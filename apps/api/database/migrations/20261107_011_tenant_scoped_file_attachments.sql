BEGIN;

CREATE TABLE file_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "submissionId" uuid NOT NULL,
  "uploadedByUserId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "originalName" varchar(255) NOT NULL,
  "storageKey" varchar(80) NOT NULL UNIQUE,
  "mimeType" varchar(100) NOT NULL,
  size bigint NOT NULL CHECK (size > 0 AND size <= 10485760),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "FK_file_attachments_submission_tenant"
    FOREIGN KEY ("submissionId", "tenantId")
    REFERENCES form_submissions(id, "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "CHK_file_attachments_mime"
    CHECK ("mimeType" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'))
);

CREATE INDEX "IDX_file_attachments_tenant_submission"
  ON file_attachments ("tenantId", "submissionId", "createdAt" DESC);
CREATE INDEX "IDX_file_attachments_uploader"
  ON file_attachments ("tenantId", "uploadedByUserId");

CREATE FUNCTION enforce_file_attachment_membership() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TR_file_attachments_active_member"
BEFORE INSERT ON file_attachments
FOR EACH ROW EXECUTE FUNCTION enforce_file_attachment_membership();

COMMIT;
