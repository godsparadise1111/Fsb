BEGIN;

CREATE TABLE workflow_recovery_incident_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "incidentId" uuid NOT NULL REFERENCES workflow_recovery_incidents(id) ON DELETE RESTRICT,
  "eventType" varchar(40) NOT NULL,
  "actorUserId" uuid REFERENCES users(id) ON DELETE RESTRICT,
  "eventKey" varchar(180) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_workflow_recovery_incident_event_key UNIQUE ("incidentId","eventKey"),
  CONSTRAINT ck_workflow_recovery_incident_event_type
    CHECK ("eventType" IN ('WORKER_SCAN','ACKNOWLEDGE','RESOLVED','REPLAY_REJECTED')),
  CONSTRAINT uq_workflow_recovery_incident_event_tenant_id UNIQUE ("tenantId","id")
);

CREATE INDEX ix_workflow_recovery_incident_events_timeline
  ON workflow_recovery_incident_events ("tenantId","incidentId","createdAt" DESC);

CREATE OR REPLACE FUNCTION fsb_validate_workflow_recovery_incident_event()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Workflow recovery incident events are append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workflow_recovery_incidents i
     WHERE i.id=NEW."incidentId" AND i."tenantId"=NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'Recovery event must match incident Tenant';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_validate_workflow_recovery_incident_event
BEFORE INSERT OR UPDATE OR DELETE ON workflow_recovery_incident_events
FOR EACH ROW EXECUTE FUNCTION fsb_validate_workflow_recovery_incident_event();

COMMIT;
