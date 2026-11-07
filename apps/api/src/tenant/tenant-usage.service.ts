import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant } from './entities/tenant.entity';

@Injectable()
export class TenantUsageService {
  constructor(private readonly dataSource: DataSource) {}

  async get(tenantId: string) {
    const tenant = await this.dataSource.getRepository(Tenant).findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'ACTIVE') throw new BadRequestException('Usage is available only for active tenants');

    const [usage] = await this.dataSource.query(
      `SELECT
        (SELECT count(*) FROM organizations o WHERE o."tenantId" = $1 AND o."isActive" = true) AS organizations,
        (SELECT count(*) FROM organization_units ou INNER JOIN organizations o ON o.id = ou."organizationId" WHERE o."tenantId" = $1 AND ou."isActive" = true) AS units,
        (SELECT count(*) FROM positions p INNER JOIN organization_units ou ON ou.id = p."organizationUnitId" INNER JOIN organizations o ON o.id = ou."organizationId" WHERE o."tenantId" = $1 AND p."isActive" = true) AS positions,
        (SELECT count(*) FROM tenant_memberships tm INNER JOIN users u ON u.id = tm."userId" AND u."isActive" = true WHERE tm."tenantId" = $1 AND tm."isActive" = true) AS activeMembers,
        (SELECT count(*) FROM process_definitions pd INNER JOIN organizations o ON o.id = pd."organizationId" WHERE o."tenantId" = $1) AS processDefinitions,
        (SELECT count(*) FROM form_definitions fd INNER JOIN organizations o ON o.id = fd."organizationId" WHERE o."tenantId" = $1) AS formDefinitions,
        (SELECT count(*) FROM process_instances pi INNER JOIN organizations o ON o.id = pi."organizationId" WHERE o."tenantId" = $1) AS processInstances,
        (SELECT count(*) FROM workflow_tasks wt INNER JOIN process_instances pi ON pi.id = wt."processInstanceId" INNER JOIN organizations o ON o.id = pi."organizationId" WHERE o."tenantId" = $1) AS workflowTasks,
        (SELECT count(*) FROM form_submissions fs INNER JOIN form_versions fv ON fv.id = fs."formVersionId" INNER JOIN form_definitions fd ON fd.id = fv."definitionId" INNER JOIN organizations o ON o.id = fd."organizationId" WHERE o."tenantId" = $1) AS formSubmissions,
        (SELECT count(*) FROM tenant_invitations ti WHERE ti."tenantId" = $1 AND ti."acceptedAt" IS NULL AND ti."revokedAt" IS NULL AND ti."expiresAt" > now()) AS pendingInvitations,
        (SELECT count(*) FROM notification_outbox no WHERE no."tenantId" = $1 AND no.status IN ('PENDING', 'PROCESSING')) AS pendingNotifications,
        (SELECT count(*) FROM notification_outbox no WHERE no."tenantId" = $1 AND no.status = 'DEAD') AS failedNotifications,
        (SELECT count(*) FROM tenant_audit_logs al WHERE al."tenantId" = $1) AS auditEvents`,
      [tenantId],
    );

    const numericUsage = Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, Number(value)]));
    return {
      tenant: { id: tenant.id, name: tenant.name, code: tenant.code, plan: tenant.plan, status: tenant.status },
      measuredAt: new Date().toISOString(),
      usage: numericUsage,
    };
  }
}
