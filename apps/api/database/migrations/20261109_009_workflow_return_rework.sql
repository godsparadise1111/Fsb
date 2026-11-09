-- Explicit, auditable return-to-earlier-step workflow transitions.
-- Requires core baseline and tenant/workflow integrity migrations.
BEGIN;
ALTER TABLE workflow_tasks
  DROP CONSTRAINT IF EXISTS "CHK_workflow_tasks_status";
ALTER TABLE workflow_tasks
  ADD CONSTRAINT "CHK_workflow_tasks_status"
  CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED','RETURNED'));
ALTER TABLE task_assignees
  DROP CONSTRAINT IF EXISTS "CHK_task_assignees_status";
ALTER TABLE task_assignees
  ADD CONSTRAINT "CHK_task_assignees_status"
  CHECK (status IN ('PENDING','APPROVED','REJECTED','REASSIGNED','RETURNED'));
ALTER TABLE workflow_action_logs
  ADD COLUMN IF NOT EXISTS "returnToStepIndex" integer NULL;
ALTER TABLE workflow_action_logs
  ADD CONSTRAINT "CHK_workflow_action_return_target"
  CHECK (
    (action = 'RETURNED' AND "returnToStepIndex" IS NOT NULL AND "returnToStepIndex" >= 0)
    OR (action <> 'RETURNED' AND "returnToStepIndex" IS NULL)
  );
CREATE INDEX IF NOT EXISTS "IDX_workflow_action_return_target"
  ON workflow_action_logs ("tenantId","returnToStepIndex","createdAt")
  WHERE action='RETURNED';
COMMIT;
