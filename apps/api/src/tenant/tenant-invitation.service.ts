import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { RegisterTenantInvitationDto } from './dto/register-tenant-invitation.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { TenantInvitation } from './entities/tenant-invitation.entity';
import { TenantMembership } from './entities/tenant-membership.entity';
import { User } from '../identity/entities/user.entity';

@Injectable()
export class TenantInvitationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(TenantInvitation) private readonly invitations: Repository<TenantInvitation>,
  ) {}

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(tenantId: string, inviterUserId: string, emailInput: string, isTenantAdmin = false) {
    const email = emailInput.trim().toLowerCase();
    return this.dataSource.transaction(async manager => {
      const tenant = await manager.findOne(Tenant, { where: { id: tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      if (tenant.status !== 'ACTIVE') throw new BadRequestException('Invitations require an active tenant');
      const inviterMembership = await manager.getRepository(TenantMembership).findOneBy({
        tenantId, userId: inviterUserId, isActive: true, isTenantAdmin: true,
      });
      if (!inviterMembership) throw new BadRequestException('Only an active tenant administrator can invite members');

      const existingUser = await manager.getRepository(User).createQueryBuilder('user')
        .where('LOWER(user.email) = :email', { email }).getOne();
      if (existingUser) {
        if (!existingUser.isActive) throw new ConflictException('The existing account is inactive; reactivate it before sending an invitation');
        const existingMembership = await manager.getRepository(TenantMembership).findOneBy({
          tenantId, userId: existingUser.id, isActive: true,
        });
        if (existingMembership) throw new ConflictException('This user is already an active tenant member');
      }
      // Serialize invitations for the same tenant/email pair to avoid concurrent duplicate sends.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [tenantId, email]);
      const pending = await manager.getRepository(TenantInvitation).createQueryBuilder('invitation')
        .where('invitation.tenantId = :tenantId AND LOWER(invitation.email) = :email', { tenantId, email })
        .andWhere('invitation.acceptedAt IS NULL AND invitation.revokedAt IS NULL AND invitation.expiresAt > :now', { now: new Date() })
        .getOne();
      if (pending) throw new ConflictException('A valid invitation already exists for this email');

      const token = randomBytes(32).toString('base64url');
      const repository = manager.getRepository(TenantInvitation);
      const invitation = repository.create({
        tenantId, email, tokenHash: this.hashToken(token), invitedByUserId,
        isTenantAdmin, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      const saved = await repository.save(invitation);
      // The raw token is returned once for delivery by the trusted notification channel.
      return { id: saved.id, email: saved.email, isTenantAdmin: saved.isTenantAdmin, expiresAt: saved.expiresAt, token };
    });
  }

  async list(tenantId: string) {
    return this.invitations.find({
      where: { tenantId },
      select: { id: true, tenantId: true, email: true, invitedByUserId: true, isTenantAdmin: true, expiresAt: true, acceptedAt: true, revokedAt: true, acceptedByUserId: true, createdAt: true },
      order: { createdAt: 'DESC' },
    });
  }

  async revoke(tenantId: string, invitationId: string) {
    return this.dataSource.transaction(async manager => {
      const invitation = await manager.findOne(TenantInvitation, {
        where: { id: invitationId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invitation) throw new NotFoundException('Invitation not found');
      if (invitation.acceptedAt) throw new BadRequestException('An accepted invitation cannot be revoked');
      if (invitation.revokedAt) return { id: invitation.id, revoked: true };
      invitation.revokedAt = new Date();
      await manager.save(invitation);
      return { id: invitation.id, revoked: true };
    });
  }

  async register(token: string, dto: RegisterTenantInvitationDto) {
    const tokenHash = this.hashToken(token);
    return this.dataSource.transaction(async manager => {
      const repository = manager.getRepository(TenantInvitation);
      const invitation = await repository.createQueryBuilder('invitation')
        .addSelect('invitation.tokenHash')
        .where('invitation.tokenHash = :tokenHash', { tokenHash })
        .setLock('pessimistic_write')
        .getOne();
      if (!invitation) throw new NotFoundException('Invitation is invalid or no longer available');
      if (invitation.acceptedAt || invitation.revokedAt) throw new BadRequestException('Invitation has already been used or revoked');
      if (invitation.expiresAt.getTime() <= Date.now()) throw new BadRequestException('Invitation has expired');

      const tenant = await manager.findOne(Tenant, { where: { id: invitation.tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant || tenant.status !== 'ACTIVE') throw new BadRequestException('The invited tenant is not active');
      const userRepository = manager.getRepository(User);
      const existingEmail = await userRepository.createQueryBuilder('user')
        .where('LOWER(user.email) = :email', { email: invitation.email }).getOne();
      if (existingEmail) throw new ConflictException('An account already exists for this email; sign in and accept the invitation instead');
      if (await userRepository.exist({ where: { username: dto.username } })) throw new ConflictException('Username already exists');

      const passwordHash = await bcrypt.hash(dto.password, 12);
      const user = await userRepository.save(userRepository.create({
        firstName: dto.firstName.trim(), lastName: dto.lastName.trim(),
        email: invitation.email, username: dto.username, passwordHash,
        phone: dto.phone ?? null, isActive: true,
      }));
      const membershipRepository = manager.getRepository(TenantMembership);
      const membership = await membershipRepository.save(membershipRepository.create({
        tenantId: invitation.tenantId, userId: user.id, isActive: true,
        isTenantAdmin: invitation.isTenantAdmin, acceptedAt: new Date(),
      }));
      invitation.acceptedAt = new Date();
      invitation.acceptedByUserId = user.id;
      await repository.save(invitation);
      return {
        registered: true,
        user: { id: user.id, email: user.email, username: user.username },
        tenant: { id: tenant.id, name: tenant.name },
        isTenantAdmin: membership.isTenantAdmin,
        nextStep: 'Sign in, then send X-Tenant-Id with the tenant id on subsequent requests.',
      };
    });
  }

  async accept(token: string, userId: string) {
    const tokenHash = this.hashToken(token);
    return this.dataSource.transaction(async manager => {
      const repository = manager.getRepository(TenantInvitation);
      const invitation = await repository.createQueryBuilder('invitation')
        .addSelect('invitation.tokenHash')
        .where('invitation.tokenHash = :tokenHash', { tokenHash })
        .setLock('pessimistic_write')
        .getOne();
      if (!invitation) throw new NotFoundException('Invitation is invalid or no longer available');
      if (invitation.acceptedAt || invitation.revokedAt) throw new BadRequestException('Invitation has already been used or revoked');
      if (invitation.expiresAt.getTime() <= Date.now()) throw new BadRequestException('Invitation has expired');

      const tenant = await manager.findOne(Tenant, { where: { id: invitation.tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant || tenant.status !== 'ACTIVE') throw new BadRequestException('The invited tenant is not active');
      const user = await manager.getRepository(User).findOneBy({ id: userId, isActive: true });
      if (!user) throw new NotFoundException('Active user not found');
      if (user.email.trim().toLowerCase() !== invitation.email) throw new BadRequestException('The invitation email does not match the authenticated account');

      const memberships = manager.getRepository(TenantMembership);
      let membership = await memberships.findOne({ where: { tenantId: invitation.tenantId, userId }, lock: { mode: 'pessimistic_write' } });
      if (membership?.isActive) throw new ConflictException('User is already an active member of this tenant');
      if (membership) {
        membership.isActive = true;
        membership.isTenantAdmin = invitation.isTenantAdmin;
        membership.acceptedAt = new Date();
      } else {
        membership = memberships.create({ tenantId: invitation.tenantId, userId, isActive: true, isTenantAdmin: invitation.isTenantAdmin, acceptedAt: new Date() });
      }
      await memberships.save(membership);
      invitation.acceptedAt = new Date();
      invitation.acceptedByUserId = userId;
      await repository.save(invitation);
      return { accepted: true, tenantId: invitation.tenantId, tenantName: tenant.name, isTenantAdmin: membership.isTenantAdmin };
    });
  }
}
