-- Add the lookup index for the organization workload policy created by
-- 20261109_001_organization_workload_policies.sql.
-- Do not recreate the table: migration 001 owns its schema and validation trigger.
BEGIN;

CREATE INDEX IF NOT EXISTS "IDX_org_workload_policy_tenant"
  ON organization_workload_policies ("tenantId", "organizationId");

COMMIT;
