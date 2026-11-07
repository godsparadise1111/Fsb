import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserRole } from '../../identity/entities/user-role.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
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
    let organizationId = request.params?.organizationId ?? request.body?.organizationId ?? request.query?.organizationId ?? null;
    const resourceId = request.params?.id ?? request.params?.versionId ?? null;
    if (!organizationId && resourceId) {
      const rows = await this.dataSource.query(
        `SELECT "organizationId" AS "organizationId" FROM process_definitions WHERE id = $1
         UNION SELECT fd."organizationId" AS "organizationId" FROM form_versions fv
           INNER JOIN form_definitions fd ON fd.id = fv."definitionId" WHERE fv.id = $1
         UNION SELECT pi."organizationId" AS "organizationId" FROM workflow_tasks wt
           INNER JOIN process_instances pi ON pi.id = wt."processInstanceId" WHERE wt.id = $1
         LIMIT 1`,
        [resourceId],
      );
      organizationId = rows[0]?.organizationId ?? null;
    }
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
    if (!platformOnly && user.tenantId && required.length === 1 && required[0] === 'workflow.tasks.read') return true;
    if (!platformOnly && user.isTenantAdmin && user.tenantId && request.method === 'GET' && ['/api/organizations', '/api/process-definitions', '/api/forms'].includes(request.path)) return true;
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
