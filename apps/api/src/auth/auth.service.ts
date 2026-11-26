import { BadRequestException, ForbiddenException, NotFoundException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../identity/entities/user.entity';
import { Role } from '../identity/entities/role.entity';
import { Permission } from '../identity/entities/permission.entity';
import { UserRole } from '../identity/entities/user-role.entity';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/refresh.dto';
import { NotificationOutboxService } from '../notifications/notification-outbox.service';
import { recordSecurityEvent } from './security-events';
import { CreateUserDto } from '../identity/dto/create-user.dto';
import {
  LOGIN_WINDOW_MINUTES,
  PASSWORD_RESET_TTL_MINUTES,
  REFRESH_REUSE_GRACE_SECONDS,
  generateRefreshToken,
  generateResetToken,
  hashRefreshToken,
  isLoginBlocked,
  isResetRequestThrottled,
  normalizeIdentity,
  passwordPolicyViolation,
  refreshTokenDays,
} from './auth-security';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

type SessionUser = Pick<User, 'id' | 'username' | 'email' | 'firstName' | 'lastName'>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Compared against when the account does not exist so that response time does not reveal valid usernames.
  private readonly dummyHash = bcrypt.hashSync('fsb-timing-equalizer', 12);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly outbox: NotificationOutboxService,
  ) {}

  async bootstrap(dto: CreateUserDto, suppliedToken?: string) {
    const expected = process.env.BOOTSTRAP_TOKEN ?? '';
    if (!expected || !suppliedToken || expected.length !== suppliedToken.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(suppliedToken))) throw new ForbiddenException('Invalid bootstrap token');
    if (await this.users.count() !== 0) throw new ConflictException('Bootstrap is closed because users already exist');
    const email = dto.email.toLowerCase();
    if (await this.users.findOne({ where: [{ email }, { username: dto.username }] })) throw new ConflictException('Email or username already exists');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const { password, ...profile } = dto;
    const user = await this.users.save(this.users.create({ ...profile, email, passwordHash, isActive: true }));
    const permissionRepo = this.users.manager.getRepository(Permission);
    const roleRepo = this.users.manager.getRepository(Role);
    const assignmentRepo = this.users.manager.getRepository(UserRole);
    let rootPermission = await permissionRepo.findOneBy({ code: '*' });
    if (!rootPermission) rootPermission = await permissionRepo.save(permissionRepo.create({ code: '*', name: 'تمام مجوزها', description: 'مجوز مدیریتی اولیه سامانه' }));
    let adminRole = await roleRepo.findOne({ where: { code: 'SYSTEM_ADMIN' }, relations: { permissions: true } });
    if (!adminRole) adminRole = roleRepo.create({ code: 'SYSTEM_ADMIN', name: 'مدیر سامانه', description: 'نقش مدیریتی اولیه', scope: 'PLATFORM', permissions: [rootPermission] });
    adminRole.scope = 'PLATFORM';
    if (!adminRole.permissions?.some(permission => permission.id === rootPermission.id)) adminRole.permissions = [...(adminRole.permissions ?? []), rootPermission];
    adminRole = await roleRepo.save(adminRole);
    await assignmentRepo.save(assignmentRepo.create({ userId: user.id, roleId: adminRole.id, organizationId: null, isActive: true }));
    return { id: user.id, username: user.username, email: user.email, firstName: user.firstName, lastName: user.lastName, role: 'SYSTEM_ADMIN' };
  }

  async login(dto: LoginDto, context: RequestContext = {}) {
    const identity = normalizeIdentity(dto.username);
    const ip = (context.ip ?? 'unknown').slice(0, 64);
    try {
      await this.assertLoginAllowed(identity, ip);
    } catch (error) {
      if (error instanceof HttpException) await recordSecurityEvent(this.users.manager, { type: 'LOGIN_BLOCKED', identity, ip, userAgent: context.userAgent, dedupeMinutes: 15 });
      throw error;
    }

    const user = await this.users.createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('(user.username = :identity OR user.email = :identity)', { identity })
      .andWhere('user.isActive = :active', { active: true }).getOne();
    const passwordOk = await bcrypt.compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user?.passwordHash || !passwordOk) {
      await this.users.manager.query('INSERT INTO auth_failed_logins (identity, "ipAddress") VALUES ($1, $2)', [identity.slice(0, 190), ip]);
      await recordSecurityEvent(this.users.manager, { type: 'LOGIN_FAILED', userId: user?.id ?? null, identity, ip, userAgent: context.userAgent });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.users.manager.query('DELETE FROM auth_failed_logins WHERE identity = $1 AND "ipAddress" = $2', [identity.slice(0, 190), ip]);
    if (Math.random() < 0.01) {
      await this.users.manager.query(`DELETE FROM auth_failed_logins WHERE "attemptedAt" < now() - interval '30 days'`);
    }
    const session = await this.createSession(user, context);
    await recordSecurityEvent(this.users.manager, { type: 'LOGIN_SUCCESS', userId: user.id, identity, ip, userAgent: context.userAgent });
    // Lets the web app pick the customer account without a second round trip (X-Tenant-Id is mandatory for multi-tenant users).
    const tenants = await this.users.manager.query(
      `SELECT tm."tenantId" AS id, tm."isTenantAdmin" AS "isTenantAdmin", COALESCE(to_jsonb(t)->>'name', '') AS name
         FROM tenant_memberships tm JOIN tenants t ON t.id = tm."tenantId" AND t.status = 'ACTIVE'
        WHERE tm."userId" = $1 AND tm."isActive" = true ORDER BY 3, 1`,
      [user.id],
    );
    return { ...session, user: { id: user.id, username: user.username, email: user.email, firstName: user.firstName, lastName: user.lastName }, tenants };
  }

  /** Exchanges a refresh token for a new access token and a NEW refresh token (rotation). */
  async refresh(refreshToken: string, context: RequestContext = {}) {
    const tokenHash = hashRefreshToken(refreshToken);
    // A transaction that throws is rolled back, so the outcome is returned and the error raised afterwards;
    // otherwise the family revocation on token reuse would be undone together with the failed request.
    const outcome = await this.users.manager.transaction(async (manager): Promise<{ error: string; reusedByUserId?: string } | { session: Awaited<ReturnType<AuthService['createSession']>> }> => {
      const [row] = await manager.query(
        `SELECT id, "userId", "familyId", "expiresAt" <= now() AS expired, "rotatedAt", "revokedAt",
                ("rotatedAt" IS NOT NULL AND now() - "rotatedAt" < make_interval(secs => $2::int)) AS "recentlyRotated"
           FROM auth_refresh_tokens WHERE "tokenHash" = $1 FOR UPDATE`,
        [tokenHash, REFRESH_REUSE_GRACE_SECONDS],
      );
      if (!row || row.revokedAt) return { error: 'Invalid refresh token' };
      if (row.rotatedAt) {
        if (row.recentlyRotated) return { error: 'Refresh token was just used; retry with the newest token' };
        await manager.query('UPDATE auth_refresh_tokens SET "revokedAt" = now() WHERE "familyId" = $1 AND "revokedAt" IS NULL', [row.familyId]);
        return { error: 'Refresh token reuse detected; the session was revoked, sign in again', reusedByUserId: row.userId };
      }
      if (row.expired) return { error: 'Refresh token expired' };
      const user = await manager.getRepository(User).findOne({ where: { id: row.userId, isActive: true } });
      if (!user) return { error: 'User is no longer active' };
      await manager.query('UPDATE auth_refresh_tokens SET "rotatedAt" = now() WHERE id = $1', [row.id]);
      return { session: await this.createSession(user, context, row.familyId, manager) };
    });
    if ('error' in outcome) {
      if (outcome.reusedByUserId) await recordSecurityEvent(this.users.manager, { type: 'TOKEN_REUSE_DETECTED', userId: outcome.reusedByUserId, ip: context.ip, userAgent: context.userAgent });
      throw new UnauthorizedException(outcome.error);
    }
    return outcome.session;
  }

  /** Revokes the current session (by access-token `sid`) and/or the session owning the supplied refresh token. */
  async logout(userId: string, sessionId?: string | null, refreshToken?: string, context: RequestContext = {}) {
    if (sessionId) {
      await this.users.manager.query('UPDATE auth_refresh_tokens SET "revokedAt" = now() WHERE "familyId" = $1 AND "userId" = $2 AND "revokedAt" IS NULL', [sessionId, userId]);
    }
    if (refreshToken) {
      await this.users.manager.query(
        `UPDATE auth_refresh_tokens SET "revokedAt" = now()
          WHERE "userId" = $2 AND "revokedAt" IS NULL
            AND "familyId" IN (SELECT "familyId" FROM auth_refresh_tokens WHERE "tokenHash" = $1 AND "userId" = $2)`,
        [hashRefreshToken(refreshToken), userId],
      );
    }
    await recordSecurityEvent(this.users.manager, { type: 'LOGOUT', userId, ip: context.ip, userAgent: context.userAgent });
    return { success: true };
  }

  async logoutAll(userId: string, context: RequestContext = {}) {
    await this.users.manager.query('UPDATE auth_refresh_tokens SET "revokedAt" = now() WHERE "userId" = $1 AND "revokedAt" IS NULL', [userId]);
    await recordSecurityEvent(this.users.manager, { type: 'LOGOUT_ALL', userId, ip: context.ip, userAgent: context.userAgent });
    return { success: true };
  }

  /**
   * Changes the caller's password. Wrong current passwords count toward the same lockout as failed logins,
   * and every OTHER session of the user is revoked so a stolen session cannot outlive the password change.
   */
  async changePassword(userId: string, currentSessionId: string | null | undefined, dto: ChangePasswordDto, context: RequestContext = {}) {
    const user = await this.users.createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :userId AND user.isActive = :active', { userId, active: true }).getOne();
    if (!user?.passwordHash) throw new UnauthorizedException('User is no longer active');
    const identity = normalizeIdentity(user.username).slice(0, 190);
    const ip = (context.ip ?? 'unknown').slice(0, 64);
    await this.assertLoginAllowed(identity, ip);
    if (!await bcrypt.compare(dto.currentPassword, user.passwordHash)) {
      await this.users.manager.query('INSERT INTO auth_failed_logins (identity, "ipAddress") VALUES ($1, $2)', [identity, ip]);
      await recordSecurityEvent(this.users.manager, { type: 'PASSWORD_CHANGE_FAILED', userId, identity, ip, userAgent: context.userAgent });
      throw new UnauthorizedException('Current password is incorrect');
    }
    const violation = passwordPolicyViolation(dto.newPassword, { username: user.username, email: user.email });
    if (violation) throw new BadRequestException(violation);
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) throw new BadRequestException('New password must differ from the current password');
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.users.manager.transaction(async manager => {
      await manager.getRepository(User).update({ id: userId }, { passwordHash });
      await manager.query(
        `UPDATE auth_refresh_tokens SET "revokedAt" = now()
          WHERE "userId" = $1 AND "revokedAt" IS NULL AND ("familyId" <> $2::uuid OR $2::uuid IS NULL)`,
        [userId, currentSessionId ?? null],
      );
    });
    await this.users.manager.query('DELETE FROM auth_failed_logins WHERE identity = $1 AND "ipAddress" = $2', [identity, ip]);
    await recordSecurityEvent(this.users.manager, { type: 'PASSWORD_CHANGED', userId, ip, userAgent: context.userAgent });
    return { success: true, otherSessionsRevoked: true };
  }

  /**
   * Always answers the same way so the endpoint cannot be used to discover which e-mail addresses have accounts.
   * Accounts without an active tenant membership (platform operators) cannot reset by e-mail.
   */
  async requestPasswordReset(email: string, context: RequestContext = {}) {
    const accepted = { accepted: true };
    try {
      const normalized = normalizeIdentity(email).slice(0, 190);
      const ip = (context.ip ?? 'unknown').slice(0, 64);
      const [target] = await this.users.manager.query(
        `SELECT u.id, tm."tenantId"
           FROM users u
           JOIN tenant_memberships tm ON tm."userId" = u.id AND tm."isActive" = true
           JOIN tenants t ON t.id = tm."tenantId" AND t.status = 'ACTIVE'
          WHERE lower(u.email) = $1 AND u."isActive" = true
          ORDER BY tm."tenantId" LIMIT 1`,
        [normalized],
      );
      if (!target) return accepted;
      const [counts] = await this.users.manager.query(
        `SELECT count(*) FILTER (WHERE "userId" = $1)::int AS "byUser", count(*) FILTER (WHERE "requestedIp" = $2)::int AS "byIp"
           FROM auth_password_resets WHERE "createdAt" > now() - interval '1 hour'`,
        [target.id, ip],
      );
      if (isResetRequestThrottled({ byUser: counts?.byUser ?? 0, byIp: counts?.byIp ?? 0 })) return accepted;
      const token = generateResetToken();
      await recordSecurityEvent(this.users.manager, { type: 'PASSWORD_RESET_REQUESTED', userId: target.id, ip, userAgent: context.userAgent });
      await this.users.manager.transaction(async manager => {
        await manager.query('UPDATE auth_password_resets SET "usedAt" = now() WHERE "userId" = $1 AND "usedAt" IS NULL', [target.id]);
        const [row] = await manager.query(
          `INSERT INTO auth_password_resets ("userId", "tokenHash", "requestedIp", "expiresAt")
           VALUES ($1, $2, $3, now() + make_interval(mins => $4::int)) RETURNING id`,
          [target.id, hashRefreshToken(token), ip, PASSWORD_RESET_TTL_MINUTES],
        );
        await this.outbox.enqueue(manager, {
          tenantId: target.tenantId,
          eventType: 'auth.password.reset.requested',
          recipient: normalized,
          subject: 'Reset your F-S password',
          dedupeKey: createHash('sha256').update(`password-reset:${row.id}`).digest('hex'),
          payload: { resetId: row.id, resetPath: `/reset-password?token=${token}` },
        });
      });
    } catch (error) {
      // Failures (for example a missing outbox key) must not change the response, or they would reveal account existence.
      this.logger.warn(`Password reset request could not be queued: ${String(error).slice(0, 300)}`);
    }
    return accepted;
  }

  /** Consumes a reset token once, sets the new password and revokes every session of the user. */
  async confirmPasswordReset(token: string, newPassword: string, context: RequestContext = {}) {
    const tokenHash = hashRefreshToken(token);
    const outcome = await this.users.manager.transaction(async (manager): Promise<{ error: string; policy?: boolean } | { ok: true; userId: string }> => {
      const [row] = await manager.query(
        `SELECT id, "userId", "expiresAt" <= now() AS expired, "usedAt" FROM auth_password_resets WHERE "tokenHash" = $1 FOR UPDATE`,
        [tokenHash],
      );
      const invalid = { error: 'Invalid or expired password reset link' };
      if (!row || row.usedAt || row.expired) return invalid;
      const user = await manager.getRepository(User).findOne({ where: { id: row.userId, isActive: true } });
      if (!user) return invalid;
      const violation = passwordPolicyViolation(newPassword, { username: user.username, email: user.email });
      // A weak password does not burn the link, so the person can try again.
      if (violation) return { error: violation, policy: true };
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await manager.getRepository(User).update({ id: user.id }, { passwordHash });
      await manager.query('UPDATE auth_password_resets SET "usedAt" = now() WHERE "userId" = $1 AND "usedAt" IS NULL', [user.id]);
      await manager.query('UPDATE auth_refresh_tokens SET "revokedAt" = now() WHERE "userId" = $1 AND "revokedAt" IS NULL', [user.id]);
      return { ok: true, userId: user.id };
    });
    if ('error' in outcome) throw new BadRequestException(outcome.error);
    await recordSecurityEvent(this.users.manager, { type: 'PASSWORD_RESET_COMPLETED', userId: outcome.userId, ip: context.ip, userAgent: context.userAgent });
    return { success: true };
  }

  async me(userId: string) {
    const user = await this.users.findOne({ where: { id: userId, isActive: true }, relations: { positions: { position: { unit: true } }, roles: { role: { permissions: true } } } });
    if (!user) throw new UnauthorizedException('User is no longer active');
    return { id: user.id, username: user.username, email: user.email, firstName: user.firstName, lastName: user.lastName, positions: user.positions, roles: user.roles };
  }

  /** Active sign-ins of the user (one row per refresh-token family). */
  async listSessions(userId: string, currentSessionId?: string | null) {
    const rows = await this.users.manager.query(
      `SELECT "familyId" AS id, min("createdAt") AS "startedAt", max("createdAt") AS "lastRefreshedAt",
              (array_agg("userAgent" ORDER BY "createdAt" DESC))[1] AS "userAgent",
              (array_agg("ipAddress" ORDER BY "createdAt" DESC))[1] AS "ipAddress",
              max("expiresAt") AS "expiresAt"
         FROM auth_refresh_tokens
        WHERE "userId" = $1 AND "revokedAt" IS NULL
        GROUP BY "familyId" HAVING max("expiresAt") > now()
        ORDER BY max("createdAt") DESC LIMIT 50`,
      [userId],
    );
    return rows.map((row: { id: string }) => ({ ...row, current: row.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string, context: RequestContext = {}) {
    const [active] = await this.users.manager.query(
      'SELECT 1 AS ok FROM auth_refresh_tokens WHERE "familyId" = $1 AND "userId" = $2 AND "revokedAt" IS NULL LIMIT 1',
      [sessionId, userId],
    );
    if (!active) throw new NotFoundException('Session not found');
    await this.users.manager.query(
      'UPDATE auth_refresh_tokens SET "revokedAt" = now() WHERE "familyId" = $1 AND "userId" = $2 AND "revokedAt" IS NULL',
      [sessionId, userId],
    );
    await recordSecurityEvent(this.users.manager, { type: 'SESSION_REVOKED', userId, ip: context.ip, userAgent: context.userAgent });
    return { success: true };
  }

  async myRecentSecurityEvents(userId: string) {
    return this.users.manager.query(
      `SELECT "eventType", "ipAddress", "userAgent", "createdAt"
         FROM auth_security_events WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
      [userId],
    );
  }

  private async assertLoginAllowed(identity: string, ip: string) {
    const [counts] = await this.users.manager.query(
      `SELECT count(*) FILTER (WHERE "ipAddress" = $2)::int AS pair, count(*)::int AS identity
         FROM auth_failed_logins
        WHERE identity = $1 AND "attemptedAt" > now() - make_interval(mins => $3::int)`,
      [identity.slice(0, 190), ip, LOGIN_WINDOW_MINUTES],
    );
    if (isLoginBlocked({ pair: counts?.pair ?? 0, identity: counts?.identity ?? 0 })) {
      throw new HttpException('Too many failed sign-in attempts. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async createSession(user: SessionUser, context: RequestContext, familyId: string = randomUUID(), manager: EntityManager = this.users.manager) {
    const refreshToken = generateRefreshToken();
    const days = refreshTokenDays();
    await manager.query(
      `INSERT INTO auth_refresh_tokens ("userId", "familyId", "tokenHash", "userAgent", "ipAddress", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6::int))`,
      [user.id, familyId, hashRefreshToken(refreshToken), (context.userAgent ?? '').slice(0, 255) || null, (context.ip ?? '').slice(0, 64) || null, days],
    );
    const accessToken = await this.jwt.signAsync({ sub: user.id, username: user.username, email: user.email, sid: familyId });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
      refreshToken,
      refreshExpiresInDays: days,
    };
  }
}
