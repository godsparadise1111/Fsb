-- Identity and organizational assignment invariants.
-- Prerequisites: tenant migrations 001, 002, 005, 006 and 008.
-- This migration intentionally fails if an inactive user is the only viable tenant admin.
BEGIN;

-- Count only administrators whose accounts are actually active. Serialize all
-- competing admin removals on the tenant row, including direct SQL operations.
CREATE OR REPLACE FUNCTION fsb_prevent_last_tenant_admin_removal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scoped_tenant uuid;
DECLARE removing_admin boolean := false;
DECLARE tenant_status varchar(20);
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
    SELECT status INTO tenant_status FROM tenants WHERE id = scoped_tenant FOR UPDATE;
    IF tenant_status = 'ACTIVE' AND NOT EXISTS (
      SELECT 1
        FROM tenant_memberships tm
        INNER JOIN users u ON u.id = tm."userId" AND u."isActive" = true
       WHERE tm."tenantId" = scoped_tenant
         AND tm.id <> OLD.id
         AND tm."isActive" = true
         AND tm."isTenantAdmin" = true
    ) THEN
      RAISE EXCEPTION 'A tenant must retain at least one active administrator with an active account';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- Every active tenant must have at least one active administrator account.
-- Existing tenants without one must be reconciled before this migration is applied.
DO $
BEGIN
  IF EXISTS (
    SELECT t.id
      FROM tenants t
      LEFT JOIN tenant_memberships tm ON tm."tenantId" = t.id AND tm."isActive" = true AND tm."isTenantAdmin" = true
      LEFT JOIN users u ON u.id = tm."userId" AND u."isActive" = true
     WHERE t.status = 'ACTIVE'
     GROUP BY t.id
    HAVING COUNT(u.id) = 0
  ) THEN
    RAISE EXCEPTION 'Identity invariant migration blocked: one or more active tenants have no active administrator; appoint one before migration 012';
  END IF;
END $;

-- Refuse unsafe cleanup if an inactive account is currently the sole admin.
DO $
BEGIN
  IF EXISTS (
    SELECT tm."tenantId"
      FROM tenant_memberships tm
      LEFT JOIN users u ON u.id = tm."userId" AND u."isActive" = true
     WHERE tm."isActive" = true AND tm."isTenantAdmin" = true
     GROUP BY tm."tenantId"
    HAVING COUNT(*) FILTER (WHERE u.id IS NOT NULL) = 0
  ) THEN
    RAISE EXCEPTION 'Identity invariant migration blocked: at least one tenant has no active administrator account; restore or appoint an administrator first';
  END IF;
END $$;

-- Membership deactivation runs the existing migration-008 trigger, which
-- revokes all tenant-scoped roles and positions in the same transaction.
UPDATE tenant_memberships tm
   SET "isActive" = false, "isTenantAdmin" = false
  FROM users u
 WHERE u.id = tm."userId" AND u."isActive" = false
   AND tm."isActive" = true;

-- Composite FKs make cross-tenant assignments impossible even if a service
-- accidentally supplies a valid user and a valid position from different tenants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_user_positions_tenant_member') THEN
    ALTER TABLE user_positions
      ADD CONSTRAINT "FK_user_positions_tenant_member"
      FOREIGN KEY ("tenantId", "userId")
      REFERENCES tenant_memberships("tenantId", "userId") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_user_roles_tenant_member') THEN
    ALTER TABLE user_roles
      ADD CONSTRAINT "FK_user_roles_tenant_member"
      FOREIGN KEY ("tenantId", "userId")
      REFERENCES tenant_memberships("tenantId", "userId") ON DELETE RESTRICT;
  END IF;
END $$;

