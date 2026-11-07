-- F-S tenant isolation: database-enforced tenant consistency.
-- Prerequisite: 20261107_001_tenant_membership_and_safe_legacy_scope.sql
-- Apply only after backup and after every legacy organization is explicitly mapped.
-- This migration refuses to proceed while tenantless organizations remain.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE "tenantId" IS NULL) THEN
    RAISE EXCEPTION 'Tenant migration blocked: map every legacy organization explicitly before applying migration 002';
  END IF;
END $$;

ALTER TABLE organizations
  ADD CONSTRAINT "UQ_organizations_id_tenant" UNIQUE (id, "tenantId");

ALTER TABLE process_definitions ADD COLUMN "tenantId" uuid NULL;
ALTER TABLE process_versions ADD COLUMN "tenantId" uuid NULL;
ALTER TABLE form_definitions ADD COLUMN "tenantId" uuid NULL;
ALTER TABLE form_versions ADD COLUMN "tenantId" uuid NULL;
ALTER TABLE process_instances ADD COLUMN "tenantId" uuid NULL;
ALTER TABLE workflow_tasks ADD COLUMN "tenantId" uuid NULL;
ALTER TABLE workflow_action_logs ADD COLUMN "tenantId" uuid NULL;
ALTER TABLE form_submissions ADD COLUMN "tenantId" uuid NULL;

UPDATE process_definitions pd SET "tenantId" = o."tenantId"
FROM organizations o WHERE o.id = pd."organizationId";
UPDATE process_versions pv SET "tenantId" = pd."tenantId"
FROM process_definitions pd WHERE pd.id = pv."definitionId";
UPDATE form_definitions fd SET "tenantId" = o."tenantId"
FROM organizations o WHERE o.id = fd."organizationId";
UPDATE form_versions fv SET "tenantId" = fd."tenantId"
FROM form_definitions fd WHERE fd.id = fv."definitionId";
UPDATE process_instances pi SET "tenantId" = o."tenantId"
FROM organizations o WHERE o.id = pi."organizationId";
UPDATE workflow_tasks wt SET "tenantId" = pi."tenantId"
FROM process_instances pi WHERE pi.id = wt."processInstanceId";
UPDATE workflow_action_logs wal SET "tenantId" = wt."tenantId"
FROM workflow_tasks wt WHERE wt.id = wal."taskId";
UPDATE form_submissions fs SET "tenantId" = fv."tenantId"
FROM form_versions fv WHERE fv.id = fs."formVersionId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT "tenantId" FROM process_definitions UNION ALL
      SELECT "tenantId" FROM process_versions UNION ALL
      SELECT "tenantId" FROM form_definitions UNION ALL
      SELECT "tenantId" FROM form_versions UNION ALL
      SELECT "tenantId" FROM process_instances UNION ALL
      SELECT "tenantId" FROM workflow_tasks UNION ALL
      SELECT "tenantId" FROM workflow_action_logs UNION ALL
      SELECT "tenantId" FROM form_submissions
    ) scoped WHERE "tenantId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Tenant backfill incomplete; no tenant-scoped constraints were installed';
  END IF;
END $$;

ALTER TABLE process_definitions ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE process_versions ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE form_definitions ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE form_versions ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE process_instances ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE workflow_tasks ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE workflow_action_logs ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE form_submissions ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE process_definitions ADD CONSTRAINT "UQ_process_definitions_id_tenant" UNIQUE (id, "tenantId");
ALTER TABLE process_versions ADD CONSTRAINT "UQ_process_versions_id_tenant" UNIQUE (id, "tenantId");
ALTER TABLE form_definitions ADD CONSTRAINT "UQ_form_definitions_id_tenant" UNIQUE (id, "tenantId");
ALTER TABLE form_versions ADD CONSTRAINT "UQ_form_versions_id_tenant" UNIQUE (id, "tenantId");
ALTER TABLE process_instances ADD CONSTRAINT "UQ_process_instances_id_tenant" UNIQUE (id, "tenantId");
ALTER TABLE workflow_tasks ADD CONSTRAINT "UQ_workflow_tasks_id_tenant" UNIQUE (id, "tenantId");

ALTER TABLE process_definitions ADD CONSTRAINT "FK_process_definitions_org_tenant"
  FOREIGN KEY ("organizationId", "tenantId") REFERENCES organizations(id, "tenantId") ON DELETE RESTRICT;
