-- Time-bounded, auditable task delegation. Original assignees remain unchanged.
BEGIN;

CREATE TABLE task_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "taskId" uuid NOT NULL,
  "fromUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "toUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "startsAt" timestamptz NOT NULL,
  "endsAt" timestamptz NOT NULL,
  "revokedAt" timestamptz NULL,
  "revokedByUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CK_task_delegations_window" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "CK_task_delegations_distinct_users" CHECK ("fromUserId" <> "toUserId"),
  CONSTRAINT "FK_task_delegations_task_tenant"
    FOREIGN KEY ("taskId", "tenantId") REFERENCES workflow_tasks(id, "tenantId") ON DELETE RESTRICT
);

CREATE INDEX "IDX_task_delegations_active_target"
  ON task_delegations ("tenantId", "toUserId", "endsAt") WHERE "revokedAt" IS NULL;
CREATE INDEX "IDX_task_delegations_task"
  ON task_delegations ("tenantId", "taskId", "createdAt" DESC);

CREATE OR REPLACE FUNCTION fsb_validate_task_delegation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Revocation is always permitted, including after task closure or membership expiry.
  IF TG_OP = 'UPDATE' AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workflow_tasks wt
    JOIN process_instances pi ON pi.id = wt."processInstanceId"
    JOIN tenants t ON t.id = pi."tenantId" AND t.status = 'ACTIVE'
    WHERE wt.id = NEW."taskId" AND pi."tenantId" = NEW."tenantId"
      AND wt.status IN ('OPEN', 'IN_PROGRESS')
  ) THEN
    RAISE EXCEPTION 'Delegation task must be actionable in an active tenant';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships tm
    JOIN users u ON u.id = tm."userId" AND u."isActive" = true
    WHERE tm."tenantId" = NEW."tenantId" AND tm."userId" = NEW."fromUserId" AND tm."isActive" = true
  ) OR NOT EXISTS (
    SELECT 1 FROM tenant_memberships tm
    JOIN users u ON u.id = tm."userId" AND u."isActive" = true
    WHERE tm."tenantId" = NEW."tenantId" AND tm."userId" = NEW."toUserId" AND tm."isActive" = true
  ) THEN
    RAISE EXCEPTION 'Delegation parties must be active tenant members';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "TR_task_delegations_validate"
  BEFORE INSERT OR UPDATE OF "taskId", "tenantId", "fromUserId", "toUserId", "startsAt", "endsAt", "revokedAt"
  ON task_delegations FOR EACH ROW EXECUTE FUNCTION fsb_validate_task_delegation();

COMMIT;
