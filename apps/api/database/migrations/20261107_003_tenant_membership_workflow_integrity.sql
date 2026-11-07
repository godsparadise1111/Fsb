-- Enforce active tenant membership for newly created workflow assignments and actions.
-- Prerequisites: migrations 001 and 002. Historical rows are retained as-is.
BEGIN;

ALTER TABLE task_assignees ADD COLUMN "tenantId" uuid NULL;
UPDATE task_assignees ta SET "tenantId" = wt."tenantId"
FROM workflow_tasks wt WHERE wt.id = ta."taskId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM task_assignees WHERE "tenantId" IS NULL) THEN
    RAISE EXCEPTION 'Task assignee tenant backfill failed; migration aborted';
  END IF;
END $$;

ALTER TABLE task_assignees ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE task_assignees ADD CONSTRAINT "FK_task_assignees_task_tenant"
  FOREIGN KEY ("taskId", "tenantId") REFERENCES workflow_tasks(id, "tenantId") ON DELETE RESTRICT;
CREATE INDEX "IDX_task_assignees_tenant_user_status"
  ON task_assignees ("tenantId", "userId", status);

CREATE OR REPLACE FUNCTION fsb_set_tenant_from_task_assignee() RETURNS trigger LANGUAGE plpgsql AS $
DECLARE resolved uuid;
BEGIN
  SELECT "tenantId" INTO resolved FROM workflow_tasks WHERE id = NEW."taskId";
  IF resolved IS NULL THEN RAISE EXCEPTION 'Workflow task tenant not found'; END IF;
  IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved THEN RAISE EXCEPTION 'Task assignee tenant mismatch'; END IF;
  NEW."tenantId" := resolved;
  RETURN NEW;
END $;

CREATE TRIGGER "TR_task_assignees_00_tenant"
  BEFORE INSERT OR UPDATE OF "taskId", "tenantId" ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION fsb_set_tenant_from_task_assignee();

CREATE OR REPLACE FUNCTION fsb_require_active_tenant_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scoped_tenant uuid;
DECLARE scoped_user uuid;
BEGIN
  scoped_tenant := NEW."tenantId";
  IF TG_TABLE_NAME = 'process_instances' THEN
    scoped_user := NEW."startedByUserId";
  ELSIF TG_TABLE_NAME = 'workflow_tasks' THEN
    scoped_user := NEW."createdByUserId";
  ELSIF TG_TABLE_NAME = 'workflow_action_logs' THEN
    scoped_user := NEW."userId";
  ELSIF TG_TABLE_NAME = 'form_submissions' THEN
    scoped_user := NEW."submittedByUserId";
  ELSIF TG_TABLE_NAME = 'task_assignees' THEN
    scoped_user := NEW."userId";
  ELSE
    RAISE EXCEPTION 'Unsupported tenant membership enforcement table: %', TG_TABLE_NAME;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships tm
     WHERE tm."tenantId" = scoped_tenant
       AND tm."userId" = scoped_user
       AND tm."isActive" = true
  ) THEN
    RAISE EXCEPTION 'User must have active membership in the resource tenant';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ZZZ_TR_process_instances_active_member"
  BEFORE INSERT OR UPDATE OF "startedByUserId", "tenantId" ON process_instances
  FOR EACH ROW EXECUTE FUNCTION fsb_require_active_tenant_member();
CREATE TRIGGER "ZZZ_TR_workflow_tasks_active_member"
  BEFORE INSERT OR UPDATE OF "createdByUserId", "tenantId" ON workflow_tasks
  FOR EACH ROW EXECUTE FUNCTION fsb_require_active_tenant_member();
CREATE TRIGGER "ZZZ_TR_workflow_action_logs_active_member"
  BEFORE INSERT OR UPDATE OF "userId", "tenantId" ON workflow_action_logs
  FOR EACH ROW EXECUTE FUNCTION fsb_require_active_tenant_member();
CREATE TRIGGER "ZZZ_TR_form_submissions_active_member"
  BEFORE INSERT OR UPDATE OF "submittedByUserId", "tenantId" ON form_submissions
  FOR EACH ROW EXECUTE FUNCTION fsb_require_active_tenant_member();
CREATE TRIGGER "ZZZ_TR_task_assignees_active_member"
  BEFORE INSERT OR UPDATE OF "userId", "tenantId" ON task_assignees
  FOR EACH ROW EXECUTE FUNCTION fsb_require_active_tenant_member();

COMMIT;

-- This intentionally validates writes, not historical ownership. Existing task and
-- submission records remain available to their authorized tenant administrators.
