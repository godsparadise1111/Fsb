-- SLA deadlines for operational alerts. Existing alerts receive deterministic deadlines from first detection.
BEGIN;
ALTER TABLE organization_operational_alerts
 ADD COLUMN "responseDueAt" timestamptz,
 ADD COLUMN "resolutionDueAt" timestamptz,
 ADD COLUMN "escalatedAt" timestamptz,
 ADD COLUMN "escalationLevel" smallint NOT NULL DEFAULT 0;
UPDATE organization_operational_alerts
 SET "responseDueAt" = "firstDetectedAt" + CASE severity WHEN 'CRITICAL' THEN interval '15 minutes' WHEN 'HIGH' THEN interval '1 hour' ELSE interval '4 hours' END,
     "resolutionDueAt" = "firstDetectedAt" + CASE severity WHEN 'CRITICAL' THEN interval '4 hours' WHEN 'HIGH' THEN interval '8 hours' ELSE interval '24 hours' END;
ALTER TABLE organization_operational_alerts
 ADD CONSTRAINT "CK_operational_alert_escalation_level" CHECK ("escalationLevel" BETWEEN 0 AND 2),
 ADD CONSTRAINT "CK_operational_alert_sla_order" CHECK ("resolutionDueAt" > "responseDueAt");
CREATE INDEX "IDX_operational_alert_sla_due" ON organization_operational_alerts ("tenantId","resolutionDueAt") WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS');
CREATE OR REPLACE FUNCTION fsb_set_operational_alert_sla_deadlines() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
 NEW."responseDueAt" := COALESCE(NEW."responseDueAt", NEW."firstDetectedAt" + CASE NEW.severity
   WHEN 'CRITICAL' THEN interval '15 minutes' WHEN 'HIGH' THEN interval '1 hour'
   WHEN 'MEDIUM' THEN interval '4 hours' ELSE interval '24 hours' END);
 NEW."resolutionDueAt" := COALESCE(NEW."resolutionDueAt", NEW."firstDetectedAt" + CASE NEW.severity
   WHEN 'CRITICAL' THEN interval '4 hours' WHEN 'HIGH' THEN interval '8 hours'
   WHEN 'MEDIUM' THEN interval '24 hours' ELSE interval '72 hours' END);
 RETURN NEW;
END; $;
CREATE TRIGGER "TR_operational_alert_sla_deadlines"
 BEFORE INSERT OR UPDATE OF severity,"firstDetectedAt","responseDueAt","resolutionDueAt"
 ON organization_operational_alerts FOR EACH ROW
 EXECUTE FUNCTION fsb_set_operational_alert_sla_deadlines();
COMMIT;
