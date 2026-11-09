import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class PlatformWorkflowHealthService {
  constructor(private readonly dataSource: DataSource) {}

  async get() {
    const [totals] = await this.dataSource.query(`
      SELECT
        count(*) FILTER (WHERE t.status='ACTIVE')::int AS "activeTenants",
        count(*) FILTER (WHERE t.status='SUSPENDED')::int AS "suspendedTenants",
        count(*) FILTER (WHERE t.status='CLOSED')::int AS "closedTenants",
        (SELECT count(*)::int FROM process_instances pi JOIN tenants tx ON tx.id=pi."tenantId"
          WHERE tx.status='ACTIVE' AND pi.status='RUNNING') AS "runningProcesses",
        (SELECT count(*)::int FROM workflow_tasks wt JOIN process_instances pi ON pi.id=wt."processInstanceId"
          JOIN tenants tx ON tx.id=pi."tenantId"
          WHERE tx.status='ACTIVE' AND pi.status='RUNNING' AND wt.status IN ('OPEN','IN_PROGRESS')) AS "activeTasks",
        (SELECT count(*)::int FROM workflow_tasks wt JOIN process_instances pi ON pi.id=wt."processInstanceId"
          JOIN tenants tx ON tx.id=pi."tenantId"
          WHERE tx.status='ACTIVE' AND pi.status='RUNNING' AND wt.status IN ('OPEN','IN_PROGRESS')
            AND wt."dueAt" IS NOT NULL AND wt."dueAt"<now()) AS "overdueTasks",
        (SELECT count(*)::int FROM workflow_recovery_incidents ri JOIN tenants tx ON tx.id=ri."tenantId"
          WHERE tx.status='ACTIVE' AND ri.status IN ('OPEN','ACKNOWLEDGED')) AS "activeRecoveryIncidents",
        (SELECT count(*)::int FROM workflow_recovery_incidents ri JOIN tenants tx ON tx.id=ri."tenantId"
          WHERE tx.status='ACTIVE' AND ri.status='RESOLVED' AND ri."resolvedAt">=now()-interval '24 hours') AS "resolvedRecoveryIncidents24h",
        (SELECT count(*)::int FROM notification_outbox no JOIN tenants tx ON tx.id=no."tenantId"
          WHERE tx.status='ACTIVE' AND no.status='DEAD') AS "deadNotifications",
        (SELECT count(*)::int FROM notification_outbox no JOIN tenants tx ON tx.id=no."tenantId"
          WHERE tx.status='ACTIVE' AND no.status='PROCESSING' AND no."lockedAt"<now()-interval '2 minutes') AS "expiredNotificationLeases"
      FROM tenants t
    `);
    const tenants = await this.dataSource.query(`
      SELECT t.id,t.name,t.code,t.status,t.plan,
        (SELECT count(*)::int FROM process_instances pi WHERE pi."tenantId"=t.id AND pi.status='RUNNING') AS "runningProcesses",
        (SELECT count(*)::int FROM workflow_tasks wt JOIN process_instances pi ON pi.id=wt."processInstanceId"
          WHERE pi."tenantId"=t.id AND pi.status='RUNNING' AND wt.status IN ('OPEN','IN_PROGRESS')) AS "activeTasks",
        (SELECT count(*)::int FROM workflow_recovery_incidents ri
          WHERE ri."tenantId"=t.id AND ri.status IN ('OPEN','ACKNOWLEDGED')) AS "activeIncidents",
        (SELECT count(*)::int FROM workflow_recovery_incident_events e
          JOIN workflow_recovery_incidents ri ON ri.id=e."incidentId" AND ri."tenantId"=e."tenantId"
          WHERE ri."tenantId"=t.id AND e."eventType"='WORKER_SCAN'
            AND e."createdAt">=now()-interval '15 minutes') AS "workerScans15m",
        (SELECT max(e."createdAt") FROM workflow_recovery_incident_events e
          JOIN workflow_recovery_incidents ri ON ri.id=e."incidentId" AND ri."tenantId"=e."tenantId"
          WHERE ri."tenantId"=t.id AND e."eventType"='WORKER_SCAN') AS "lastWorkerScanAt"
      FROM tenants t
      WHERE t.status IN ('ACTIVE','SUSPENDED')
      ORDER BY CASE t.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,t.name
    `);
    const numeric = Object.fromEntries(Object.entries(totals ?? {}).map(([key,value]) => [key,Number(value ?? 0)]));
    const workerEnabled = process.env.FSB_WORKFLOW_RECOVERY_ENABLED === 'true';
    return {
      platform: { recoveryWorkerConfigured: workerEnabled, pollMs: Number(process.env.FSB_WORKFLOW_RECOVERY_POLL_MS ?? 60000) },
      totals: numeric,
      tenants: tenants.map((tenant: Record<string, unknown>) => ({
        ...tenant,
        runningProcesses: Number(tenant.runningProcesses ?? 0),
        activeTasks: Number(tenant.activeTasks ?? 0),
        activeIncidents: Number(tenant.activeIncidents ?? 0),
        workerScans15m: Number(tenant.workerScans15m ?? 0),
        workerSignal: tenant.status !== 'ACTIVE' ? 'FROZEN' : Number(tenant.workerScans15m ?? 0) > 0 ? 'OBSERVED' : 'NO_RECENT_INCIDENT_SCAN',
      })),
      measuredAt: new Date().toISOString(),
      refreshAfterSeconds: 30,
    };
  }
}
