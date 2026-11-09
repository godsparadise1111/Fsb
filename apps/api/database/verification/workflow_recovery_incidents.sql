-- Operational queue for workflow recovery incidents.
-- Read-only: acknowledge/resolve only through an audited administrative workflow.

SELECT ri.id, ri."tenantId", t.name AS "tenantName",
       ri."processInstanceId", pi.title AS "processTitle",
       ri."incidentType", ri.status, ri.details,
       ri."createdAt", ri."updatedAt"
  FROM workflow_recovery_incidents ri
  JOIN tenants t ON t.id=ri."tenantId"
  JOIN process_instances pi ON pi.id=ri."processInstanceId" AND pi."tenantId"=ri."tenantId"
 WHERE ri.status IN ('OPEN','ACKNOWLEDGED')
 ORDER BY ri."createdAt" ASC;

-- Tenant/process identity integrity must return zero rows.
SELECT ri.id, ri."tenantId" AS "incidentTenantId", pi."tenantId" AS "processTenantId"
  FROM workflow_recovery_incidents ri
  JOIN process_instances pi ON pi.id=ri."processInstanceId"
 WHERE ri."tenantId" IS DISTINCT FROM pi."tenantId";

-- Duplicate fingerprints must return zero rows.
SELECT "tenantId","processInstanceId","incidentType",fingerprint,count(*)
  FROM workflow_recovery_incidents
 GROUP BY "tenantId","processInstanceId","incidentType",fingerprint
HAVING count(*) > 1;
