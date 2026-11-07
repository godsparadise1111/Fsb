import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class WorkflowAutomationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowAutomationWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    if (process.env.FSB_WORKFLOW_AUTOMATION_ENABLED !== 'true') return;
    const requested = Number(process.env.FSB_WORKFLOW_POLL_MS ?? 30000);
    const interval = Number.isFinite(requested) ? Math.min(300000, Math.max(5000, requested)) : 30000;
    this.timer = setInterval(() => void this.processBatch(), interval);
    this.timer.unref();
    void this.processBatch();
    this.logger.log(`Workflow automation worker started (poll=${interval}ms)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async processBatch() {
    if (this.busy) return;
    this.busy = true;
    try {
      const candidates = await this.dataSource.query(
        `SELECT t.id AS "taskId", pi.id AS "instanceId", pi."tenantId" AS "tenantId",
                pi."organizationId" AS "organizationId", pi."currentStepIndex" AS "stepIndex",
                pv.schema->'steps'->pi."currentStepIndex" AS step
           FROM workflow_tasks t
           JOIN process_instances pi ON pi.id = t."processInstanceId"
           JOIN process_versions pv ON pv.id = pi."processVersionId"
           JOIN tenants tenant ON tenant.id = pi."tenantId" AND tenant.status = 'ACTIVE'
          WHERE t.status IN ('OPEN', 'IN_PROGRESS') AND t."dueAt" IS NOT NULL
            AND jsonb_typeof(pv.schema->'steps') = 'array'
            AND COALESCE(pv.schema->'steps'->pi."currentStepIndex"->>'reassignAfterHours', '') ~ '^[0-9]+([.][0-9]+)?$'
            AND t."dueAt" + ((pv.schema->'steps'->pi."currentStepIndex"->>'reassignAfterHours')::numeric * interval '1 hour') <= now()
            AND NOT EXISTS (SELECT 1 FROM workflow_task_reassignments r WHERE r."taskId" = t.id)
          ORDER BY t."dueAt" ASC LIMIT 50`,
      ) as Array<{ taskId: string; tenantId: string; organizationId: string; step: Record<string, unknown> }>;

      for (const candidate of candidates) {
        try {
          await this.reassignOverdueTask(candidate);
        } catch (error) {
          this.logger.warn(`Automatic reassignment skipped for task ${candidate.taskId}: ${String(error).slice(0, 350)}`);
        }
      }
    } catch (error) {
      this.logger.error(`Workflow automation scan failed: ${String(error).slice(0, 500)}`);
    } finally {
      this.busy = false;
    }
  }

  private async reassignOverdueTask(candidate: { taskId: string; tenantId: string; organizationId: string; step: Record<string, unknown> }) {
    const configured = candidate.step?.reassignUserIds;
    if (!Array.isArray(configured) || configured.length < 1 || configured.length > 50 ||
        configured.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      this.logger.warn(`Task ${candidate.taskId} has invalid reassignUserIds; no assignments changed`);
      return;
    }
    const targetIds = [...new Set(configured as string[])];
    if (targetIds.length !== configured.length) {
      this.logger.warn(`Task ${candidate.taskId} has duplicate reassignment targets; no assignments changed`);
      return;
    }

    await this.dataSource.transaction(async manager => {
      const [task] = await manager.query(
        `SELECT t.id, t.status, t."dueAt", t."processInstanceId"
           FROM workflow_tasks t WHERE t.id = $1 FOR UPDATE`,
        [candidate.taskId],
      );
      if (!task || !['OPEN', 'IN_PROGRESS'].includes(task.status) || !task.dueAt) return;
      const [instance] = await manager.query(
        `SELECT pi."tenantId", pi."organizationId", pi."currentStepIndex", pv.schema->'steps'->pi."currentStepIndex" AS step
           FROM process_instances pi JOIN process_versions pv ON pv.id = pi."processVersionId"
          WHERE pi.id = $1`,
        [task.processInstanceId],
      );
      if (!instance || instance.tenantId !== candidate.tenantId || instance.organizationId !== candidate.organizationId) return;
      if (Number(instance.step?.reassignAfterHours) !== Number(candidate.step?.reassignAfterHours) ||
          JSON.stringify(instance.step?.reassignUserIds) !== JSON.stringify(candidate.step?.reassignUserIds)) return;
      const [existing] = await manager.query('SELECT id FROM workflow_task_reassignments WHERE "taskId" = $1', [candidate.taskId]);
      if (existing) return;

      const eligible = await manager.query(
        `SELECT DISTINCT u.id
           FROM users u
           JOIN tenant_memberships tm ON tm."userId" = u.id AND tm."tenantId" = $2 AND tm."isActive" = true
           JOIN user_positions up ON up."userId" = u.id AND up."isActive" = true
             AND up."validFrom" <= now() AND (up."validUntil" IS NULL OR up."validUntil" >= now())
           JOIN positions p ON p.id = up."positionId" AND p."isActive" = true
           JOIN organization_units ou ON ou.id = p."organizationUnitId"
             AND ou."organizationId" = $3 AND ou."isActive" = true
          WHERE u.id = ANY($1::uuid[]) AND u."isActive" = true`,
        [targetIds, candidate.tenantId, candidate.organizationId],
      );
      if (eligible.length !== targetIds.length) {
        this.logger.warn(`Task ${candidate.taskId} has reassignment targets without active tenant membership and organization positions`);
        return;
      }

      const assignments = await manager.query(
        `SELECT "userId", status FROM task_assignees WHERE "taskId" = $1 FOR UPDATE`,
        [candidate.taskId],
      ) as Array<{ userId: string; status: string }>;
      const byUser = new Map(assignments.map(item => [item.userId, item.status]));
      if (targetIds.some(id => byUser.has(id) && byUser.get(id) !== 'PENDING')) {
        this.logger.warn(`Task ${candidate.taskId} has a target with a previous non-pending assignment; manual review required`);
        return;
      }
      const previousPending = assignments.filter(item => item.status === 'PENDING').map(item => item.userId);
      const keepPending = previousPending.filter(id => targetIds.includes(id));
      const newTargets = targetIds.filter(id => !byUser.has(id));
      const displaced = previousPending.filter(id => !targetIds.includes(id));
      if (!newTargets.length && !displaced.length) return;

      if (displaced.length) {
        await manager.query(
          `UPDATE task_assignees SET status = 'REASSIGNED',
             comment = 'Automatically reassigned after configured SLA threshold'
           WHERE "taskId" = $1 AND status = 'PENDING' AND "userId" = ANY($2::uuid[])`,
          [candidate.taskId, displaced],
        );
      }
      if (newTargets.length) {
        await manager.query(
          `INSERT INTO task_assignees ("taskId", "userId", status, comment)
           SELECT $1, target_id, 'PENDING', 'Assigned by automatic SLA reassignment'
             FROM unnest($2::uuid[]) AS target_id
           ON CONFLICT ("taskId", "userId") DO NOTHING`,
          [candidate.taskId, newTargets],
        );
      }
      await manager.query(
        `INSERT INTO workflow_task_reassignments
           ("tenantId", "taskId", "triggerType", "fromUserIds", "toUserIds", reason)
         VALUES ($1, $2, 'SLA', $3::jsonb, $4::jsonb, $5)`,
        [candidate.tenantId, candidate.taskId, JSON.stringify(previousPending), JSON.stringify(targetIds),
         `Automatic reassignment after SLA threshold; retained pending targets: ${keepPending.length}`],
      );
    });
  }
}
