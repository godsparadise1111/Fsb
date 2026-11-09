import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'node:os';
import * as nodemailer from 'nodemailer';
import { DataSource } from 'typeorm';
import { NotificationOutboxService } from './notification-outbox.service';

@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorker.name);
  private readonly workerId = `fsb-mail-${hostname().replace(/[^a-zA-Z0-9.-]/g, '-')}-${process.pid}`.slice(0, 120);
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private transporter: nodemailer.Transporter | undefined;

  constructor(private readonly outbox: NotificationOutboxService, private readonly dataSource: DataSource) {}

  onModuleInit() {
    if (process.env.FSB_NOTIFICATION_WORKER_ENABLED !== 'true') return;
    const host = process.env.FSB_SMTP_HOST;
    const from = process.env.FSB_EMAIL_FROM;
    const publicUrl = process.env.FSB_PUBLIC_APP_URL;
    if (!host || !from || !publicUrl || !process.env.FSB_OUTBOX_ENCRYPTION_KEY) {
      throw new Error('Notification worker requires FSB_SMTP_HOST, FSB_EMAIL_FROM, FSB_PUBLIC_APP_URL and FSB_OUTBOX_ENCRYPTION_KEY');
    }
    const port = Number(process.env.FSB_SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FSB_SMTP_PORT is invalid');
    const authUser = process.env.FSB_SMTP_USER;
    const authPass = process.env.FSB_SMTP_PASS;
    if (Boolean(authUser) !== Boolean(authPass)) throw new Error('Configure both FSB_SMTP_USER and FSB_SMTP_PASS, or neither');
    const parsedPublicUrl = new URL(publicUrl);
    if (process.env.NODE_ENV === 'production' && parsedPublicUrl.protocol !== 'https:') throw new Error('FSB_PUBLIC_APP_URL must use HTTPS in production');
    this.transporter = nodemailer.createTransport({
      host, port, secure: process.env.FSB_SMTP_SECURE === 'true',
      ...(authUser && authPass ? { auth: { user: authUser, pass: authPass } } : {}),
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    const requestedInterval = Number(process.env.FSB_NOTIFICATION_POLL_MS ?? 5000);
    const interval = Number.isFinite(requestedInterval) ? Math.min(60000, Math.max(1000, requestedInterval)) : 5000;
    this.timer = setInterval(() => void this.processBatch(), interval);
    this.timer.unref();
    void this.processBatch();
    this.logger.log(`Notification worker started (poll=${interval}ms)`);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.transporter?.close();
  }

  private escapeHtml(value: string) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  private async enqueueOperationalAlertSlaEscalations() {
    const candidates = await this.dataSource.query(
      `SELECT a.id,a."tenantId",a."organizationId",a.title,a.severity,a.status,
              a."assignedToUserId",a."responseDueAt",a."resolutionDueAt",
              u.email,
              CASE WHEN a."acknowledgedAt" IS NULL AND a."responseDueAt" <= now() THEN 'RESPONSE'
                   WHEN a."resolutionDueAt" <= now() THEN 'RESOLUTION' END AS stage
         FROM organization_operational_alerts a
         JOIN tenants t ON t.id=a."tenantId" AND t.status='ACTIVE'
         JOIN users u ON u.id=a."assignedToUserId" AND u."isActive"=true AND u.email IS NOT NULL
         JOIN tenant_memberships tm ON tm."userId"=u.id AND tm."tenantId"=a."tenantId" AND tm."isActive"=true
        WHERE a.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')
          AND ((a."acknowledgedAt" IS NULL AND a."responseDueAt" <= now())
            OR a."resolutionDueAt" <= now())
          AND NOT EXISTS (
            SELECT 1 FROM notification_outbox n
             WHERE n."tenantId"=a."tenantId"
               AND n."dedupeKey"='alert-sla:'||a.id::text||':'||
                 CASE WHEN a."acknowledgedAt" IS NULL AND a."responseDueAt" <= now() THEN 'RESPONSE' ELSE 'RESOLUTION' END
          )
        ORDER BY a."resolutionDueAt" ASC LIMIT 100`,
    ) as Array<{id:string;tenantId:string;organizationId:string;title:string;severity:string;assignedToUserId:string;responseDueAt:Date;resolutionDueAt:Date;email:string;stage:string}>;
    for (const alert of candidates) {
      await this.dataSource.transaction(async manager => {
        const dedupeKey = `alert-sla:${alert.id}:${alert.stage}`;
        const [queued] = await manager.query(
          `SELECT id FROM notification_outbox WHERE "tenantId"=$1 AND "dedupeKey"=$2`,
          [alert.tenantId,dedupeKey],
        );
        if (queued) return;
        await this.outbox.enqueue(manager, {
          tenantId: alert.tenantId,
          eventType: 'organization.alert.sla.breached',
          recipient: alert.email,
          subject: `Operational alert SLA breached: ${alert.title}`,
          dedupeKey,
          payload: {
            alertId: alert.id, organizationId: alert.organizationId, title: alert.title,
            severity: alert.severity, stage: alert.stage, userId: alert.assignedToUserId,
            responseDueAt: new Date(alert.responseDueAt).toISOString(),
            resolutionDueAt: new Date(alert.resolutionDueAt).toISOString(),
          },
        });
        await manager.query(
          `INSERT INTO organization_operational_alert_events ("tenantId","organizationId","alertId","actorUserId","eventType","fromStatus","toStatus","note","dedupeKey")
           VALUES ($1,$2,$3,NULL,$4,$5,$5,$6,$7) ON CONFLICT ("tenantId","dedupeKey") DO NOTHING`,
          [alert.tenantId,alert.organizationId,alert.id,alert.stage === 'RESPONSE' ? 'SLA_RESPONSE_BREACH' : 'SLA_RESOLUTION_BREACH',alert.status,
           alert.stage === 'RESPONSE' ? 'مهلت پاسخ هشدار نقض شد.' : 'مهلت حل هشدار نقض شد.',dedupeKey],
        );
      });
      await this.dataSource.query(
        `UPDATE organization_operational_alerts
            SET "escalatedAt"=COALESCE("escalatedAt",now()),
                "escalationLevel"=GREATEST("escalationLevel",CASE WHEN $2='RESPONSE' THEN 1 ELSE 2 END),
                "updatedAt"=now()
          WHERE id=$1 AND "tenantId"=$3 AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`,
        [alert.id,alert.stage,alert.tenantId],
      );
    }
  }

  private async send(item: { id: string; tenantId: string; eventType: string; recipient: string; subject: string | null; payload: Record<string, unknown> }): Promise<boolean> {
    if (!this.transporter) throw new Error('SMTP transport is unavailable');
    const [tenant] = await this.dataSource.query('SELECT status FROM tenants WHERE id = $1', [item.tenantId]);
    if (!tenant || tenant.status !== 'ACTIVE') {
      await this.outbox.markDead(item.id, this.workerId, 'Tenant is not active; notification was not sent');
      return false;
    }
    if (item.eventType === 'organization.alert.sla.breached') {
      const alertId = String(item.payload.alertId ?? '');
      const userId = String(item.payload.userId ?? '');
      const [valid] = await this.dataSource.query(
        `SELECT a.id FROM organization_operational_alerts a
          JOIN users u ON u.id=$3 AND u."isActive"=true AND lower(u.email)=lower($4)
          JOIN tenant_memberships tm ON tm."userId"=u.id AND tm."tenantId"=a."tenantId" AND tm."isActive"=true
         WHERE a.id=$1 AND a."tenantId"=$2 AND a."assignedToUserId"=u.id
           AND a.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`,
        [alertId,item.tenantId,userId,item.recipient],
      );
      if (!valid) {
        await this.outbox.markDead(item.id,this.workerId,'Alert is closed or assigned recipient is no longer an active tenant member');
        return false;
      }
      const title=String(item.payload.title ?? 'Operational alert');
      const stage=String(item.payload.stage ?? 'SLA');
      const due=String(stage==='RESPONSE' ? item.payload.responseDueAt : item.payload.resolutionDueAt);
      const safeTitle=this.escapeHtml(title), safeDue=this.escapeHtml(due);
      const subject=(item.subject ?? 'Operational alert SLA breached').replaceAll('\\r',' ').replaceAll('\\n',' ').slice(0,160);
      await this.transporter.sendMail({
        from:process.env.FSB_EMAIL_FROM,to:item.recipient,subject,
        text:`The operational alert "${title}" has breached its ${stage.toLowerCase()} deadline. Deadline: ${due}`,
        html:`<p>The operational alert <strong>${safeTitle}</strong> has breached its ${stage.toLowerCase()} deadline.</p><p>Deadline: ${safeDue}</p>`,
        messageId:`<fsb-${item.id}@${new URL(process.env.FSB_PUBLIC_APP_URL!).hostname}>`,
      });
      return true;
    }
    if (item.eventType !== 'tenant.invitation.created') throw new Error(`Unsupported notification event: ${item.eventType}`);
    const invitationId = String(item.payload.invitationId ?? '');
    const [invitation] = await this.dataSource.query(
      `SELECT id FROM tenant_invitations
        WHERE id = $1 AND "tenantId" = $2
          AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > now()`,
      [invitationId, item.tenantId],
    );
    if (!invitation) {
      await this.outbox.markDead(item.id, this.workerId, 'Invitation is expired, revoked, or already accepted');
      return false;
    }
    const tenantName = String(item.payload.tenantName ?? 'F-S');
    const acceptPath = String(item.payload.acceptPath ?? '');
    if (!acceptPath.startsWith('/invite?token=')) throw new Error('Invitation link is invalid');
    const baseUrl = new URL(process.env.FSB_PUBLIC_APP_URL!);
    const invitationUrl = new URL(acceptPath, baseUrl).toString();
    const safeTenant = this.escapeHtml(tenantName);
    const safeUrl = this.escapeHtml(invitationUrl);
    const subject = (item.subject ?? `Invitation to join ${tenantName}`).replaceAll('\r', ' ').replaceAll('\n', ' ').slice(0, 160);
    const text = `You have been invited to join ${tenantName}. Open this link to accept the invitation: ${invitationUrl}`;
    const html = `<p>You have been invited to join <strong>${safeTenant}</strong>.</p><p><a href="${safeUrl}">Accept invitation</a></p><p>This link expires in seven days and can only be used once.</p>`;
    await this.transporter.sendMail({
      from: process.env.FSB_EMAIL_FROM, to: item.recipient, subject, text, html,
      messageId: `<fsb-${item.id}@${baseUrl.hostname}>`,
    });
    return true;
  }

  private async processBatch() {
    if (this.busy || !this.transporter) return;
    this.busy = true;
    try {
      try {
        await this.enqueueOperationalAlertSlaEscalations();
      } catch (error) {
        this.logger.warn(`Operational alert SLA scan failed: ${String(error).slice(0, 400)}`);
      }
      const items = await this.outbox.claimBatch(this.workerId, 20);
      for (const item of items) {
        try {
          const sent = await this.send(item);
          if (sent) {
            const acknowledged = await this.outbox.markDelivered(item.id, this.workerId);
            if (!acknowledged) this.logger.warn(`Notification ${item.id} was sent but its lease could not be acknowledged`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Notification ${item.id} failed: ${message.slice(0, 300)}`);
          await this.outbox.scheduleRetry(item.id, this.workerId, error).catch(retryError => {
            this.logger.error(`Could not schedule retry for ${item.id}: ${String(retryError).slice(0, 300)}`);
          });
        }
      }
    } catch (error) {
      this.logger.error(`Notification batch failed: ${String(error).slice(0, 500)}`);
    } finally {
      this.busy = false;
    }
  }
}
