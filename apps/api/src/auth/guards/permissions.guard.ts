import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../../identity/entities/user-role.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(UserRole) private readonly assignments: Repository<UserRole>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.sub) throw new ForbiddenException('Authenticated user context is missing');

    const platformOnly = required.some(code => code.startsWith('tenants.'));
    const organizationId = request.params?.organizationId ?? request.body?.organizationId ?? request.query?.organizationId ?? null;
    const grants = await this.assignments.find({
      where: { userId: user.sub, isActive: true },
      relations: { role: { permissions: true }, organization: true },
    });
    const platformWildcard = grants.some(assignment =>
      assignment.role?.isActive && assignment.role.scope === 'PLATFORM' &&
      (assignment.role.permissions ?? []).some(permission => permission.code === '*'),
    );
    if (platformWildcard) return true;

    // A verified tenant context cannot be used to address another tenant's organization.
    let selectedOrganization: Organization | null = null;
    if (organizationId) {
      selectedOrganization = await this.organizations.findOne({ where: { id: organizationId, isActive: true } });
      if (!selectedOrganization) throw new ForbiddenException('Organization is unavailable in the current access context');
      if (!user.tenantId || selectedOrganization.tenantId !== user.tenantId) {
        throw new ForbiddenException('Cross-tenant access is not allowed');
      }
    }

    // Tenant administrators are elevated only inside their verified active tenant.
    // Platform-management permissions always remain platform-only.
    if (!platformOnly && user.isTenantAdmin && user.tenantId && required.every(code => code.startsWith('tenant.members.'))) return true;
    if (!platformOnly && user.isTenantAdmin && user.tenantId && selectedOrganization?.tenantId === user.tenantId) return true;

    const grantedCodes = new Set<string>();
    for (const assignment of grants) {
      if (!assignment.role?.isActive || assignment.role.scope !== 'ORGANIZATION') continue;
      if (!organizationId || assignment.organizationId !== organizationId) continue;
      if (!user.tenantId || assignment.organization?.tenantId !== user.tenantId) continue;
      for (const permission of assignment.role.permissions ?? []) {
        if (permission.code !== '*') grantedCodes.add(permission.code);
      }
    }

    if (required.every(code => grantedCodes.has(code))) return true;
    throw new ForbiddenException('Insufficient permissions');
  }
}
