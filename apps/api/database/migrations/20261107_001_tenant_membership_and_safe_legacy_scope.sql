-- F-S tenant foundation migration
-- Apply with psql only after a verified database backup.
-- This migration deliberately DOES NOT assign legacy organizations to a tenant.
BEGIN;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  slug varchar(80) NOT NULL,
  code varchar(40) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  plan varchar(24) NOT NULL DEFAULT 'CORE',
  "trialEndsAt" timestamptz NULL,
  "activatedAt" timestamptz NULL,
  "suspendedAt" timestamptz NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_tenants_slug" UNIQUE (slug),
  CONSTRAINT "UQ_tenants_code" UNIQUE (code),
  CONSTRAINT "CHK_tenants_status" CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','CLOSED')),
  CONSTRAINT "CHK_tenants_plan" CHECK (plan IN ('CORE','PROFESSIONAL','ENTERPRISE'))
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS "tenantId" uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_organizations_tenant') THEN
    ALTER TABLE organizations
      ADD CONSTRAINT "FK_organizations_tenant"
      FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "isActive" boolean NOT NULL DEFAULT true,
  "isTenantAdmin" boolean NOT NULL DEFAULT false,
  "acceptedAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_tenant_membership_user_tenant" UNIQUE ("tenantId", "userId")
);

CREATE INDEX IF NOT EXISTS "IDX_tenant_memberships_user_active"
  ON tenant_memberships ("userId", "isActive");
CREATE INDEX IF NOT EXISTS "IDX_organizations_tenant_active"
  ON organizations ("tenantId", "isActive");

COMMIT;

-- After reviewing the mapping with the customer owner, execute a separate,
-- audited statement per legacy organization. Never map by guess or bulk default:
-- UPDATE organizations SET "tenantId" = '<TENANT_UUID>'
-- WHERE id = '<ORGANIZATION_UUID>' AND "tenantId" IS NULL;
--
-- Verify before closing the migration window:
-- SELECT id, name, code FROM organizations WHERE "tenantId" IS NULL;
-- SELECT "tenantId", count(*) FROM organizations GROUP BY "tenantId";
