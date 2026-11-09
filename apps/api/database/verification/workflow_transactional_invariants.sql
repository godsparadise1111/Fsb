-- Read-only verification for transactional workflow execution.
-- Invariant queries should return zero rows after recovery. Open incidents and expired leases are operational queues, not silent data loss.

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
HAVING count(wt.id) FILTER (WHERE wt.status IN ('OPEN','IN_PROGRESS')) <> 1
   AND NOT EXISTS (
     SELECT 1 FROM workflow_recovery_incidents ri
      WHERE ri."tenantId"=pi."tenantId" AND ri."processInstanceId"=pi.id
        AND ri."incidentType"='RUNNING_PROCESS_TASK_COUNT_MISMATCH'
        AND ri.status IN ('OPEN','ACKNOWLEDGED')
   );

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

-- 6. Every committed action log must have its matching append-only lifecycle event.
SELECT wal.id AS "actionLogId", wal."taskId", wal."tenantId"
  FROM workflow_action_logs wal
 WHERE NOT EXISTS (
   SELECT 1 FROM workflow_task_lifecycle_events le
    WHERE le."tenantId"=wal."tenantId" AND le."taskId"=wal."taskId"
      AND le."eventType"='ACTION_RECORDED'
      AND le.details->>'actionLogId'=wal.id::text
 );

-- 7. A workflow task assignment notification may only remain queued while
-- its task and recipient are still eligible. The worker revalidates before send.
SELECT o.id AS "outboxId", o."tenantId", o.recipient,
       (o.payloadCiphertext IS NULL) AS "missingCiphertext"
  FROM notification_outbox o
 WHERE o."eventType"='workflow.task.assigned'
   AND o.status IN ('PENDING','PROCESSING')
   AND o."payloadCiphertext" IS NULL;


-- 8. Open recovery incidents require operator review; this is an operational queue.
SELECT id,"tenantId","processInstanceId","incidentType",details,"createdAt"
  FROM workflow_recovery_incidents
 WHERE status IN ('OPEN','ACKNOWLEDGED')
 ORDER BY "createdAt" ASC;

-- 11. Expired notification leases must be reclaimable; this query is diagnostic
-- and may return rows only while a worker is down or before the next poll.
SELECT id, "tenantId", attempts, "lockedAt", "lockedBy"
  FROM notification_outbox
 WHERE status='PROCESSING' AND "lockedAt" < now() - interval '2 minutes';

