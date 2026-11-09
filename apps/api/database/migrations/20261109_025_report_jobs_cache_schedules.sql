-- Report builder cache, asynchronous execution and scheduled delivery.
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_report_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "scopeHash" varchar(64) NOT NULL,
  "cacheKey" varchar(64) NOT NULL,
  payload jsonb NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_report_cache_scope_key UNIQUE ("tenantId","scopeHash","cacheKey"),
  CONSTRAINT ck_tenant_report_cache_payload CHECK (jsonb_typeof(payload)='object')
);
CREATE INDEX IF NOT EXISTS idx_tenant_report_cache_expiry ON tenant_report_cache ("expiresAt");

CREATE TABLE IF NOT EXISTS tenant_report_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "ownerUserId" uuid NOT NULL,
  "organizationId" uuid NULL,
  config jsonb NOT NULL,
  "scopeOrganizationIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "isTenantWide" boolean NOT NULL DEFAULT false,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  result jsonb NULL,
  error text NULL,
  attempts integer NOT NULL DEFAULT 0,
  "availableAt" timestamptz NOT NULL DEFAULT now(),
  "lockedBy" varchar(120) NULL,
  "lockedAt" timestamptz NULL,
  "startedAt" timestamptz NULL,
  "completedAt" timestamptz NULL,
  "scheduleId" uuid NULL,
  "scheduledFor" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_tenant_report_jobs_owner_membership FOREIGN KEY ("tenantId","ownerUserId")
    REFERENCES tenant_memberships("tenantId","userId") ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_report_jobs_config CHECK (jsonb_typeof(config)='object'),
  CONSTRAINT ck_tenant_report_jobs_scope CHECK (jsonb_typeof("scopeOrganizationIds")='array'),
  CONSTRAINT ck_tenant_report_jobs_status CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  CONSTRAINT ck_tenant_report_jobs_attempts CHECK (attempts BETWEEN 0 AND 10),
  CONSTRAINT uq_tenant_report_jobs_schedule_run UNIQUE ("scheduleId","scheduledFor")
);
CREATE INDEX IF NOT EXISTS idx_tenant_report_jobs_queue
  ON tenant_report_jobs (status,"createdAt") WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX IF NOT EXISTS idx_tenant_report_jobs_owner
  ON tenant_report_jobs ("tenantId","ownerUserId","createdAt" DESC);

CREATE TABLE IF NOT EXISTS tenant_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "ownerUserId" uuid NOT NULL,
  "organizationId" uuid NULL,
  config jsonb NOT NULL,
  "scopeOrganizationIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "isTenantWide" boolean NOT NULL DEFAULT false,
  frequency varchar(12) NOT NULL,
  weekday smallint NULL,
  "timeOfDay" time NOT NULL,
  timezone varchar(80) NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "nextRunAt" timestamptz NOT NULL,
  "lastRunAt" timestamptz NULL,
  "lastJobId" uuid NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_tenant_report_schedules_owner_membership FOREIGN KEY ("tenantId","ownerUserId")
    REFERENCES tenant_memberships("tenantId","userId") ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_report_schedules_config CHECK (jsonb_typeof(config)='object'),
  CONSTRAINT ck_tenant_report_schedules_scope CHECK (jsonb_typeof("scopeOrganizationIds")='array'),
  CONSTRAINT ck_tenant_report_schedules_frequency CHECK (frequency IN ('DAILY','WEEKLY','MONTHLY')),
  CONSTRAINT ck_tenant_report_schedules_weekday CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6)
);
CREATE INDEX IF NOT EXISTS idx_tenant_report_schedules_due
  ON tenant_report_schedules ("nextRunAt") WHERE "isActive"=true;
CREATE INDEX IF NOT EXISTS idx_tenant_report_schedules_owner
  ON tenant_report_schedules ("tenantId","ownerUserId","createdAt" DESC);

ALTER TABLE tenant_report_jobs
  ADD CONSTRAINT fk_tenant_report_jobs_schedule
  FOREIGN KEY ("scheduleId") REFERENCES tenant_report_schedules(id) ON DELETE SET NULL;
ALTER TABLE tenant_report_schedules
  ADD CONSTRAINT fk_tenant_report_schedules_last_job
  FOREIGN KEY ("lastJobId") REFERENCES tenant_report_jobs(id) ON DELETE SET NULL;

COMMIT;
