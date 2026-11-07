-- Automatic SLA-based reassignment with immutable history.
BEGIN;

ALTER TABLE task_assignees DROP CONSTRAINT IF EXISTS "CK_task_assignees_status";
ALTER TABLE task_assignees ADD CONSTRAINT "CK_task_assignees_status"
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REASSIGNED'));

CREATE TABLE workflow_task_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "taskId" uuid NOT NULL,
  "triggerType" varchar(30) NOT NULL,
  "fromUserIds" jsonb NOT NULL,
  "toUserIds" jsonb NOT NULL,
  reason varchar(1000) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CK_workflow_task_reassignments_trigger" CHECK ("triggerType" IN ('SLA')),
  CONSTRAINT "CK_workflow_task_reassignments_from_array" CHECK (jsonb_typeof("fromUserIds") = 'array'),
  CONSTRAINT "CK_workflow_task_reassignments_to_array" CHECK (jsonb_typeof("toUserIds") = 'array' AND jsonb_array_length("toUserIds") BETWEEN 1 AND 50),
  CONSTRAINT "FK_workflow_task_reassignments_task_tenant"
    FOREIGN KEY ("taskId", "tenantId") REFERENCES workflow_tasks(id, "tenantId") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "UQ_workflow_task_reassignments_task" ON workflow_task_reassignments ("taskId");
CREATE INDEX "IDX_workflow_task_reassignments_tenant_created"
  ON workflow_task_reassignments ("tenantId", "createdAt" DESC);

CREATE OR REPLACE FUNCTION fsb_immutable_workflow_task_reassignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Workflow task reassignment history is immutable';
END $$;
CREATE TRIGGER "TR_workflow_task_reassignments_immutable"
  BEFORE UPDATE OR DELETE ON workflow_task_reassignments
  FOR EACH ROW EXECUTE FUNCTION fsb_immutable_workflow_task_reassignment();

COMMIT;
