-- Prevent attachment metadata or tenant ownership from being reassigned after upload.
BEGIN;
CREATE OR REPLACE FUNCTION fsb_prevent_file_attachment_reassignment() RETURNS trigger
LANGUAGE plpgsql AS $fsb$
BEGIN
  IF OLD."tenantId" IS DISTINCT FROM NEW."tenantId"
     OR OLD."submissionId" IS DISTINCT FROM NEW."submissionId"
     OR OLD."uploadedByUserId" IS DISTINCT FROM NEW."uploadedByUserId"
     OR OLD."storageKey" IS DISTINCT FROM NEW."storageKey"
     OR OLD."originalName" IS DISTINCT FROM NEW."originalName"
     OR OLD."mimeType" IS DISTINCT FROM NEW."mimeType"
     OR OLD.size IS DISTINCT FROM NEW.size
     OR OLD.sha256 IS DISTINCT FROM NEW.sha256 THEN
    RAISE EXCEPTION 'File attachment ownership and content metadata are immutable';
  END IF;
  RETURN NEW;
END;
$fsb$;
DROP TRIGGER IF EXISTS "TR_file_attachments_immutable" ON file_attachments;
CREATE TRIGGER "TR_file_attachments_immutable"
  BEFORE UPDATE ON file_attachments
  FOR EACH ROW EXECUTE FUNCTION fsb_prevent_file_attachment_reassignment();
COMMIT;
