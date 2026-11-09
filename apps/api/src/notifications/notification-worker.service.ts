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
              CASE WHEN a."acknowledgedAt" IS NULL AND a."responseDueAt" <= now() THEN 'RESPONSE'
                   WHEN a."resolutionDueAt" <= now() THEN 'RESOLUTION' END AS stage
         FROM organization_operational_alerts a
         JOIN tenants t ON t.id=a."tenantId" AND t.status='ACTIVE'
        WHERE a.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')
          AND ((a."acknowledgedAt" IS NULL AND a."responseDueAt" <= now())
            OR a."resolutionDueAt" <= now())
        ORDER BY a."resolutionDueAt" ASC NULLS LAST LIMIT 100`,
    ) as Array<{id:string;tenantId:string;organizationId:string;title:string;severity:string;status:string;assignedToUserId:string|null;responseDueAt:Date|null;resolutionDueAt:Date|null;stage:string}>;
    for (const candidate of candidates) {
      await this.dataSource.transaction(async manager => {
        const [alert] = await manager.query(
          `SELECT * FROM organization_operational_alerts
            WHERE id=$1 AND "tenantId"=$2 AND "organizationId"=$3
              AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')
            FOR UPDATE`,
          [candidate.id,candidate.tenantId,candidate.organizationId],
        );
        if (!alert) return;
        const stage = alert."acknowledgedAt" == null && alert.responseDueAt && new Date(alert.responseDueAt) <= new Date()
          ? 'RESPONSE'
          : alert.resolutionDueAt && new Date(alert.resolutionDueAt) <= new Date() ? 'RESOLUTION' : null;
        if (!stage) return;
        const recipients = await manager.query(
          `SELECT DISTINCT u.id AS "userId",u.email,'ASSIGNEE' AS audience
             FROM users u
             JOIN tenant_memberships tm ON tm."userId"=u.id AND tm."tenantId"=$1 AND tm."isActive"=true
            WHERE u.id=$2 AND u."isActive"=true AND u.email IS NOT NULL
              AND $3::uuid IS NOT NULL
           UNION
           SELECT DISTINCT u.id AS "userId",u.email,'MANAGER' AS audience
             FROM user_roles ur
             JOIN roles r ON r.id=ur."roleId" AND r."isActive"=true AND r.scope='ORGANIZATION'
             JOIN role_permissions rp ON rp."roleId"=r.id
             JOIN permissions p ON p.id=rp."permissionId" AND p.code='workflow.substitutions.manage'
             JOIN users u ON u.id=ur."userId" AND u."isActive"=true AND u.email IS NOT NULL
             JOIN tenant_memberships tm ON tm."userId"=u.id AND tm."tenantId"=$1 AND tm."isActive"=true
            WHERE ur."organizationId"=$4 AND ur."isActive"=true`,
          [alert.tenantId,alert.assignedToUserId,alert.assignedToUserId,alert.organizationId],
        ) as Array<{userId:string;email:string;audience:'ASSIGNEE'|'MANAGER'}>;
        for (const recipient of recipients) {
          const dedupeKey = recipient.audience === 'ASSIGNEE'
            ? `alert-sla:${alert.id}:${stage}:${recipient.userId}`
            : `alert-sla-manager:${alert.id}:${stage}:${recipient.userId}`;
          await this.outbox.enqueue(manager, {
            tenantId: alert.tenantId,
            eventType: 'organization.alert.sla.breached',
            recipient: recipient.email,
            subject: recipient.audience === 'MANAGER'
              ? `Escalated operational alert: ${alert.title}`
              : `Operational alert SLA breached: ${alert.title}`,
            dedupeKey,
            payload: {
              alertId: alert.id, organizationId: alert.organizationId, title: alert.title,
              severity: alert.severity, stage, userId: recipient.userId, audience: recipient.audience,
              responseDueAt: alert.responseDueAt ? new Date(alert.responseDueAt).toISOString() : null,
              resolutionDueAt: alert.resolutionDueAt ? new Date(alert.resolutionDueAt).toISOString() : null,
            },
          });
        }
        const eventDedupe = `alert-sla-escalation:${alert.id}:${stage}`;
        await manager.query(
          `INSERT INTO organization_operational_alert_events ("tenantId","organizationId","alertId","actorUserId","eventType","fromStatus","toStatus","note","dedupeKey")
           VALUES ($1,$2,$3,NULL,'SLA_ESCALATION',$4,$4,$5,$6)
           ON CONFLICT ("tenantId","dedupeKey") DO NOTHING`,
          [alert.tenantId,alert.organizationId,alert.id,alert.status,
           stage === 'RESPONSE' ? 'هشدار به مسئولان سازمان ارجاع تشدیدی شد؛ مهلت پاسخ نقض شده است.' : 'هشدار به مسئولان سازمان ارجاع تشدیدی شد؛ مهلت حل نقض شده است.',eventDedupe],
        );
        await manager.query(
          `UPDATE organization_operational_alerts
              SET "escalatedAt"=COALESCE("escalatedAt",now()),
                  "escalationLevel"=GREATEST("escalationLevel",CASE WHEN $2='RESPONSE' THEN 1 ELSE 2 END),
                  "updatedAt"=now()
            WHERE id=$1 AND "tenantId"=$3`,
          [alert.id,stage,alert.tenantId],
        );
      });
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
      const audience = String(item.payload.audience ?? 'ASSIGNEE');
      const organizationId = String(item.payload.organizationId ?? '');
      const [valid] = await this.dataSource.query(
        audience === 'MANAGER'
          ? `SELECT a.id FROM organization_operational_alerts a
              JOIN users u ON u.id=$3 AND u."isActive"=true AND lower(u.email)=lower($4)
              JOIN tenant_memberships tm ON tm."userId"=u.id AND tm."tenantId"=a."tenantId" AND tm."isActive"=true
              JOIN user_roles ur ON ur."userId"=u.id AND ur."organizationId"=a."organizationId" AND ur."isActive"=true
              JOIN roles r ON r.id=ur."roleId" AND r."isActive"=true AND r.scope='ORGANIZATION'
              JOIN role_permissions rp ON rp."roleId"=r.id
              JOIN permissions p ON p.id=rp."permissionId" AND p.code='workflow.substitutions.manage'
             WHERE a.id=$1 AND a."tenantId"=$2 AND a."organizationId"=$5
               AND a.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`
          : `SELECT a.id FROM organization_operational_alerts a
              JOIN users u ON u.id=$3 AND u."isActive"=true AND lower(u.email)=lower($4)
              JOIN tenant_memberships tm ON tm."userId"=u.id AND tm."tenantId"=a."tenantId" AND tm."isActive"=true
             WHERE a.id=$1 AND a."tenantId"=$2 AND a."assignedToUserId"=u.id
               AND a.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`,
        audience === 'MANAGER' ? [alertId,item.tenantId,userId,item.recipient,organizationId] : [alertId,item.tenantId,userId,item.recipient],
      );
      if (!valid) {
        await this.outbox.markDead(item.id,this.workerId,'Alert is closed or escalation recipient is no longer an active tenant organization manager');
        return false;
      }
      const title=String(item.payload.title ?? 'Operational alert');
      const stage=String(item.payload.stage ?? 'SLA');
      const due=String(stage==='RESPONSE' ? item.payload.responseDueAt ?? '' : item.payload.resolutionDueAt ?? '');
      const safeTitle=this.escapeHtml(title), safeDue=this.escapeHtml(due);
      const subject=(item.subject ?? 'Operational alert SLA breached').replaceAll('\\r',' ').replaceAll('\\n',' ').slice(0,160);
      const audienceLabel = audience === 'MANAGER' ? 'management escalation' : 'assigned owner notification';
      await this.transporter.sendMail({
        from:process.env.FSB_EMAIL_FROM,to:item.recipient,subject,
        text:`The operational alert "${title}" has breached its ${stage.toLowerCase()} deadline (${audienceLabel}). Deadline: ${due}`,
        html:`<p>The operational alert <strong>${safeTitle}</strong> has breached its ${stage.toLowerCase()} deadline (${audienceLabel}).</p><p>Deadline: ${safeDue}</p>`,
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