-- Lock the user and membership rows while creating/reactivating assignments.
-- This serializes assignment creation against account/membership deactivation.
CREATE OR REPLACE FUNCTION fsb_assert_active_identity_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE user_active boolean;
DECLARE tenant_status varchar(20);
DECLARE resolved_tenant uuid;
DECLARE role_scope varchar(24);
DECLARE role_active boolean;
DECLARE organization_active boolean;
DECLARE unit_active boolean;
DECLARE position_active boolean;
BEGIN
  IF NEW."isActive" IS DISTINCT FROM true THEN RETURN NEW; END IF;

  SELECT u."isActive" INTO user_active
    FROM users u WHERE u.id = NEW."userId" FOR SHARE;
  IF user_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Active identity assignment requires an active user';
  END IF;

  IF TG_TABLE_NAME = 'user_positions' THEN
    SELECT t.id, t.status, o."isActive", ou."isActive", p."isActive"
      INTO resolved_tenant, tenant_status, organization_active, unit_active, position_active
      FROM positions p
      INNER JOIN organization_units ou ON ou.id = p."organizationUnitId"
      INNER JOIN organizations o ON o.id = ou."organizationId"
      INNER JOIN tenants t ON t.id = o."tenantId"
     WHERE p.id = NEW."positionId"
     FOR SHARE OF p, ou, o, t;
    IF tenant_status IS DISTINCT FROM 'ACTIVE'
       OR organization_active IS DISTINCT FROM true
       OR unit_active IS DISTINCT FROM true
       OR position_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Active position assignment requires an active tenant, organization, unit and position';
    END IF;

    PERFORM 1 FROM tenant_memberships tm
     WHERE tm."tenantId" = resolved_tenant AND tm."userId" = NEW."userId"
       AND tm."isActive" = true
     FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Position assignee must be an active member of the same tenant'; END IF;
  ELSIF TG_TABLE_NAME = 'user_roles' THEN
    SELECT r.scope, r."isActive" INTO role_scope, role_active
      FROM roles r WHERE r.id = NEW."roleId" FOR SHARE;
    IF role_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Active role assignment requires an active role'; END IF;

    IF NEW."organizationId" IS NULL THEN
      IF role_scope <> 'PLATFORM' OR NEW."tenantId" IS NOT NULL THEN
        RAISE EXCEPTION 'Only platform roles may be assigned without an organization';
      END IF;
      RETURN NEW;
    END IF;

    IF role_scope <> 'ORGANIZATION' THEN RAISE EXCEPTION 'Platform roles cannot be organization-scoped'; END IF;
    SELECT t.id, t.status, o."isActive" INTO resolved_tenant, tenant_status, organization_active
      FROM organizations o INNER JOIN tenants t ON t.id = o."tenantId"
     WHERE o.id = NEW."organizationId"
     FOR SHARE OF o, t;
    IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved_tenant THEN
      RAISE EXCEPTION 'Role assignment tenant does not match its organization';
    END IF;
    IF tenant_status IS DISTINCT FROM 'ACTIVE' OR organization_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Active organization role requires an active tenant and organization';
    END IF;

    PERFORM 1 FROM tenant_memberships tm
     WHERE tm."tenantId" = resolved_tenant AND tm."userId" = NEW."userId"
       AND tm."isActive" = true
     FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Role recipient must be an active member of the same tenant'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "AAA_user_positions_active_identity_guard"
  BEFORE INSERT OR UPDATE OF "userId", "positionId", "tenantId", "isActive" ON user_positions
  FOR EACH ROW EXECUTE FUNCTION fsb_assert_active_identity_assignment();
CREATE TRIGGER "AAA_user_roles_active_identity_guard"
  BEFORE INSERT OR UPDATE OF "userId", "roleId", "organizationId", "tenantId", "isActive" ON user_roles
  FOR EACH ROW EXECUTE FUNCTION fsb_assert_active_identity_assignment();

-- An account deactivation must remove its tenant memberships (and therefore
-- assignments through migration 008), but must never silently remove the last admin.
CREATE OR REPLACE FUNCTION fsb_guard_user_deactivation_admin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE membership_row record;
DECLARE tenant_status varchar(20);
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    FOR membership_row IN
      SELECT tm."tenantId", tm."isTenantAdmin"
        FROM tenant_memberships tm
       WHERE tm."userId" = OLD.id AND tm."isActive" = true
       ORDER BY tm."tenantId"
    LOOP
      IF membership_row."isTenantAdmin" THEN
        SELECT status INTO tenant_status FROM tenants WHERE id = membership_row."tenantId" FOR UPDATE;
        IF tenant_status = 'ACTIVE' AND NOT EXISTS (
          SELECT 1
            FROM tenant_memberships tm
            INNER JOIN users u ON u.id = tm."userId" AND u."isActive" = true
           WHERE tm."tenantId" = membership_row."tenantId"
             AND tm."userId" <> OLD.id
             AND tm."isActive" = true AND tm."isTenantAdmin" = true
        ) THEN
          RAISE EXCEPTION 'Transfer tenant administration before deactivating the last active administrator account';
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "AAA_users_last_tenant_admin_guard"
  BEFORE UPDATE OF "isActive" ON users
  FOR EACH ROW EXECUTE FUNCTION fsb_guard_user_deactivation_admin();

