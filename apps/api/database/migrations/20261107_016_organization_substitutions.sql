-- Time-bound organizational substitution for workflow assignments.
BEGIN;

INSERT INTO permissions (id, code, name, description, "createdAt")
VALUES (gen_random_uuid(), 'workflow.substitutions.manage', 'Manage organizational substitutions',
        'Create, inspect and revoke time-bound workflow substitutions in an assigned organization', now())
ON CONFLICT (code) DO NOTHING;

CREATE TABLE organization_substitutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "organizationId" uuid NOT NULL,
  "originalUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "substituteUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "startsAt" timestamptz NOT NULL,
  "endsAt" timestamptz NOT NULL,
  reason varchar(1000) NOT NULL,
  "createdByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "revokedAt" timestamptz NULL,
  "revokedByUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CK_org_substitution_distinct_users" CHECK ("originalUserId" <> "substituteUserId"),
  CONSTRAINT "CK_org_substitution_dates" CHECK ("endsAt" > "startsAt" AND "endsAt" <= "startsAt" + interval '90 days'),
  CONSTRAINT "CK_org_substitution_reason" CHECK (length(trim(reason)) >= 5),
  CONSTRAINT "FK_org_substitution_org_tenant" FOREIGN KEY ("organizationId", "tenantId")
    REFERENCES organizations(id, "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "CK_org_substitution_revoke_pair" CHECK (
    ("revokedAt" IS NULL AND "revokedByUserId" IS NULL) OR
    ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL)
  )
);

CREATE INDEX "IDX_org_substitutions_substitute_active"
  ON organization_substitutions ("tenantId", "substituteUserId", "startsAt", "endsAt")
  WHERE "revokedAt" IS NULL;
CREATE INDEX "IDX_org_substitutions_original_active"
  ON organization_substitutions ("tenantId", "originalUserId", "startsAt", "endsAt")
  WHERE "revokedAt" IS NULL;
CREATE INDEX "IDX_org_substitutions_org_created"
  ON organization_substitutions ("tenantId", "organizationId", "createdAt" DESC);

CREATE OR REPLACE FUNCTION fsb_validate_org_substitution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  organization_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."tenantId", NEW."organizationId", NEW."originalUserId", NEW."substituteUserId",
           NEW."startsAt", NEW."endsAt", NEW.reason, NEW."createdByUserId", NEW."createdAt")
       IS DISTINCT FROM
       ROW(OLD."tenantId", OLD."organizationId", OLD."originalUserId", OLD."substituteUserId",
           OLD."startsAt", OLD."endsAt", OLD.reason, OLD."createdByUserId", OLD."createdAt") THEN
      RAISE EXCEPTION 'Organizational substitution details are immutable';
    END IF;
    IF OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL OR NEW."revokedByUserId" IS NULL THEN
      RAISE EXCEPTION 'Only an active substitution may be revoked';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM tenant_memberships tm JOIN users u ON u.id = tm."userId" AND u."isActive" = true
       WHERE tm."tenantId" = NEW."tenantId" AND tm."userId" = NEW."revokedByUserId" AND tm."isActive" = true
    ) THEN RAISE EXCEPTION 'Revoker must be an active tenant member'; END IF;
    RETURN NEW;
  END IF;

  IF NEW."revokedAt" IS NOT NULL OR NEW."revokedByUserId" IS NOT NULL THEN
    RAISE EXCEPTION 'A new substitution cannot be created as revoked';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW."tenantId"::text || ':' || NEW."organizationId"::text || ':' || NEW."originalUserId"::text, 0
  ));
  SELECT "tenantId" INTO organization_tenant FROM organizations
   WHERE id = NEW."organizationId" AND "tenantId" = NEW."tenantId" AND "isActive" = true;
  IF organization_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = NEW."tenantId" AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Substitution organization and tenant must be active and match';
  END IF;
  IF NEW."startsAt" <= now() - interval '1 minute' OR NEW."endsAt" <= NEW."startsAt"
     OR NEW."endsAt" > NEW."startsAt" + interval '90 days' THEN
    RAISE EXCEPTION 'Invalid substitution validity window';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships tm JOIN users u ON u.id = tm."userId" AND u."isActive" = true
     WHERE tm."tenantId" = NEW."tenantId" AND tm."userId" = NEW."createdByUserId" AND tm."isActive" = true
  ) THEN RAISE EXCEPTION 'Creator must be an active tenant member'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_positions up JOIN positions p ON p.id = up."positionId"
    JOIN organization_units ou ON ou.id = p."organizationUnitId"
    JOIN tenant_memberships tm ON tm."tenantId" = NEW."tenantId" AND tm."userId" = up."userId" AND tm."isActive" = true
    JOIN users u ON u.id = up."userId" AND u."isActive" = true
    WHERE up."userId" = NEW."originalUserId" AND ou."organizationId" = NEW."organizationId"
      AND up."isActive" = true AND p."isActive" = true AND ou."isActive" = true
      AND up."validFrom" <= NEW."startsAt" AND (up."validUntil" IS NULL OR up."validUntil" >= NEW."startsAt")
  ) OR NOT EXISTS (
    SELECT 1 FROM user_positions up JOIN positions p ON p.id = up."positionId"
    JOIN organization_units ou ON ou.id = p."organizationUnitId"
    JOIN tenant_memberships tm ON tm."tenantId" = NEW."tenantId" AND tm."userId" = up."userId" AND tm."isActive" = true
    JOIN users u ON u.id = up."userId" AND u."isActive" = true
    WHERE up."userId" = NEW."substituteUserId" AND ou."organizationId" = NEW."organizationId"
      AND up."isActive" = true AND p."isActive" = true AND ou."isActive" = true
      AND up."validFrom" <= NEW."startsAt" AND (up."validUntil" IS NULL OR up."validUntil" >= NEW."startsAt")
  ) THEN
    RAISE EXCEPTION 'Both users must have active positions in the substitution organization';
  END IF;
  IF EXISTS (
    SELECT 1 FROM organization_substitutions s
     WHERE s."tenantId" = NEW."tenantId" AND s."organizationId" = NEW."organizationId"
       AND s."originalUserId" = NEW."originalUserId" AND s."revokedAt" IS NULL
       AND tstzrange(s."startsAt", s."endsAt", '[)') && tstzrange(NEW."startsAt", NEW."endsAt", '[)')
  ) THEN RAISE EXCEPTION 'Overlapping active substitutions for the same original user are not allowed'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "TR_org_substitutions_validate"
  BEFORE INSERT OR UPDATE ON organization_substitutions
  FOR EACH ROW EXECUTE FUNCTION fsb_validate_org_substitution();

COMMIT;
