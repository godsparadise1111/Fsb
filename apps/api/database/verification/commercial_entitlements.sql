-- Read-only commercial and API credential consistency checks.
-- Every query below must return zero rows unless its header says otherwise.

-- 1. Every tenant must have exactly one subscription after migration 021.
SELECT t.id AS "tenantId", t.name
FROM tenants t
LEFT JOIN tenant_subscriptions s ON s."tenantId"=t.id
WHERE s.id IS NULL;

-- 2. Legacy tenant plan and subscription plan must remain aligned.
SELECT t.id AS "tenantId", t.plan AS "tenantPlan", s."planCode"
FROM tenants t
JOIN tenant_subscriptions s ON s."tenantId"=t.id
WHERE t.plan <> s."planCode";

-- 3. Every subscription must reference an existing active catalog entry.
SELECT s.id, s."tenantId", s."planCode"
FROM tenant_subscriptions s
LEFT JOIN commercial_plans p ON p.code=s."planCode"
WHERE p.code IS NULL;

-- 4. Invoice subscription and invoice tenant must match.
SELECT i.id, i."tenantId", i."subscriptionId", s."tenantId" AS "subscriptionTenantId"
FROM tenant_invoices i
LEFT JOIN tenant_subscriptions s ON s.id=i."subscriptionId"
WHERE s.id IS NULL OR s."tenantId" <> i."tenantId";

-- 5. API credentials must not have inconsistent revocation metadata or unsupported scopes.
SELECT id, "tenantId", status, "revokedAt", scopes
FROM tenant_api_credentials
WHERE (status='ACTIVE' AND "revokedAt" IS NOT NULL)
   OR (status='REVOKED' AND "revokedAt" IS NULL)
   OR cardinality(scopes) NOT BETWEEN 1 AND 10
   OR NOT (scopes <@ ARRAY['tenant.read','reports.read']::text[]);

-- 6. A tenant with a closed status must not retain an active subscription.
-- This query identifies operational exceptions; resolve them explicitly.
SELECT t.id AS "tenantId", t.status AS "tenantStatus", s.status AS "subscriptionStatus"
FROM tenants t
JOIN tenant_subscriptions s ON s."tenantId"=t.id
WHERE t.status='CLOSED' AND s.status IN ('ACTIVE','TRIALING');

-- 7. Expired active subscriptions are surfaced for billing reconciliation.
SELECT s.id, s."tenantId", s.status, s."currentPeriodEnd"
FROM tenant_subscriptions s
WHERE s.status IN ('ACTIVE','TRIALING')
  AND (s."currentPeriodEnd" <= now()
       OR (s.status='TRIALING' AND s."trialEndsAt" IS NOT NULL AND s."trialEndsAt" <= now()));

-- 8. Active credentials belonging to suspended/closed tenants are surfaced.
SELECT c.id, c."tenantId", t.status
FROM tenant_api_credentials c
JOIN tenants t ON t.id=c."tenantId"
WHERE c.status='ACTIVE' AND t.status='CLOSED';


-- 9. Active members plus unexpired pending invitations must not exceed maxUsers.
SELECT t.id AS "tenantId", p.code AS "planCode",
       count(DISTINCT tm.id) FILTER (WHERE tm."isActive"=true AND u."isActive"=true)
       + count(DISTINCT i.id) FILTER (WHERE i."acceptedAt" IS NULL AND i."revokedAt" IS NULL AND i."expiresAt">now()) AS "reservedSeats",
       (p.limits->>'maxUsers')::bigint AS "maxUsers"
FROM tenants t
JOIN tenant_subscriptions s ON s."tenantId"=t.id
JOIN commercial_plans p ON p.code=s."planCode"
LEFT JOIN tenant_memberships tm ON tm."tenantId"=t.id
LEFT JOIN users u ON u.id=tm."userId"
LEFT JOIN tenant_invitations i ON i."tenantId"=t.id
GROUP BY t.id,p.code,p.limits
HAVING count(DISTINCT tm.id) FILTER (WHERE tm."isActive"=true AND u."isActive"=true)
       + count(DISTINCT i.id) FILTER (WHERE i."acceptedAt" IS NULL AND i."revokedAt" IS NULL AND i."expiresAt">now())
       > (p.limits->>'maxUsers')::bigint;

-- 10. Active organizations must not exceed maxOrganizations.
SELECT t.id AS "tenantId", count(o.id) AS "activeOrganizations",
       (p.limits->>'maxOrganizations')::bigint AS "maxOrganizations"
FROM tenants t
JOIN tenant_subscriptions s ON s."tenantId"=t.id
JOIN commercial_plans p ON p.code=s."planCode"
LEFT JOIN organizations o ON o."tenantId"=t.id AND o."isActive"=true
GROUP BY t.id,p.limits
HAVING count(o.id) > (p.limits->>'maxOrganizations')::bigint;

-- 11. Process definitions must not exceed maxProcesses.
SELECT t.id AS "tenantId", count(pd.id) AS "processDefinitions",
       (p.limits->>'maxProcesses')::bigint AS "maxProcesses"
FROM tenants t
JOIN tenant_subscriptions s ON s."tenantId"=t.id
JOIN commercial_plans p ON p.code=s."planCode"
LEFT JOIN organizations o ON o."tenantId"=t.id
LEFT JOIN process_definitions pd ON pd."organizationId"=o.id
GROUP BY t.id,p.limits
HAVING count(pd.id) > (p.limits->>'maxProcesses')::bigint;

-- 12. Stored attachment bytes must not exceed maxStorageBytes.
SELECT t.id AS "tenantId", COALESCE(sum(fa.size::numeric),0) AS "storedBytes",
       (p.limits->>'maxStorageBytes')::numeric AS "maxStorageBytes"
FROM tenants t
JOIN tenant_subscriptions s ON s."tenantId"=t.id
JOIN commercial_plans p ON p.code=s."planCode"
LEFT JOIN file_attachments fa ON fa."tenantId"=t.id
GROUP BY t.id,p.limits
HAVING COALESCE(sum(fa.size::numeric),0) > (p.limits->>'maxStorageBytes')::numeric;
