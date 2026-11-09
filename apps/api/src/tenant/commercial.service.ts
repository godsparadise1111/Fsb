import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';

@Injectable()
export class CommercialService {
  constructor(private readonly dataSource: DataSource) {}

  listPlans() {
    return this.dataSource.query(
      `SELECT code, "displayName", description, features, limits,
              "monthlyPriceMinor", "annualPriceMinor", "currencyCode", "isPublic"
         FROM commercial_plans WHERE "isActive" = true ORDER BY code ASC`,
    );
  }

  async listSubscriptions() {
    return this.dataSource.query(
      `SELECT t.id AS "tenantId", t.name AS "tenantName", t.slug, t.code AS "tenantCode", t.status AS "tenantStatus",
              s.id AS "subscriptionId", s.status AS "subscriptionStatus", s."billingCycle",
              s."currentPeriodStart", s."currentPeriodEnd", s."trialEndsAt", s."cancelAtPeriodEnd",
              p.code AS "planCode", p."displayName" AS "planName", p.features, p.limits,
              p."monthlyPriceMinor", p."annualPriceMinor", p."currencyCode"
         FROM tenants t
         LEFT JOIN tenant_subscriptions s ON s."tenantId" = t.id
         LEFT JOIN commercial_plans p ON p.code = s."planCode"
        ORDER BY t."createdAt" DESC`,
    );
  }

  listInvoices() {
    return this.dataSource.query(
      `SELECT i.id,i."tenantId",t.name AS "tenantName",t.code AS "tenantCode",
              i."invoiceNumber",i.status,i."currencyCode",i."subtotalMinor",i."taxMinor",i."totalMinor",
              i.description,i."issuedAt",i."dueAt",i."paidAt",i."renewedAt",i."createdAt"
         FROM tenant_invoices i
         JOIN tenants t ON t.id=i."tenantId"
        ORDER BY i."createdAt" DESC LIMIT 250`,
    );
  }

