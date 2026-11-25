import type { Transporter } from 'nodemailer';
import type { DataSource } from 'typeorm';
import type { NotificationOutboxService } from './notification-outbox.service';

export const PASSWORD_RESET_EVENT = 'auth.password.reset.requested';

export interface PasswordResetDeliveryContext {
  dataSource: DataSource;
  transporter: Transporter;
  outbox: NotificationOutboxService;
  workerId: string;
  escapeHtml: (value: string) => string;
}

export interface PasswordResetDeliveryItem {
  id: string;
  tenantId: string;
  recipient: string;
  subject: string | null;
  payload: Record<string, unknown>;
}

/**
 * Sends a password reset e-mail. Returns true when the mail was handed to SMTP.
 * The notification is marked DEAD (never retried) when the reset is no longer usable, so a stale
 * link is never mailed after the token was consumed, expired or the account was disabled.
 */
export async function deliverPasswordReset(ctx: PasswordResetDeliveryContext, item: PasswordResetDeliveryItem): Promise<boolean> {
  const resetId = String(item.payload.resetId ?? '');
  const resetPath = String(item.payload.resetPath ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(resetId) || !resetPath.startsWith('/reset-password?token=')) {
    await ctx.outbox.markDead(item.id, ctx.workerId, 'Password reset notification payload is invalid');
    return false;
  }
  const [valid] = await ctx.dataSource.query(
    `SELECT r.id
       FROM auth_password_resets r
       JOIN users u ON u.id = r."userId" AND u."isActive" = true AND lower(u.email) = lower($3)
       JOIN tenant_memberships tm ON tm."userId" = u.id AND tm."tenantId" = $2 AND tm."isActive" = true
      WHERE r.id = $1 AND r."usedAt" IS NULL AND r."expiresAt" > now()`,
    [resetId, item.tenantId, item.recipient],
  );
  if (!valid) {
    await ctx.outbox.markDead(item.id, ctx.workerId, 'Password reset is expired, already used, or the account is no longer eligible');
    return false;
  }
  const baseUrl = new URL(process.env.FSB_PUBLIC_APP_URL!);
  const link = new URL(resetPath, baseUrl).toString();
  const safeLink = ctx.escapeHtml(link);
  const subject = (item.subject ?? 'Reset your F-S password').replace(/[\r\n]/g, ' ').slice(0, 160);
  await ctx.transporter.sendMail({
    from: process.env.FSB_EMAIL_FROM,
    to: item.recipient,
    subject,
    text: `A password reset was requested for your F-S account. Open this link within 30 minutes to choose a new password: ${link}\n\nIf you did not request this, ignore this message; your password stays unchanged.`,
    html: `<p>A password reset was requested for your F-S account.</p><p><a href="${safeLink}">Choose a new password</a></p><p>The link works once and expires in 30 minutes. If you did not request it, ignore this message; your password stays unchanged.</p>`,
    messageId: `<fsb-${item.id}@${baseUrl.hostname}>`,
  });
  return true;
}
