-- Database-level tenant membership invariants.
-- Prerequisites: migrations 001 and tenant membership table.
BEGIN;

CREATE OR REPLACE FUNCTION fsb_guard_tenant_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant_status varchar(20);
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."tenantId" IS DISTINCT FROM NEW."tenantId" OR OLD."userId" IS DISTINCT FROM NEW."userId") THEN
    RAISE EXCEPTION 'Tenant membership identity is immutable; deactivate the old membership and create a new one';
  END IF;
  IF NEW."isTenantAdmin" = true AND NEW."isActive" = false THEN
    RAISE EXCEPTION 'An inactive tenant membership cannot be an administrator';
  END IF;
  IF NEW."isActive" THEN
    SELECT status INTO tenant_status FROM tenants WHERE id = NEW."tenantId";
    IF tenant_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'Active membership requires an active tenant';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW."userId" AND u."isActive" = true) THEN
      RAISE EXCEPTION 'Active membership requires an active user';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "TR_tenant_memberships_00_guard"
  BEFORE INSERT OR UPDATE OF "tenantId", "userId", "isActive", "isTenantAdmin" ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION fsb_guard_tenant_membership();

CREATE OR REPLACE FUNCTION fsb_prevent_last_tenant_admin_removal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scoped_tenant uuid;
DECLARE removing_admin boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    scoped_tenant := OLD."tenantId";
    removing_admin := OLD."isActive" AND OLD."isTenantAdmin";
  ELSE
    scoped_tenant := OLD."tenantId";
    removing_admin := OLD."isActive" AND OLD."isTenantAdmin"
      AND (NEW."isActive" = false OR NEW."isTenantAdmin" = false);
  END IF;

  IF removing_admin THEN
    -- Serialize competing demotions/removals for this tenant before counting admins.
    PERFORM id FROM tenants WHERE id = scoped_tenant FOR UPDATE;
    IF NOT EXISTS (
      SELECT 1 FROM tenant_memberships tm
       WHERE tm."tenantId" = scoped_tenant
         AND tm.id <> OLD.id
         AND tm."isActive" = true
         AND tm."isTenantAdmin" = true
    ) THEN
      RAISE EXCEPTION 'A tenant must retain at least one active administrator';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ZZZ_TR_tenant_memberships_last_admin"
  BEFORE DELETE OR UPDATE OF "isActive", "isTenantAdmin" ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION fsb_prevent_last_tenant_admin_removal();

COMMIT;
