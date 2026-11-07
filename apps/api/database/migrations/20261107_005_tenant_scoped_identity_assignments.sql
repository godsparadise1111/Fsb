-- Tenant-scope identity assignments: positions and organization role grants.
-- Prerequisites: migrations 001 and 002.
BEGIN;

ALTER TABLE user_positions ADD COLUMN "tenantId" uuid NULL;
UPDATE user_positions up
   SET "tenantId" = o."tenantId"
  FROM positions p
  INNER JOIN organization_units ou ON ou.id = p."organizationUnitId"
  INNER JOIN organizations o ON o.id = ou."organizationId"
 WHERE p.id = up."positionId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM user_positions WHERE "tenantId" IS NULL) THEN
    RAISE EXCEPTION 'User position tenant backfill failed; review positions without organization ownership';
  END IF;
END $$;

ALTER TABLE user_positions ALTER COLUMN "tenantId" SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_positions up
     WHERE up."isActive" = true
       AND (
         NOT EXISTS (SELECT 1 FROM users u WHERE u.id = up."userId" AND u."isActive" = true)
         OR NOT EXISTS (
         SELECT 1 FROM tenant_memberships tm
          WHERE tm."tenantId" = up."tenantId" AND tm."userId" = up."userId" AND tm."isActive" = true
         )
       )
  ) THEN
    RAISE EXCEPTION 'Active user positions include users without active membership in the same tenant; reconcile memberships before migration 005';
  END IF;
END $$;

ALTER TABLE user_positions ADD CONSTRAINT "FK_user_positions_tenant"
  FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE RESTRICT;
CREATE INDEX "IDX_user_positions_tenant_user_active"
  ON user_positions ("tenantId", "userId", "isActive");

CREATE OR REPLACE FUNCTION fsb_guard_user_position_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved_tenant uuid;
DECLARE tenant_status varchar(20);
DECLARE position_active boolean;
DECLARE unit_active boolean;
DECLARE organization_active boolean;
BEGIN
  SELECT o."tenantId", t.status, p."isActive", ou."isActive", o."isActive"
    INTO resolved_tenant, tenant_status, position_active, unit_active, organization_active
    FROM positions p
    INNER JOIN organization_units ou ON ou.id = p."organizationUnitId"
    INNER JOIN organizations o ON o.id = ou."organizationId"
    INNER JOIN tenants t ON t.id = o."tenantId"
   WHERE p.id = NEW."positionId";
  IF resolved_tenant IS NULL THEN RAISE EXCEPTION 'Position must belong to an organization in a tenant'; END IF;
  IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved_tenant THEN RAISE EXCEPTION 'User position tenant mismatch'; END IF;
  IF NEW."isActive" THEN
    IF tenant_status <> 'ACTIVE' OR position_active IS DISTINCT FROM true OR unit_active IS DISTINCT FROM true OR organization_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Active user position requires an active organization, position and tenant';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW."userId" AND u."isActive" = true) THEN
      RAISE EXCEPTION 'User position recipient must be active';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM tenant_memberships tm
       WHERE tm."tenantId" = resolved_tenant AND tm."userId" = NEW."userId" AND tm."isActive" = true
    ) THEN RAISE EXCEPTION 'User must be an active member of the position tenant'; END IF;
  END IF;
  NEW."tenantId" := resolved_tenant;
  RETURN NEW;
END $$;

CREATE TRIGGER "TR_user_positions_tenant_guard"
  BEFORE INSERT OR UPDATE OF "userId", "positionId", "tenantId", "isActive" ON user_positions
  FOR EACH ROW EXECUTE FUNCTION fsb_guard_user_position_tenant();

