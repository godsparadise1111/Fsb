import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant } from './entities/tenant.entity';

@Injectable()
export class TenantDashboardService {
  constructor(private readonly dataSource: DataSource) {}

  async get(tenantId: string, user: { sub: string; isTenantAdmin?: boolean }) {
    const tenant = await this.dataSource.getRepository(Tenant).findOne({ where: { id: tenantId } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new NotFoundException('Active tenant not found');
    const [workflow] = await this.dataSource.query(
      `SELECT
        count(DISTINCT pi.id) FILTER (WHERE pi.status='RUNNING')::int AS "runningProcesses",
        count(wt.id) FILTER (WHERE wt.status IN ('OPEN','IN_PROGRESS'))::int AS "openTasks",
        count(wt.id) FILTER (WHERE wt.status IN ('OPEN','IN_PROGRESS') AND wt."dueAt" IS NOT NULL AND wt."dueAt"<now())::int AS "overdueTasks",
        count(wt.id) FILTER (WHERE wt.status IN ('OPEN','IN_PROGRESS') AND wt."dueAt">now() AND wt."dueAt"<now()+interval '24 hours')::int AS "dueNext24Hours",
        count(DISTINCT pi.id) FILTER (WHERE pi."startedAt">=now()-interval '24 hours')::int AS "startedLast24Hours",
        count(DISTINCT pi.id) FILTER (WHERE pi."completedAt">=now()-interval '24 hours')::int AS "completedLast24Hours"
       FROM organizations o
       LEFT JOIN process_instances pi ON pi."organizationId"=o.id
       LEFT JOIN workflow_tasks wt ON wt."processInstanceId"=pi.id
       WHERE o."tenantId"=$1 AND o."isActive"=true`,
      [tenantId],
    );
    const [alerts] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS'))::int AS "activeAlerts",
              count(*) FILTER (WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS') AND
                (("acknowledgedAt" IS NULL AND "responseDueAt"<now()) OR "resolutionDueAt"<now()))::int AS "slaBreachedAlerts"
         FROM organization_operational_alerts WHERE "tenantId"=$1`, [tenantId],
    );
    const [outbox] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status='PENDING')::int AS pending,
              count(*) FILTER (WHERE status='PROCESSING')::int AS processing,
              count(*) FILTER (WHERE status='DEAD')::int AS dead,
              count(*) FILTER (WHERE status='DELIVERED' AND "deliveredAt">=now()-interval '24 hours')::int AS deliveredLast24Hours
         FROM notification_outbox WHERE "tenantId"=$1`, [tenantId],
    );
    const numeric = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, Number(value ?? 0)]));
    return {
      tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan },
      viewer: { userId: user.sub, role: user.isTenantAdmin ? 'TENANT_ADMIN' : 'TENANT_MEMBER' },
      workflow: numeric(workflow),
      alerts: numeric(alerts),
      notifications: numeric(outbox),
      measuredAt: new Date().toISOString(),
      refreshAfterSeconds: 30,
    };
  }
}
