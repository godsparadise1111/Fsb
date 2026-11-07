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

  private async enqueueOverdueEscalations() {
    const candidates = await this.dataSource.query(
      `SELECT t.id AS "taskId", t.title AS "taskTitle", t."dueAt" AS "dueAt",
              pi.id AS "instanceId", pi.title AS "processTitle", pi."tenantId" AS "tenantId",
              pi."organizationId" AS "organizationId", pv.schema->'steps'->pi."currentStepIndex" AS step
         FROM workflow_tasks t
         JOIN process_instances pi ON pi.id = t."processInstanceId"
         JOIN process_versions pv ON pv.id = pi."processVersionId"
         JOIN tenants tenant ON tenant.id = pi."tenantId" AND tenant.status = 'ACTIVE'
        WHERE t.status IN ('OPEN', 'IN_PROGRESS') AND t."dueAt" IS NOT NULL
          AND jsonb_typeof(pv.schema->'steps') = 'array'
          AND COALESCE(pv.schema->'steps'->pi."currentStepIndex"->>'escalateAfterHours', '') ~ '^[0-9]+([.][0-9]+)? { id: string; tenantId: string; eventType: string; recipient: string; subject: string | null; payload: Record<string, unknown> }): Promise<boolean> {
    if (!this.transporter) throw new Error('SMTP transport is unavailable');
    const [tenant] = await this.dataSource.query('SELECT status FROM tenants WHERE id = $1', [item.tenantId]);
    if (!tenant || tenant.status !== 'ACTIVE') {
      await this.outbox.markDead(item.id, this.workerId, 'Tenant is not active; notification was not sent');
      return false;
    }
    if (item.eventType === 'workflow.sla.overdue') {
      const taskId = String(item.payload.taskId ?? '');
      const userId = String(item.payload.userId ?? '');
      const [valid] = await this.dataSource.query(
        `SELECT t.id
           FROM workflow_tasks t
           JOIN process_instances pi ON pi.id = t."processInstanceId"
           JOIN tenants tenant ON tenant.id = pi."tenantId" AND tenant.status = 'ACTIVE'
           JOIN users u ON u.id = $3 AND u."isActive" = true AND lower(u.email) = lower($4)
           JOIN tenant_memberships tm ON tm."userId" = u.id AND tm."tenantId" = pi."tenantId" AND tm."isActive" = true
          WHERE t.id = $1 AND pi."tenantId" = $2
            AND t.status IN ('OPEN', 'IN_PROGRESS') AND t."dueAt" IS NOT NULL AND t."dueAt" <= now()`,
        [taskId, item.tenantId, userId, item.recipient],
      );
      if (!valid) {
        await this.outbox.markDead(item.id, this.workerId, 'Task is no longer overdue/actionable or recipient is no longer an active tenant member');
        return false;
      }
      const taskTitle = String(item.payload.taskTitle ?? 'Workflow task');
      const processTitle = String(item.payload.processTitle ?? 'Process');
      const dueAt = String(item.payload.dueAt ?? '');
      const safeTask = this.escapeHtml(taskTitle);
      const safeProcess = this.escapeHtml(processTitle);
      const safeDue = this.escapeHtml(dueAt);
      const subject = (item.subject ?? `SLA overdue: ${taskTitle}`).replaceAll('\\r', ' ').replaceAll('\\n', ' ').slice(0, 160);
      await this.transporter.sendMail({
        from: process.env.FSB_EMAIL_FROM, to: item.recipient, subject,
        text: `The task "${taskTitle}" in process "${processTitle}" is overdue. Due at: ${dueAt}.`,
        html: `<p>The task <strong>${safeTask}</strong> in process <strong>${safeProcess}</strong> is overdue.</p><p>Due at: ${safeDue}</p>`,
        messageId: `<fsb-${item.id}@${new URL(process.env.FSB_PUBLIC_APP_URL!).hostname}>`,
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
      await this.enqueueOverdueEscalations();
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

          AND t."dueAt" + ((pv.schema->'steps'->pi."currentStepIndex"->>'escalateAfterHours')::numeric * interval '1 hour') <= now()
          AND NOT EXISTS (
            SELECT 1 FROM notification_outbox queued
             WHERE queued."tenantId" = pi."tenantId"
               AND queued."dedupeKey" LIKE ('sla:' || t.id::text || ':%')
          )
        ORDER BY t."dueAt" ASC LIMIT 100`,
    ) as Array<{ taskId: string; taskTitle: string; dueAt: Date; instanceId: string; processTitle: string; tenantId: string; organizationId: string; step: Record<string, unknown> }>;

    for (const candidate of candidates) {
      const configuredIds = Array.isArray(candidate.step?.escalationUserIds)
        ? candidate.step.escalationUserIds.filter((id): id is string => typeof id === 'string')
        : [];
      const assignees = await this.dataSource.query(
        `SELECT "userId" FROM task_assignees WHERE "taskId" = $1 AND status = 'PENDING'`,
        [candidate.taskId],
      ) as Array<{ userId: string }>;
      const recipientIds = [...new Set([...assignees.map(row => row.userId), ...configuredIds])];
      if (!recipientIds.length) continue;
      const recipients = await this.dataSource.query(
        `SELECT DISTINCT u.id AS "userId", u.email
           FROM users u
           JOIN tenant_memberships tm ON tm."userId" = u.id
             AND tm."tenantId" = $2 AND tm."isActive" = true
           JOIN user_positions up ON up."userId" = u.id AND up."isActive" = true
             AND up."validFrom" <= now() AND (up."validUntil" IS NULL OR up."validUntil" >= now())
           JOIN positions p ON p.id = up."positionId" AND p."isActive" = true
           JOIN organization_units unit ON unit.id = p."organizationUnitId"
             AND unit."organizationId" = $3 AND unit."isActive" = true
          WHERE u.id = ANY($1::uuid[]) AND u."isActive" = true`,
        [recipientIds, candidate.tenantId, candidate.organizationId],
      ) as Array<{ userId: string; email: string }>;
      if (!recipients.length) continue;
      await this.dataSource.transaction(async manager => {
        for (const recipient of recipients) {
          await this.outbox.enqueue(manager, {
            tenantId: candidate.tenantId,
            eventType: 'workflow.sla.overdue',
            recipient: recipient.email,
            subject: `SLA overdue: ${candidate.taskTitle}`,
            dedupeKey: `sla:${candidate.taskId}:${recipient.userId}`,
            payload: {
              taskId: candidate.taskId,
              taskTitle: candidate.taskTitle,
              processTitle: candidate.processTitle,
              dueAt: new Date(candidate.dueAt).toISOString(),
              userId: recipient.userId,
            },
          });
        }
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
