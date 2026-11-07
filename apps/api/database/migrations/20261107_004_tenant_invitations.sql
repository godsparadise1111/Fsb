-- Tenant invitations: hashed one-time tokens, expiry, revocation and acceptance audit.
-- Prerequisite: migrations 001 and tenant membership entity.
BEGIN;

CREATE TABLE tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  email varchar(190) NOT NULL,
  "tokenHash" varchar(64) NOT NULL,
  "invitedByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "isTenantAdmin" boolean NOT NULL DEFAULT false,
  "expiresAt" timestamptz NOT NULL,
  "acceptedAt" timestamptz NULL,
  "revokedAt" timestamptz NULL,
  "acceptedByUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_tenant_invitations_token_hash" UNIQUE ("tokenHash"),
  CONSTRAINT "CHK_tenant_invitations_email_normalized" CHECK (email = lower(trim(email))),
  CONSTRAINT "CHK_tenant_invitations_terminal_state" CHECK ("acceptedAt" IS NULL OR "revokedAt" IS NULL),
  CONSTRAINT "CHK_tenant_invitations_acceptor" CHECK (("acceptedAt" IS NULL AND "acceptedByUserId" IS NULL) OR ("acceptedAt" IS NOT NULL AND "acceptedByUserId" IS NOT NULL))
);

CREATE INDEX "IDX_tenant_invitations_tenant_email"
  ON tenant_invitations ("tenantId", email, "createdAt" DESC);
CREATE INDEX "IDX_tenant_invitations_pending_expiry"
  ON tenant_invitations ("tenantId", "expiresAt")
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;

COMMIT;
