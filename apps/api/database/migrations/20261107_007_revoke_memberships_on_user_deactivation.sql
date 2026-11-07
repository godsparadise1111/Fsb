-- Deactivating a user must revoke all tenant memberships, while preserving
-- the last-active-tenant-admin invariant enforced by migration 006.
BEGIN;

CREATE OR REPLACE FUNCTION fsb_revoke_memberships_on_user_deactivation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE membership_row record;
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    FOR membership_row IN
      SELECT id, "tenantId"
        FROM tenant_memberships
       WHERE "userId" = OLD.id AND "isActive" = true
       ORDER BY "tenantId", id
    LOOP
      -- Keep a deterministic tenant lock order across concurrent account deactivations.
      PERFORM id FROM tenants WHERE id = membership_row."tenantId" FOR UPDATE;
      UPDATE tenant_memberships
         SET "isActive" = false, "isTenantAdmin" = false
       WHERE id = membership_row.id AND "isActive" = true;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "TR_users_revoke_tenant_memberships"
  AFTER UPDATE OF "isActive" ON users
  FOR EACH ROW EXECUTE FUNCTION fsb_revoke_memberships_on_user_deactivation();

COMMIT;
