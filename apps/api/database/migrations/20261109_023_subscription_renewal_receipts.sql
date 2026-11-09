-- One-time idempotency marker for subscription renewal against a paid invoice.
BEGIN;
ALTER TABLE tenant_invoices ADD COLUMN "renewedAt" timestamptz;
CREATE INDEX "IDX_tenant_invoices_paid_unrenewed"
  ON tenant_invoices("tenantId","createdAt")
  WHERE status='PAID' AND "renewedAt" IS NULL;
COMMIT;
