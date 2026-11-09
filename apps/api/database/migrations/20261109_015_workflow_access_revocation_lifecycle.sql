-- Preserve workflow history while terminating operational authority on access revocation.
-- Requires workflow delegation, deferral, tenant composite integrity and inactive-assignee migrations.
BEGIN;

ALTER TABLE task_deferral_requests
  DROP CONSTRAINT IF EXISTS "CK_task_deferral_requests_status";
ALTER TABLE task_deferral_requests
  ADD CONSTRAINT "CK_task_deferral_requests_status"
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'));
ALTER TABLE task_deferral_requests
  DROP CONSTRAINT IF EXISTS "CK_task_deferral_requests_review";
ALTER TABLE task_deferral_requests
  ADD CONSTRAINT "CK_task_deferral_requests_review"
  CHECK (
    (status = 'PENDING' AND "reviewerUserId" IS NULL AND "reviewedAt" IS NULL)
    OR (status IN ('APPROVED', 'REJECTED') AND "reviewerUserId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
    OR (status = 'CANCELLED' AND "reviewerUserId" IS NULL AND "reviewedAt" IS NOT NULL)
  );

CREATE TABLE workflow_task_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "taskId" uuid NOT NULL,
  "eventType" varchar(60) NOT NULL,
  "affectedUserId" uuid NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "FK_workflow_task_lifecycle_task_tenant"
    FOREIGN KEY ("taskId", "tenantId") REFERENCES workflow_tasks(id, "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "FK_workflow_task_lifecycle_affected_user"
    FOREIGN KEY ("affectedUserId") REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX "IDX_workflow_task_lifecycle_task"
  ON workflow_task_lifecycle_events ("tenantId", "taskId", "createdAt");
CREATE INDEX "IDX_workflow_task_lifecycle_user"
  ON workflow_task_lifecycle_events ("tenantId", "affectedUserId", "createdAt")
  WHERE "affectedUserId" IS NOT NULL;

CREATE OR REPLACE FUNCTION fsb_reject_workflow_task_lifecycle_mutation() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  RAISE EXCEPTION 'Workflow task lifecycle events are append-only';
END $;
CREATE TRIGGER "TR_workflow_task_lifecycle_append_only"
  BEFORE UPDATE OR DELETE ON workflow_task_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION fsb_reject_workflow_task_lifecycle_mutation();

CREATE OR REPLACE FUNCTION fsb_validate_task_deferral_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."tenantId", NEW."taskId", NEW."requesterUserId", NEW."originalDueAt", NEW."proposedDueAt", NEW.reason, NEW."createdAt")
       IS DISTINCT FROM
       ROW(OLD."tenantId", OLD."taskId", OLD."requesterUserId", OLD."originalDueAt", OLD."proposedDueAt", OLD.reason, OLD."createdAt") THEN
      RAISE EXCEPTION 'Task deferral request details are immutable';
    END IF;
    IF NEW.status = 'CANCELLED' AND current_setting('fsb.lifecycle_cleanup', true) = 'on'
       AND OLD.status = 'PENDING' THEN
      RETURN NEW;
    END IF;
    IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('APPROVED', 'REJECTED') THEN
      RAISE EXCEPTION 'Only pending task deferral requests may be reviewed or lifecycle-cancelled';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM workflow_tasks wt
      JOIN process_instances pi ON pi.id = wt."processInstanceId"
      JOIN tenants t ON t.id = NEW."tenantId" AND t.status = 'ACTIVE'
      JOIN organizations o ON o.id = pi."organizationId" AND o."tenantId" = NEW."tenantId" AND o."isActive" = true
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

  IF TG_OP = 'UPDATE' AND NEW.status <> 'CANCELLED' AND NOT EXISTS (
    SELECT 1 FROM tenant_memberships tm
    JOIN users u ON u.id = tm."userId" AND u."isActive" = true
    JOIN tenants t ON t.id = tm."tenantId" AND t.status = 'ACTIVE'
    WHERE tm."tenantId" = NEW."tenantId" AND tm."userId" = NEW."reviewerUserId" AND tm."isActive" = true
      AND NEW."reviewerUserId" <> NEW."requesterUserId"
  ) THEN
    RAISE EXCEPTION 'Deferral reviewer must be an active tenant member';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fsb_cancel_workflow_operations_for_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    UPDATE task_delegations
       SET "revokedAt" = now(), "revokedByUserId" = NULL
     WHERE "tenantId" = OLD."tenantId"
       AND ("fromUserId" = OLD."userId" OR "toUserId" = OLD."userId")
       AND "revokedAt" IS NULL;

    PERFORM set_config('fsb.lifecycle_cleanup', 'on', true);
    UPDATE task_deferral_requests r
       SET status = 'CANCELLED', "reviewerUserId" = NULL, "reviewedAt" = now(),
           "reviewerComment" = 'Automatically cancelled because requester membership was revoked'
      FROM workflow_tasks wt
     WHERE wt.id = r."taskId" AND wt."tenantId" = OLD."tenantId"
       AND r."tenantId" = OLD."tenantId" AND r."requesterUserId" = OLD."userId"
       AND r.status = 'PENDING';
    PERFORM set_config('fsb.lifecycle_cleanup', 'off', true);

    INSERT INTO workflow_task_lifecycle_events ("tenantId","taskId","eventType","affectedUserId",details)
    SELECT DISTINCT OLD."tenantId", wt.id, 'ASSIGNEE_MEMBERSHIP_REVOKED', OLD."userId",
           jsonb_build_object('membershipId', OLD.id, 'policy', wt."assignmentPolicy")
      FROM task_assignees ta
      JOIN workflow_tasks wt ON wt.id = ta."taskId"
     WHERE ta."tenantId" = OLD."tenantId" AND ta."userId" = OLD."userId"
       AND ta.status = 'PENDING' AND wt.status IN ('OPEN','IN_PROGRESS')
       AND NOT EXISTS (
         SELECT 1 FROM workflow_task_lifecycle_events e
          WHERE e."taskId" = wt.id AND e."eventType" = 'ASSIGNEE_MEMBERSHIP_REVOKED'
            AND e."affectedUserId" = OLD."userId"
       );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ZZZ_tenant_membership_workflow_cleanup"
  AFTER UPDATE OF "isActive" ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION fsb_cancel_workflow_operations_for_membership();

CREATE OR REPLACE FUNCTION fsb_cancel_workflow_operations_for_inactive_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    INSERT INTO workflow_task_lifecycle_events ("tenantId","taskId","eventType",details)
    SELECT wt."tenantId", wt.id, 'ORGANIZATION_DEACTIVATED',
           jsonb_build_object('organizationId', NEW.id)
      FROM workflow_tasks wt
      JOIN process_instances pi ON pi.id = wt."processInstanceId"
     WHERE pi."organizationId" = NEW.id AND wt.status IN ('OPEN','IN_PROGRESS');

    UPDATE workflow_tasks wt SET status='CANCELLED', "completedAt"=now(), "updatedAt"=now()
      FROM process_instances pi
     WHERE pi.id=wt."processInstanceId" AND pi."organizationId"=NEW.id
       AND wt.status IN ('OPEN','IN_PROGRESS');

    UPDATE task_assignees ta SET status='REASSIGNED', "actedAt"=now(),
           comment=concat_ws(E'\n', ta.comment, 'Assignment closed because the organization was deactivated')
      FROM workflow_tasks wt
      JOIN process_instances pi ON pi.id=wt."processInstanceId"
     WHERE ta."taskId"=wt.id AND pi."organizationId"=NEW.id AND ta.status='PENDING';

    UPDATE task_delegations td SET "revokedAt"=now(), "revokedByUserId"=NULL
      FROM workflow_tasks wt
      JOIN process_instances pi ON pi.id=wt."processInstanceId"
     WHERE td."taskId"=wt.id AND pi."organizationId"=NEW.id AND td."revokedAt" IS NULL;

    PERFORM set_config('fsb.lifecycle_cleanup', 'on', true);
    UPDATE task_deferral_requests r SET status='CANCELLED', "reviewerUserId"=NULL,
      "reviewedAt"=now(), "reviewerComment"='Automatically cancelled because the organization was deactivated'
      FROM workflow_tasks wt
      JOIN process_instances pi ON pi.id=wt."processInstanceId"
     WHERE r."taskId"=wt.id AND pi."organizationId"=NEW.id AND r.status='PENDING';
    PERFORM set_config('fsb.lifecycle_cleanup', 'off', true);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ZZZ_organizations_cancel_workflow_operations"
  AFTER UPDATE OF "isActive" ON organizations
  FOR EACH ROW EXECUTE FUNCTION fsb_cancel_workflow_operations_for_inactive_organization();

CREATE OR REPLACE FUNCTION fsb_close_tenant_workflow_operations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'CLOSED' THEN
    INSERT INTO workflow_task_lifecycle_events ("tenantId","taskId","eventType",details)
    SELECT wt."tenantId", wt.id, 'TENANT_CLOSED',
           jsonb_build_object('tenantId', NEW.id)
      FROM workflow_tasks wt
     WHERE wt."tenantId"=NEW.id AND wt.status IN ('OPEN','IN_PROGRESS');

    UPDATE workflow_tasks SET status='CANCELLED', "completedAt"=now(), "updatedAt"=now()
     WHERE "tenantId"=NEW.id AND status IN ('OPEN','IN_PROGRESS');

    UPDATE task_assignees ta SET status='REASSIGNED', "actedAt"=now(),
           comment=concat_ws(E'\n', ta.comment, 'Assignment closed because the tenant was closed')
      FROM workflow_tasks wt
     WHERE ta."taskId"=wt.id AND wt."tenantId"=NEW.id AND wt.status='CANCELLED' AND ta.status='PENDING';

    UPDATE task_delegations SET "revokedAt"=now(), "revokedByUserId"=NULL
     WHERE "tenantId"=NEW.id AND "revokedAt" IS NULL;

    PERFORM set_config('fsb.lifecycle_cleanup', 'on', true);
    UPDATE task_deferral_requests SET status='CANCELLED', "reviewerUserId"=NULL,
      "reviewedAt"=now(), "reviewerComment"='Automatically cancelled because the tenant was closed'
     WHERE "tenantId"=NEW.id AND status='PENDING';
    PERFORM set_config('fsb.lifecycle_cleanup', 'off', true);

    UPDATE notification_outbox SET status='DEAD', "lockedBy"=NULL, "lockedAt"=NULL,
      lastError='Tenant closed; queued notification was permanently suppressed', "updatedAt"=now()
     WHERE "tenantId"=NEW.id AND status IN ('PENDING','PROCESSING');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ZZZ_tenants_close_workflow_operations"
  AFTER UPDATE OF status ON tenants
  FOR EACH ROW EXECUTE FUNCTION fsb_close_tenant_workflow_operations();

-- Reconcile legacy pending operations that became invalid before this migration.
INSERT INTO workflow_task_lifecycle_events ("tenantId","taskId","eventType","details")
SELECT wt."tenantId", wt.id,
       CASE WHEN t.status='CLOSED' THEN 'TENANT_CLOSED' ELSE 'ORGANIZATION_DEACTIVATED' END,
       jsonb_build_object('migration','20261109_015','reconciled',true)
  FROM workflow_tasks wt
  JOIN process_instances pi ON pi.id=wt."processInstanceId"
  JOIN organizations o ON o.id=pi."organizationId"
  JOIN tenants t ON t.id=wt."tenantId"
 WHERE wt.status IN ('OPEN','IN_PROGRESS')
   AND (o."isActive"=false OR t.status='CLOSED');

UPDATE workflow_tasks wt
   SET status='CANCELLED', "completedAt"=now(), "updatedAt"=now()
  FROM process_instances pi
  JOIN organizations o ON o.id=pi."organizationId"
  JOIN tenants t ON t.id=pi."tenantId"
 WHERE wt."processInstanceId"=pi.id AND wt.status IN ('OPEN','IN_PROGRESS')
   AND (o."isActive"=false OR t.status='CLOSED');

UPDATE task_assignees ta
   SET status='REASSIGNED', "actedAt"=now(),
       comment=concat_ws(E'\\n', ta.comment, 'Assignment closed during workflow lifecycle migration')
  FROM workflow_tasks wt
 WHERE ta."taskId"=wt.id AND wt.status='CANCELLED' AND ta.status='PENDING'
   AND EXISTS (
     SELECT 1 FROM process_instances pi
     JOIN organizations o ON o.id=pi."organizationId"
     JOIN tenants t ON t.id=pi."tenantId"
     WHERE pi.id=wt."processInstanceId" AND (o."isActive"=false OR t.status='CLOSED')
   );

UPDATE task_delegations d
   SET "revokedAt"=now(), "revokedByUserId"=NULL
  FROM workflow_tasks wt
  JOIN process_instances pi ON pi.id=wt."processInstanceId"
  JOIN organizations o ON o.id=pi."organizationId"
  JOIN tenants t ON t.id=wt."tenantId"
 WHERE d."taskId"=wt.id AND d."revokedAt" IS NULL
   AND (wt.status NOT IN ('OPEN','IN_PROGRESS') OR o."isActive"=false OR t.status='CLOSED'
     OR NOT EXISTS (SELECT 1 FROM tenant_memberships tm JOIN users u ON u.id=tm."userId" AND u."isActive"=true
                     WHERE tm."tenantId"=d."tenantId" AND tm."userId"=d."fromUserId" AND tm."isActive"=true)
     OR NOT EXISTS (SELECT 1 FROM tenant_memberships tm JOIN users u ON u.id=tm."userId" AND u."isActive"=true
                     WHERE tm."tenantId"=d."tenantId" AND tm."userId"=d."toUserId" AND tm."isActive"=true));

SELECT set_config('fsb.lifecycle_cleanup', 'on', true);
UPDATE task_deferral_requests r
   SET status='CANCELLED', "reviewerUserId"=NULL, "reviewedAt"=now(),
       "reviewerComment"='Automatically cancelled during workflow lifecycle migration'
  FROM workflow_tasks wt
  JOIN process_instances pi ON pi.id=wt."processInstanceId"
  JOIN organizations o ON o.id=pi."organizationId"
  JOIN tenants t ON t.id=wt."tenantId"
 WHERE r."taskId"=wt.id AND r.status='PENDING'
   AND (wt.status NOT IN ('OPEN','IN_PROGRESS') OR o."isActive"=false OR t.status='CLOSED'
     OR NOT EXISTS (SELECT 1 FROM tenant_memberships tm JOIN users u ON u.id=tm."userId" AND u."isActive"=true
                     WHERE tm."tenantId"=r."tenantId" AND tm."userId"=r."requesterUserId" AND tm."isActive"=true));
SELECT set_config('fsb.lifecycle_cleanup', 'off', true);

UPDATE notification_outbox o
   SET status='DEAD', "lockedBy"=NULL, "lockedAt"=NULL,
       lastError='Tenant was already closed when workflow lifecycle migration was applied', "updatedAt"=now()
  FROM tenants t
 WHERE t.id=o."tenantId" AND t.status='CLOSED' AND o.status IN ('PENDING','PROCESSING');

COMMIT;