ALTER TABLE form_definitions ADD CONSTRAINT "FK_form_definitions_org_tenant"
  FOREIGN KEY ("organizationId", "tenantId") REFERENCES organizations(id, "tenantId") ON DELETE RESTRICT;
ALTER TABLE process_versions ADD CONSTRAINT "FK_process_versions_definition_tenant"
  FOREIGN KEY ("definitionId", "tenantId") REFERENCES process_definitions(id, "tenantId") ON DELETE RESTRICT;
ALTER TABLE form_versions ADD CONSTRAINT "FK_form_versions_definition_tenant"
  FOREIGN KEY ("definitionId", "tenantId") REFERENCES form_definitions(id, "tenantId") ON DELETE RESTRICT;
ALTER TABLE process_instances ADD CONSTRAINT "FK_process_instances_org_tenant"
  FOREIGN KEY ("organizationId", "tenantId") REFERENCES organizations(id, "tenantId") ON DELETE RESTRICT;
ALTER TABLE process_instances ADD CONSTRAINT "FK_process_instances_version_tenant"
  FOREIGN KEY ("processVersionId", "tenantId") REFERENCES process_versions(id, "tenantId") ON DELETE RESTRICT;
ALTER TABLE workflow_tasks ADD CONSTRAINT "FK_workflow_tasks_instance_tenant"
  FOREIGN KEY ("processInstanceId", "tenantId") REFERENCES process_instances(id, "tenantId") ON DELETE RESTRICT;
ALTER TABLE workflow_action_logs ADD CONSTRAINT "FK_workflow_action_logs_task_tenant"
  FOREIGN KEY ("taskId", "tenantId") REFERENCES workflow_tasks(id, "tenantId") ON DELETE RESTRICT;
ALTER TABLE form_submissions ADD CONSTRAINT "FK_form_submissions_version_tenant"
  FOREIGN KEY ("formVersionId", "tenantId") REFERENCES form_versions(id, "tenantId") ON DELETE RESTRICT;
ALTER TABLE form_submissions ADD CONSTRAINT "FK_form_submissions_instance_tenant"
  FOREIGN KEY ("processInstanceId", "tenantId") REFERENCES process_instances(id, "tenantId") ON DELETE RESTRICT;

CREATE INDEX "IDX_process_definitions_tenant_org" ON process_definitions ("tenantId", "organizationId");
CREATE INDEX "IDX_form_definitions_tenant_org" ON form_definitions ("tenantId", "organizationId");
CREATE INDEX "IDX_process_instances_tenant_org_status" ON process_instances ("tenantId", "organizationId", status);
CREATE INDEX "IDX_workflow_tasks_tenant_status" ON workflow_tasks ("tenantId", status);
CREATE INDEX "IDX_form_submissions_tenant_submitted" ON form_submissions ("tenantId", "submittedAt");

-- Populate tenantId transparently for ORM inserts, while rejecting cross-tenant parent references.
CREATE OR REPLACE FUNCTION fsb_set_tenant_from_organization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved uuid;
BEGIN
  SELECT "tenantId" INTO resolved FROM organizations WHERE id = NEW."organizationId";
  IF resolved IS NULL THEN RAISE EXCEPTION 'Organization has no active tenant mapping'; END IF;
  IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved THEN RAISE EXCEPTION 'Cross-tenant organization reference rejected'; END IF;
  NEW."tenantId" := resolved;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fsb_set_tenant_from_process_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved uuid;
BEGIN
  SELECT "tenantId" INTO resolved FROM process_definitions WHERE id = NEW."definitionId";
  IF resolved IS NULL THEN RAISE EXCEPTION 'Process definition tenant not found'; END IF;
  IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved THEN RAISE EXCEPTION 'Cross-tenant process version rejected'; END IF;
  NEW."tenantId" := resolved;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fsb_set_tenant_from_form_definition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved uuid;
BEGIN
  SELECT "tenantId" INTO resolved FROM form_definitions WHERE id = NEW."definitionId";
  IF resolved IS NULL THEN RAISE EXCEPTION 'Form definition tenant not found'; END IF;
  IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved THEN RAISE EXCEPTION 'Cross-tenant form version rejected'; END IF;
  NEW."tenantId" := resolved;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fsb_set_tenant_from_process_instance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved uuid; version_org uuid;
