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

  private async send(item: { id: string; tenantId: string; eventType: string; recipient: string; subject: string | null; payload: Record<string, unknown> }): Promise<boolean> {
    if (!this.transporter) throw new Error('SMTP transport is unavailable');
    const [tenant] = await this.dataSource.query('SELECT status FROM tenants WHERE id = $1', [item.tenantId]);
    if (!tenant || tenant.status !== 'ACTIVE') {
      await this.outbox.markDead(item.id, this.workerId, 'Tenant is not active; notification was not sent');
      return false;
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
