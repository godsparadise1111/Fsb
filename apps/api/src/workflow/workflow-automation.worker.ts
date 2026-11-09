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
           JOIN organizations org ON org.id = pi."organizationId" AND org."tenantId" = pi."tenantId" AND org."isActive" = true
          WHERE t.status IN ('OPEN', 'IN_PROGRESS') AND t."dueAt" IS NOT NULL
            AND jsonb_typeof(pv.schema->'steps') = 'array'
            AND COALESCE(pv.schema->'steps'->pi."currentStepIndex"->>'reassignAfterHours', '') ~ '^[0-9]+([.][0-9]+)?$'
            AND t."dueAt" + ((pv.schema->'steps'->pi."currentStepIndex"->>'reassignAfterHours')::numeric * interval '1 hour') <= now()
            AND NOT EXISTS (SELECT 1 FROM workflow_task_reassignments r WHERE r."taskId" = t.id AND r."triggerType" = 'SLA')
          ORDER BY t."dueAt" ASC LIMIT 50`,
      ) as Array<{ taskId: string; tenantId: string; organizationId: string; step: Record<string, unknown> }>;

      for (const candidate of candidates) {
        try {
          await this.reassignOverdueTask(candidate);
        } catch (error) {
          this.logger.warn(`Automatic reassignment skipped for task ${candidate.taskId}: ${String(error).slice(0, 350)}`);
        }
      }
      await this.processInactiveAssigneeBatch();
    } catch (error) {
      this.logger.error(`Workflow automation scan failed: ${String(error).slice(0, 500)}`);
    } finally {
      this.busy = false;
    }
  }


  private async processInactiveAssigneeBatch() {
    const candidates = await this.dataSource.query(
      `SELECT DISTINCT t.id AS "taskId", pi."tenantId" AS "tenantId", pi."organizationId" AS "organizationId"
         FROM workflow_tasks t JOIN process_instances pi ON pi.id = t."processInstanceId"
         JOIN process_versions pv ON pv.id = pi."processVersionId"
         JOIN tenants tenant ON tenant.id = pi."tenantId" AND tenant.status = 'ACTIVE'
         JOIN organizations org ON org.id = pi."organizationId" AND org."tenantId" = pi."tenantId" AND org."isActive" = true
         JOIN task_assignees ta ON ta."taskId" = t.id AND ta.status = 'PENDING'
        WHERE t.status IN ('OPEN', 'IN_PROGRESS')
          AND (NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ta."userId" AND u."isActive" = true)
            OR NOT EXISTS (SELECT 1 FROM tenant_memberships tm WHERE tm."tenantId" = pi."tenantId" AND tm."userId" = ta."userId" AND tm."isActive" = true)
            OR NOT EXISTS (SELECT 1 FROM user_positions up JOIN positions p ON p.id = up."positionId" AND p."isActive" = true
              JOIN organization_units ou ON ou.id = p."organizationUnitId" AND ou."organizationId" = pi."organizationId" AND ou."isActive" = true
              WHERE up."userId" = ta."userId" AND up."isActive" = true AND up."validFrom" <= now() AND (up."validUntil" IS NULL OR up."validUntil" >= now())))
        ORDER BY t.id LIMIT 50`,
    );
    for (const candidate of candidates as Array<{taskId:string;tenantId:string;organizationId:string}>) {
      try { await this.reassignInactiveAssignees(candidate); }
      catch (error) { this.logger.warn('Inactive-assignee reassignment skipped: ' + String(error).slice(0,350)); }
    }
  }

  private async reassignInactiveAssignees(candidate: {taskId:string;tenantId:string;organizationId:string}) {
    await this.dataSource.transaction(async manager => {
      const tenants = await manager.query(`SELECT id FROM tenants WHERE id=$1 AND status='ACTIVE' FOR SHARE`, [candidate.tenantId]);
      if (!tenants.length) return;
      const organizations = await manager.query(`SELECT id FROM organizations WHERE id=$1 AND "tenantId"=$2 AND "isActive"=true FOR SHARE`, [candidate.organizationId, candidate.tenantId]);
      if (!organizations.length) return;
      const [task] = await manager.query(`SELECT id, status, "processInstanceId" FROM workflow_tasks WHERE id = $1 FOR UPDATE`, [candidate.taskId]);
      if (!task || !['OPEN','IN_PROGRESS'].includes(task.status)) return;
      const [instance] = await manager.query(`SELECT pi."tenantId", pi."organizationId", pv.schema->'steps'->pi."currentStepIndex" AS step FROM process_instances pi JOIN process_versions pv ON pv.id = pi."processVersionId" JOIN tenants tenant ON tenant.id = pi."tenantId" AND tenant.status = 'ACTIVE'
        JOIN organizations org ON org.id = pi."organizationId" AND org."tenantId" = pi."tenantId" AND org."isActive" = true WHERE pi.id = $1`, [task.processInstanceId]);
      if (!instance || instance.tenantId !== candidate.tenantId || instance.organizationId !== candidate.organizationId) return;
      const assignments = await manager.query(`SELECT "userId",status FROM task_assignees WHERE "taskId"=$1 FOR UPDATE`, [candidate.taskId]) as Array<{userId:string;status:string}>;
      const pending = assignments.filter(a => a.status === 'PENDING'); if (!pending.length) return;
      const invalid = await manager.query(`SELECT ta."userId" FROM task_assignees ta WHERE ta."taskId"=$1 AND ta.status='PENDING' AND (
        NOT EXISTS(SELECT 1 FROM users u WHERE u.id=ta."userId" AND u."isActive"=true) OR
        NOT EXISTS(SELECT 1 FROM tenant_memberships tm WHERE tm."tenantId"=$2 AND tm."userId"=ta."userId" AND tm."isActive"=true) OR
        NOT EXISTS(SELECT 1 FROM user_positions up JOIN positions p ON p.id=up."positionId" AND p."isActive"=true JOIN organization_units ou ON ou.id=p."organizationUnitId" AND ou."organizationId"=$3 AND ou."isActive"=true
              JOIN organizations org ON org.id=ou."organizationId" AND org."tenantId"=$2 AND org."isActive"=true
              JOIN tenants tenant ON tenant.id=org."tenantId" AND tenant.status='ACTIVE'
              WHERE up."userId"=ta."userId" AND up."isActive"=true AND up."validFrom"<=now() AND (up."validUntil" IS NULL OR up."validUntil">=now())))`, [candidate.taskId,candidate.tenantId,candidate.organizationId]) as Array<{userId:string}>;
      const displaced = invalid.map(x => x.userId); if (!displaced.length) return;
      const retained = pending.map(a => a.userId).filter(id => !displaced.includes(id));
      const finalizeWithoutReplacement = async (reason: string) => {
        await manager.query(`UPDATE task_assignees SET status='REASSIGNED', comment=$3, "actedAt"=now() WHERE "taskId"=$1 AND status='PENDING' AND "userId"=ANY($2::uuid[])`, [candidate.taskId, displaced, reason]);
        if (!retained.length) {
          await manager.query(`UPDATE workflow_tasks SET status='CANCELLED', "completedAt"=now(), "updatedAt"=now() WHERE id=$1 AND status IN ('OPEN','IN_PROGRESS')`, [candidate.taskId]);
          await manager.query(`UPDATE process_instances SET status='CANCELLED', "completedAt"=now(), "updatedAt"=now() WHERE id=(SELECT "processInstanceId" FROM workflow_tasks WHERE id=$1) AND status='RUNNING'
            AND NOT EXISTS (SELECT 1 FROM workflow_tasks other WHERE other."processInstanceId"=process_instances.id AND other.id<>$1 AND other.status IN ('OPEN','IN_PROGRESS'))`, [candidate.taskId]);
          await manager.query(`INSERT INTO workflow_task_lifecycle_events ("tenantId","taskId","eventType","details") VALUES ($1,$2,'TASK_CANCELLED_NO_ELIGIBLE_ASSIGNEE',$3::jsonb)`, [candidate.tenantId, candidate.taskId, JSON.stringify({ displacedUserIds: displaced, reason })]);
        }
        await manager.query(`INSERT INTO workflow_task_lifecycle_events ("tenantId","taskId","eventType","affectedUserId","details") SELECT $1,$2,'ASSIGNEE_RECONCILED',affected_user,jsonb_build_object('reason',$4::text,'replacementUserIds',$5::jsonb) FROM unnest($3::uuid[]) AS affected(affected_user)`, [candidate.tenantId, candidate.taskId, displaced, reason, JSON.stringify(retained)]);
        if (retained.length) {
          await manager.query(`INSERT INTO workflow_task_reassignments ("tenantId","taskId","triggerType","fromUserIds","toUserIds",reason) VALUES ($1,$2,'INACTIVE_ASSIGNEE',$3::jsonb,$4::jsonb,$5) ON CONFLICT ("taskId","triggerType") DO NOTHING`, [candidate.tenantId, candidate.taskId, JSON.stringify(displaced), JSON.stringify(retained), reason]);
        }
      };
      const configured = instance.step?.reassignUserIds;
      if (instance.step?.reassignOnInactiveAssignee !== true) {
        await finalizeWithoutReplacement('Invalid assignee removed; automatic reassignment is not enabled for this process step');
        return;
      }
      if (!Array.isArray(configured) || configured.length < 1 || configured.length > 50 || configured.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
        await finalizeWithoutReplacement('Invalid assignee removed; configured fallback recipients are missing or invalid');
        return;
      }
      const targets = [...new Set(configured as string[])];
      if (targets.length !== configured.length) {
        await finalizeWithoutReplacement('Invalid assignee removed; configured fallback recipients contain duplicates');
        return;
      }
      const eligible = await manager.query(`SELECT DISTINCT u.id FROM users u JOIN tenant_memberships tm ON tm."userId"=u.id AND tm."tenantId"=$2 AND tm."isActive"=true JOIN user_positions up ON up."userId"=u.id AND up."isActive"=true AND up."validFrom"<=now() AND (up."validUntil" IS NULL OR up."validUntil">=now()) JOIN positions p ON p.id=up."positionId" AND p."isActive"=true JOIN organization_units ou ON ou.id=p."organizationUnitId" AND ou."organizationId"=$3 AND ou."isActive"=true
           JOIN organizations org ON org.id=ou."organizationId" AND org."tenantId"=$2 AND org."isActive"=true
          WHERE u.id=ANY($1::uuid[]) AND u."isActive"=true`, [targets,candidate.tenantId,candidate.organizationId]) as Array<{id:string}>;
      if (eligible.length !== targets.length) {
        await finalizeWithoutReplacement('Invalid assignee removed; one or more configured fallback recipients are no longer eligible');
        return;
      }
      const byUser = new Map(assignments.map(a => [a.userId,a.status]));
      if (targets.some(id => byUser.has(id) && byUser.get(id) !== 'PENDING')) {
        await finalizeWithoutReplacement('Invalid assignee removed; a configured fallback recipient has already completed or rejected this task');
        return;
      }
      const finalIds = [...new Set([...retained,...targets])]; if (!finalIds.length) {
        await finalizeWithoutReplacement('Invalid assignee removed; no eligible replacement remains');
        return;
      }
      const newTargets = targets.filter(id => !byUser.has(id));
      await manager.query(`UPDATE task_assignees SET status='REASSIGNED', comment='Automatically reassigned because assignee is inactive or no longer eligible' WHERE "taskId"=$1 AND status='PENDING' AND "userId"=ANY($2::uuid[])`, [candidate.taskId,displaced]);
      if (newTargets.length) await manager.query(`INSERT INTO task_assignees ("taskId","userId",status,comment) SELECT $1,target_id,'PENDING','Assigned by inactive-assignee fallback' FROM unnest($2::uuid[]) AS targets(target_id) ON CONFLICT ("taskId","userId") DO NOTHING`, [candidate.taskId,newTargets]);
      await manager.query(`INSERT INTO workflow_task_lifecycle_events ("tenantId","taskId","eventType","affectedUserId","details") SELECT $1,$2,'ASSIGNEE_REASSIGNED',affected_user,jsonb_build_object('replacementUserIds',$4::jsonb) FROM unnest($3::uuid[]) AS affected(affected_user)`, [candidate.tenantId, candidate.taskId, displaced, JSON.stringify(finalIds)]);
      await manager.query(`INSERT INTO workflow_task_reassignments ("tenantId","taskId","triggerType","fromUserIds","toUserIds",reason) VALUES ($1,$2,'INACTIVE_ASSIGNEE',$3::jsonb,$4::jsonb,$5) ON CONFLICT ("taskId","triggerType") DO NOTHING`, [candidate.tenantId,candidate.taskId,JSON.stringify(displaced),JSON.stringify(finalIds),'Automatic reassignment because pending assignees became inactive or lost valid tenant/organization membership']);
    });
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
      const tenants = await manager.query(`SELECT id FROM tenants WHERE id=$1 AND status='ACTIVE' FOR SHARE`, [candidate.tenantId]);
      if (!tenants.length) return;
      const organizations = await manager.query(`SELECT id FROM organizations WHERE id=$1 AND "tenantId"=$2 AND "isActive"=true FOR SHARE`, [candidate.organizationId, candidate.tenantId]);
      if (!organizations.length) return;
      const [task] = await manager.query(
        `SELECT t.id, t."tenantId", t.status, t."dueAt", t."processInstanceId"
           FROM workflow_tasks t WHERE t.id = $1 AND t."tenantId" = $2 FOR UPDATE`,
        [candidate.taskId, candidate.tenantId],
      );
      if (!task || !['OPEN', 'IN_PROGRESS'].includes(task.status) || !task.dueAt) return;
      const [instance] = await manager.query(
        `SELECT pi."tenantId", pi."organizationId", pi."currentStepIndex", pv.schema->'steps'->pi."currentStepIndex" AS step
           FROM process_instances pi
           JOIN process_versions pv ON pv.id = pi."processVersionId"
           JOIN tenants tenant ON tenant.id = pi."tenantId" AND tenant.status = 'ACTIVE'
           JOIN organizations org ON org.id = pi."organizationId" AND org."tenantId" = pi."tenantId" AND org."isActive" = true
          WHERE pi.id = $1 AND pi."tenantId" = $2`,
        [task.processInstanceId, candidate.tenantId],
      );
      if (!instance || instance.tenantId !== candidate.tenantId || instance.organizationId !== candidate.organizationId) return;
      const reassignAfterHours = Number(instance.step?.reassignAfterHours);
      if (!Number.isFinite(reassignAfterHours) || new Date(task.dueAt).getTime() + reassignAfterHours * 3600000 > Date.now()) return;
      if (Number(instance.step?.reassignAfterHours) !== Number(candidate.step?.reassignAfterHours) ||
          JSON.stringify(instance.step?.reassignUserIds) !== JSON.stringify(candidate.step?.reassignUserIds)) return;
      const [existing] = await manager.query(
        `SELECT id FROM workflow_task_reassignments WHERE "taskId" = $1 AND "triggerType" = 'SLA'`,
        [candidate.taskId],
      );
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
           JOIN organizations org ON org.id = ou."organizationId" AND org."tenantId" = $2 AND org."isActive" = true
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
