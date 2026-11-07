-- Task deadline changes require an auditable, tenant-scoped approval.
BEGIN;

INSERT INTO permissions (id, code, name, description, "createdAt")
VALUES (
  gen_random_uuid(),
  'workflow.tasks.defer.approve',
  'Review task deadline changes',
  'Approve or reject deadline extension requests within the assigned organization',
  now()
)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE task_deferral_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "taskId" uuid NOT NULL,
  "requesterUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "originalDueAt" timestamptz NULL,
  "proposedDueAt" timestamptz NOT NULL,
  reason varchar(1000) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  "reviewerUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  "reviewedAt" timestamptz NULL,
  "reviewerComment" varchar(1000) NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CK_task_deferral_requests_status" CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT "CK_task_deferral_requests_reason" CHECK (length(trim(reason)) >= 5),
  CONSTRAINT "CK_task_deferral_requests_review" CHECK (
    (status = 'PENDING' AND "reviewerUserId" IS NULL AND "reviewedAt" IS NULL)
    OR (status IN ('APPROVED', 'REJECTED') AND "reviewerUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
  ),
  CONSTRAINT "FK_task_deferral_requests_task_tenant"
    FOREIGN KEY ("taskId", "tenantId") REFERENCES workflow_tasks(id, "tenantId") ON DELETE RESTRICT
);

CREATE INDEX "IDX_task_deferral_requests_task"
  ON task_deferral_requests ("tenantId", "taskId", "createdAt" DESC);
CREATE INDEX "IDX_task_deferral_requests_pending"
  ON task_deferral_requests ("tenantId", status, "createdAt") WHERE status = 'PENDING';
CREATE UNIQUE INDEX "UQ_task_deferral_requests_one_pending_per_task"
  ON task_deferral_requests ("taskId") WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION fsb_validate_task_deferral_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."tenantId", NEW."taskId", NEW."requesterUserId", NEW."originalDueAt", NEW."proposedDueAt", NEW.reason, NEW."createdAt")
       IS DISTINCT FROM
       ROW(OLD."tenantId", OLD."taskId", OLD."requesterUserId", OLD."originalDueAt", OLD."proposedDueAt", OLD.reason, OLD."createdAt") THEN
      RAISE EXCEPTION 'Task deferral request details are immutable';
    END IF;
    IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('APPROVED', 'REJECTED') THEN
      RAISE EXCEPTION 'Only pending task deferral requests may be reviewed';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM workflow_tasks wt
      JOIN process_instances pi ON pi.id = wt."processInstanceId"
      JOIN tenants t ON t.id = NEW."tenantId" AND t.status = 'ACTIVE'
      JOIN tenant_memberships tm ON tm."tenantId" = NEW."tenantId"
        AND tm."userId" = NEW."requesterUserId" AND tm."isActive" = true
      JOIN users requester ON requester.id = NEW."requesterUserId" AND requester."isActive" = true
      WHERE wt.id = NEW."taskId" AND pi."tenantId" = NEW."tenantId"
        AND wt.status IN ('OPEN', 'IN_PROGRESS')
        AND wt."dueAt" IS NOT DISTINCT FROM NEW."originalDueAt"
        AND (
          EXISTS (SELECT 1 FROM task_assignees a
                   WHERE a."taskId" = wt.id AND a."userId" = NEW."requesterUserId" AND a.status = 'PENDING')
          OR EXISTS (SELECT 1 FROM task_delegations d
                      JOIN task_assignees a ON a."taskId" = d."taskId" AND a."userId" = d."fromUserId" AND a.status = 'PENDING'
                     WHERE d."taskId" = wt.id AND d."tenantId" = NEW."tenantId"
                       AND d."toUserId" = NEW."requesterUserId" AND d."revokedAt" IS NULL
                       AND d."startsAt" <= now() AND d."endsAt" > now())
        )
    ) THEN
      RAISE EXCEPTION 'Deferral requester and task must belong to an active tenant and actionable task';
    END IF;
    IF NEW."proposedDueAt" <= GREATEST(COALESCE(NEW."originalDueAt", now()), now())
       OR NEW."proposedDueAt" > GREATEST(COALESCE(NEW."originalDueAt", now()), now()) + interval '30 days' THEN
      RAISE EXCEPTION 'Proposed task deadline must extend the current deadline by no more than 30 days';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT EXISTS (
    SELECT 1 FROM tenant_memberships tm
    JOIN users u ON u.id = tm."userId" AND u."isActive" = true
    JOIN tenants t ON t.id = tm."tenantId" AND t.status = 'ACTIVE'
    WHERE tm."tenantId" = NEW."tenantId" AND tm."userId" = NEW."reviewerUserId" AND tm."isActive" = true
  ) THEN
    RAISE EXCEPTION 'Deferral reviewer must be an active tenant member';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "TR_task_deferral_requests_validate"
  BEFORE INSERT OR UPDATE ON task_deferral_requests
  FOR EACH ROW EXECUTE FUNCTION fsb_validate_task_deferral_request();

COMMIT;
