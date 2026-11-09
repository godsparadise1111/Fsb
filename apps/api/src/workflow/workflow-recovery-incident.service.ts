import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantAuditService } from '../tenant/tenant-audit.service';

const INCIDENT_TYPES = ['TERMINAL_PROCESS_HAS_ACTIVE_TASKS', 'RUNNING_PROCESS_TASK_COUNT_MISMATCH'] as const;
type IncidentType = typeof INCIDENT_TYPES[number];

@Injectable()
export class WorkflowRecoveryIncidentService {
  constructor(private readonly dataSource: DataSource, private readonly audit: TenantAuditService) {}

  private severity(type: string): string {
    if (type === 'RUNNING_PROCESS_TASK_COUNT_MISMATCH') return 'CRITICAL';
    if (type === 'TERMINAL_PROCESS_HAS_ACTIVE_TASKS') return 'HIGH';
    return 'MEDIUM';
  }

  async list(tenantId: string, filters: { organizationId?: string; processInstanceId?: string; incidentType?: string; severity?: string; status?: string; limit?: number; offset?: number }) {
    if (filters.incidentType && !INCIDENT_TYPES.includes(filters.incidentType as IncidentType)) throw new BadRequestException('Unsupported incident type');
    if (filters.severity && !['CRITICAL','HIGH','MEDIUM'].includes(filters.severity)) throw new BadRequestException('Unsupported severity');
    if (filters.status && !['ACTIVE','OPEN','ACKNOWLEDGED','RESOLVED'].includes(filters.status)) throw new BadRequestException('Unsupported incident status');
    const limit = Math.min(100, Math.max(1, Math.floor(filters.limit ?? 25)));
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));
    const params: unknown[] = [tenantId];
    const where = ['i."tenantId"=$1'];
    const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('?', '$' + params.length)); };
    if (filters.organizationId) add('pi."organizationId"=?', filters.organizationId);
    if (filters.processInstanceId) add('i."processInstanceId"=?', filters.processInstanceId);
    if (filters.incidentType) add('i."incidentType"=?', filters.incidentType);
    if (filters.status === 'ACTIVE' || !filters.status) where.push(`i.status IN ('OPEN','ACKNOWLEDGED')`);
    else add('i.status=?', filters.status);
    if (filters.severity) add(`CASE i."incidentType" WHEN 'RUNNING_PROCESS_TASK_COUNT_MISMATCH' THEN 'CRITICAL' WHEN 'TERMINAL_PROCESS_HAS_ACTIVE_TASKS' THEN 'HIGH' ELSE 'MEDIUM' END=?`, filters.severity);
    const rows = await this.dataSource.query(
      `SELECT i.id,i."tenantId",i."processInstanceId",i."incidentType",i.fingerprint,i.details,i.status,
              i."createdAt",i."updatedAt",i."resolvedAt",pi.title AS "processTitle",pi.status AS "processStatus",
              pi."organizationId",o.name AS "organizationName",
              CASE i."incidentType" WHEN 'RUNNING_PROCESS_TASK_COUNT_MISMATCH' THEN 'CRITICAL'
                   WHEN 'TERMINAL_PROCESS_HAS_ACTIVE_TASKS' THEN 'HIGH' ELSE 'MEDIUM' END AS severity,
              (SELECT count(*)::int FROM workflow_recovery_incident_events e WHERE e."incidentId"=i.id) AS "eventCount"
         FROM workflow_recovery_incidents i
         JOIN process_instances pi ON pi.id=i."processInstanceId" AND pi."tenantId"=i."tenantId"
         JOIN organizations o ON o.id=pi."organizationId" AND o."tenantId"=i."tenantId"
        WHERE ${where.join(' AND ')}
        ORDER BY CASE i.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END, i."createdAt" DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [count] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM workflow_recovery_incidents i
         JOIN process_instances pi ON pi.id=i."processInstanceId" AND pi."tenantId"=i."tenantId"
        WHERE ${where.join(' AND ')}`, params,
    );
    return { items: rows, total: count?.total ?? 0, limit, offset };
  }

  async detail(tenantId: string, incidentId: string) {
    const [incident] = await this.dataSource.query(
      `SELECT i.*,pi.title AS "processTitle",pi.status AS "processStatus",pi."organizationId",o.name AS "organizationName",
              CASE i."incidentType" WHEN 'RUNNING_PROCESS_TASK_COUNT_MISMATCH' THEN 'CRITICAL'
                   WHEN 'TERMINAL_PROCESS_HAS_ACTIVE_TASKS' THEN 'HIGH' ELSE 'MEDIUM' END AS severity
         FROM workflow_recovery_incidents i
         JOIN process_instances pi ON pi.id=i."processInstanceId" AND pi."tenantId"=i."tenantId"
         JOIN organizations o ON o.id=pi."organizationId" AND o."tenantId"=i."tenantId"
        WHERE i.id=$1 AND i."tenantId"=$2`, [incidentId, tenantId],
    );
    if (!incident) throw new NotFoundException('Recovery incident not found');
    const events = await this.dataSource.query(
      `SELECT id,"eventType","actorUserId","eventKey",metadata,"createdAt"
         FROM workflow_recovery_incident_events WHERE "incidentId"=$1 AND "tenantId"=$2 ORDER BY "createdAt" DESC LIMIT 200`,
      [incidentId, tenantId],
    );
    const taskIds: string[] = Array.isArray(incident.details?.activeTaskIds) ? incident.details.activeTaskIds : [];
    const lifecycle = taskIds.length ? await this.dataSource.query(
      `SELECT id,"taskId","eventType",details,"createdAt" FROM workflow_task_lifecycle_events
        WHERE "tenantId"=$1 AND "taskId"=ANY($2::uuid[]) ORDER BY "createdAt" DESC LIMIT 200`,
      [tenantId, taskIds],
    ) : [];
    return { incident: { ...incident, severity: this.severity(incident.incidentType) }, events, lifecycle };
  }

  async acknowledge(tenantId: string, incidentId: string, actorUserId: string, note?: string) {
    return this.transition(tenantId, incidentId, actorUserId, 'ACKNOWLEDGE', note);
  }

  async resolve(tenantId: string, incidentId: string, actorUserId: string, note: string) {
    if (!note?.trim() || note.trim().length < 5 || note.trim().length > 1000) throw new BadRequestException('Resolution note must contain 5 to 1000 characters');
    return this.transition(tenantId, incidentId, actorUserId, 'RESOLVE', note.trim());
  }

  private async transition(tenantId: string, incidentId: string, actorUserId: string, action: 'ACKNOWLEDGE' | 'RESOLVE', note?: string) {
    return this.dataSource.transaction(async manager => {
      const [incident] = await manager.query(
        `SELECT id,status,"incidentType" FROM workflow_recovery_incidents WHERE id=$1 AND "tenantId"=$2 FOR UPDATE`,
        [incidentId, tenantId],
      );
      if (!incident) throw new NotFoundException('Recovery incident not found');
      if (action === 'ACKNOWLEDGE' && incident.status !== 'OPEN') throw new ConflictException('Only OPEN incidents can be acknowledged');
      if (action === 'RESOLVE' && incident.status !== 'ACKNOWLEDGED') throw new ConflictException('Acknowledge the incident before resolving it');
      const status = action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'RESOLVED';
      await manager.query(
        `UPDATE workflow_recovery_incidents SET status=$3,"updatedAt"=now(),"resolvedAt"=${action === 'RESOLVE' ? 'now()' : 'NULL'}
          WHERE id=$1 AND "tenantId"=$2`, [incidentId, tenantId, status],
      );
      const eventKey = `${action.toLowerCase()}:${actorUserId}:${Date.now()}`;
      await manager.query(
        `INSERT INTO workflow_recovery_incident_events ("tenantId","incidentId","eventType","actorUserId","eventKey",metadata)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [tenantId, incidentId, action === 'RESOLVE' ? 'RESOLVED' : action, actorUserId, eventKey, JSON.stringify({ note: note ?? null, fromStatus: incident.status, toStatus: status })],
      );
      await this.audit.record(manager, {
        tenantId, actorUserId, action: `workflow.recovery_incident.${action.toLowerCase()}`,
        resourceType: 'WORKFLOW_RECOVERY_INCIDENT', resourceId: incidentId,
        metadata: { incidentType: incident.incidentType, fromStatus: incident.status, toStatus: status, note: note ?? null },
      });
      return { id: incidentId, status, action };
    });
  }

  async replay(tenantId: string, incidentId: string, actorUserId: string) {
    const rejected = await this.dataSource.transaction(async manager => {
      const [incident] = await manager.query(
        `SELECT id,status,"incidentType" FROM workflow_recovery_incidents WHERE id=$1 AND "tenantId"=$2 FOR UPDATE`,
        [incidentId, tenantId],
      );
      if (!incident) throw new NotFoundException('Recovery incident not found');
      const reason = 'No registered safe, idempotent replay handler exists for this incident type. Human actions and process-stage advancement are never replayed.';
      await manager.query(
        `INSERT INTO workflow_recovery_incident_events ("tenantId","incidentId","eventType","actorUserId","eventKey",metadata)
         VALUES ($1,$2,'REPLAY_REJECTED',$3,$4,$5::jsonb)`,
        [tenantId, incidentId, actorUserId, `replay-rejected:${actorUserId}:${Date.now()}`, JSON.stringify({ incidentType: incident.incidentType, reason })],
      );
      await this.audit.record(manager, {
        tenantId, actorUserId, action: 'workflow.recovery_incident.replay_rejected',
        resourceType: 'WORKFLOW_RECOVERY_INCIDENT', resourceId: incidentId,
        metadata: { incidentType: incident.incidentType, reason },
      });
      return { reason };
    });
    throw new ConflictException(rejected.reason);
  }
}
