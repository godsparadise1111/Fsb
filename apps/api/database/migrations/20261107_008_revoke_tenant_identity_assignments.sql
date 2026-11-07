-- Revoking a tenant membership also disables that user's tenant-scoped
-- positions and organization role grants. Reactivation requires explicit reassignment.
BEGIN;

CREATE OR REPLACE FUNCTION fsb_revoke_tenant_identity_assignments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    UPDATE user_positions
       SET "isActive" = false, "isPrimary" = false
     WHERE "tenantId" = OLD."tenantId" AND "userId" = OLD."userId" AND "isActive" = true;

    UPDATE user_roles
       SET "isActive" = false
     WHERE "tenantId" = OLD."tenantId" AND "userId" = OLD."userId" AND "isActive" = true;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "TR_tenant_memberships_revoke_assignments"
  AFTER UPDATE OF "isActive" ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION fsb_revoke_tenant_identity_assignments();

-- Reconcile already inactive memberships that still carry active assignments.
UPDATE user_positions up
   SET "isActive" = false, "isPrimary" = false
  FROM tenant_memberships tm
 WHERE tm."tenantId" = up."tenantId" AND tm."userId" = up."userId"
   AND tm."isActive" = false AND up."isActive" = true;

UPDATE user_roles ur
   SET "isActive" = false
  FROM tenant_memberships tm
 WHERE tm."tenantId" = ur."tenantId" AND tm."userId" = ur."userId"
   AND tm."isActive" = false AND ur."isActive" = true;

COMMIT;
