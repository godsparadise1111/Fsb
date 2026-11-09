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
  IF OLD.status='REVOKED' AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
    RAISE EXCEPTION 'API credential revocation timestamp is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_api_credential_identity
BEFORE UPDATE ON tenant_api_credentials
FOR EACH ROW EXECUTE FUNCTION fsb_protect_api_credential_identity();
CREATE OR REPLACE FUNCTION fsb_prevent_api_credential_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'API credentials cannot be hard-deleted; revoke them instead';
END;
$$;
CREATE TRIGGER trg_prevent_api_credential_delete
BEFORE DELETE ON tenant_api_credentials
FOR EACH ROW EXECUTE FUNCTION fsb_prevent_api_credential_delete();

-- Enforce commercial shutdown even when tenant closure is performed outside the API service.
CREATE OR REPLACE FUNCTION fsb_close_commercial_access_on_tenant_close()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status='CLOSED' THEN
    UPDATE tenant_subscriptions
       SET status='CANCELLED',"cancelledAt"=COALESCE("cancelledAt",now()),"updatedAt"=now()
     WHERE "tenantId"=NEW.id AND status<>'CANCELLED';
    UPDATE tenant_api_credentials
       SET status='REVOKED',"revokedAt"=now()
     WHERE "tenantId"=NEW.id AND status='ACTIVE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_close_commercial_access_on_tenant_close
AFTER UPDATE OF status ON tenants
FOR EACH ROW EXECUTE FUNCTION fsb_close_commercial_access_on_tenant_close();
COMMIT;
