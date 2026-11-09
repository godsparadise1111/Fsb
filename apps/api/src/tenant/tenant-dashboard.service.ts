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
        count(DISTINCT wt.id) FILTER (WHERE wt.status IN ('OPEN','IN_PROGRESS'))::int AS "openTasks",
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

  async getPersonal(tenantId: string, userId: string) {
    const [member] = await this.dataSource.query(
      `SELECT 1 FROM tenant_memberships tm JOIN tenants t ON t.id=tm."tenantId"
        JOIN users u ON u.id=tm."userId"
       WHERE tm."tenantId"=$1 AND tm."userId"=$2 AND tm."isActive"=true
         AND t.status='ACTIVE' AND u."isActive"=true`, [tenantId,userId],
    );
    if (!member) throw new NotFoundException('Active tenant membership not found');
    const [metrics] = await this.dataSource.query(
      `WITH visible_tasks AS (
         SELECT DISTINCT wt.id,wt.status,wt."dueAt",wt."createdAt",wt."completedAt"
           FROM workflow_tasks wt
           JOIN process_instances pi ON pi.id=wt."processInstanceId" AND pi."tenantId"=$1
           WHERE wt."tenantId"=$1 AND wt.status IN ('OPEN','IN_PROGRESS')
             AND (
               EXISTS (SELECT 1 FROM task_assignees ta WHERE ta."taskId"=wt.id AND ta."tenantId"=$1 AND ta."userId"=$2 AND ta.status='PENDING')
               OR EXISTS (SELECT 1 FROM organization_substitutions os
                 JOIN task_assignees original ON original."taskId"=wt.id AND original."userId"=os."originalUserId" AND original.status='PENDING'
                 WHERE os."tenantId"=$1 AND os."organizationId"=pi."organizationId" AND os."substituteUserId"=$2
                   AND os."revokedAt" IS NULL AND os."startsAt"<=now() AND os."endsAt">now()
                   AND EXISTS (SELECT 1 FROM tenant_memberships tm JOIN users su ON su.id=tm."userId" AND su."isActive"=true WHERE tm."tenantId"=$1 AND tm."userId"=$2 AND tm."isActive"=true)
                   AND EXISTS (SELECT 1 FROM user_positions up JOIN positions p ON p.id=up."positionId" JOIN organization_units ou ON ou.id=p."organizationUnitId"
                     WHERE up."userId"=$2 AND ou."organizationId"=pi."organizationId" AND up."isActive"=true AND p."isActive"=true AND ou."isActive"=true
                       AND up."validFrom"<=now() AND (up."validUntil" IS NULL OR up."validUntil">=now())))
               OR EXISTS (SELECT 1 FROM task_delegations td
                 JOIN task_assignees original ON original."taskId"=wt.id AND original."userId"=td."fromUserId" AND original.status='PENDING'
                 WHERE td."tenantId"=$1 AND td."taskId"=wt.id AND td."toUserId"=$2
                   AND td."revokedAt" IS NULL AND td."startsAt"<=now() AND td."endsAt">now()
                   AND EXISTS (SELECT 1 FROM tenant_memberships tm JOIN users su ON su.id=tm."userId" AND su."isActive"=true WHERE tm."tenantId"=$1 AND tm."userId"=$2 AND tm."isActive"=true)
                   AND EXISTS (SELECT 1 FROM user_positions up JOIN positions p ON p.id=up."positionId" JOIN organization_units ou ON ou.id=p."organizationUnitId"
                     WHERE up."userId"=$2 AND ou."organizationId"=pi."organizationId" AND up."isActive"=true AND p."isActive"=true AND ou."isActive"=true
                       AND up."validFrom"<=now() AND (up."validUntil" IS NULL OR up."validUntil">=now())))
             )
       )
       SELECT count(*)::int AS "openTasks",
         count(*) FILTER (WHERE "dueAt"<now())::int AS "overdueTasks",
         count(*) FILTER (WHERE "dueAt">now() AND "dueAt"<now()+interval '7 days')::int AS "dueNext7Days",
         (SELECT count(*)::int FROM workflow_tasks wt
           WHERE wt."tenantId"=$1 AND wt.status='COMPLETED' AND wt."completedAt">=now()-interval '30 days'
             AND EXISTS (SELECT 1 FROM workflow_action_logs wal WHERE wal."taskId"=wt.id AND wal."userId"=$2 AND wal.action='APPROVED')) AS "completedLast30Days",
         (SELECT count(DISTINCT pi.id)::int FROM process_instances pi
           WHERE pi."tenantId"=$1 AND pi."startedByUserId"=$2 AND pi."startedAt">=now()-interval '30 days') AS "startedLast30Days",
         (SELECT count(*)::int FROM workflow_action_logs wal
           WHERE wal."tenantId"=$1 AND wal."userId"=$2 AND wal.action='RETURNED' AND wal."createdAt">=now()-interval '30 days') AS "returnsLast30Days"
       FROM visible_tasks`, [tenantId,userId],
    );
    return { viewer:{userId,role:'STAFF'}, metrics:Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,Number(v??0)])), measuredAt:new Date().toISOString() };
  }

  async getOrganization(tenantId: string, organizationId: string, userId: string) {
    const [organization] = await this.dataSource.query(
      `SELECT id,name FROM organizations WHERE id=$1 AND "tenantId"=$2 AND "isActive"=true`,
      [organizationId,tenantId],
    );
    if (!organization) throw new NotFoundException('Organization not found in active tenant');
    const [metrics] = await this.dataSource.query(
      `SELECT
        count(DISTINCT pi.id) FILTER (WHERE pi.status='RUNNING')::int AS "runningProcesses",
        count(DISTINCT wt.id) FILTER (WHERE wt.status IN ('OPEN','IN_PROGRESS'))::int AS "openTasks",
        count(DISTINCT wt.id) FILTER (WHERE wt.status IN ('OPEN','IN_PROGRESS') AND wt."dueAt"<now())::int AS "overdueTasks",
        count(DISTINCT wt.id) FILTER (WHERE wt.status IN ('OPEN','IN_PROGRESS') AND NOT EXISTS
          (SELECT 1 FROM task_assignees ta WHERE ta."taskId"=wt.id AND ta.status='PENDING'))::int AS "unassignedTasks",
        count(DISTINCT oa.id) FILTER (WHERE oa.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS'))::int AS "activeAlerts",
        count(DISTINCT oa.id) FILTER (WHERE oa.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')
          AND ((oa."acknowledgedAt" IS NULL AND oa."responseDueAt"<now()) OR oa."resolutionDueAt"<now()))::int AS "slaBreachedAlerts"
       FROM organizations o
       LEFT JOIN process_instances pi ON pi."organizationId"=o.id AND pi."tenantId"=$1
       LEFT JOIN workflow_tasks wt ON wt."processInstanceId"=pi.id AND wt."tenantId"=$1
       LEFT JOIN organization_operational_alerts oa ON oa."organizationId"=o.id AND oa."tenantId"=$1
       WHERE o.id=$2 AND o."tenantId"=$1 GROUP BY o.id`, [tenantId,organizationId],
    );
    return { organization, viewer:{userId,role:'ORGANIZATION_MANAGER'}, metrics:Object.fromEntries(Object.entries(metrics??{}).map(([k,v])=>[k,Number(v??0)])), measuredAt:new Date().toISOString() };
  }

}
