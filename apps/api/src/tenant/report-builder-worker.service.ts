import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'node:os';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ReportBuilderService, ReportSpec, ReportAccessScope } from './report-builder.service';
import { nextReportScheduleAt, ReportScheduleFrequency } from './report-schedule-time';
import { NotificationOutboxService } from '../notifications/notification-outbox.service';

type ReportJobRow = {
  id: string; tenantId: string; ownerUserId: string; organizationId: string | null; config: ReportSpec;
  scopeOrganizationIds: string[] | string; isTenantWide: boolean; scheduleId: string | null;
  attempts: number;
};

@Injectable()
export class ReportBuilderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportBuilderWorker.name);
  private readonly workerId = ('fsb-reports-' + hostname().replace(/[^a-zA-Z0-9.-]/g, '-') + '-' + process.pid).slice(0, 120);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly reports: ReportBuilderService,
    private readonly outbox: NotificationOutboxService,
  ) {}

  onModuleInit() {
    if (process.env.FSB_REPORT_WORKER_ENABLED !== 'true') return;
    const requested = Number(process.env.FSB_REPORT_POLL_MS ?? 5000);
    const interval = Number.isFinite(requested) ? Math.min(60000, Math.max(1000, requested)) : 5000;
    this.timer = setInterval(() => void this.processBatch(), interval);
    this.timer.unref();
    void this.processBatch();
    this.logger.log('Report worker started; polling every ' + interval + 'ms');
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async enqueueDueSchedules() {
    const due = await this.dataSource.transaction(async manager => {
      const rows = await manager.query(
        'SELECT * FROM tenant_report_schedules WHERE "isActive"=true AND "nextRunAt"<=now() ORDER BY "nextRunAt" FOR UPDATE SKIP LOCKED LIMIT 20',
      );
      const created: Array<{ id: string; tenantId: string; ownerUserId: string; scheduleId: string }> = [];
      for (const schedule of rows) {
        const scheduledFor = new Date(schedule.nextRunAt);
        const membership = await manager.query(
          'SELECT u.email FROM tenant_memberships tm JOIN users u ON u.id=tm."userId" AND u."isActive"=true WHERE tm."tenantId"=$1 AND tm."userId"=$2 AND tm."isActive"=true AND u.email IS NOT NULL',
          [schedule.tenantId, schedule.ownerUserId],
        );
        if (!membership.length) {
          await manager.query('UPDATE tenant_report_schedules SET "isActive"=false,"updatedAt"=now() WHERE id=$1', [schedule.id]);
          continue;
        }
        const [job] = await manager.query(
          'INSERT INTO tenant_report_jobs ("tenantId","ownerUserId","organizationId",config,"scopeOrganizationIds","isTenantWide",status,"scheduleId","scheduledFor") VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,\'PENDING\',$7,$8) ON CONFLICT ("scheduleId","scheduledFor") DO NOTHING RETURNING id',
          [schedule.tenantId, schedule.ownerUserId, schedule.organizationId, JSON.stringify(schedule.config), JSON.stringify(schedule.scopeOrganizationIds), schedule.isTenantWide === true, schedule.id, scheduledFor],
        );
        const next = nextReportScheduleAt(schedule.frequency as ReportScheduleFrequency, String(schedule.timeOfDay).slice(0, 5), schedule.timezone, schedule.weekday === null ? null : Number(schedule.weekday), new Date());
        await manager.query(
          'UPDATE tenant_report_schedules SET "lastRunAt"=$2,"lastJobId"=COALESCE($3,"lastJobId"),"nextRunAt"=$4,"updatedAt"=now() WHERE id=$1',
          [schedule.id, scheduledFor, job?.id ?? null, next],
        );
        if (job?.id) created.push({ id: job.id, tenantId: schedule.tenantId, ownerUserId: schedule.ownerUserId, scheduleId: schedule.id });
      }
      return created;
    });
    if (due.length) this.logger.log('Queued ' + due.length + ' scheduled report run(s)');
  }

  private async claimJobs(): Promise<ReportJobRow[]> {
    return this.dataSource.transaction(async manager => {
      await manager.query(
        'UPDATE tenant_report_jobs SET status=CASE WHEN attempts>=5 THEN \'FAILED\' ELSE \'PENDING\' END,"lockedBy"=NULL,"lockedAt"=NULL,error=COALESCE(error,\'Worker lease expired\'),"updatedAt"=now() WHERE status=\'PROCESSING\' AND "lockedAt"<now()-interval \'5 minutes\'',
      );
      return manager.query(
        'WITH candidates AS (SELECT id FROM tenant_report_jobs WHERE status=\'PENDING\' AND "availableAt"<=now() AND attempts<5 ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 2) UPDATE tenant_report_jobs j SET status=\'PROCESSING\',"lockedBy"=$1,"lockedAt"=now(),"startedAt"=COALESCE(j."startedAt",now()),attempts=j.attempts+1,"updatedAt"=now() FROM candidates c WHERE j.id=c.id RETURNING j.*',
        [this.workerId],
      );
    });
  }

  private async notifySchedule(manager: EntityManager, job: ReportJobRow, result: { rowCount: number; sourceLabel: string }) {
    if (!job.scheduleId) return;
    const [recipient] = await manager.query(
      'SELECT u.email FROM tenant_memberships tm JOIN users u ON u.id=tm."userId" AND u."isActive"=true WHERE tm."tenantId"=$1 AND tm."userId"=$2 AND tm."isActive"=true AND u.email IS NOT NULL',
      [job.tenantId, job.ownerUserId],
    );
    if (!recipient?.email) return;
    const dedupeKey = createHash('sha256').update('report-schedule:' + job.scheduleId + ':' + job.id).digest('hex');
    await this.outbox.enqueue(manager, {
      tenantId: job.tenantId,
      eventType: 'report.schedule.completed',
      recipient: recipient.email,
      subject: 'گزارش زمان‌بندی‌شده آماده است',
      dedupeKey,
      payload: { jobId: job.id, organizationId: job.organizationId, reportTitle: 'گزارش زمان‌بندی‌شده', sourceLabel: result.sourceLabel, rowCount: result.rowCount },
    });
  }

  private async processJob(job: ReportJobRow) {
    try {
      const verifiedScope = await this.reports.resolveScope(job.tenantId, job.ownerUserId, job.organizationId ?? undefined);
      const scope: ReportAccessScope = { ...verifiedScope, executionTimeoutMs: 60000 };
      const result = await this.reports.execute(job.tenantId, job.config, scope);
      await this.dataSource.transaction(async manager => {
        const updated = await manager.query(
          'UPDATE tenant_report_jobs SET status=\'COMPLETED\',result=$3::jsonb,error=NULL,"lockedBy"=NULL,"lockedAt"=NULL,"completedAt"=now(),"updatedAt"=now() WHERE id=$1 AND status=\'PROCESSING\' AND "lockedBy"=$2 RETURNING id',
          [job.id, this.workerId, JSON.stringify(result)],
        );
        if (updated.length) await this.notifySchedule(manager, job, result);
      });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1500);
      const forbidden = error instanceof ForbiddenException;
      const retry = !forbidden && job.attempts < 5;
      const delay = Math.min(3600, 30 * (2 ** Math.max(0, job.attempts - 1)));
      if (forbidden && job.scheduleId) await this.dataSource.query('UPDATE tenant_report_schedules SET "isActive"=false,"updatedAt"=now() WHERE id=$1', [job.scheduleId]);
      await this.dataSource.query(
        'UPDATE tenant_report_jobs SET status=$3,error=$4,"availableAt"=now()+($5 * interval \'1 second\'),"lockedBy"=NULL,"lockedAt"=NULL,"updatedAt"=now() WHERE id=$1 AND status=\'PROCESSING\' AND "lockedBy"=$2',
        [job.id, this.workerId, retry ? 'PENDING' : 'FAILED', message, delay],
      );
      this.logger.warn('Report job ' + job.id + ' failed: ' + message.slice(0, 300));
    }
  }

  private async processBatch() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.dataSource.query("DELETE FROM tenant_report_cache WHERE id IN (SELECT id FROM tenant_report_cache WHERE \"expiresAt\"<now() ORDER BY \"expiresAt\" LIMIT 250)");
      await this.enqueueDueSchedules();
      const jobs = await this.claimJobs();
      for (const job of jobs) await this.processJob(job);
    } catch (error) {
      this.logger.error('Report worker batch failed: ' + String(error).slice(0, 500));
    } finally {
      this.busy = false;
    }
  }
}
