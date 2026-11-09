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


-- Recovery event Tenant/incident identity mismatches must return zero rows.
SELECT e.id, e."tenantId" AS "eventTenantId", i."tenantId" AS "incidentTenantId"
  FROM workflow_recovery_incident_events e
  JOIN workflow_recovery_incidents i ON i.id=e."incidentId"
 WHERE e."tenantId" IS DISTINCT FROM i."tenantId";

-- Manual incident actions must have an audit record in the same Tenant.
SELECT e.id, e."eventType", e."tenantId", e."incidentId", e."actorUserId"
  FROM workflow_recovery_incident_events e
 WHERE e."eventType" IN ('ACKNOWLEDGE','RESOLVED','REPLAY_REJECTED')
   AND NOT EXISTS (
     SELECT 1 FROM tenant_audit_logs a
      WHERE a."tenantId"=e."tenantId"
        AND a."resourceType"='WORKFLOW_RECOVERY_INCIDENT'
        AND a."resourceId"=e."incidentId"
        AND a."actorUserId"=e."actorUserId"
        AND a.action=CASE e."eventType"
          WHEN 'ACKNOWLEDGE' THEN 'workflow.recovery_incident.acknowledge'
          WHEN 'RESOLVED' THEN 'workflow.recovery_incident.resolve'
          WHEN 'REPLAY_REJECTED' THEN 'workflow.recovery_incident.replay_rejected'
        END
   );

-- A resolved incident must have a durable RESOLVED event.
SELECT i.id, i."tenantId", i.status, i."resolvedAt"
  FROM workflow_recovery_incidents i
 WHERE i.status='RESOLVED'
   AND NOT EXISTS (
     SELECT 1 FROM workflow_recovery_incident_events e
      WHERE e."tenantId"=i."tenantId" AND e."incidentId"=i.id AND e."eventType"='RESOLVED'
   );

-- Event keys must be unique per incident (also protected by a unique constraint).
SELECT "incidentId","eventKey",count(*)
  FROM workflow_recovery_incident_events
 GROUP BY "incidentId","eventKey"
HAVING count(*)>1;


-- Platform health reconciliation: one row per active/suspended Tenant.
-- Compare these values with /api/platform/workflow-health.
SELECT t.id AS "tenantId", t.name, t.status,
       (SELECT count(*)::int FROM process_instances pi
         WHERE pi."tenantId"=t.id AND pi.status='RUNNING') AS "runningProcesses",
       (SELECT count(*)::int FROM workflow_tasks wt
         JOIN process_instances pi ON pi.id=wt."processInstanceId"
        WHERE pi."tenantId"=t.id AND pi.status='RUNNING' AND wt.status IN ('OPEN','IN_PROGRESS')) AS "activeTasks",
       (SELECT count(*)::int FROM workflow_recovery_incidents ri
        WHERE ri."tenantId"=t.id AND ri.status IN ('OPEN','ACKNOWLEDGED')) AS "activeRecoveryIncidents",
       (SELECT count(*)::int FROM workflow_recovery_incident_events e
         JOIN workflow_recovery_incidents ri ON ri.id=e."incidentId" AND ri."tenantId"=e."tenantId"
        WHERE ri."tenantId"=t.id AND e."eventType"='WORKER_SCAN'
          AND e."createdAt">=now()-interval '15 minutes') AS "workerScans15m"
  FROM tenants t
 WHERE t.status IN ('ACTIVE','SUSPENDED')
 ORDER BY t.name;

-- No event may be visible through an incident belonging to another Tenant.
SELECT e.id, e."tenantId" AS "eventTenantId", ri."tenantId" AS "incidentTenantId"
  FROM workflow_recovery_incident_events e
  JOIN workflow_recovery_incidents ri ON ri.id=e."incidentId"
 WHERE e."tenantId" <> ri."tenantId";

