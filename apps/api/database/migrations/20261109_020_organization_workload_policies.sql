-- Organization-level workload capacity policy for absence substitutes.
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
  CONSTRAINT "UQ_org_workload_policy_tenant_org" UNIQUE ("tenantId","organizationId"),
  CONSTRAINT "FK_org_workload_policy_org_tenant" FOREIGN KEY ("organizationId","tenantId")
    REFERENCES organizations(id,"tenantId") ON DELETE RESTRICT,
  CONSTRAINT "CK_org_workload_policy_max" CHECK ("maxOpenTasksPerSubstitute" BETWEEN 1 AND 500),
  CONSTRAINT "CK_org_workload_policy_warning" CHECK ("warningThresholdPercent" BETWEEN 1 AND 100)
);
CREATE INDEX "IDX_org_workload_policy_tenant" ON organization_workload_policies ("tenantId","organizationId");
COMMIT;
