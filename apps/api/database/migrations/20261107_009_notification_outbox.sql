-- Encrypted, tenant-scoped transactional notification outbox.
-- Requires the tenant table from migration 001.
BEGIN;

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "eventType" varchar(80) NOT NULL,
  recipient varchar(190) NOT NULL,
  subject varchar(160) NULL,
  "payloadCiphertext" text NOT NULL,
  "payloadIv" varchar(64) NOT NULL,
  "payloadAuthTag" varchar(64) NOT NULL,
  "dedupeKey" varchar(80) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  "availableAt" timestamptz NOT NULL DEFAULT now(),
  "lockedBy" varchar(120) NULL,
  "lockedAt" timestamptz NULL,
  "deliveredAt" timestamptz NULL,
  "lastError" text NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CHK_notification_outbox_status" CHECK (status IN ('PENDING','PROCESSING','DELIVERED','DEAD')),
  CONSTRAINT "CHK_notification_outbox_attempts" CHECK (attempts >= 0),
  CONSTRAINT "CHK_notification_outbox_lease" CHECK (
    (status = 'PROCESSING' AND "lockedBy" IS NOT NULL AND "lockedAt" IS NOT NULL)
    OR (status <> 'PROCESSING' AND "lockedBy" IS NULL AND "lockedAt" IS NULL)
  ),
  CONSTRAINT "CHK_notification_outbox_delivery" CHECK (
    (status = 'DELIVERED' AND "deliveredAt" IS NOT NULL)
    OR (status <> 'DELIVERED' AND "deliveredAt" IS NULL)
  )
);

CREATE INDEX "IDX_notification_outbox_ready"
  ON notification_outbox (status, "availableAt", "createdAt")
  WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX "IDX_notification_outbox_tenant"
  ON notification_outbox ("tenantId", "createdAt" DESC);

CREATE OR REPLACE FUNCTION fsb_guard_notification_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant_status varchar(20);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
    RAISE EXCEPTION 'Notification outbox tenant ownership is immutable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO tenant_status FROM tenants WHERE id = NEW."tenantId";
    IF tenant_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'Notifications can only be queued for an active tenant';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "TR_notification_outbox_tenant_guard"
  BEFORE INSERT OR UPDATE OF "tenantId" ON notification_outbox
  FOR EACH ROW EXECUTE FUNCTION fsb_guard_notification_outbox();

COMMIT;
