-- Indexed, single-use renewal receipts; renewedAt is created with the invoice ledger in migration 021.
BEGIN;
CREATE INDEX "IDX_tenant_invoices_paid_unrenewed"
  ON tenant_invoices("tenantId","createdAt")
  WHERE status='PAID' AND "renewedAt" IS NULL;
COMMIT;
