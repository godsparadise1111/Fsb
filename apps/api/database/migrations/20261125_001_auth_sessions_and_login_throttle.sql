-- Phase 4: revocable sessions (rotating refresh tokens) and database-backed login throttling.
BEGIN;

CREATE TABLE auth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "familyId" uuid NOT NULL,
  "tokenHash" char(64) NOT NULL UNIQUE,
  "userAgent" varchar(255) NULL,
  "ipAddress" varchar(64) NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL,
  "rotatedAt" timestamptz NULL,
  "revokedAt" timestamptz NULL,
  CONSTRAINT "CK_auth_refresh_tokens_hash" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "CK_auth_refresh_tokens_expiry" CHECK ("expiresAt" > "createdAt")
);

CREATE INDEX "IDX_auth_refresh_tokens_family" ON auth_refresh_tokens("familyId", "userId");
CREATE INDEX "IDX_auth_refresh_tokens_user_active" ON auth_refresh_tokens("userId") WHERE "revokedAt" IS NULL;

CREATE TABLE auth_failed_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity varchar(190) NOT NULL,
  "ipAddress" varchar(64) NOT NULL,
  "attemptedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "IDX_auth_failed_logins_identity" ON auth_failed_logins(identity, "attemptedAt" DESC);
CREATE INDEX "IDX_auth_failed_logins_time" ON auth_failed_logins("attemptedAt");

COMMIT;
