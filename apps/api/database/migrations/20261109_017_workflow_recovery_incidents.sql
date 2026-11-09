BEGIN;

CREATE TABLE workflow_recovery_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "processInstanceId" uuid NOT NULL REFERENCES process_instances(id) ON DELETE RESTRICT,
  "incidentType" varchar(80) NOT NULL,
  fingerprint char(64) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'OPEN',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "resolvedAt" timestamptz,
  CONSTRAINT uq_workflow_recovery_incident_fingerprint
    UNIQUE ("tenantId","processInstanceId","incidentType",fingerprint),
  CONSTRAINT ck_workflow_recovery_incident_status
    CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  CONSTRAINT ck_workflow_recovery_incident_resolution
    CHECK ((status='RESOLVED' AND "resolvedAt" IS NOT NULL) OR
           (status<>'RESOLVED' AND "resolvedAt" IS NULL)),
  CONSTRAINT ck_workflow_recovery_incident_fingerprint
    CHECK (fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX ix_workflow_recovery_incident_open
  ON workflow_recovery_incidents ("tenantId","createdAt")
  WHERE status IN ('OPEN','ACKNOWLEDGED');

CREATE OR REPLACE FUNCTION fsb_validate_workflow_recovery_incident()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Workflow recovery incidents cannot be deleted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM process_instances pi
     WHERE pi.id=NEW."processInstanceId" AND pi."tenantId"=NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Workflow recovery incident must match process Tenant';
  END IF;
  IF TG_OP='UPDATE' AND ROW(NEW."tenantId",NEW."processInstanceId",NEW."incidentType",NEW.fingerprint,NEW.details,NEW."createdAt")
       IS DISTINCT FROM ROW(OLD."tenantId",OLD."processInstanceId",OLD."incidentType",OLD.fingerprint,OLD.details,OLD."createdAt") THEN
    RAISE EXCEPTION 'Workflow recovery incident identity and details are immutable';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='RESOLVED' THEN
    RAISE EXCEPTION 'Resolved workflow recovery incidents are immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_validate_workflow_recovery_incident
BEFORE INSERT OR UPDATE OR DELETE ON workflow_recovery_incidents
FOR EACH ROW EXECUTE FUNCTION fsb_validate_workflow_recovery_incident();

COMMIT;
