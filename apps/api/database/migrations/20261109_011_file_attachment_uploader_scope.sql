-- Enforce uploader eligibility and submission/form/organization tenant consistency at the database boundary.
BEGIN;

CREATE OR REPLACE FUNCTION enforce_file_attachment_membership() RETURNS trigger AS $function$
DECLARE
  submission_tenant_id uuid;
  organization_tenant_id uuid;
BEGIN
  SELECT fs."tenantId", o."tenantId"
    INTO submission_tenant_id, organization_tenant_id
    FROM form_submissions fs
    INNER JOIN form_versions fv ON fv.id = fs."formVersionId"
    INNER JOIN form_definitions fd ON fd.id = fv."definitionId"
    INNER JOIN organizations o ON o.id = fd."organizationId"
   WHERE fs.id = NEW."submissionId";

  IF submission_tenant_id IS NULL
     OR organization_tenant_id IS DISTINCT FROM submission_tenant_id THEN
    RAISE EXCEPTION 'Attachment submission and form organization must belong to the same tenant'
      USING ERRCODE = '23503';
  END IF;

  NEW."tenantId" := submission_tenant_id;

  IF NOT EXISTS (
    SELECT 1
      FROM tenant_memberships tm
      INNER JOIN tenants t ON t.id = tm."tenantId" AND t.status = 'ACTIVE'
      INNER JOIN users u ON u.id = tm."userId" AND u."isActive" = true
     WHERE tm."tenantId" = NEW."tenantId"
       AND tm."userId" = NEW."uploadedByUserId"
       AND tm."isActive" = true
  ) THEN
    RAISE EXCEPTION 'File uploader must be an active user and member of the active tenant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

COMMIT;
