-- Query indexes for tenant-scoped operational alert SLA reporting and worker scans.
BEGIN;
CREATE INDEX IF NOT EXISTS "IDX_operational_alert_sla_report_cohort"
 ON organization_operational_alerts ("tenantId","firstDetectedAt","organizationId",severity);
CREATE INDEX IF NOT EXISTS "IDX_operational_alert_response_due"
 ON organization_operational_alerts ("tenantId","responseDueAt")
 WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')
   AND "responseDueAt" IS NOT NULL AND "acknowledgedAt" IS NULL;
COMMIT;
