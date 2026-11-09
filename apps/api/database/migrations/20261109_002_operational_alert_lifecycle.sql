-- Persistent lifecycle for organization operational alerts.
BEGIN;
CREATE TABLE organization_operational_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 "organizationId" uuid NOT NULL,
 "alertKey" varchar(220) NOT NULL,
 type varchar(64) NOT NULL, severity varchar(16) NOT NULL, title varchar(240) NOT NULL,
 description text NOT NULL, "resourceId" varchar(128) NOT NULL, "dueAt" timestamptz NULL,
 status varchar(16) NOT NULL DEFAULT 'OPEN',
 "assignedToUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
 "acknowledgedByUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT, "acknowledgedAt" timestamptz NULL,
 "resolvedByUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT, "resolvedAt" timestamptz NULL,
 "resolutionNote" text NULL, "firstDetectedAt" timestamptz NOT NULL DEFAULT now(),
 "lastDetectedAt" timestamptz NOT NULL DEFAULT now(), "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "UQ_operational_alert_tenant_org_key" UNIQUE ("tenantId","organizationId","alertKey"),
 CONSTRAINT "FK_operational_alert_org_tenant" FOREIGN KEY ("organizationId","tenantId") REFERENCES organizations(id,"tenantId") ON DELETE RESTRICT,
 CONSTRAINT "CK_operational_alert_severity" CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
 CONSTRAINT "CK_operational_alert_status" CHECK (status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','IGNORED')),
 CONSTRAINT "CK_operational_alert_ack_pair" CHECK (("acknowledgedByUserId" IS NULL)=("acknowledgedAt" IS NULL)),
 CONSTRAINT "CK_operational_alert_resolution_pair" CHECK (("resolvedAt" IS NULL)=("resolvedByUserId" IS NULL)),
 CONSTRAINT "CK_operational_alert_resolution_note" CHECK (status <> 'RESOLVED' OR "resolutionNote" IS NOT NULL)
);
CREATE INDEX "IDX_operational_alert_org_status_severity" ON organization_operational_alerts ("tenantId","organizationId",status,severity,"lastDetectedAt" DESC);
CREATE INDEX "IDX_operational_alert_assignee" ON organization_operational_alerts ("tenantId","assignedToUserId",status) WHERE "assignedToUserId" IS NOT NULL;
CREATE OR REPLACE FUNCTION fsb_validate_operational_alert_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."assignedToUserId" IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM tenant_memberships tm JOIN users u ON u.id=tm."userId" AND u."isActive"=true
   WHERE tm."tenantId"=NEW."tenantId" AND tm."userId"=NEW."assignedToUserId" AND tm."isActive"=true
 ) THEN RAISE EXCEPTION 'Operational alert owner must be an active tenant member'; END IF;
 NEW."updatedAt":=now(); RETURN NEW;
END; $$;
CREATE TRIGGER "TR_operational_alert_assignment" BEFORE INSERT OR UPDATE ON organization_operational_alerts FOR EACH ROW EXECUTE FUNCTION fsb_validate_operational_alert_assignment();
COMMIT;
