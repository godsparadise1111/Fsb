-- Read-only enterprise acceptance checks. Every result set must be empty.
-- Run only after the migration ledger has been verified on isolated Staging.

-- Organization hierarchy must stay within one organization and cannot contain cycles.
SELECT child.id, child."organizationId", parent."organizationId" AS "parentOrganizationId"
  FROM organization_units child
  JOIN organization_units parent ON parent.id=child."parentId"
 WHERE child."organizationId" <> parent."organizationId";

WITH RECURSIVE walk(start_id, id, "parentId", path, cycle) AS (
  SELECT id, id, "parentId", ARRAY[id], false FROM organization_units
  UNION ALL
  SELECT w.start_id, p.id, p."parentId", w.path || p.id, p.id=ANY(w.path)
    FROM walk w JOIN organization_units p ON p.id=w."parentId" WHERE NOT w.cycle
)
SELECT start_id, path FROM walk WHERE cycle;

-- Every active position assignment must belong to an active user, membership,
-- position, unit, organization and tenant.
SELECT up.id, up."tenantId", up."userId", up."positionId"
  FROM user_positions up
  LEFT JOIN users u ON u.id=up."userId"
  LEFT JOIN tenant_memberships tm ON tm."tenantId"=up."tenantId" AND tm."userId"=up."userId"
  LEFT JOIN positions p ON p.id=up."positionId"
  LEFT JOIN organization_units ou ON ou.id=p."organizationUnitId"
  LEFT JOIN organizations o ON o.id=ou."organizationId"
  LEFT JOIN tenants t ON t.id=up."tenantId"
 WHERE up."isActive"=true AND (
   u.id IS NULL OR u."isActive"=false OR tm.id IS NULL OR tm."isActive"=false OR
   p.id IS NULL OR p."isActive"=false OR ou.id IS NULL OR ou."isActive"=false OR
   o.id IS NULL OR o."isActive"=false OR o."tenantId"<>up."tenantId" OR t.status<>'ACTIVE'
 );

-- Form submissions linked to processes must match the same tenant and organization.
SELECT fs.id, fs."tenantId", o."tenantId" AS "organizationTenant",
       pi."tenantId" AS "processTenant", fd."organizationId", pi."organizationId" AS "processOrganization"
  FROM form_submissions fs
  JOIN form_versions fv ON fv.id=fs."formVersionId"
  JOIN form_definitions fd ON fd.id=fv."definitionId"
  JOIN organizations o ON o.id=fd."organizationId"
  LEFT JOIN process_instances pi ON pi.id=fs."processInstanceId"
 WHERE fs."tenantId" IS DISTINCT FROM o."tenantId"
    OR (fs."processInstanceId" IS NOT NULL AND (
      pi.id IS NULL OR pi."tenantId" IS DISTINCT FROM fs."tenantId" OR
      pi."organizationId" IS DISTINCT FROM fd."organizationId"
    ));

-- Active substitutions must be time-bounded, within one active tenant/organization,
-- and must not substitute a user for themselves.
SELECT s.id, s."tenantId", s."organizationId", s."originalUserId", s."substituteUserId"
  FROM organization_substitutions s
  LEFT JOIN organizations o ON o.id=s."organizationId"
  LEFT JOIN tenants t ON t.id=s."tenantId"
  LEFT JOIN tenant_memberships original_member ON original_member."tenantId"=s."tenantId" AND original_member."userId"=s."originalUserId"
  LEFT JOIN tenant_memberships substitute_member ON substitute_member."tenantId"=s."tenantId" AND substitute_member."userId"=s."substituteUserId"
 WHERE s."revokedAt" IS NULL AND (
   s."originalUserId"=s."substituteUserId" OR s."startsAt">=s."endsAt" OR
   o.id IS NULL OR o."tenantId"<>s."tenantId" OR o."isActive"=false OR
   t.status<>'ACTIVE' OR original_member.id IS NULL OR original_member."isActive"=false OR
   substitute_member.id IS NULL OR substitute_member."isActive"=false
 );

-- A notification outbox row may not leak encrypted payloads into API logs;
-- this query checks that queued rows have the required AEAD envelope.
SELECT id, "tenantId", "eventType"
  FROM notification_outbox
 WHERE status IN ('PENDING','PROCESSING')
   AND ("payloadCiphertext" IS NULL OR "payloadIv" IS NULL OR "payloadAuthTag" IS NULL OR "dedupeKey" IS NULL);

-- Process/task tenant ownership must agree and running processes must be reconciled.
SELECT wt.id, pi."tenantId", pi."organizationId", o."tenantId" AS "organizationTenant"
  FROM workflow_tasks wt
  JOIN process_instances pi ON pi.id=wt."processInstanceId"
  LEFT JOIN organizations o ON o.id=pi."organizationId"
 WHERE o.id IS NULL OR o."tenantId" IS DISTINCT FROM pi."tenantId";

-- A terminal process must not retain active work.
SELECT pi.id, wt.id AS "taskId", wt.status
  FROM process_instances pi
  JOIN workflow_tasks wt ON wt."processInstanceId"=pi.id
 WHERE pi.status IN ('COMPLETED','CANCELLED') AND wt.status IN ('OPEN','IN_PROGRESS');
