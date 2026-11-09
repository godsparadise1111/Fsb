-- Read-only post-migration checks. Every query should return zero rows
-- except the final tenant-admin summary, which should show >= 1 active admin.
-- Run against staging after migrations 001-012; do not use as a substitute for race tests.

-- Active tenant memberships must belong to active users and active tenants.
SELECT tm.id, tm."tenantId", tm."userId"
  FROM tenant_memberships tm
  LEFT JOIN users u ON u.id = tm."userId"
  LEFT JOIN tenants t ON t.id = tm."tenantId"
 WHERE tm."isActive" = true
   AND (u.id IS NULL OR u."isActive" = false OR t.status <> 'ACTIVE');

-- Active position assignments must match tenant membership and active structure.
SELECT up.id, up."tenantId", up."userId", up."positionId"
  FROM user_positions up
  LEFT JOIN users u ON u.id = up."userId"
  LEFT JOIN tenant_memberships tm
    ON tm."tenantId" = up."tenantId" AND tm."userId" = up."userId"
  LEFT JOIN positions p ON p.id = up."positionId"
  LEFT JOIN organization_units ou ON ou.id = p."organizationUnitId"
  LEFT JOIN organizations o ON o.id = ou."organizationId"
  LEFT JOIN tenants t ON t.id = up."tenantId"
 WHERE up."isActive" = true
   AND (u.id IS NULL OR u."isActive" = false
     OR tm.id IS NULL OR tm."isActive" = false
     OR p.id IS NULL OR p."isActive" = false
     OR ou.id IS NULL OR ou."isActive" = false
     OR o.id IS NULL OR o."isActive" = false
     OR t.status <> 'ACTIVE' OR o."tenantId" <> up."tenantId");

-- Active organization role assignments must match tenant, active user/member and active organization.
SELECT ur.id, ur."tenantId", ur."userId", ur."organizationId", ur."roleId"
  FROM user_roles ur
  LEFT JOIN users u ON u.id = ur."userId"
  LEFT JOIN tenant_memberships tm
    ON tm."tenantId" = ur."tenantId" AND tm."userId" = ur."userId"
  LEFT JOIN organizations o ON o.id = ur."organizationId"
  LEFT JOIN roles r ON r.id = ur."roleId"
  LEFT JOIN tenants t ON t.id = ur."tenantId"
 WHERE ur."isActive" = true AND ur."organizationId" IS NOT NULL
   AND (u.id IS NULL OR u."isActive" = false
     OR tm.id IS NULL OR tm."isActive" = false
     OR o.id IS NULL OR o."isActive" = false
     OR r.id IS NULL OR r."isActive" = false OR r.scope <> 'ORGANIZATION'
     OR t.status <> 'ACTIVE' OR o."tenantId" <> ur."tenantId");

-- Active platform assignments must remain unscoped and target active users/roles.
SELECT ur.id, ur."userId", ur."roleId"
  FROM user_roles ur
  LEFT JOIN users u ON u.id = ur."userId"
  LEFT JOIN roles r ON r.id = ur."roleId"
 WHERE ur."isActive" = true AND ur."organizationId" IS NULL
   AND (ur."tenantId" IS NOT NULL OR u.id IS NULL OR u."isActive" = false
     OR r.id IS NULL OR r."isActive" = false OR r.scope <> 'PLATFORM');

-- Every tenant must retain at least one active administrator account.
SELECT tm."tenantId", COUNT(*) FILTER (
         WHERE tm."isActive" = true AND tm."isTenantAdmin" = true AND u."isActive" = true
       ) AS active_admins
  FROM tenant_memberships tm
  JOIN users u ON u.id = tm."userId"
 GROUP BY tm."tenantId"
HAVING COUNT(*) FILTER (
         WHERE tm."isActive" = true AND tm."isTenantAdmin" = true AND u."isActive" = true
       ) = 0;

-- Active task assignees must still be active members of the task tenant.
SELECT ta.id, ta."tenantId", ta."taskId", ta."userId"
  FROM task_assignees ta
  LEFT JOIN users u ON u.id = ta."userId"
  LEFT JOIN tenant_memberships tm
    ON tm."tenantId" = ta."tenantId" AND tm."userId" = ta."userId"
 WHERE ta.status = 'PENDING'
   AND (u.id IS NULL OR u."isActive" = false OR tm.id IS NULL OR tm."isActive" = false);
