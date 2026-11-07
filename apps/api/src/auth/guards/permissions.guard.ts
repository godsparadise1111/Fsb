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

  private async resolveOrganizationId(request: any): Promise<string | null> {
    const direct = request.params?.organizationId ?? request.body?.organizationId ??
      request.query?.organizationId ?? null;

    const candidates = [
      request.params?.id,
      request.params?.versionId,
      request.params?.unitId,
      request.params?.positionId,
      request.body?.processVersionId,
      request.body?.formVersionId,
      request.body?.processInstanceId,
      request.body?.organizationUnitId,
      request.body?.parentId,
    ].filter((value): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
    if (!candidates.length) return direct;

    // Resolve resource ownership from the database, never from a caller-supplied tenantId.
    const rows = await this.dataSource.query(
      `SELECT id AS "resourceId", "organizationId" FROM organizations WHERE id = ANY($1::uuid[])
       UNION ALL
       SELECT id AS "resourceId", "organizationId" FROM process_definitions WHERE id = ANY($1::uuid[])
       UNION ALL
       SELECT pv.id AS "resourceId", pd."organizationId"
         FROM process_versions pv INNER JOIN process_definitions pd ON pd.id = pv."definitionId"
        WHERE pv.id = ANY($1::uuid[])
       UNION ALL
       SELECT fd.id AS "resourceId", fd."organizationId" FROM form_definitions fd WHERE fd.id = ANY($1::uuid[])
       UNION ALL
       SELECT fv.id AS "resourceId", fd."organizationId"
         FROM form_versions fv INNER JOIN form_definitions fd ON fd.id = fv."definitionId"
        WHERE fv.id = ANY($1::uuid[])
       UNION ALL
       SELECT pi.id AS "resourceId", pi."organizationId" FROM process_instances pi WHERE pi.id = ANY($1::uuid[])
       UNION ALL
       SELECT wt.id AS "resourceId", pi."organizationId"
         FROM workflow_tasks wt INNER JOIN process_instances pi ON pi.id = wt."processInstanceId"
        WHERE wt.id = ANY($1::uuid[])
       UNION ALL
       SELECT ou.id AS "resourceId", ou."organizationId" FROM organization_units ou WHERE ou.id = ANY($1::uuid[])
       UNION ALL
       SELECT p.id AS "resourceId", ou."organizationId"
         FROM positions p INNER JOIN organization_units ou ON ou.id = p."organizationUnitId"
        WHERE p.id = ANY($1::uuid[])`,
      [candidates],
    );
    const found = rows.find((row: { resourceId: string }) => candidates.includes(row.resourceId));
    if (!found?.organizationId) return null;
    // A caller-supplied organizationId is only a consistency assertion, never the source of truth.
    if (direct && direct !== found.organizationId) throw new ForbiddenException('Requested organization does not own this resource');
    return found.organizationId;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.sub) throw new ForbiddenException('Authenticated user context is missing');

    const grants = await this.assignments.find({
      where: { userId: user.sub, isActive: true },
      relations: { role: { permissions: true }, organization: true },
    });
    const platformGrants = grants.filter(item => item.role?.isActive && item.role.scope === 'PLATFORM');
    const platformCodes = new Set((platformGrants.flatMap(item => item.role.permissions ?? [])).map(item => item.code));
    if (platformCodes.has('*') || required.every(code => platformCodes.has(code))) return true;

    // Platform administration is never inherited by a tenant administrator.
    if (required.some(code => code.startsWith('tenants.'))) {
      throw new ForbiddenException('Platform-level permission required');
    }
    if (!user.tenantId) throw new ForbiddenException('An active tenant context is required');

    const organizationId = await this.resolveOrganizationId(request);
    let organization: Organization | null = null;
    if (organizationId) {
      organization = await this.organizations.findOne({ where: { id: organizationId, isActive: true } });
      if (!organization || organization.tenantId !== user.tenantId) {
        throw new ForbiddenException('Resource is outside the active tenant');
      }
    }

    // The personal inbox is safe for every active tenant member: the service constrains
    // rows by the authenticated user id and the verified tenant id.
    const requestPath = String(request.path ?? request.url ?? '').split('?')[0];
    if (request.method === 'GET' && requestPath.endsWith('/tasks/my') && required.length === 1 && required[0] === 'workflow.tasks.read') return true;

    // Tenant administrators get only explicitly listed tenant-level capabilities.
    if (user.isTenantAdmin) {
      if (required.every(code => ['tenant.members.read', 'tenant.members.manage', 'tenant.organizations.manage'].includes(code))) return true;
      if (!organizationId && required.every(code =>
        ['organization.read', 'processes.read', 'forms.read', 'workflow.tasks.read'].includes(code),
      )) return true;
      if (organization && required.every(code =>
        ['organization.read', 'organization.manage', 'processes.read', 'processes.manage', 'processes.publish',
         'forms.read', 'forms.manage', 'forms.publish', 'forms.submit', 'workflow.start',
         'workflow.tasks.read', 'workflow.tasks.act', 'workflow.history.read'].includes(code),
      )) return true;
    }

    // Non-admin users must have an explicit organization-scoped grant. Collection
    // endpoints without an organization filter are intentionally not implicitly granted.

    const grantedCodes = new Set<string>();
    for (const assignment of grants) {
      if (!assignment.role?.isActive || assignment.role.scope !== 'ORGANIZATION') continue;
      if (!organizationId || assignment.organizationId !== organizationId) continue;
      if (assignment.organization?.tenantId !== user.tenantId) continue;
      for (const permission of assignment.role.permissions ?? []) {
        if (permission.code !== '*') grantedCodes.add(permission.code);
      }
    }

    if (required.every(code => grantedCodes.has(code))) return true;
    throw new ForbiddenException('Insufficient permissions');
  }
}
