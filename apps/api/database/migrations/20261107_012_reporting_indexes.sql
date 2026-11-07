BEGIN;

-- Tenant analytics filter by organization and event time.
CREATE INDEX IF NOT EXISTS "IDX_process_instances_org_started"
  ON process_instances ("organizationId", "startedAt")
  INCLUDE (status, "startedByUserId", "completedAt");

CREATE INDEX IF NOT EXISTS "IDX_process_instances_org_completed"
  ON process_instances ("organizationId", "completedAt")
  WHERE "completedAt" IS NOT NULL;

-- Report task status by creation window and current open-task aging.
CREATE INDEX IF NOT EXISTS "IDX_workflow_tasks_created_instance"
  ON workflow_tasks ("createdAt", "processInstanceId")
  INCLUDE (status);

CREATE INDEX IF NOT EXISTS "IDX_workflow_tasks_open_aging"
  ON workflow_tasks ("createdAt", "processInstanceId")
  WHERE status IN ('OPEN', 'IN_PROGRESS');

COMMIT;
