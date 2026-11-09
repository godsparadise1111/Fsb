-- Extend the immutable alert timeline with idempotent SLA breach events.
BEGIN;
ALTER TABLE organization_operational_alert_events DROP CONSTRAINT "CK_operational_alert_event_type";
ALTER TABLE organization_operational_alert_events ADD CONSTRAINT "CK_operational_alert_event_type"
 CHECK ("eventType" IN ('ACKNOWLEDGE','ASSIGN','RESOLVE','REOPEN','COMMENT','SLA_RESPONSE_BREACH','SLA_RESOLUTION_BREACH','SLA_ESCALATION'));
ALTER TABLE organization_operational_alert_events ADD COLUMN "dedupeKey" varchar(220) NULL;
CREATE UNIQUE INDEX "UQ_operational_alert_event_dedupe"
 ON organization_operational_alert_events ("tenantId","dedupeKey") WHERE "dedupeKey" IS NOT NULL;
COMMIT;
