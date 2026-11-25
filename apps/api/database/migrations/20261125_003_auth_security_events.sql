-- Phase 4: append-only security event trail for authentication and session activity.
-- Failed sign-ins for unknown accounts store only a short hash of the typed identity, never the identity itself,
-- because people sometimes type a password into the username field.
BEGIN;

CREATE TABLE auth_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventType" varchar(60) NOT NULL,
  "userId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  "identityHash" varchar(32) NULL,
  "ipAddress" varchar(64) NULL,
  "userAgent" varchar(255) NULL,
  metadata jsonb NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CK_auth_security_events_type" CHECK ("eventType" ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  CONSTRAINT "CK_auth_security_events_metadata_size" CHECK (metadata IS NULL OR octet_length(metadata::text) <= 4000)
);

CREATE INDEX "IDX_auth_security_events_user" ON auth_security_events("userId", "createdAt" DESC) WHERE "userId" IS NOT NULL;
CREATE INDEX "IDX_auth_security_events_type_time" ON auth_security_events("eventType", "createdAt" DESC);
CREATE INDEX "IDX_auth_security_events_identity" ON auth_security_events("identityHash", "ipAddress", "createdAt" DESC) WHERE "identityHash" IS NOT NULL;

CREATE OR REPLACE FUNCTION fsb_auth_security_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Authentication security events are append-only';
END $$;

CREATE TRIGGER "TR_auth_security_events_no_mutation"
  BEFORE UPDATE OR DELETE ON auth_security_events
  FOR EACH ROW EXECUTE FUNCTION fsb_auth_security_events_append_only();

COMMIT;
