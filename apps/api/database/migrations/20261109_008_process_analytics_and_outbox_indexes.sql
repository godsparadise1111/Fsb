-- Tenant-scoped indexes for bottleneck analytics and notification operations.
-- Requires tenant composite migration 002 and notification outbox migration 009.
BEGIN;
CREATE INDEX IF NOT EXISTS "IDX_workflow_tasks_tenant_created_process"
  ON workflow_tasks ("tenantId","createdAt","processInstanceId")
  INCLUDE (status,"dueAt","completedAt");
CREATE INDEX IF NOT EXISTS "IDX_workflow_action_logs_tenant_task_created"
  ON workflow_action_logs ("tenantId","taskId","createdAt");
CREATE INDEX IF NOT EXISTS "IDX_notification_outbox_tenant_status_updated"
  ON notification_outbox ("tenantId",status,"updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_notification_outbox_stale_lease"
  ON notification_outbox ("tenantId","lockedAt")
  WHERE status='PROCESSING';
COMMIT;
