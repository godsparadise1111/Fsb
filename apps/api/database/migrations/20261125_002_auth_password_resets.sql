-- Phase 4: single-use, short-lived password reset tokens (only the SHA-256 hash is stored).
BEGIN;

CREATE TABLE auth_password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "tokenHash" char(64) NOT NULL UNIQUE,
  "requestedIp" varchar(64) NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL,
  "usedAt" timestamptz NULL,
  CONSTRAINT "CK_auth_password_resets_hash" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "CK_auth_password_resets_expiry" CHECK ("expiresAt" > "createdAt")
);

CREATE INDEX "IDX_auth_password_resets_user_open" ON auth_password_resets("userId") WHERE "usedAt" IS NULL;
CREATE INDEX "IDX_auth_password_resets_created" ON auth_password_resets("createdAt");

COMMIT;
