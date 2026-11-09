-- Read-only lifecycle checks. Run after migration 015 and after background workers settle.
-- Every query should return zero rows.

-- No operationally open task may remain in an inactive organization or closed tenant.
SELECT wt.id, wt."tenantId", pi."organizationId", o."isActive", t.status
  FROM workflow_tasks wt
  JOIN process_instances pi ON pi.id = wt."processInstanceId"
  JOIN organizations o ON o.id = pi."organizationId"
  JOIN tenants t ON t.id = wt."tenantId"
 WHERE wt.status IN ('OPEN','IN_PROGRESS')
   AND (o."isActive" = false OR t.status = 'CLOSED');

-- Pending assignees must remain active users and active members of the task tenant.
-- A non-empty result after the automation worker settles indicates unresolved access revocation.
SELECT ta.id, ta."tenantId", ta."taskId", ta."userId"
  FROM task_assignees ta
  JOIN workflow_tasks wt ON wt.id = ta."taskId"
  LEFT JOIN users u ON u.id = ta."userId"
  LEFT JOIN tenant_memberships tm ON tm."tenantId" = ta."tenantId" AND tm."userId" = ta."userId"
 WHERE ta.status = 'PENDING' AND wt.status IN ('OPEN','IN_PROGRESS')
   AND (u.id IS NULL OR u."isActive" = false OR tm.id IS NULL OR tm."isActive" = false);

-- Pending deferrals must reference an open task, active tenant/org and active requester membership.
SELECT r.id, r."tenantId", r."taskId", r."requesterUserId"
  FROM task_deferral_requests r
  JOIN workflow_tasks wt ON wt.id = r."taskId"
  JOIN process_instances pi ON pi.id = wt."processInstanceId"
  LEFT JOIN tenants t ON t.id = r."tenantId"
  LEFT JOIN organizations o ON o.id = pi."organizationId"
  LEFT JOIN tenant_memberships tm ON tm."tenantId" = r."tenantId" AND tm."userId" = r."requesterUserId"
  LEFT JOIN users u ON u.id = r."requesterUserId"
 WHERE r.status = 'PENDING'
   AND (wt.status NOT IN ('OPEN','IN_PROGRESS') OR t.status <> 'ACTIVE'
     OR o."isActive" = false OR tm.id IS NULL OR tm."isActive" = false
     OR u.id IS NULL OR u."isActive" = false);

-- Active delegations must have an actionable task and active membership on both sides.
SELECT d.id, d."tenantId", d."taskId", d."fromUserId", d."toUserId"
  FROM task_delegations d
  JOIN workflow_tasks wt ON wt.id = d."taskId"
  JOIN process_instances pi ON pi.id = wt."processInstanceId"
  LEFT JOIN tenants t ON t.id = d."tenantId"
  LEFT JOIN organizations o ON o.id = pi."organizationId"
  LEFT JOIN tenant_memberships source_tm ON source_tm."tenantId" = d."tenantId" AND source_tm."userId" = d."fromUserId"
  LEFT JOIN users source_user ON source_user.id = d."fromUserId"
  LEFT JOIN tenant_memberships target_tm ON target_tm."tenantId" = d."tenantId" AND target_tm."userId" = d."toUserId"
  LEFT JOIN users target_user ON target_user.id = d."toUserId"
 WHERE d."revokedAt" IS NULL AND d."endsAt" > now()
   AND (wt.status NOT IN ('OPEN','IN_PROGRESS') OR t.status <> 'ACTIVE' OR o."isActive" = false
     OR source_tm.id IS NULL OR source_tm."isActive" = false OR source_user."isActive" = false
     OR target_tm.id IS NULL OR target_tm."isActive" = false OR target_user."isActive" = false);

-- Closed tenants must not retain queued or leased notifications.
SELECT o.id, o."tenantId", o.status
  FROM notification_outbox o
  JOIN tenants t ON t.id = o."tenantId"
 WHERE t.status = 'CLOSED' AND o.status IN ('PENDING','PROCESSING');

-- Every cancelled deferral has a review timestamp but no human reviewer.
SELECT id, "tenantId", "taskId", "reviewerUserId", "reviewedAt"
  FROM task_deferral_requests
 WHERE status = 'CANCELLED'
   AND ("reviewerUserId" IS NOT NULL OR "reviewedAt" IS NULL);

-- Lifecycle events must remain tenant-bound to their original workflow task.
SELECT e.id, e."tenantId", e."taskId"
  FROM workflow_task_lifecycle_events e
  LEFT JOIN workflow_tasks wt ON wt.id=e."taskId" AND wt."tenantId"=e."tenantId"
 WHERE wt.id IS NULL;
