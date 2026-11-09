-- Organization-level substitute workload policy.
-- Safe default: no row means advisory-only behavior with the application defaults.
BEGIN;

CREATE TABLE organization_workload_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "organizationId" uuid NOT NULL,
  "maxOpenTasksPerSubstitute" integer NOT NULL DEFAULT 10,
  "warningThresholdPercent" integer NOT NULL DEFAULT 80,
  "enforceLimit" boolean NOT NULL DEFAULT false,
  "updatedByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_org_workload_policy_tenant_org" UNIQUE ("tenantId", "organizationId"),
  CONSTRAINT "FK_org_workload_policy_org_tenant"
    FOREIGN KEY ("organizationId", "tenantId")
    REFERENCES organizations(id, "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "CK_org_workload_policy_max"
    CHECK ("maxOpenTasksPerSubstitute" BETWEEN 1 AND 500),
  CONSTRAINT "CK_org_workload_policy_warning"
    CHECK ("warningThresholdPercent" BETWEEN 1 AND 100)
);

CREATE INDEX "IDX_org_workload_policy_tenant_org"
  ON organization_workload_policies ("tenantId", "organizationId");

CREATE OR REPLACE FUNCTION fsb_validate_org_workload_policy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM tenant_memberships tm
      JOIN users u ON u.id = tm."userId" AND u."isActive" = true
     WHERE tm."tenantId" = NEW."tenantId"
       AND tm."userId" = NEW."updatedByUserId"
       AND tm."isActive" = true
  ) THEN
    RAISE EXCEPTION 'Workload policy updater must be an active tenant member';
  END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "TR_org_workload_policy_validate"
BEFORE INSERT OR UPDATE ON organization_workload_policies
FOR EACH ROW EXECUTE FUNCTION fsb_validate_org_workload_policy();

COMMIT;