CREATE OR REPLACE FUNCTION fsb_deactivate_user_tenant_memberships() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    UPDATE tenant_memberships
       SET "isActive" = false, "isTenantAdmin" = false
     WHERE "userId" = NEW.id AND "isActive" = true;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ZZZ_users_revoke_tenant_memberships"
  AFTER UPDATE OF "isActive" ON users
  FOR EACH ROW EXECUTE FUNCTION fsb_deactivate_user_tenant_memberships();

-- Disabling a structural object revokes affected assignments. Re-enabling the
-- object does not restore assignments; an administrator must explicitly reassign.
CREATE OR REPLACE FUNCTION fsb_revoke_inactive_organization_assignments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    UPDATE user_positions up SET "isActive" = false, "isPrimary" = false
      FROM positions p JOIN organization_units ou ON ou.id = p."organizationUnitId"
     WHERE up."positionId" = p.id AND ou."organizationId" = NEW.id AND up."isActive" = true;
    UPDATE user_roles SET "isActive" = false
     WHERE "organizationId" = NEW.id AND "isActive" = true;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ZZZ_organizations_revoke_assignments"
  AFTER UPDATE OF "isActive" ON organizations
  FOR EACH ROW EXECUTE FUNCTION fsb_revoke_inactive_organization_assignments();

CREATE OR REPLACE FUNCTION fsb_revoke_inactive_unit_assignments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    UPDATE user_positions up SET "isActive" = false, "isPrimary" = false
      FROM positions p
     WHERE up."positionId" = p.id AND p."organizationUnitId" = NEW.id AND up."isActive" = true;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ZZZ_organization_units_revoke_assignments"
  AFTER UPDATE OF "isActive" ON organization_units
  FOR EACH ROW EXECUTE FUNCTION fsb_revoke_inactive_unit_assignments();

CREATE OR REPLACE FUNCTION fsb_revoke_inactive_position_assignments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    UPDATE user_positions SET "isActive" = false, "isPrimary" = false
     WHERE "positionId" = NEW.id AND "isActive" = true;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ZZZ_positions_revoke_assignments"
  AFTER UPDATE OF "isActive" ON positions
  FOR EACH ROW EXECUTE FUNCTION fsb_revoke_inactive_position_assignments();

CREATE OR REPLACE FUNCTION fsb_revoke_inactive_role_assignments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    UPDATE user_roles SET "isActive" = false WHERE "roleId" = NEW.id AND "isActive" = true;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ZZZ_roles_revoke_assignments"
  AFTER UPDATE OF "isActive" ON roles
  FOR EACH ROW EXECUTE FUNCTION fsb_revoke_inactive_role_assignments();


-- Deferred checks permit tenant activation and initial-admin membership creation
-- in one transaction, while making an active tenant without an active admin impossible.
CREATE OR REPLACE FUNCTION fsb_assert_tenant_has_active_admin() RETURNS trigger LANGUAGE plpgsql AS $
DECLARE scoped_tenant uuid;
DECLARE scoped_status varchar(20);
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    scoped_tenant := NEW.id;
    scoped_status := NEW.status;
  ELSE
    scoped_tenant := NEW."tenantId";
    SELECT status INTO scoped_status FROM tenants WHERE id = scoped_tenant;
  END IF;

  IF scoped_status = 'ACTIVE' AND NOT EXISTS (
    SELECT 1
      FROM tenant_memberships tm
      INNER JOIN users u ON u.id = tm."userId" AND u."isActive" = true
     WHERE tm."tenantId" = scoped_tenant
       AND tm."isActive" = true AND tm."isTenantAdmin" = true
  ) THEN
    RAISE EXCEPTION 'An active tenant must retain at least one active administrator account';
  END IF;
  RETURN NULL;
END $;

CREATE CONSTRAINT TRIGGER "CT_tenants_require_active_admin"
  AFTER INSERT OR UPDATE ON tenants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsb_assert_tenant_has_active_admin();

CREATE CONSTRAINT TRIGGER "CT_tenant_memberships_require_active_admin"
  AFTER INSERT OR UPDATE ON tenant_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsb_assert_tenant_has_active_admin();

COMMIT;
