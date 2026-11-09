-- Commercial plans, tenant subscriptions and auditable manual invoices.
BEGIN;

CREATE TABLE commercial_plans (
  code varchar(24) PRIMARY KEY,
  "displayName" varchar(100) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  "monthlyPriceMinor" bigint,
  "annualPriceMinor" bigint,
  "currencyCode" char(3) NOT NULL DEFAULT 'USD',
  "isPublic" boolean NOT NULL DEFAULT true,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CK_commercial_plans_prices" CHECK (
    ("monthlyPriceMinor" IS NULL OR "monthlyPriceMinor" >= 0) AND
    ("annualPriceMinor" IS NULL OR "annualPriceMinor" >= 0)
  ),
  CONSTRAINT "CK_commercial_plans_currency" CHECK ("currencyCode" ~ '^[A-Z]{3}$'),
  CONSTRAINT "CK_commercial_plans_features_object" CHECK (jsonb_typeof(features) = 'object'),
  CONSTRAINT "CK_commercial_plans_limits_object" CHECK (jsonb_typeof(limits) = 'object')
);

INSERT INTO commercial_plans (code, "displayName", description, features, limits)
VALUES
('CORE', 'Core', 'هسته مدیریت سازمان، فرم و گردش‌کار', '{"form_builder":true,"workflow":true,"dashboards":true,"standard_reports":true,"email_notifications":true,"api_access":false,"advanced_reports":false,"sla":false,"delegation":false,"webhooks":false,"sso":false,"audit_export":false}'::jsonb, '{"maxUsers":25,"maxOrganizations":1,"maxProcesses":20,"maxStorageBytes":5368709120}'::jsonb),
('PROFESSIONAL', 'Professional', 'قابلیت‌های عملیاتی و گزارش‌گیری پیشرفته', '{"form_builder":true,"workflow":true,"dashboards":true,"standard_reports":true,"email_notifications":true,"api_access":true,"advanced_reports":true,"sla":true,"delegation":true,"webhooks":true,"sso":false,"audit_export":false}'::jsonb, '{"maxUsers":100,"maxOrganizations":10,"maxProcesses":200,"maxStorageBytes":53687091200}'::jsonb),
('ENTERPRISE', 'Enterprise', 'قابلیت‌های پیشرفته سازمانی و یکپارچه‌سازی', '{"form_builder":true,"workflow":true,"dashboards":true,"standard_reports":true,"email_notifications":true,"api_access":true,"advanced_reports":true,"sla":true,"delegation":true,"webhooks":true,"sso":true,"audit_export":true}'::jsonb, '{"maxUsers":1000,"maxOrganizations":100,"maxProcesses":5000,"maxStorageBytes":536870912000}'::jsonb)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  "planCode" varchar(24) NOT NULL REFERENCES commercial_plans(code) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'TRIALING',
  "billingCycle" varchar(12) NOT NULL DEFAULT 'MONTHLY',
  "startsAt" timestamptz NOT NULL DEFAULT now(),
  "currentPeriodStart" timestamptz NOT NULL DEFAULT now(),
  "currentPeriodEnd" timestamptz,
  "trialEndsAt" timestamptz,
  "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
  "cancelledAt" timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdByUserId" uuid REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CK_tenant_subscriptions_status" CHECK (status IN ('TRIALING','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED')),
  CONSTRAINT "CK_tenant_subscriptions_cycle" CHECK ("billingCycle" IN ('MONTHLY','ANNUAL')),
  CONSTRAINT "CK_tenant_subscriptions_period" CHECK ("currentPeriodEnd" IS NULL OR "currentPeriodEnd" > "currentPeriodStart"),
  CONSTRAINT "CK_tenant_subscriptions_metadata" CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX "IDX_tenant_subscriptions_status_period" ON tenant_subscriptions(status, "currentPeriodEnd");

CREATE TABLE tenant_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "subscriptionId" uuid NOT NULL REFERENCES tenant_subscriptions(id) ON DELETE RESTRICT,
  "invoiceNumber" varchar(64) NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'DRAFT',
  "currencyCode" char(3) NOT NULL,
  "subtotalMinor" bigint NOT NULL,
  "taxMinor" bigint NOT NULL DEFAULT 0,
  "totalMinor" bigint NOT NULL,
  description varchar(1000) NOT NULL DEFAULT '',
  "issuedAt" timestamptz,
  "dueAt" timestamptz,
  "paidAt" timestamptz,
  "voidedAt" timestamptz,
  "createdByUserId" uuid REFERENCES users(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CK_tenant_invoices_status" CHECK (status IN ('DRAFT','ISSUED','PAID','VOID','OVERDUE')),
  CONSTRAINT "CK_tenant_invoices_amounts" CHECK ("subtotalMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" = "subtotalMinor" + "taxMinor"),
  CONSTRAINT "CK_tenant_invoices_currency" CHECK ("currencyCode" ~ '^[A-Z]{3}$'),
  CONSTRAINT "CK_tenant_invoices_payment_time" CHECK ((status <> 'PAID') OR "paidAt" IS NOT NULL)
);
CREATE INDEX "IDX_tenant_invoices_tenant_created" ON tenant_invoices("tenantId","createdAt" DESC);

CREATE OR REPLACE FUNCTION fsb_validate_invoice_subscription_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subscription_tenant uuid;
BEGIN
  SELECT "tenantId" INTO subscription_tenant FROM tenant_subscriptions WHERE id = NEW."subscriptionId";
  IF subscription_tenant IS NULL OR subscription_tenant <> NEW."tenantId" THEN
    RAISE EXCEPTION 'invoice subscription must belong to the same tenant';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_invoice_subscription_tenant
BEFORE INSERT OR UPDATE OF "tenantId","subscriptionId" ON tenant_invoices
FOR EACH ROW EXECUTE FUNCTION fsb_validate_invoice_subscription_tenant();

INSERT INTO tenant_subscriptions (
  "tenantId", "planCode", status, "billingCycle", "startsAt",
  "currentPeriodStart", "currentPeriodEnd", "createdAt", "updatedAt"
)
SELECT t.id, t.plan,
       CASE WHEN t.status = 'ACTIVE' THEN 'ACTIVE'
            WHEN t.status = 'SUSPENDED' THEN 'SUSPENDED'
            ELSE 'TRIALING' END,
       'MONTHLY', COALESCE(t."activatedAt", t."createdAt"),
       COALESCE(t."activatedAt", t."createdAt"), NULL,
       now(), now()
FROM tenants t
WHERE EXISTS (SELECT 1 FROM commercial_plans p WHERE p.code = t.plan)
ON CONFLICT ("tenantId") DO NOTHING;

COMMIT;
