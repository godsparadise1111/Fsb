-- Database-enforced organization/unit/position hierarchy integrity.
-- Prerequisite: tenant migrations 001, 002 and identity invariants migration 012.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM organization_units ou
    LEFT JOIN organizations o ON o.id = ou."organizationId"
    LEFT JOIN tenants t ON t.id = o."tenantId"
    WHERE ou."isActive" = true
      AND (o.id IS NULL OR o."isActive" = false OR t.status IS DISTINCT FROM 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'Active organization units exist under inactive or tenantless organizations; reconcile before migration 013';
  END IF;
  IF EXISTS (
    SELECT 1 FROM organization_units child
    JOIN organization_units parent ON parent.id = child."parentId"
    WHERE child."parentId" IS NOT NULL
      AND child."organizationId" <> parent."organizationId"
  ) THEN
    RAISE EXCEPTION 'Organization unit hierarchy contains cross-organization parent references; repair before migration 013';
  END IF;
  IF EXISTS (
    SELECT 1 FROM positions p
    LEFT JOIN organization_units ou ON ou.id = p."organizationUnitId"
    LEFT JOIN organizations o ON o.id = ou."organizationId"
    LEFT JOIN tenants t ON t.id = o."tenantId"
    WHERE p."isActive" = true
      AND (ou.id IS NULL OR ou."isActive" = false OR o."isActive" = false OR t.status IS DISTINCT FROM 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'Active positions exist under inactive organization units, organizations or tenants; reconcile before migration 013';
  END IF;
END $$;

ALTER TABLE organization_units
  ADD CONSTRAINT "UQ_organization_units_id_org" UNIQUE (id, "organizationId");

ALTER TABLE organization_units
  ADD CONSTRAINT "FK_organization_units_parent_same_org"
  FOREIGN KEY ("parentId", "organizationId")
  REFERENCES organization_units(id, "organizationId") ON DELETE RESTRICT;

ALTER TABLE organization_units
  ADD CONSTRAINT "CHK_organization_units_not_own_parent"
  CHECK ("parentId" IS NULL OR "parentId" <> id);

CREATE OR REPLACE FUNCTION fsb_guard_organization_unit_structure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE organization_active boolean;
DECLARE tenant_status varchar(20);
DECLARE parent_organization uuid;
DECLARE parent_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'An organization unit cannot be transferred to another organization';
  END IF;

  SELECT o."isActive", t.status INTO organization_active, tenant_status
    FROM organizations o
    INNER JOIN tenants t ON t.id = o."tenantId"
   WHERE o.id = NEW."organizationId"
   FOR SHARE OF o, t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization unit must belong to an existing tenant organization'; END IF;

  IF NEW."isActive" THEN
    IF organization_active IS DISTINCT FROM true OR tenant_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'An active unit requires an active organization and tenant';
    END IF;
  END IF;

  IF NEW."parentId" IS NOT NULL THEN
    SELECT parent."organizationId", parent."isActive"
      INTO parent_organization, parent_active
      FROM organization_units parent
     WHERE parent.id = NEW."parentId"
     FOR SHARE;
    IF NOT FOUND OR parent_organization <> NEW."organizationId" THEN
      RAISE EXCEPTION 'A unit parent must belong to the same organization';
    END IF;
    IF NEW."isActive" AND parent_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'An active unit requires an active parent unit';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "AAA_organization_units_structure_guard"
  BEFORE INSERT OR UPDATE OF "organizationId", "parentId", "isActive" ON organization_units
  FOR EACH ROW EXECUTE FUNCTION fsb_guard_organization_unit_structure();

CREATE OR REPLACE FUNCTION fsb_guard_position_structure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE unit_active boolean;
DECLARE organization_active boolean;
DECLARE tenant_status varchar(20);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."organizationUnitId" IS DISTINCT FROM NEW."organizationUnitId" THEN
    RAISE EXCEPTION 'A position cannot be transferred to another organization unit';
  END IF;

  SELECT ou."isActive", o."isActive", t.status
    INTO unit_active, organization_active, tenant_status
    FROM organization_units ou
    INNER JOIN organizations o ON o.id = ou."organizationId"
    INNER JOIN tenants t ON t.id = o."tenantId"
   WHERE ou.id = NEW."organizationUnitId"
   FOR SHARE OF ou, o, t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Position must belong to an existing organization unit'; END IF;

  IF NEW."isActive" AND (
    unit_active IS DISTINCT FROM true OR organization_active IS DISTINCT FROM true
    OR tenant_status IS DISTINCT FROM 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'An active position requires an active unit, organization and tenant';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "AAA_positions_structure_guard"
  BEFORE INSERT OR UPDATE OF "organizationUnitId", "isActive" ON positions
  FOR EACH ROW EXECUTE FUNCTION fsb_guard_position_structure();

-- Structural deactivation cascades downward. Reactivation never silently
-- restores child objects or their historical user assignments.
CREATE OR REPLACE FUNCTION fsb_revoke_inactive_unit_assignments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    UPDATE positions SET "isActive" = false
     WHERE "organizationUnitId" = NEW.id AND "isActive" = true;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fsb_revoke_inactive_organization_assignments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" = true AND NEW."isActive" = false THEN
    UPDATE organization_units SET "isActive" = false
     WHERE "organizationId" = NEW.id AND "isActive" = true;
    UPDATE user_roles SET "isActive" = false
     WHERE "organizationId" = NEW.id AND "isActive" = true;
  END IF;
  RETURN NEW;
END $$;

COMMIT;
