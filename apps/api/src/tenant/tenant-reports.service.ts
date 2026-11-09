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

    const stagePerformance = await this.dataSource.query(
      `SELECT pd.name AS "processName", wt.title AS "stageName",
              count(*) FILTER (WHERE wt.status = 'COMPLETED' AND wt."completedAt" IS NOT NULL)::int AS "completedTasks",
              round((avg(EXTRACT(EPOCH FROM (wt."completedAt" - wt."createdAt")) / 3600)
                FILTER (WHERE wt.status = 'COMPLETED' AND wt."completedAt" IS NOT NULL))::numeric, 2) AS "averageCycleHours",
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (wt."completedAt" - wt."createdAt")) / 3600)
                FILTER (WHERE wt.status = 'COMPLETED' AND wt."completedAt" IS NOT NULL))::numeric, 2) AS "medianCycleHours",
              round((percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (wt."completedAt" - wt."createdAt")) / 3600)
                FILTER (WHERE wt.status = 'COMPLETED' AND wt."completedAt" IS NOT NULL))::numeric, 2) AS "p90CycleHours",
              count(*) FILTER (WHERE wt.status = 'COMPLETED' AND wt."dueAt" IS NOT NULL
                AND wt."completedAt" > wt."dueAt")::int AS "completedLate",
              count(*) FILTER (WHERE wt.status IN ('OPEN', 'IN_PROGRESS'))::int AS "currentlyOpen",
              count(*) FILTER (WHERE wt.status IN ('OPEN', 'IN_PROGRESS') AND wt."dueAt" IS NOT NULL
                AND wt."dueAt" < now())::int AS "currentlyOverdue"
         FROM workflow_tasks wt
         INNER JOIN process_instances pi ON pi.id = wt."processInstanceId"
         INNER JOIN process_versions pv ON pv.id = pi."processVersionId"
         INNER JOIN process_definitions pd ON pd.id = pv."definitionId"
         INNER JOIN organizations o ON o.id = pi."organizationId"
        WHERE o."tenantId" = $1 AND wt."createdAt" >= $2 AND wt."createdAt" < $3
          AND ($4::uuid IS NULL OR pi."organizationId" = $4)
        GROUP BY pd.name, wt.title
        ORDER BY COALESCE(avg(EXTRACT(EPOCH FROM (wt."completedAt" - wt."createdAt")) / 3600)
          FILTER (WHERE wt.status = 'COMPLETED' AND wt."completedAt" IS NOT NULL), 0) DESC,
          "currentlyOverdue" DESC, "currentlyOpen" DESC
        LIMIT 50`,
      [tenantId, from, to, orgFilter],
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
      stagePerformance: stagePerformance.map((item: any) => ({
        processName: item.processName, stageName: item.stageName,
        completedTasks: Number(item.completedTasks),
        averageCycleHours: item.averageCycleHours == null ? null : Number(item.averageCycleHours),
        medianCycleHours: item.medianCycleHours == null ? null : Number(item.medianCycleHours),
        p90CycleHours: item.p90CycleHours == null ? null : Number(item.p90CycleHours),
        completedLate: Number(item.completedLate),
        currentlyOpen: Number(item.currentlyOpen),
        currentlyOverdue: Number(item.currentlyOverdue),
      })),
      organizations: byOrganization.map((item: any) => ({
        organizationId: item.organizationId, organizationName: item.organizationName,
        started: Number(item.started), completed: Number(item.completed), running: Number(item.running),
      })),
      generatedAt: new Date().toISOString(),
    };
  }


  async operationalAlertSla(tenantId: string, options: { from?: string; to?: string; organizationId?: string }) {
    const tenant = await this.dataSource.getRepository(Tenant).findOne({ where: { id: tenantId } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new NotFoundException('Active tenant not found');
    const now = new Date();
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const defaultFrom = new Date(defaultTo.getTime() - 30 * 86400000);
    const from = this.parseDate(options.from, defaultFrom, 'from');
    const to = this.parseDate(options.to, defaultTo, 'to');
    if (from >= to || to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException('Invalid report range; maximum is 366 days');
    const organizationId = options.organizationId ?? null;
    if (organizationId) {
      const [owned] = await this.dataSource.query('SELECT id FROM organizations WHERE id=$1 AND "tenantId"=$2 AND "isActive"=true',[organizationId,tenantId]);
      if (!owned) throw new NotFoundException('Organization not found in this tenant');
    }
    const [summary] = await this.dataSource.query(
      `SELECT count(*)::int AS "totalAlerts",
        count(*) FILTER (WHERE "acknowledgedAt" IS NOT NULL AND "responseDueAt" IS NOT NULL)::int AS "responded",
        count(*) FILTER (WHERE "responseDueAt" IS NOT NULL AND ("acknowledgedAt" IS NOT NULL OR "responseDueAt"<now()))::int AS "responseEligible",
        count(*) FILTER (WHERE "responseDueAt" IS NOT NULL AND "acknowledgedAt" IS NOT NULL AND "acknowledgedAt"<="responseDueAt")::int AS "responseMet",
        count(*) FILTER (WHERE ("acknowledgedAt" IS NULL AND "responseDueAt"<now()) OR "acknowledgedAt">"responseDueAt")::int AS "responseBreached",
        count(*) FILTER (WHERE "resolvedAt" IS NOT NULL AND "resolutionDueAt" IS NOT NULL)::int AS "resolved",
        count(*) FILTER (WHERE "resolutionDueAt" IS NOT NULL AND ("resolvedAt" IS NOT NULL OR "resolutionDueAt"<now()))::int AS "resolutionEligible",
        count(*) FILTER (WHERE "resolutionDueAt" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolvedAt"<="resolutionDueAt")::int AS "resolutionMet",
        count(*) FILTER (WHERE ("resolvedAt" IS NULL AND "resolutionDueAt"<now()) OR "resolvedAt">"resolutionDueAt")::int AS "resolutionBreached",
        round(avg(EXTRACT(EPOCH FROM ("acknowledgedAt"-"firstDetectedAt"))/60) FILTER (WHERE "acknowledgedAt">="firstDetectedAt")::numeric,2) AS "averageResponseMinutes",
        round(avg(EXTRACT(EPOCH FROM ("resolvedAt"-"firstDetectedAt"))/3600) FILTER (WHERE "resolvedAt">="firstDetectedAt")::numeric,2) AS "averageResolutionHours",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("acknowledgedAt"-"firstDetectedAt"))/60)
          FILTER (WHERE "acknowledgedAt">="firstDetectedAt") AS "medianResponseMinutes",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("resolvedAt"-"firstDetectedAt"))/3600)
          FILTER (WHERE "resolvedAt">="firstDetectedAt") AS "medianResolutionHours"
       FROM organization_operational_alerts
       WHERE "tenantId"=$1 AND "firstDetectedAt">=$2 AND "firstDetectedAt"<$3 AND ($4::uuid IS NULL OR "organizationId"=$4)`,
      [tenantId,from,to,organizationId],
    );
    const bySeverity = await this.dataSource.query(
      `SELECT severity,count(*)::int AS total,
        count(*) FILTER (WHERE "acknowledgedAt" IS NOT NULL AND "acknowledgedAt"<="responseDueAt")::int AS "responseMet",
        count(*) FILTER (WHERE "acknowledgedAt">"responseDueAt" OR ("acknowledgedAt" IS NULL AND "responseDueAt"<now()))::int AS "responseBreached",
        count(*) FILTER (WHERE "resolvedAt" IS NOT NULL AND "resolvedAt"<="resolutionDueAt")::int AS "resolutionMet",
        count(*) FILTER (WHERE "resolvedAt">"resolutionDueAt" OR ("resolvedAt" IS NULL AND "resolutionDueAt"<now()))::int AS "resolutionBreached",
        round(avg(EXTRACT(EPOCH FROM ("acknowledgedAt"-"firstDetectedAt"))/60) FILTER (WHERE "acknowledgedAt">="firstDetectedAt")::numeric,2) AS "averageResponseMinutes",
        round(avg(EXTRACT(EPOCH FROM ("resolvedAt"-"firstDetectedAt"))/3600) FILTER (WHERE "resolvedAt">="firstDetectedAt")::numeric,2) AS "averageResolutionHours"
       FROM organization_operational_alerts
       WHERE "tenantId"=$1 AND "firstDetectedAt">=$2 AND "firstDetectedAt"<$3 AND ($4::uuid IS NULL OR "organizationId"=$4)
       GROUP BY severity ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END`,
      [tenantId,from,to,organizationId],
    );
    const byOrganization = await this.dataSource.query(
      `SELECT o.id AS "organizationId",o.name AS "organizationName",count(a.id)::int AS total,
        count(a.id) FILTER (WHERE a."acknowledgedAt" IS NOT NULL AND a."acknowledgedAt"<=a."responseDueAt")::int AS "responseMet",
        count(a.id) FILTER (WHERE a."acknowledgedAt">a."responseDueAt" OR (a."acknowledgedAt" IS NULL AND a."responseDueAt"<now()))::int AS "responseBreached",
        count(a.id) FILTER (WHERE a."resolvedAt" IS NOT NULL AND a."resolvedAt"<=a."resolutionDueAt")::int AS "resolutionMet",
        count(a.id) FILTER (WHERE a."resolvedAt">a."resolutionDueAt" OR (a."resolvedAt" IS NULL AND a."resolutionDueAt"<now()))::int AS "resolutionBreached"
       FROM organizations o LEFT JOIN organization_operational_alerts a
         ON a."organizationId"=o.id AND a."tenantId"=$1 AND a."firstDetectedAt">=$2 AND a."firstDetectedAt"<$3
       WHERE o."tenantId"=$1 AND o."isActive"=true AND ($4::uuid IS NULL OR o.id=$4)
       GROUP BY o.id,o.name ORDER BY total DESC,o.name LIMIT 100`,
      [tenantId,from,to,organizationId],
    );
    const numeric = (row: any) => Object.fromEntries(Object.entries(row ?? {}).map(([key,value]) => [key,value == null ? null : typeof value === 'string' && /^-?\\d+(\\.\\d+)?$/.test(value) ? Number(value) : value]));
    const responseEligible=Number(summary?.responseEligible ?? 0), responseMet=Number(summary?.responseMet ?? 0);
    const resolutionEligible=Number(summary?.resolutionEligible ?? 0), resolutionMet=Number(summary?.resolutionMet ?? 0);
    return {
      tenant:{id:tenant.id,name:tenant.name},period:{from:from.toISOString(),to:to.toISOString()},filters:{organizationId},
      summary:numeric(summary),
      responseCompliancePercent:responseEligible ? Number(((responseMet/responseEligible)*100).toFixed(2)) : null,
      resolutionCompliancePercent:resolutionEligible ? Number(((resolutionMet/resolutionEligible)*100).toFixed(2)) : null,
      bySeverity:bySeverity.map(numeric),byOrganization:byOrganization.map(numeric),generatedAt:new Date().toISOString(),
    };
  }

  async operationalAlertSlaCsv(tenantId: string, options: { from?: string; to?: string; organizationId?: string }) {
    const report = await this.operationalAlertSla(tenantId, options);
    const rows: unknown[][] = [
      ['بخش','شاخص','مقدار'],['مشتری','نام',report.tenant.name],['بازه','از',report.period.from],['بازه','تا',report.period.to],
      ...Object.entries(report.summary).map(([key,value])=>['خلاصه',key,value]),
      ['انطباق','پاسخ درصد',report.responseCompliancePercent],['انطباق','حل درصد',report.resolutionCompliancePercent],
    ];
    for (const item of report.bySeverity) for (const [key,value] of Object.entries(item)) rows.push(['شدت',key,value]);
    for (const item of report.byOrganization) for (const [key,value] of Object.entries(item)) rows.push(['سازمان',key,value]);
    const cell = (value: unknown) => {
      let text = value == null ? '' : String(value);
      if (/^[\\s]*[=+@-]/.test(text) || text.startsWith('\\t') || text.startsWith('\\r')) text = "'" + text;
      return '"' + text.replace(/"/g,'""') + '"';
    };
    return '\\uFEFF' + rows.map(row=>row.map(cell).join(',')).join('\\r\\n') + '\\r\\n';
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
    for (const item of report.stagePerformance) {
      lines.push(['عملکرد مراحل', `${item.processName} - ${item.stageName} - تکمیل‌شده`, String(item.completedTasks)]);
      lines.push(['عملکرد مراحل', `${item.processName} - ${item.stageName} - میانگین چرخه (ساعت)`, String(item.averageCycleHours ?? '')]);
      lines.push(['عملکرد مراحل', `${item.processName} - ${item.stageName} - میانه چرخه (ساعت)`, String(item.medianCycleHours ?? '')]);
      lines.push(['عملکرد مراحل', `${item.processName} - ${item.stageName} - صدک ۹۰ چرخه (ساعت)`, String(item.p90CycleHours ?? '')]);
      lines.push(['عملکرد مراحل', `${item.processName} - ${item.stageName} - تکمیل با تأخیر`, String(item.completedLate)]);
      lines.push(['عملکرد مراحل', `${item.processName} - ${item.stageName} - باز / مهلت‌گذشته`, `${item.currentlyOpen} / ${item.currentlyOverdue}`]);
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