ALTER TABLE user_roles ADD COLUMN "tenantId" uuid NULL;
UPDATE user_roles ur SET "tenantId" = o."tenantId"
FROM organizations o WHERE o.id = ur."organizationId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_roles ur INNER JOIN roles r ON r.id = ur."roleId"
     WHERE (ur."organizationId" IS NULL AND r.scope <> 'PLATFORM')
        OR (ur."organizationId" IS NOT NULL AND r.scope <> 'ORGANIZATION')
  ) THEN
    RAISE EXCEPTION 'Existing user role scope does not match its organization scope; reconcile before migration 005';
  END IF;
  IF EXISTS (
    SELECT 1 FROM user_roles ur
     WHERE ur."organizationId" IS NOT NULL AND ur."isActive" = true
       AND (
         NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ur."userId" AND u."isActive" = true)
         OR NOT EXISTS (
         SELECT 1 FROM tenant_memberships tm
          WHERE tm."tenantId" = ur."tenantId" AND tm."userId" = ur."userId" AND tm."isActive" = true
         )
       )
  ) THEN
    RAISE EXCEPTION 'Active organization role assignments include users without active tenant membership; reconcile before migration 005';
  END IF;
END $$;

ALTER TABLE user_roles ADD CONSTRAINT "CHK_user_roles_tenant_scope"
  CHECK (("organizationId" IS NULL AND "tenantId" IS NULL) OR ("organizationId" IS NOT NULL AND "tenantId" IS NOT NULL));
ALTER TABLE user_roles ADD CONSTRAINT "FK_user_roles_org_tenant"
  FOREIGN KEY ("organizationId", "tenantId") REFERENCES organizations(id, "tenantId") ON DELETE RESTRICT;
CREATE INDEX "IDX_user_roles_tenant_org_user"
  ON user_roles ("tenantId", "organizationId", "userId");

CREATE OR REPLACE FUNCTION fsb_guard_user_role_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE role_scope varchar(24);
DECLARE role_active boolean;
DECLARE resolved_tenant uuid;
DECLARE tenant_status varchar(20);
DECLARE organization_active boolean;
BEGIN
  SELECT scope, "isActive" INTO role_scope, role_active FROM roles WHERE id = NEW."roleId";
  IF role_scope IS NULL THEN RAISE EXCEPTION 'Role not found'; END IF;
  IF NEW."organizationId" IS NULL THEN
    IF role_scope <> 'PLATFORM' OR NEW."tenantId" IS NOT NULL THEN
      RAISE EXCEPTION 'Only platform roles may be assigned without an organization';
    END IF;
    IF NEW."isActive" AND (role_active IS DISTINCT FROM true OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW."userId" AND u."isActive" = true)) THEN
      RAISE EXCEPTION 'Active platform role assignment requires an active role and user';
    END IF;
    RETURN NEW;
  END IF;
  IF role_scope <> 'ORGANIZATION' THEN RAISE EXCEPTION 'Platform roles cannot be organization-scoped'; END IF;

  SELECT o."tenantId", t.status, o."isActive"
    INTO resolved_tenant, tenant_status, organization_active
    FROM organizations o
    INNER JOIN tenants t ON t.id = o."tenantId"
   WHERE o.id = NEW."organizationId";
  IF resolved_tenant IS NULL THEN RAISE EXCEPTION 'Role organization tenant not found'; END IF;
  IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved_tenant THEN RAISE EXCEPTION 'User role tenant mismatch'; END IF;
  IF NEW."isActive" THEN
    IF role_active IS DISTINCT FROM true OR tenant_status <> 'ACTIVE' OR organization_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Active organization role requires active role, organization and tenant';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW."userId" AND u."isActive" = true) THEN
      RAISE EXCEPTION 'Role recipient must be active';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM tenant_memberships tm
       WHERE tm."tenantId" = resolved_tenant AND tm."userId" = NEW."userId" AND tm."isActive" = true
    ) THEN RAISE EXCEPTION 'Role recipient must be an active member of the organization tenant'; END IF;
  END IF;
  NEW."tenantId" := resolved_tenant;
  RETURN NEW;
END $$;

CREATE TRIGGER "TR_user_roles_tenant_guard"
  BEFORE INSERT OR UPDATE OF "userId", "roleId", "organizationId", "tenantId", "isActive" ON user_roles
  FOR EACH ROW EXECUTE FUNCTION fsb_guard_user_role_tenant();

COMMIT;
