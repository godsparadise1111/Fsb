-- Deactivating a user must revoke all tenant memberships, while preserving
-- the last-active-tenant-admin invariant enforced by migration 006.
BEGIN;

-- Reconcile already-disabled accounts first. If one is the only active admin
-- of a tenant, stop and require an explicit administrator transfer.
DO $
BEGIN
  IF EXISTS (
    SELECT 1
      FROM tenant_memberships tm
      INNER JOIN users u ON u.id = tm."userId"
     WHERE tm."isActive" = true AND tm."isTenantAdmin" = true AND u."isActive" = false
       AND NOT EXISTS (
         SELECT 1
           FROM tenant_memberships other
           INNER JOIN users other_user ON other_user.id = other."userId" AND other_user."isActive" = true
          WHERE other."tenantId" = tm."tenantId"
            AND other."isActive" = true AND other."isTenantAdmin" = true
            AND other.id <> tm.id
       )
  ) THEN
    RAISE EXCEPTION 'An inactive account is the only tenant administrator; transfer administration before migration 007';
  END IF;
END $;

UPDATE tenant_memberships tm
   SET "isActive" = false, "isTenantAdmin" = false
  FROM users u
 WHERE u.id = tm."userId" AND u."isActive" = false AND tm."isActive" = true;

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