  async getTenantOverview(tenantId: string) {
    const [tenant] = await this.dataSource.query(
      `SELECT t.id, t.name, t.code, t.status AS "tenantStatus", t.plan AS "legacyPlan",
              s.id AS "subscriptionId", s.status AS "subscriptionStatus", s."billingCycle",
              s."currentPeriodStart", s."currentPeriodEnd", s."trialEndsAt", s."cancelAtPeriodEnd",
              p.code AS "planCode", p."displayName" AS "planName", p.features, p.limits,
              p."monthlyPriceMinor", p."annualPriceMinor", p."currencyCode"
         FROM tenants t
         LEFT JOIN tenant_subscriptions s ON s."tenantId" = t.id
         LEFT JOIN commercial_plans p ON p.code = s."planCode"
        WHERE t.id = $1`,
      [tenantId],
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
    const invoices = await this.dataSource.query(
      `SELECT id, "invoiceNumber", status, "currencyCode", "subtotalMinor", "taxMinor", "totalMinor",
              description, "issuedAt", "dueAt", "paidAt", "renewedAt", "createdAt"
         FROM tenant_invoices WHERE "tenantId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
      [tenantId],
    );
    return { tenant, invoices };
  }

  async updateSubscription(input: {
    tenantId: string; planCode: string; status: SubscriptionStatus; billingCycle: BillingCycle;
    periodStart?: string; periodEnd?: string | null; trialEndsAt?: string | null;
    cancelAtPeriodEnd?: boolean; actorUserId: string;
  }) {
    return this.dataSource.transaction(async manager => {
      const [tenant] = await manager.query(
        'SELECT id, plan FROM tenants WHERE id = $1 FOR UPDATE',
        [input.tenantId],
      );
      if (!tenant) throw new NotFoundException('Tenant not found');
      const [plan] = await manager.query(
        'SELECT code FROM commercial_plans WHERE code = $1 AND "isActive" = true',
        [input.planCode],
      );
      if (!plan) throw new BadRequestException('Selected commercial plan is not active');
      const [current] = await manager.query(
        'SELECT id, "planCode", status FROM tenant_subscriptions WHERE "tenantId" = $1 FOR UPDATE',
        [input.tenantId],
      );
      const periodStart = input.periodStart ? new Date(input.periodStart) : new Date();
      const periodEnd = input.periodEnd ? new Date(input.periodEnd) : null;
      const trialEndsAt = input.trialEndsAt ? new Date(input.trialEndsAt) : null;
      if (periodEnd && periodEnd <= periodStart) throw new BadRequestException('Subscription period end must be after its start');
      if (input.status === 'TRIALING' && !trialEndsAt) throw new BadRequestException('Trial subscriptions require trialEndsAt');
      let subscriptionId: string;
      if (current) {
        const [updated] = await manager.query(
          `UPDATE tenant_subscriptions
              SET "planCode"=$2, status=$3, "billingCycle"=$4, "currentPeriodStart"=$5,
                  "currentPeriodEnd"=$6, "trialEndsAt"=$7, "cancelAtPeriodEnd"=$8,
                  "cancelledAt"=CASE WHEN $3='CANCELLED' THEN COALESCE("cancelledAt",now()) ELSE NULL END,
                  "updatedAt"=now()
            WHERE id=$1 RETURNING id`,
          [current.id, input.planCode, input.status, input.billingCycle, periodStart, periodEnd,
           trialEndsAt, input.cancelAtPeriodEnd ?? false],
        );
        subscriptionId = updated.id;
      } else {
        const [created] = await manager.query(
          `INSERT INTO tenant_subscriptions
            ("tenantId","planCode",status,"billingCycle","startsAt","currentPeriodStart","currentPeriodEnd","trialEndsAt","cancelAtPeriodEnd","createdByUserId")
           VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9) RETURNING id`,
          [input.tenantId, input.planCode, input.status, input.billingCycle, periodStart,
           periodEnd, trialEndsAt, input.cancelAtPeriodEnd ?? false, input.actorUserId],
        );
        subscriptionId = created.id;
      }
      await manager.query('UPDATE tenants SET plan=$2, "updatedAt"=now() WHERE id=$1', [input.tenantId, input.planCode]);
      await manager.query(
        `INSERT INTO tenant_audit_logs ("tenantId","actorUserId",action,"resourceType","resourceId",metadata)
         VALUES ($1,$2,'SUBSCRIPTION_CHANGED','TENANT_SUBSCRIPTION',$3,$4::jsonb)`,
        [input.tenantId, input.actorUserId, subscriptionId, JSON.stringify({
          fromPlan: current?.planCode ?? tenant.plan, toPlan: input.planCode, status: input.status,
          billingCycle: input.billingCycle, periodStart: periodStart.toISOString(),
          periodEnd: periodEnd?.toISOString() ?? null, trialEndsAt: trialEndsAt?.toISOString() ?? null,
        })],
      );
      return { subscriptionId, tenantId: input.tenantId, planCode: input.planCode, status: input.status, billingCycle: input.billingCycle };
    });
  }

  async createInvoice(input: {
    tenantId: string; invoiceNumber: string; currencyCode: string; subtotalMinor: number;
    taxMinor: number; description: string; dueAt?: string; actorUserId: string;
  }) {
    if (!/^[A-Z]{3}$/.test(input.currencyCode)) throw new BadRequestException('Currency must be a three-letter ISO code');
    if (!Number.isSafeInteger(input.subtotalMinor) || !Number.isSafeInteger(input.taxMinor) ||
        input.subtotalMinor < 0 || input.taxMinor < 0 ||
        !Number.isSafeInteger(input.subtotalMinor + input.taxMinor)) {
      throw new BadRequestException('Invoice amounts must be non-negative safe integers in minor currency units');
    }
    return this.dataSource.transaction(async manager => {
      const [subscription] = await manager.query(
        'SELECT id FROM tenant_subscriptions WHERE "tenantId"=$1 FOR UPDATE',
        [input.tenantId],
      );
      if (!subscription) throw new BadRequestException('Tenant has no subscription; assign a plan first');
      const [invoice] = await manager.query(
        `INSERT INTO tenant_invoices
          ("tenantId","subscriptionId","invoiceNumber",status,"currencyCode","subtotalMinor","taxMinor","totalMinor",description,"issuedAt","dueAt","createdByUserId")
         VALUES ($1,$2,$3,'ISSUED',$4,$5,$6,$7,$8,now(),$9,$10)
         RETURNING id,"invoiceNumber",status,"currencyCode","subtotalMinor","taxMinor","totalMinor","issuedAt","dueAt"`,
        [input.tenantId, subscription.id, input.invoiceNumber, input.currencyCode,
         input.subtotalMinor, input.taxMinor, input.subtotalMinor + input.taxMinor,
         input.description, input.dueAt ? new Date(input.dueAt) : null, input.actorUserId],
      );
      await manager.query(
        `INSERT INTO tenant_audit_logs ("tenantId","actorUserId",action,"resourceType","resourceId",metadata)
         VALUES ($1,$2,'INVOICE_ISSUED','TENANT_INVOICE',$3,$4::jsonb)`,
        [input.tenantId, input.actorUserId, invoice.id, JSON.stringify({ invoiceNumber: invoice.invoiceNumber, totalMinor: invoice.totalMinor, currencyCode: invoice.currencyCode })],
      );
      return invoice;
    });
  }

  async renewSubscriptionFromPaidInvoice(tenantId: string, invoiceId: string, actorUserId: string) {
    return this.dataSource.transaction(async manager => {
      const [subscription] = await manager.query(
        `SELECT id,status,"billingCycle","currentPeriodStart","currentPeriodEnd"
           FROM tenant_subscriptions WHERE "tenantId"=$1 FOR UPDATE`,
        [tenantId],
      );
      if (!subscription) throw new NotFoundException('Tenant subscription not found');
      if (subscription.status === 'CANCELLED') throw new BadRequestException('Cancelled subscriptions cannot be renewed; assign a new subscription first');
      const [invoice] = await manager.query(
        `SELECT id,status,"totalMinor","currencyCode","invoiceNumber","renewedAt"
           FROM tenant_invoices WHERE id=$1 AND "tenantId"=$2 AND "subscriptionId"=$3 FOR UPDATE`,
        [invoiceId, tenantId, subscription.id],
      );
      if (!invoice) throw new NotFoundException('Invoice not found for this tenant subscription');
      if (invoice.status !== 'PAID') throw new BadRequestException('Subscription renewal requires a PAID invoice');
      if (invoice.renewedAt) throw new ConflictException('This paid invoice has already been applied to a subscription renewal');
      const [renewed] = await manager.query(
        `UPDATE tenant_subscriptions
            SET status='ACTIVE',
                "currentPeriodStart"=CASE
                  WHEN "currentPeriodEnd" IS NULL OR "currentPeriodEnd" < now() THEN now()
                  ELSE "currentPeriodEnd" END,
                "currentPeriodEnd"=CASE
                  WHEN "currentPeriodEnd" IS NULL OR "currentPeriodEnd" < now()
                    THEN now() + CASE WHEN "billingCycle"='ANNUAL' THEN interval '1 year' ELSE interval '1 month' END
                  ELSE "currentPeriodEnd" + CASE WHEN "billingCycle"='ANNUAL' THEN interval '1 year' ELSE interval '1 month' END
                END,
                "trialEndsAt"=NULL,"cancelAtPeriodEnd"=false,"cancelledAt"=NULL,"updatedAt"=now()
          WHERE id=$1
          RETURNING id,status,"billingCycle","currentPeriodStart","currentPeriodEnd"`,
        [subscription.id],
      );
      const [receipt] = await manager.query(
        `UPDATE tenant_invoices SET "renewedAt"=now()
          WHERE id=$1 AND "tenantId"=$2 AND status='PAID' AND "renewedAt" IS NULL
          RETURNING id`,
        [invoice.id, tenantId],
      );
      if (!receipt) throw new ConflictException('Paid invoice has already been used for renewal');
      await manager.query(
        `INSERT INTO tenant_audit_logs ("tenantId","actorUserId",action,"resourceType","resourceId",metadata)
         VALUES ($1,$2,'SUBSCRIPTION_RENEWED','TENANT_SUBSCRIPTION',$3,$4::jsonb)`,
        [tenantId, actorUserId, subscription.id, JSON.stringify({
          invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
          totalMinor: invoice.totalMinor, currencyCode: invoice.currencyCode,
          currentPeriodStart: renewed.currentPeriodStart, currentPeriodEnd: renewed.currentPeriodEnd,
        })],
      );
      return renewed;
    });
  }

  async transitionInvoice(invoiceId: string, status: 'PAID' | 'VOID', actorUserId: string) {
    return this.dataSource.transaction(async manager => {
      const [invoice] = await manager.query(
        'SELECT id,"tenantId",status,"invoiceNumber" FROM tenant_invoices WHERE id=$1 FOR UPDATE',
        [invoiceId],
      );
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === status) return invoice;
      if (invoice.status !== 'ISSUED' && invoice.status !== 'OVERDUE') {
        throw new BadRequestException('Only issued or overdue invoices can be paid or voided');
      }
      const [updated] = await manager.query(
        `UPDATE tenant_invoices SET status=$2,
           "paidAt"=CASE WHEN $2='PAID' THEN now() ELSE NULL END,
           "voidedAt"=CASE WHEN $2='VOID' THEN now() ELSE NULL END
         WHERE id=$1 RETURNING id,"tenantId",status,"invoiceNumber","paidAt","voidedAt"`,
        [invoiceId, status],
      );
      await manager.query(
        `INSERT INTO tenant_audit_logs ("tenantId","actorUserId",action,"resourceType","resourceId",metadata)
         VALUES ($1,$2,$3,'TENANT_INVOICE',$4,$5::jsonb)`,
        [invoice.tenantId, actorUserId, status === 'PAID' ? 'INVOICE_MARKED_PAID' : 'INVOICE_VOIDED', invoiceId, JSON.stringify({ invoiceNumber: invoice.invoiceNumber })],
      );
      return updated;
    });
  }
}
