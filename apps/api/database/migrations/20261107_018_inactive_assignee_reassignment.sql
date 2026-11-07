-- Support a second, independent reassignment trigger for inactive or ineligible assignees.
-- Keep one immutable record per task and trigger type, allowing SLA and inactivity
-- events to be recorded separately without permitting duplicate processing.
BEGIN;

ALTER TABLE workflow_task_reassignments
  DROP CONSTRAINT IF EXISTS "CK_workflow_task_reassignments_trigger";
ALTER TABLE workflow_task_reassignments
  ADD CONSTRAINT "CK_workflow_task_reassignments_trigger"
  CHECK ("triggerType" IN ('SLA', 'INACTIVE_ASSIGNEE'));

DROP INDEX IF EXISTS "UQ_workflow_task_reassignments_task";
CREATE UNIQUE INDEX "UQ_workflow_task_reassignments_task_trigger"
  ON workflow_task_reassignments ("taskId", "triggerType");

COMMIT;
