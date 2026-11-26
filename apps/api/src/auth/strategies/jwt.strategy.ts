import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '../../identity/entities/user.entity';
import { TenantMembership } from '../../tenant/entities/tenant-membership.entity';

const jwtSecret = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'development-only-change-this-secret');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters before starting F-S in production.');

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(TenantMembership) private readonly memberships: Repository<TenantMembership>,
  ) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: jwtSecret, passReqToCallback: true });
  }

  async validate(request: { headers?: Record<string, string | string[] | undefined> }, payload: { sub: string; username: string; email: string; sid?: string }) {
    const activeUser = await this.users.exist({ where: { id: payload.sub, isActive: true } });
    if (!activeUser) throw new UnauthorizedException('User account is inactive or no longer exists');

    // Tokens issued after sessions were introduced carry `sid`; logout revokes the session and kills the access token too.
    // Tokens without `sid` (issued before this change) stay valid until they expire.
    if (payload.sid) {
      const [session] = await this.users.manager.query(
        'SELECT 1 AS ok FROM auth_refresh_tokens WHERE "familyId" = $1 AND "userId" = $2 AND "revokedAt" IS NULL LIMIT 1',
        [payload.sid, payload.sub],
      );
      if (!session) throw new UnauthorizedException('Session was ended; sign in again');
    }

    const requestedTenantId = request.headers?.['x-tenant-id'];
    if (Array.isArray(requestedTenantId)) throw new UnauthorizedException('Invalid tenant context');
    const memberships = await this.memberships.find({
      where: { userId: payload.sub, isActive: true },
      relations: { tenant: true },
    });
    let selected = requestedTenantId ? memberships.find(item => item.tenantId === requestedTenantId) : undefined;
    if (requestedTenantId && (!selected || selected.tenant?.status !== 'ACTIVE')) throw new UnauthorizedException('User is not an active member of an active selected tenant');
    if (!requestedTenantId && memberships.length === 1) selected = memberships[0];
    const invitationAcceptance = String((request as any).url ?? (request as any).path ?? '').split('?')[0].endsWith('/tenant/invitations/accept');
    if (!requestedTenantId && memberships.length > 1 && !invitationAcceptance) throw new UnauthorizedException('X-Tenant-Id is required when the user belongs to multiple tenants');
    if (selected && selected.tenant?.status !== 'ACTIVE') throw new UnauthorizedException('The selected customer account is suspended or closed');

    return {
      sub: payload.sub,
      username: payload.username,
      email: payload.email,
      sid: payload.sid ?? null,
      tenantId: selected?.tenantId ?? null,
      tenantMembershipId: selected?.id ?? null,
      isTenantAdmin: selected?.isTenantAdmin ?? false,
    };
  }
}
