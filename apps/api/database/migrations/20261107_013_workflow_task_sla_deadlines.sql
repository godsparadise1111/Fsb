BEGIN;

ALTER TABLE workflow_tasks
  ADD COLUMN IF NOT EXISTS "dueAt" timestamptz NULL;

CREATE INDEX IF NOT EXISTS "IDX_workflow_tasks_due_at_active"
  ON workflow_tasks ("dueAt", "processInstanceId")
  WHERE "dueAt" IS NOT NULL AND status IN ('OPEN', 'IN_PROGRESS');

COMMIT;
