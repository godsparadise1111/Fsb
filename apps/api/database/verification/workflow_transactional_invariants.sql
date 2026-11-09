-- Read-only verification for transactional workflow execution.
-- Every query must return zero rows after workers are quiescent.

-- 1. A committed idempotency claim must always contain its final response.
SELECT id, "tenantId", "taskId", "userId", "idempotencyKey", "createdAt"
  FROM workflow_action_idempotency
 WHERE response IS NULL OR "completedAt" IS NULL;

-- 2. A running process must have exactly one actionable task in this sequential engine.
SELECT pi.id AS "processInstanceId", pi."tenantId",
       count(wt.id) FILTER (WHERE wt.status IN ('OPEN','IN_PROGRESS')) AS "activeTaskCount"
  FROM process_instances pi
  LEFT JOIN workflow_tasks wt ON wt."processInstanceId"=pi.id
 WHERE pi.status='RUNNING'
 GROUP BY pi.id, pi."tenantId"
HAVING count(wt.id) FILTER (WHERE wt.status IN ('OPEN','IN_PROGRESS')) <> 1;

-- 3. A terminal process must not retain actionable tasks.
SELECT pi.id AS "processInstanceId", pi."tenantId", wt.id AS "taskId", wt.status AS "taskStatus"
  FROM process_instances pi
  JOIN workflow_tasks wt ON wt."processInstanceId"=pi.id
 WHERE pi.status IN ('COMPLETED','CANCELLED')
   AND wt.status IN ('OPEN','IN_PROGRESS');

-- 4. A terminal task must not retain pending assignees.
SELECT wt.id AS "taskId", pi."tenantId", wt.status AS "taskStatus", ta."userId"
  FROM workflow_tasks wt
  JOIN process_instances pi ON pi.id=wt."processInstanceId"
  JOIN task_assignees ta ON ta."taskId"=wt.id AND ta.status='PENDING'
 WHERE wt.status IN ('COMPLETED','CANCELLED','RETURNED');

-- 5. Every action log must point to a task in the same Tenant.
SELECT wal.id AS "actionLogId", wal."tenantId" AS "logTenantId",
       pi."tenantId" AS "taskTenantId", wal."taskId"
  FROM workflow_action_logs wal
  JOIN workflow_tasks wt ON wt.id=wal."taskId"
  JOIN process_instances pi ON pi.id=wt."processInstanceId"
 WHERE wal."tenantId" IS DISTINCT FROM pi."tenantId";

-- 6. A workflow task assignment notification may only remain queued while
-- its task and recipient are still eligible. The worker revalidates before send.
SELECT o.id AS "outboxId", o."tenantId", o.recipient,
       (o.payloadCiphertext IS NULL) AS "missingCiphertext"
  FROM notification_outbox o
 WHERE o."eventType"='workflow.task.assigned'
   AND o.status IN ('PENDING','PROCESSING')
   AND o."payloadCiphertext" IS NULL;
