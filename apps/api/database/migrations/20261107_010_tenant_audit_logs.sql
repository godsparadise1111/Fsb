-- Append-only audit trail for tenant administration and invitations.
BEGIN;

CREATE TABLE tenant_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "actorUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "targetUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(80) NOT NULL,
  "resourceType" varchar(80) NOT NULL,
  "resourceId" uuid NULL,
  metadata jsonb NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "IDX_tenant_audit_tenant_created"
  ON tenant_audit_logs ("tenantId", "createdAt");
CREATE INDEX "IDX_tenant_audit_actor"
  ON tenant_audit_logs ("tenantId", "actorUserId", "createdAt");

CREATE OR REPLACE FUNCTION fsb_tenant_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tenant audit logs are append-only';
END $$;

CREATE TRIGGER "TR_tenant_audit_no_mutation"
  BEFORE UPDATE OR DELETE ON tenant_audit_logs
  FOR EACH ROW EXECUTE FUNCTION fsb_tenant_audit_append_only();

COMMIT;
