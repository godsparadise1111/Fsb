-- Organization absences are backed by the existing substitution engine.
-- The linked substitution drives task inbox visibility and delegated actions.
BEGIN;
CREATE TABLE organization_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "organizationId" uuid NOT NULL,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "substituteUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "substitutionId" uuid NOT NULL UNIQUE REFERENCES organization_substitutions(id) ON DELETE RESTRICT,
  "startsAt" timestamptz NOT NULL,
  "endsAt" timestamptz NOT NULL,
  reason varchar(1000) NOT NULL,
  "createdByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "cancelledAt" timestamptz NULL,
  "cancelledByUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "FK_org_absence_org_tenant" FOREIGN KEY ("organizationId","tenantId")
    REFERENCES organizations(id,"tenantId") ON DELETE RESTRICT,
  CONSTRAINT "CK_org_absence_dates" CHECK ("endsAt" > "startsAt" AND "endsAt" <= "startsAt" + interval '90 days'),
  CONSTRAINT "CK_org_absence_users" CHECK ("userId" <> "substituteUserId"),
  CONSTRAINT "CK_org_absence_reason" CHECK (length(trim(reason)) >= 5),
  CONSTRAINT "CK_org_absence_cancel_pair" CHECK (
    ("cancelledAt" IS NULL AND "cancelledByUserId" IS NULL) OR
    ("cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL)
  )
);
CREATE INDEX "IDX_org_absences_org_dates" ON organization_absences ("tenantId","organizationId","startsAt","endsAt");
CREATE INDEX "IDX_org_absences_user_dates" ON organization_absences ("tenantId","userId","startsAt","endsAt");
CREATE OR REPLACE FUNCTION fsb_validate_org_absence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s organization_substitutions%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."tenantId",NEW."organizationId",NEW."userId",NEW."substituteUserId",NEW."substitutionId",NEW."startsAt",NEW."endsAt",NEW.reason,NEW."createdByUserId",NEW."createdAt")
       IS DISTINCT FROM ROW(OLD."tenantId",OLD."organizationId",OLD."userId",OLD."substituteUserId",OLD."substitutionId",OLD."startsAt",OLD."endsAt",OLD.reason,OLD."createdByUserId",OLD."createdAt") THEN
      RAISE EXCEPTION 'Absence details are immutable';
    END IF;
    IF OLD."cancelledAt" IS NOT NULL OR NEW."cancelledAt" IS NULL OR NEW."cancelledByUserId" IS NULL THEN
      RAISE EXCEPTION 'Only an active absence can be cancelled';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM organization_substitutions WHERE id=NEW."substitutionId";
  IF NOT FOUND OR s."tenantId"<>NEW."tenantId" OR s."organizationId"<>NEW."organizationId"
    OR s."originalUserId"<>NEW."userId" OR s."substituteUserId"<>NEW."substituteUserId"
    OR s."startsAt"<>NEW."startsAt" OR s."endsAt"<>NEW."endsAt" OR s.reason<>NEW.reason THEN
    RAISE EXCEPTION 'Absence must match its backing organizational substitution';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TR_org_absences_validate" BEFORE INSERT OR UPDATE ON organization_absences
FOR EACH ROW EXECUTE FUNCTION fsb_validate_org_absence();
COMMIT;
