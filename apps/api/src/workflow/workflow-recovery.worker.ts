import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Conservative crash-recovery worker.
 * It repairs only states whose intended outcome is unambiguous. Ambiguous
 * process histories are recorded for operator review and never auto-advanced.
 */
@Injectable()
export class WorkflowRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowRecoveryWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private readonly workerId = `workflow-recovery-${process.pid}`;

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    if (process.env.FSB_WORKFLOW_RECOVERY_ENABLED !== 'true') return;
    const requested = Number(process.env.FSB_WORKFLOW_RECOVERY_POLL_MS ?? 60000);
    const interval = Number.isFinite(requested) ? Math.min(300000, Math.max(10000, requested)) : 60000;
    this.timer = setInterval(() => void this.recoverBatch(), interval);
    this.timer.unref();
    void this.recoverBatch();
    this.logger.log(`Workflow recovery worker started (poll=${interval}ms)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async recoverBatch() {
    if (this.busy) return;
    this.busy = true;
    try {
      const candidates = await this.dataSource.query(
        `SELECT DISTINCT pi.id AS "instanceId"
           FROM process_instances pi
           JOIN tenants t ON t.id=pi."tenantId" AND t.status='ACTIVE'
           JOIN organizations o ON o.id=pi."organizationId" AND o."tenantId"=pi."tenantId" AND o."isActive"=true
          WHERE
            (pi.status IN ('COMPLETED','CANCELLED') AND EXISTS (
              SELECT 1 FROM workflow_tasks wt
               WHERE wt."processInstanceId"=pi.id AND wt.status IN ('OPEN','IN_PROGRESS')
            ))
            OR (pi.status='RUNNING' AND (
              (SELECT count(*) FROM workflow_tasks wt WHERE wt."processInstanceId"=pi.id AND wt.status IN ('OPEN','IN_PROGRESS')) <> 1
            ))
          ORDER BY pi.id
          LIMIT 50`,
      ) as Array<{ instanceId: string }>;

      for (const candidate of candidates) {
        try {
          await this.reconcileInstance(candidate.instanceId);
        } catch (error) {
          this.logger.warn(`Recovery skipped for process ${candidate.instanceId}: ${String(error).slice(0, 400)}`);
        }
      }
      await this.reconcileTerminalAssignments();
    } catch (error) {
      this.logger.error(`Workflow recovery scan failed: ${String(error).slice(0, 500)}`);
    } finally {
      this.busy = false;
    }
  }

  private async recordReview(manager: EntityManager, tenantId: string, taskId: string, eventType: string, details: Record<string, unknown>) {
    const fingerprint = createHash('sha256').update(JSON.stringify(details)).digest('hex');
    await manager.query(
      `INSERT INTO workflow_task_lifecycle_events ("tenantId","taskId","eventType","details")
       SELECT $1,$2,$3,$4::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM workflow_task_lifecycle_events
           WHERE "tenantId"=$1 AND "taskId"=$2 AND "eventType"=$3
             AND details->>'recoveryFingerprint'=$5
        )`,
      [tenantId, taskId, eventType, JSON.stringify({ ...details, recoveryFingerprint: fingerprint, workerId: this.workerId }), fingerprint],
    );
  }

  private async reconcileInstance(instanceId: string) {
    await this.dataSource.transaction(async manager => {
      const [snapshot] = await manager.query(
        `SELECT id,"tenantId","organizationId",status FROM process_instances WHERE id=$1`,
        [instanceId],
      );
      if (!snapshot) return;
      const [tenant] = await manager.query(
        `SELECT id,status FROM tenants WHERE id=$1 FOR SHARE`, [snapshot.tenantId],
      );
      if (!tenant || tenant.status !== 'ACTIVE') return;
      const [organization] = await manager.query(
        `SELECT id,"isActive" FROM organizations WHERE id=$1 AND "tenantId"=$2 FOR SHARE`,
        [snapshot.organizationId, snapshot.tenantId],
      );
      if (!organization || !organization.isActive) return;
      const [instance] = await manager.query(
        `SELECT id,status,"tenantId","organizationId" FROM process_instances WHERE id=$1 FOR UPDATE`,
        [instanceId],
      );
      if (!instance) return;
      const tasks = await manager.query(
        `SELECT id,status FROM workflow_tasks
          WHERE "processInstanceId"=$1 ORDER BY "createdAt",id FOR UPDATE`,
        [instanceId],
      ) as Array<{id:string;status:string}>;
      const active = tasks.filter(task => ['OPEN','IN_PROGRESS'].includes(task.status));

      if (['COMPLETED','CANCELLED'].includes(instance.status) && active.length) {
        for (const task of active) {
          await manager.query(
            `UPDATE workflow_tasks SET status='CANCELLED',"completedAt"=COALESCE("completedAt",now()),"updatedAt"=now()
              WHERE id=$1 AND status IN ('OPEN','IN_PROGRESS')`,
            [task.id],
          );
          const displaced = await manager.query(
            `UPDATE task_assignees SET status='REASSIGNED',
                comment='Automatically closed during terminal process recovery',
                "actedAt"=COALESCE("actedAt",now())
              WHERE "taskId"=$1 AND status='PENDING' RETURNING "userId"`,
            [task.id],
          ) as Array<{userId:string}>;
          await this.recordReview(manager, instance.tenantId, task.id, 'RECOVERY_TERMINAL_TASK_CLOSED', {
            processInstanceId: instance.id, previousProcessStatus: instance.status,
            displacedUserIds: displaced.map(item => item.userId),
          });
        }
        return;
      }

      if (instance.status === 'RUNNING' && active.length !== 1) {
        const anchor = tasks[tasks.length - 1];
        if (!anchor) return;
        await this.recordReview(manager, instance.tenantId, anchor.id, 'RECOVERY_PROCESS_REQUIRES_REVIEW', {
          processInstanceId: instance.id,
          activeTaskIds: active.map(task => task.id),
          reason: active.length === 0 ? 'RUNNING process has no active task; automatic advancement is unsafe' : 'RUNNING process has multiple active tasks; automatic task selection is unsafe',
        });
      }
    });
  }

  private async reconcileTerminalAssignments() {
    await this.dataSource.transaction(async manager => {
      const [lock] = await manager.query(`SELECT pg_try_advisory_xact_lock(hashtextextended('fsb-workflow-terminal-assignment-recovery',0)) AS acquired`);
      if (!lock?.acquired) return;
      const rows = await manager.query(
        `SELECT wt.id AS "taskId",pi."tenantId",wt.status
           FROM workflow_tasks wt
           JOIN process_instances pi ON pi.id=wt."processInstanceId"
           JOIN tenants t ON t.id=pi."tenantId" AND t.status='ACTIVE'
           JOIN organizations o ON o.id=pi."organizationId" AND o."tenantId"=pi."tenantId" AND o."isActive"=true
           JOIN task_assignees ta ON ta."taskId"=wt.id AND ta.status='PENDING'
          WHERE wt.status IN ('COMPLETED','CANCELLED','RETURNED')
          ORDER BY wt.id LIMIT 100
          FOR UPDATE OF wt SKIP LOCKED`,
      ) as Array<{taskId:string;tenantId:string;status:string}>;
      for (const row of rows) {
        const changed = await manager.query(
          `UPDATE task_assignees SET status='REASSIGNED',
              comment='Automatically reconciled: task is already terminal',
              "actedAt"=COALESCE("actedAt",now())
            WHERE "taskId"=$1 AND status='PENDING' RETURNING "userId"`,
          [row.taskId],
        ) as Array<{userId:string}>;
        if (changed.length) {
          await this.recordReview(manager, row.tenantId, row.taskId, 'RECOVERY_TERMINAL_ASSIGNMENTS_RECONCILED', {
            taskStatus: row.status, displacedUserIds: changed.map(item => item.userId),
          });
        }
      }
    });
  }
}