BEGIN
  SELECT "tenantId" INTO resolved FROM organizations WHERE id = NEW."organizationId";
  SELECT pd."organizationId" INTO version_org
    FROM process_versions pv JOIN process_definitions pd ON pd.id = pv."definitionId"
   WHERE pv.id = NEW."processVersionId";
  IF resolved IS NULL OR version_org IS NULL OR version_org <> NEW."organizationId" THEN
    RAISE EXCEPTION 'Process instance organization and process version must belong to the same tenant organization';
  END IF;
  IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved THEN RAISE EXCEPTION 'Cross-tenant process instance rejected'; END IF;
  NEW."tenantId" := resolved;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fsb_set_tenant_from_instance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved uuid;
BEGIN
  SELECT "tenantId" INTO resolved FROM process_instances WHERE id = NEW."processInstanceId";
  IF resolved IS NULL THEN RAISE EXCEPTION 'Process instance tenant not found'; END IF;
  IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved THEN RAISE EXCEPTION 'Cross-tenant workflow task rejected'; END IF;
  NEW."tenantId" := resolved;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fsb_set_tenant_from_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved uuid;
BEGIN
  SELECT "tenantId" INTO resolved FROM workflow_tasks WHERE id = NEW."taskId";
  IF resolved IS NULL THEN RAISE EXCEPTION 'Workflow task tenant not found'; END IF;
  IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved THEN RAISE EXCEPTION 'Cross-tenant workflow action rejected'; END IF;
  NEW."tenantId" := resolved;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fsb_set_tenant_from_form_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resolved uuid; process_tenant uuid;
BEGIN
  SELECT "tenantId" INTO resolved FROM form_versions WHERE id = NEW."formVersionId";
  IF resolved IS NULL THEN RAISE EXCEPTION 'Form version tenant not found'; END IF;
  IF NEW."processInstanceId" IS NOT NULL THEN
    SELECT "tenantId" INTO process_tenant FROM process_instances WHERE id = NEW."processInstanceId";
    IF process_tenant IS NULL OR process_tenant <> resolved THEN RAISE EXCEPTION 'Form submission process instance belongs to another tenant'; END IF;
  END IF;
  IF NEW."tenantId" IS NOT NULL AND NEW."tenantId" <> resolved THEN RAISE EXCEPTION 'Cross-tenant form submission rejected'; END IF;
  NEW."tenantId" := resolved;
  RETURN NEW;
END $$;

CREATE TRIGGER "TR_process_definitions_tenant" BEFORE INSERT OR UPDATE OF "organizationId", "tenantId" ON process_definitions
  FOR EACH ROW EXECUTE FUNCTION fsb_set_tenant_from_organization();
CREATE TRIGGER "TR_form_definitions_tenant" BEFORE INSERT OR UPDATE OF "organizationId", "tenantId" ON form_definitions
  FOR EACH ROW EXECUTE FUNCTION fsb_set_tenant_from_organization();
CREATE TRIGGER "TR_process_versions_tenant" BEFORE INSERT OR UPDATE OF "definitionId", "tenantId" ON process_versions
  FOR EACH ROW EXECUTE FUNCTION fsb_set_tenant_from_process_definition();
CREATE TRIGGER "TR_form_versions_tenant" BEFORE INSERT OR UPDATE OF "definitionId", "tenantId" ON form_versions
  FOR EACH ROW EXECUTE FUNCTION fsb_set_tenant_from_form_definition();
CREATE TRIGGER "TR_process_instances_tenant" BEFORE INSERT OR UPDATE OF "organizationId", "processVersionId", "tenantId" ON process_instances
  FOR EACH ROW EXECUTE FUNCTION fsb_set_tenant_from_process_instance();
CREATE TRIGGER "TR_workflow_tasks_tenant" BEFORE INSERT OR UPDATE OF "processInstanceId", "tenantId" ON workflow_tasks
  FOR EACH ROW EXECUTE FUNCTION fsb_set_tenant_from_instance();
CREATE TRIGGER "TR_workflow_action_logs_tenant" BEFORE INSERT OR UPDATE OF "taskId", "tenantId" ON workflow_action_logs
  FOR EACH ROW EXECUTE FUNCTION fsb_set_tenant_from_task();
CREATE TRIGGER "TR_form_submissions_tenant" BEFORE INSERT OR UPDATE OF "formVersionId", "processInstanceId", "tenantId" ON form_submissions
  FOR EACH ROW EXECUTE FUNCTION fsb_set_tenant_from_form_submission();

COMMIT;

-- After deployment, verify each table's tenantId is fully populated and no
-- cross-tenant references can be inserted. Do not run against production without
-- a rehearsed backup/restore and a reviewed legacy organization mapping.
