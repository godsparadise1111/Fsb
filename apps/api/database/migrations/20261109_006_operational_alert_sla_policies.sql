-- Per-organization configurable operational alert response and resolution targets.
BEGIN;
CREATE TABLE organization_operational_alert_sla_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 "organizationId" uuid NOT NULL,
 "criticalResponseMinutes" integer NOT NULL DEFAULT 15,
 "highResponseMinutes" integer NOT NULL DEFAULT 60,
 "mediumResponseMinutes" integer NOT NULL DEFAULT 240,
 "lowResponseMinutes" integer NOT NULL DEFAULT 1440,
 "criticalResolutionHours" integer NOT NULL DEFAULT 4,
 "highResolutionHours" integer NOT NULL DEFAULT 8,
 "mediumResolutionHours" integer NOT NULL DEFAULT 24,
 "lowResolutionHours" integer NOT NULL DEFAULT 72,
 "enabled" boolean NOT NULL DEFAULT true,
 "updatedByUserId" uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "UQ_operational_alert_sla_policy_org" UNIQUE ("tenantId","organizationId"),
 CONSTRAINT "FK_operational_alert_sla_policy_org" FOREIGN KEY ("organizationId","tenantId") REFERENCES organizations(id,"tenantId") ON DELETE RESTRICT,
 CONSTRAINT "CK_operational_alert_sla_response" CHECK (
  "criticalResponseMinutes" BETWEEN 1 AND 10080 AND "highResponseMinutes" BETWEEN 1 AND 10080
  AND "mediumResponseMinutes" BETWEEN 1 AND 10080 AND "lowResponseMinutes" BETWEEN 1 AND 10080
 ),
 CONSTRAINT "CK_operational_alert_sla_resolution" CHECK (
  "criticalResolutionHours" BETWEEN 1 AND 720 AND "highResolutionHours" BETWEEN 1 AND 720
  AND "mediumResolutionHours" BETWEEN 1 AND 720 AND "lowResolutionHours" BETWEEN 1 AND 720
 )
);
CREATE OR REPLACE FUNCTION fsb_validate_operational_alert_sla_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."updatedByUserId" IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM users u JOIN tenant_memberships tm ON tm."userId"=u.id
    WHERE u.id=NEW."updatedByUserId" AND u."isActive"=true
      AND tm."tenantId"=NEW."tenantId" AND tm."isActive"=true
 ) THEN RAISE EXCEPTION 'SLA policy editor must be an active tenant member'; END IF;
 NEW."updatedAt" := now();
 RETURN NEW;
END; $$;
CREATE TRIGGER "TR_operational_alert_sla_policy_validate"
 BEFORE INSERT OR UPDATE ON organization_operational_alert_sla_policies
 FOR EACH ROW EXECUTE FUNCTION fsb_validate_operational_alert_sla_policy();
CREATE OR REPLACE FUNCTION fsb_set_operational_alert_sla_deadlines() RETURNS trigger LANGUAGE plpgsql AS $fsb$
DECLARE p organization_operational_alert_sla_policies%ROWTYPE;
DECLARE response_minutes integer;
DECLARE resolution_hours integer;
BEGIN
 SELECT * INTO p FROM organization_operational_alert_sla_policies
  WHERE "tenantId"=NEW."tenantId" AND "organizationId"=NEW."organizationId";
 IF FOUND THEN
  IF NOT p."enabled" THEN
   NEW."responseDueAt" := NULL; NEW."resolutionDueAt" := NULL; RETURN NEW;
  END IF;
  response_minutes := CASE NEW.severity WHEN 'CRITICAL' THEN p."criticalResponseMinutes" WHEN 'HIGH' THEN p."highResponseMinutes" WHEN 'MEDIUM' THEN p."mediumResponseMinutes" ELSE p."lowResponseMinutes" END;
  resolution_hours := CASE NEW.severity WHEN 'CRITICAL' THEN p."criticalResolutionHours" WHEN 'HIGH' THEN p."highResolutionHours" WHEN 'MEDIUM' THEN p."mediumResolutionHours" ELSE p."lowResolutionHours" END;
 ELSE
  response_minutes := CASE NEW.severity WHEN 'CRITICAL' THEN 15 WHEN 'HIGH' THEN 60 WHEN 'MEDIUM' THEN 240 ELSE 1440 END;
  resolution_hours := CASE NEW.severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 8 WHEN 'MEDIUM' THEN 24 ELSE 72 END;
 END IF;
 NEW."responseDueAt" := COALESCE(NEW."responseDueAt", NEW."firstDetectedAt" + make_interval(mins => response_minutes));
 NEW."resolutionDueAt" := COALESCE(NEW."resolutionDueAt", NEW."firstDetectedAt" + make_interval(hours => resolution_hours));
 RETURN NEW;
END; $fsb$;
COMMIT;
