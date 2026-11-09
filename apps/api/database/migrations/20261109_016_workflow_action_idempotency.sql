BEGIN;

CREATE TABLE workflow_action_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "taskId" uuid NOT NULL REFERENCES workflow_tasks(id) ON DELETE RESTRICT,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "idempotencyKey" varchar(128) NOT NULL,
  "requestHash" char(64) NOT NULL,
  response jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "completedAt" timestamptz,
  CONSTRAINT uq_workflow_action_idempotency_scope
    UNIQUE ("tenantId", "taskId", "userId", "idempotencyKey"),
  CONSTRAINT ck_workflow_action_idempotency_key
    CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._:-]{16,128}$'),
  CONSTRAINT ck_workflow_action_idempotency_hash
    CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_workflow_action_idempotency_completion
    CHECK ((response IS NULL AND "completedAt" IS NULL) OR
           (response IS NOT NULL AND "completedAt" IS NOT NULL))
);

CREATE INDEX ix_workflow_action_idempotency_created
  ON workflow_action_idempotency ("tenantId", "createdAt");

CREATE OR REPLACE FUNCTION fsb_guard_workflow_action_idempotency()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workflow action idempotency records cannot be deleted';
  END IF;
  IF OLD."tenantId" IS DISTINCT FROM NEW."tenantId"
     OR OLD."taskId" IS DISTINCT FROM NEW."taskId"
     OR OLD."userId" IS DISTINCT FROM NEW."userId"
     OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
     OR OLD."requestHash" IS DISTINCT FROM NEW."requestHash"
     OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'Workflow action idempotency identity is immutable';
  END IF;
  IF OLD.response IS NOT NULL AND
     (NEW.response IS DISTINCT FROM OLD.response OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt") THEN
    RAISE EXCEPTION 'A completed workflow action response is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_guard_workflow_action_idempotency
BEFORE UPDATE OR DELETE ON workflow_action_idempotency
FOR EACH ROW EXECUTE FUNCTION fsb_guard_workflow_action_idempotency();

COMMIT;
