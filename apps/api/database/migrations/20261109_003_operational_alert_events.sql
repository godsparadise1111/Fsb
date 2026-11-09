-- Append-only operational alert timeline and manager follow-up notes.
BEGIN;
ALTER TABLE organization_operational_alerts ADD CONSTRAINT "UQ_operational_alert_id_scope" UNIQUE (id,"tenantId","organizationId");
CREATE TABLE organization_operational_alert_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 "organizationId" uuid NOT NULL,
 "alertId" uuid NOT NULL,
 "actorUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
 "eventType" varchar(24) NOT NULL,
 "fromStatus" varchar(16) NULL,
 "toStatus" varchar(16) NULL,
 note text NULL,
 "assignedToUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "CK_operational_alert_event_type" CHECK ("eventType" IN ('ACKNOWLEDGE','ASSIGN','RESOLVE','REOPEN','COMMENT')),
 CONSTRAINT "CK_operational_alert_event_note" CHECK (note IS NULL OR length(note) BETWEEN 3 AND 4000),
 CONSTRAINT "FK_operational_alert_event_org_tenant" FOREIGN KEY ("organizationId","tenantId") REFERENCES organizations(id,"tenantId") ON DELETE RESTRICT,
 CONSTRAINT "FK_operational_alert_event_alert_scope" FOREIGN KEY ("alertId","tenantId","organizationId") REFERENCES organization_operational_alerts(id,"tenantId","organizationId") ON DELETE RESTRICT
);
CREATE INDEX "IDX_operational_alert_events_timeline" ON organization_operational_alert_events ("tenantId","organizationId","alertId","createdAt" DESC);
CREATE OR REPLACE FUNCTION fsb_prevent_operational_alert_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Operational alert events are append-only';
END; $$;
CREATE TRIGGER "TR_operational_alert_event_immutable"
 BEFORE UPDATE OR DELETE ON organization_operational_alert_events
 FOR EACH ROW EXECUTE FUNCTION fsb_prevent_operational_alert_event_mutation();
COMMIT;
