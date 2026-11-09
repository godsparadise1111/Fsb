-- Initial relational schema for a brand-new F-S installation.
-- Safe for already initialized development databases: existing tables are not replaced.
-- Tenant columns and tenant-aware constraints are intentionally added by migrations 001+.
BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "firstName" varchar(120) NOT NULL,
  "lastName" varchar(120) NOT NULL,
  email varchar(190) NOT NULL UNIQUE,
  username varchar(80) NOT NULL UNIQUE,
  "passwordHash" varchar(255) NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  phone varchar(40) NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  description varchar(500) NULL,
  scope varchar(24) NOT NULL DEFAULT 'ORGANIZATION',
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(120) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  description varchar(500) NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS role_permissions (
  "roleId" uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  "permissionId" uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY ("roleId","permissionId")
);

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  code varchar(80) NOT NULL UNIQUE,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  code varchar(80) NOT NULL,
  "parentId" uuid NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_organization_units_org_parent_code"
  ON organization_units ("organizationId","parentId",code);
CREATE TABLE IF NOT EXISTS positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationUnitId" uuid NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
  title varchar(160) NOT NULL,
  code varchar(80) NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "positionId" uuid NOT NULL REFERENCES positions(id) ON DELETE RESTRICT,
  "validFrom" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" timestamptz NULL,
  "isPrimary" boolean NOT NULL DEFAULT true,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_user_position_active_assignment" UNIQUE ("userId","positionId","validFrom")
);
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "roleId" uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  "organizationId" uuid NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_user_role_scope" UNIQUE ("userId","roleId","organizationId")
);

CREATE TABLE IF NOT EXISTS process_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code varchar(120) NOT NULL,
  name varchar(200) NOT NULL,
  description text NULL,
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_process_definitions_org_code" UNIQUE ("organizationId",code)
);
CREATE TABLE IF NOT EXISTS process_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "definitionId" uuid NOT NULL REFERENCES process_definitions(id) ON DELETE RESTRICT,
  "versionNumber" integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  "changeNote" text NULL,
  "publishedAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_process_version_number" UNIQUE ("definitionId","versionNumber")
);
CREATE TABLE IF NOT EXISTS form_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code varchar(120) NOT NULL,
  name varchar(200) NOT NULL,
  description text NULL,
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_form_definitions_org_code" UNIQUE ("organizationId",code)
);
CREATE TABLE IF NOT EXISTS form_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "definitionId" uuid NOT NULL REFERENCES form_definitions(id) ON DELETE RESTRICT,
  "versionNumber" integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  schema jsonb NOT NULL,
  "changeNote" text NULL,
  "publishedAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_form_version_number" UNIQUE ("definitionId","versionNumber")
);

CREATE TABLE IF NOT EXISTS process_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processVersionId" uuid NOT NULL REFERENCES process_versions(id) ON DELETE RESTRICT,
  "organizationId" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "startedByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title varchar(240) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'RUNNING',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  "currentStepIndex" integer NOT NULL DEFAULT 0,
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "completedAt" timestamptz NULL
);
CREATE TABLE IF NOT EXISTS workflow_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processInstanceId" uuid NOT NULL REFERENCES process_instances(id) ON DELETE RESTRICT,
  title varchar(200) NOT NULL,
  instructions text NULL,
  "assignmentPolicy" varchar(20) NOT NULL DEFAULT 'ALL_ASSIGNEES',
  status varchar(20) NOT NULL DEFAULT 'OPEN',
  "createdByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "completedAt" timestamptz NULL
);
CREATE TABLE IF NOT EXISTS task_assignees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId" uuid NOT NULL REFERENCES workflow_tasks(id) ON DELETE RESTRICT,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  comment text NULL,
  "actedAt" timestamptz NULL,
  "assignedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_task_assignee_user" UNIQUE ("taskId","userId")
);
CREATE TABLE IF NOT EXISTS workflow_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId" uuid NOT NULL REFERENCES workflow_tasks(id) ON DELETE RESTRICT,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(30) NOT NULL,
  comment text NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "formVersionId" uuid NOT NULL REFERENCES form_versions(id) ON DELETE RESTRICT,
  "submittedByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "processInstanceId" uuid NULL REFERENCES process_instances(id) ON DELETE RESTRICT,
  data jsonb NOT NULL,
  "submittedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_process_definitions_org" ON process_definitions ("organizationId");
CREATE INDEX IF NOT EXISTS "IDX_form_definitions_org" ON form_definitions ("organizationId");
CREATE INDEX IF NOT EXISTS "IDX_process_instances_org_status" ON process_instances ("organizationId",status);
CREATE INDEX IF NOT EXISTS "IDX_workflow_tasks_instance_status" ON workflow_tasks ("processInstanceId",status);
CREATE INDEX IF NOT EXISTS "IDX_task_assignees_user_status" ON task_assignees ("userId",status);
CREATE INDEX IF NOT EXISTS "IDX_workflow_action_logs_task_created" ON workflow_action_logs ("taskId","createdAt");
CREATE INDEX IF NOT EXISTS "IDX_form_submissions_version_submitted" ON form_submissions ("formVersionId","submittedAt");

COMMIT;
