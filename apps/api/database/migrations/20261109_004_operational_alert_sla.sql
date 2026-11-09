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
 ALTER COLUMN "responseDueAt" SET NOT NULL,
 ALTER COLUMN "resolutionDueAt" SET NOT NULL,
 ADD CONSTRAINT "CK_operational_alert_escalation_level" CHECK ("escalationLevel" BETWEEN 0 AND 2),
 ADD CONSTRAINT "CK_operational_alert_sla_order" CHECK ("resolutionDueAt" > "responseDueAt");
CREATE INDEX "IDX_operational_alert_sla_due" ON organization_operational_alerts ("tenantId","resolutionDueAt") WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS');
COMMIT;
