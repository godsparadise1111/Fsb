BEGIN;

-- PostgreSQL requires a unique key on the exact referenced column pair.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_form_submissions_id_tenant"
  ON form_submissions (id, "tenantId");

-- IF NOT EXISTS also supports development databases where TypeORM synchronize
-- may have created the table before this SQL migration was applied.
CREATE TABLE IF NOT EXISTS file_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "submissionId" uuid NOT NULL,
  "uploadedByUserId" uuid NOT NULL,
  "originalName" varchar(255) NOT NULL,
  "storageKey" varchar(80) NOT NULL UNIQUE,
  "mimeType" varchar(100) NOT NULL,
  size bigint NOT NULL,
  sha256 varchar(64) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_file_attachments_tenant') THEN
    ALTER TABLE file_attachments
      ADD CONSTRAINT "FK_file_attachments_tenant"
      FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_file_attachments_uploader') THEN
    ALTER TABLE file_attachments
      ADD CONSTRAINT "FK_file_attachments_uploader"
      FOREIGN KEY ("uploadedByUserId") REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_file_attachments_submission_tenant') THEN
    ALTER TABLE file_attachments
      ADD CONSTRAINT "FK_file_attachments_submission_tenant"
      FOREIGN KEY ("submissionId", "tenantId")
      REFERENCES form_submissions(id, "tenantId") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_file_attachments_size') THEN
    ALTER TABLE file_attachments
      ADD CONSTRAINT "CHK_file_attachments_size"
      CHECK (size > 0 AND size <= 10485760);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_file_attachments_sha256') THEN
    ALTER TABLE file_attachments
      ADD CONSTRAINT "CHK_file_attachments_sha256"
      CHECK (sha256 ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_file_attachments_mime') THEN
    ALTER TABLE file_attachments
      ADD CONSTRAINT "CHK_file_attachments_mime"
      CHECK ("mimeType" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'));
  END IF;
END;
$migration$;

CREATE INDEX IF NOT EXISTS "IDX_file_attachments_tenant_submission"
  ON file_attachments ("tenantId", "submissionId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "IDX_file_attachments_uploader"
  ON file_attachments ("tenantId", "uploadedByUserId");

CREATE OR REPLACE FUNCTION enforce_file_attachment_membership() RETURNS trigger AS $function$
BEGIN
  SELECT fs."tenantId" INTO NEW."tenantId"
    FROM form_submissions fs
    WHERE fs.id = NEW."submissionId";
  IF NEW."tenantId" IS NULL THEN
    RAISE EXCEPTION 'Attachment submission does not exist'
      USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships tm
    INNER JOIN tenants t ON t.id = tm."tenantId"
    WHERE tm."tenantId" = NEW."tenantId"
      AND tm."userId" = NEW."uploadedByUserId"
      AND tm."isActive" = true
      AND t.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'File uploader must be an active member of the active tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "TR_file_attachments_active_member" ON file_attachments;
CREATE TRIGGER "TR_file_attachments_active_member"
BEFORE INSERT ON file_attachments
FOR EACH ROW EXECUTE FUNCTION enforce_file_attachment_membership();

COMMIT;
