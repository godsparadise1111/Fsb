import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant } from './entities/tenant.entity';

@Injectable()
export class TenantReportsService {
  constructor(private readonly dataSource: DataSource) {}

  private parseDate(value: string | undefined, fallback: Date, name: string) {
    if (!value) return fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${name} must use YYYY-MM-DD`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${name} is not a valid calendar date`);
    return date;
  }

  async overview(tenantId: string, options: { from?: string; to?: string; organizationId?: string }) {
    const tenant = await this.dataSource.getRepository(Tenant).findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'ACTIVE') throw new BadRequestException('Reports are available only for active tenants');

    const now = new Date();
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const defaultFrom = new Date(defaultTo.getTime() - 30 * 86400000);
    const from = this.parseDate(options.from, defaultFrom, 'from');
    const to = this.parseDate(options.to, defaultTo, 'to');
    if (from >= to) throw new BadRequestException('from must be earlier than to');
    if (to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException('Report range cannot exceed 366 days');

    if (options.organizationId) {
      const [owned] = await this.dataSource.query(
        'SELECT id FROM organizations WHERE id = $1 AND "tenantId" = $2 AND "isActive" = true',
        [options.organizationId, tenantId],
      );
      if (!owned) throw new NotFoundException('Organization not found in this customer account');
    }

    const orgFilter = options.organizationId ?? null;
    const [summary] = await this.dataSource.query(
      `SELECT
        count(*) FILTER (WHERE pi.status = 'RUNNING')::int AS "runningInstances",
        count(*) FILTER (WHERE pi.status = 'COMPLETED')::int AS "completedInstances",
        count(*) FILTER (WHERE pi.status = 'CANCELLED')::int AS "cancelledInstances",
        count(*)::int AS "startedInstances",
        round((avg(EXTRACT(EPOCH FROM (pi."completedAt" - pi."startedAt")) / 3600)
          FILTER (WHERE pi.status = 'COMPLETED' AND pi."completedAt" IS NOT NULL))::numeric, 2) AS "averageCompletionHours",
        count(DISTINCT pi."startedByUserId")::int AS "uniqueStarters"
       FROM process_instances pi
       INNER JOIN organizations o ON o.id = pi."organizationId"
       WHERE o."tenantId" = $1 AND pi."startedAt" >= $2 AND pi."startedAt" < $3
         AND ($4::uuid IS NULL OR pi."organizationId" = $4)`,
      [tenantId, from, to, orgFilter],
    );

    const tasks = await this.dataSource.query(
      `SELECT wt.status, count(*)::int AS count
         FROM workflow_tasks wt
         INNER JOIN process_instances pi ON pi.id = wt."processInstanceId"
         INNER JOIN organizations o ON o.id = pi."organizationId"
        WHERE o."tenantId" = $1 AND wt."createdAt" >= $2 AND wt."createdAt" < $3
          AND ($4::uuid IS NULL OR pi."organizationId" = $4)
        GROUP BY wt.status ORDER BY wt.status`,
      [tenantId, from, to, orgFilter],
    );

    const daily = await this.dataSource.query(
      `WITH days AS (
         SELECT generate_series(date_trunc('day', $2::timestamptz),
                                date_trunc('day', $3::timestamptz - interval '1 millisecond'),
                                interval '1 day') AS day
       )
       SELECT days.day::date::text AS day,
              count(pi.id) FILTER (WHERE pi."startedAt" >= days.day AND pi."startedAt" < days.day + interval '1 day')::int AS started,
              count(pi.id) FILTER (WHERE pi."completedAt" >= days.day AND pi."completedAt" < days.day + interval '1 day')::int AS completed
         FROM days
         LEFT JOIN process_instances pi ON (
           (pi."startedAt" >= days.day AND pi."startedAt" < days.day + interval '1 day')
           OR (pi."completedAt" >= days.day AND pi."completedAt" < days.day + interval '1 day')
         ) AND EXISTS (
           SELECT 1 FROM organizations o
            WHERE o.id = pi."organizationId" AND o."tenantId" = $1
              AND ($4::uuid IS NULL OR pi."organizationId" = $4)
         )
        GROUP BY days.day ORDER BY days.day`,
      [tenantId, from, to, orgFilter],
    );

    const taskAging = await this.dataSource.query(
      `SELECT
         count(*) FILTER (WHERE wt.status IN ('OPEN', 'IN_PROGRESS'))::int AS "openTasks",
         count(*) FILTER (WHERE wt.status IN ('OPEN', 'IN_PROGRESS') AND wt."dueAt" IS NOT NULL AND wt."dueAt" < now())::int AS "overdueTasks",
         count(*) FILTER (WHERE wt.status IN ('OPEN', 'IN_PROGRESS') AND wt."createdAt" < now() - interval '3 days')::int AS "olderThan3Days",
         count(*) FILTER (WHERE wt.status IN ('OPEN', 'IN_PROGRESS') AND wt."createdAt" < now() - interval '7 days')::int AS "olderThan7Days",
         count(*) FILTER (WHERE wt.status IN ('OPEN', 'IN_PROGRESS') AND wt."createdAt" < now() - interval '14 days')::int AS "olderThan14Days",
         round((avg(EXTRACT(EPOCH FROM (now() - wt."createdAt")) / 3600)
           FILTER (WHERE wt.status IN ('OPEN', 'IN_PROGRESS')))::numeric, 1) AS "averageOpenHours"
       FROM workflow_tasks wt
       INNER JOIN process_instances pi ON pi.id = wt."processInstanceId"
       INNER JOIN organizations o ON o.id = pi."organizationId"
       WHERE o."tenantId" = $1 AND ($2::uuid IS NULL OR pi."organizationId" = $2)`,
      [tenantId, orgFilter],
    );

    const oldestOpenTasks = await this.dataSource.query(
      `SELECT wt.id AS "taskId", wt.title, wt.status, wt."createdAt", wt."dueAt", (wt."dueAt" IS NOT NULL AND wt."dueAt" < now()) AS overdue,
              pi.id AS "processInstanceId", pi.title AS "processTitle",
              o.id AS "organizationId", o.name AS "organizationName",
              round((EXTRACT(EPOCH FROM (now() - wt."createdAt")) / 3600)::numeric, 1) AS "ageHours"
         FROM workflow_tasks wt
         INNER JOIN process_instances pi ON pi.id = wt."processInstanceId"
         INNER JOIN organizations o ON o.id = pi."organizationId"
        WHERE o."tenantId" = $1 AND wt.status IN ('OPEN', 'IN_PROGRESS')
          AND ($2::uuid IS NULL OR pi."organizationId" = $2)
        ORDER BY wt."createdAt" ASC LIMIT 20`,
      [tenantId, orgFilter],
    );

    const byOrganization = await this.dataSource.query(
      `SELECT o.id AS "organizationId", o.name AS "organizationName",
              count(pi.id)::int AS started,
              count(pi.id) FILTER (WHERE pi.status = 'COMPLETED')::int AS completed,
              count(pi.id) FILTER (WHERE pi.status = 'RUNNING')::int AS running
         FROM organizations o
         LEFT JOIN process_instances pi ON pi."organizationId" = o.id
           AND pi."startedAt" >= $2 AND pi."startedAt" < $3
        WHERE o."tenantId" = $1 AND o."isActive" = true
          AND ($4::uuid IS NULL OR o.id = $4)
        GROUP BY o.id, o.name ORDER BY started DESC, o.name ASC LIMIT 100`,
      [tenantId, from, to, orgFilter],
    );

    return {
      tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan },
      period: { from: from.toISOString(), to: to.toISOString() },
      filters: { organizationId: orgFilter },
      processInstances: {
        started: Number(summary.startedInstances ?? 0),
        running: Number(summary.runningInstances ?? 0),
        completed: Number(summary.completedInstances ?? 0),
        cancelled: Number(summary.cancelledInstances ?? 0),
        averageCompletionHours: summary.averageCompletionHours == null ? null : Number(summary.averageCompletionHours),
        uniqueStarters: Number(summary.uniqueStarters ?? 0),
      },
      tasksByStatus: tasks.map((item: any) => ({ status: item.status, count: Number(item.count) })),
      taskAging: {
        openTasks: Number(taskAging[0]?.openTasks ?? 0),
        overdueTasks: Number(taskAging[0]?.overdueTasks ?? 0),
        olderThan3Days: Number(taskAging[0]?.olderThan3Days ?? 0),
        olderThan7Days: Number(taskAging[0]?.olderThan7Days ?? 0),
        olderThan14Days: Number(taskAging[0]?.olderThan14Days ?? 0),
        averageOpenHours: taskAging[0]?.averageOpenHours == null ? null : Number(taskAging[0].averageOpenHours),
        oldestOpenTasks: oldestOpenTasks.map((item: any) => ({
          taskId: item.taskId, title: item.title, status: item.status,
          createdAt: item.createdAt, dueAt: item.dueAt, overdue: item.overdue,
          processInstanceId: item.processInstanceId, processTitle: item.processTitle,
          organizationId: item.organizationId, organizationName: item.organizationName,
          ageHours: Number(item.ageHours),
        })),
      },
      dailyThroughput: daily.map((item: any) => ({ day: item.day, started: Number(item.started), completed: Number(item.completed) })),
      organizations: byOrganization.map((item: any) => ({
        organizationId: item.organizationId, organizationName: item.organizationName,
        started: Number(item.started), completed: Number(item.completed), running: Number(item.running),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async overviewCsv(tenantId: string, options: { from?: string; to?: string; organizationId?: string }) {
    const report = await this.overview(tenantId, options);
    const cell = (value: unknown) => {
      let text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
      const first = text.trimStart()[0];
      if ((first !== undefined && '=+-@'.includes(first)) || text.startsWith('\t') || text.startsWith('\r')) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const lines: string[][] = [
      ['بخش', 'شاخص', 'مقدار'],
      ['اطلاعات گزارش', 'مشتری', report.tenant.name],
      ['اطلاعات گزارش', 'از تاریخ', report.period.from],
      ['اطلاعات گزارش', 'تا تاریخ (غیرشامل)', report.period.to],
      ['فرایندها', 'شروع‌شده', String(report.processInstances.started)],
      ['فرایندها', 'در جریان', String(report.processInstances.running)],
      ['فرایندها', 'تکمیل‌شده', String(report.processInstances.completed)],
      ['فرایندها', 'لغوشده', String(report.processInstances.cancelled)],
      ['فرایندها', 'میانگین زمان تکمیل (ساعت)', String(report.processInstances.averageCompletionHours ?? '')],
      ['فرایندها', 'آغازکنندگان یکتا', String(report.processInstances.uniqueStarters)],
      ['وظایف باز', 'کل', String(report.taskAging.openTasks)],
      ['وظایف باز', 'مهلت‌گذشته', String(report.taskAging.overdueTasks)],
      ['وظایف باز', 'قدیمی‌تر از ۳ روز', String(report.taskAging.olderThan3Days)],
      ['وظایف باز', 'قدیمی‌تر از ۷ روز', String(report.taskAging.olderThan7Days)],
      ['وظایف باز', 'قدیمی‌تر از ۱۴ روز', String(report.taskAging.olderThan14Days)],
      ['وظایف باز', 'میانگین سن (ساعت)', String(report.taskAging.averageOpenHours ?? '')],
    ];
    for (const item of report.tasksByStatus) lines.push(['وضعیت وظایف', item.status, String(item.count)]);
    for (const item of report.dailyThroughput) {
      lines.push(['روند روزانه', `${item.day} - شروع`, String(item.started)]);
      lines.push(['روند روزانه', `${item.day} - تکمیل`, String(item.completed)]);
    }
    for (const item of report.organizations) {
      lines.push(['سازمان', `${item.organizationName} - شروع`, String(item.started)]);
      lines.push(['سازمان', `${item.organizationName} - تکمیل`, String(item.completed)]);
      lines.push(['سازمان', `${item.organizationName} - در جریان`, String(item.running)]);
    }
    for (const item of report.taskAging.oldestOpenTasks) {
      lines.push(['وظایف قدیمی', item.taskId, `${item.title} | ${item.organizationName} | ${item.ageHours} ساعت | ${item.overdue ? 'مهلت‌گذشته' : 'در مهلت'}`]);
    }
    return '\uFEFF' + lines.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }

}
