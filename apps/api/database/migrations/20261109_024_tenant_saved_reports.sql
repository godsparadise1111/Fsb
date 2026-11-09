-- Dynamic, tenant-scoped saved reports. No user SQL or executable query text is stored.
CREATE TABLE IF NOT EXISTS tenant_saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "ownerUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title varchar(160) NOT NULL,
  description varchar(1000),
  config jsonb NOT NULL,
  "isShared" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tenant_saved_reports_config_object CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT ck_tenant_saved_reports_title CHECK (length(btrim(title)) BETWEEN 1 AND 160)
);

CREATE INDEX IF NOT EXISTS ix_tenant_saved_reports_owner_updated
  ON tenant_saved_reports ("tenantId", "ownerUserId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS ix_tenant_saved_reports_shared_updated
  ON tenant_saved_reports ("tenantId", "isShared", "updatedAt" DESC)
  WHERE "isShared" = true;

COMMENT ON TABLE tenant_saved_reports IS
  'Tenant-scoped saved report specifications. Query execution is compiled from an allowlisted metadata registry.';
