-- Tenant-scoped API credentials for the versioned public read API.
BEGIN;
CREATE TABLE tenant_api_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name varchar(100) NOT NULL,
  "keyPrefix" varchar(24) NOT NULL UNIQUE,
  "secretHash" char(64) NOT NULL UNIQUE,
  scopes text[] NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" timestamptz,
  "lastUsedAt" timestamptz,
  "createdByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CK_tenant_api_credentials_status" CHECK (status IN ('ACTIVE','REVOKED')),
  CONSTRAINT "CK_tenant_api_credentials_scopes" CHECK (
    cardinality(scopes) BETWEEN 1 AND 10 AND
    scopes <@ ARRAY['tenant.read','reports.read']::text[]
  ),
  CONSTRAINT "CK_tenant_api_credentials_revoked" CHECK (
    (status='ACTIVE' AND "revokedAt" IS NULL) OR
    (status='REVOKED' AND "revokedAt" IS NOT NULL)
  )
);
CREATE INDEX "IDX_tenant_api_credentials_active" ON tenant_api_credentials("tenantId",status,"expiresAt");
CREATE OR REPLACE FUNCTION fsb_protect_api_credential_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."tenantId" <> OLD."tenantId" OR NEW."keyPrefix" <> OLD."keyPrefix" OR
     NEW."secretHash" <> OLD."secretHash" OR NEW."createdByUserId" <> OLD."createdByUserId" OR
     NEW."createdAt" <> OLD."createdAt" OR NEW.name <> OLD.name OR
     NEW.scopes IS DISTINCT FROM OLD.scopes OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN
    RAISE EXCEPTION 'API credential identity is immutable';
  END IF;
  IF OLD.status='REVOKED' AND NEW.status <> 'REVOKED' THEN
    RAISE EXCEPTION 'Revoked API credentials cannot be reactivated';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_api_credential_identity
BEFORE UPDATE ON tenant_api_credentials
FOR EACH ROW EXECUTE FUNCTION fsb_protect_api_credential_identity();
CREATE OR REPLACE FUNCTION fsb_prevent_api_credential_delete()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  RAISE EXCEPTION 'API credentials cannot be hard-deleted; revoke them instead';
END;
$;
CREATE TRIGGER trg_prevent_api_credential_delete
BEFORE DELETE ON tenant_api_credentials
FOR EACH ROW EXECUTE FUNCTION fsb_prevent_api_credential_delete();
COMMIT;
