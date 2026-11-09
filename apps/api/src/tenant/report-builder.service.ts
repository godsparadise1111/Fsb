import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

type Field = { label: string; expression: string; type: 'text' | 'date' | 'number'; groupable?: boolean; filterable?: boolean };
type Source = { label: string; from: string; dateExpression: string; tenantExpression?: string; fields: Record<string, Field> };
export type ReportFilter = { field: string; operator: 'eq' | 'neq' | 'contains' | 'in' | 'gte' | 'lte'; value: unknown };
export type ReportSpec = { source: string; from?: string; to?: string; groupBy?: string; aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max'; measure?: string; filters?: ReportFilter[]; limit?: number };

const SOURCES: Record<string, Source> = {
  organizations: {
    label: 'سازمان‌ها',
    from: 'organizations o',
    dateExpression: 'o."createdAt"',
    fields: {
      name: { label: 'نام سازمان', expression: 'o.name', type: 'text', groupable: true },
      code: { label: 'کد سازمان', expression: 'o.code', type: 'text', groupable: true },
      status: { label: 'وضعیت سازمان', expression: "(CASE WHEN o.\"isActive\" THEN 'فعال' ELSE 'غیرفعال' END)", type: 'text', groupable: true },
      createdAt: { label: 'زمان ایجاد', expression: 'o."createdAt"', type: 'date' },
    },
  },
  users: {
    label: 'اعضای مشتری',
    from: 'users u INNER JOIN tenant_memberships tm ON tm."userId" = u.id',
    tenantExpression: 'tm."tenantId"',
    dateExpression: 'u."createdAt"',
    fields: {
      username: { label: 'نام کاربری', expression: 'u.username', type: 'text', groupable: true },
      fullName: { label: 'نام و نام خانوادگی', expression: 'concat(u."firstName", \' \', u."lastName")', type: 'text', groupable: true },
      accountStatus: { label: 'وضعیت حساب', expression: "(CASE WHEN u.\"isActive\" THEN 'فعال' ELSE 'غیرفعال' END)", type: 'text', groupable: true },
      membershipStatus: { label: 'وضعیت عضویت', expression: "(CASE WHEN tm.\"isActive\" THEN 'فعال' ELSE 'غیرفعال' END)", type: 'text', groupable: true },
      createdAt: { label: 'زمان ایجاد حساب', expression: 'u."createdAt"', type: 'date' },
    },
  },
  forms: {
    label: 'تعریف فرم‌ها',
    from: 'form_definitions fd INNER JOIN organizations o ON o.id = fd."organizationId"',
    dateExpression: 'fd."createdAt"',
    fields: {
      name: { label: 'نام فرم', expression: 'fd.name', type: 'text', groupable: true },
      code: { label: 'کد فرم', expression: 'fd.code', type: 'text', groupable: true },
      status: { label: 'وضعیت فرم', expression: 'fd.status', type: 'text', groupable: true },
      organizationName: { label: 'سازمان', expression: 'o.name', type: 'text', groupable: true },
      createdAt: { label: 'زمان ایجاد', expression: 'fd."createdAt"', type: 'date' },
    },
  },
  processes: {
    label: 'نمونه‌های فرایند',
    from: 'process_instances pi INNER JOIN organizations o ON o.id = pi."organizationId"',
    dateExpression: 'pi."startedAt"',
    fields: {
      title: { label: 'عنوان فرایند', expression: 'pi.title', type: 'text', groupable: true },
      status: { label: 'وضعیت', expression: 'pi.status', type: 'text', groupable: true },
      startedAt: { label: 'زمان شروع', expression: 'pi."startedAt"', type: 'date' },
      completedAt: { label: 'زمان تکمیل', expression: 'pi."completedAt"', type: 'date' },
      organizationName: { label: 'سازمان', expression: 'o.name', type: 'text', groupable: true },
      durationHours: { label: 'مدت تکمیل (ساعت)', expression: 'EXTRACT(EPOCH FROM (pi."completedAt" - pi."startedAt")) / 3600.0', type: 'number' },
      startedByUserId: { label: 'شناسه آغازگر', expression: 'pi."startedByUserId"::text', type: 'text', groupable: true },
    },
  },
  tasks: {
    label: 'وظایف گردش‌کار',
    from: 'workflow_tasks wt INNER JOIN process_instances pi ON pi.id = wt."processInstanceId" INNER JOIN organizations o ON o.id = pi."organizationId"',
    dateExpression: 'wt."createdAt"',
    fields: {
      title: { label: 'عنوان وظیفه', expression: 'wt.title', type: 'text', groupable: true },
      status: { label: 'وضعیت وظیفه', expression: 'wt.status', type: 'text', groupable: true },
      createdAt: { label: 'زمان ایجاد', expression: 'wt."createdAt"', type: 'date' },
      completedAt: { label: 'زمان تکمیل', expression: 'wt."completedAt"', type: 'date' },
      dueAt: { label: 'مهلت انجام', expression: 'wt."dueAt"', type: 'date' },
      organizationName: { label: 'سازمان', expression: 'o.name', type: 'text', groupable: true },
      processTitle: { label: 'عنوان نمونه فرایند', expression: 'pi.title', type: 'text', groupable: true },
      durationHours: { label: 'زمان انجام (ساعت)', expression: 'EXTRACT(EPOCH FROM (wt."completedAt" - wt."createdAt")) / 3600.0', type: 'number' },
    },
  },
  submissions: {
    label: 'پاسخ‌های فرم',
    from: 'form_submissions fs INNER JOIN form_versions fv ON fv.id = fs."formVersionId" INNER JOIN form_definitions fd ON fd.id = fv."definitionId" INNER JOIN organizations o ON o.id = fd."organizationId"',
    dateExpression: 'fs."submittedAt"',
    fields: {
      formName: { label: 'نام فرم', expression: 'fd.name', type: 'text', groupable: true },
      formCode: { label: 'کد فرم', expression: 'fd.code', type: 'text', groupable: true },
      submittedAt: { label: 'زمان ثبت پاسخ', expression: 'fs."submittedAt"', type: 'date' },
      organizationName: { label: 'سازمان', expression: 'o.name', type: 'text', groupable: true },
      submittedByUserId: { label: 'شناسه ثبت‌کننده', expression: 'fs."submittedByUserId"::text', type: 'text', groupable: true },
      hasProcess: { label: 'دارای فرایند', expression: "(CASE WHEN fs.\"processInstanceId\" IS NULL THEN 'خیر' ELSE 'بله' END)", type: 'text', groupable: true },
    },
  },
};

@Injectable()
export class ReportBuilderService {
  constructor(private readonly dataSource: DataSource) {}

  catalog() {
    return Object.entries(SOURCES).map(([key, source]) => ({
      key, label: source.label,
      fields: Object.entries(source.fields).map(([fieldKey, field]) => ({
        key: fieldKey, label: field.label, type: field.type,
        groupable: field.groupable === true, filterable: field.filterable !== false,
      })),
      aggregates: ['count', ...(Object.values(source.fields).some(f => f.type === 'number') ? ['sum', 'avg', 'min', 'max'] : [])],
    }));
  }

  private date(value: unknown, fallback: Date, name: string): Date {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${name} باید با قالب YYYY-MM-DD باشد`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${name} معتبر نیست`);
    return parsed;
  }

  private validate(spec: ReportSpec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new BadRequestException('تعریف گزارش نامعتبر است');
    const source = SOURCES[spec.source];
    if (!source) throw new BadRequestException('منبع داده مجاز نیست');
    if (!['count', 'sum', 'avg', 'min', 'max'].includes(spec.aggregate)) throw new BadRequestException('عملگر تجمیع نامعتبر است');
    if (spec.aggregate !== 'count') {
      const measure = spec.measure ? source.fields[spec.measure] : undefined;
      if (!measure || measure.type !== 'number') throw new BadRequestException('شاخص عددی انتخاب‌شده مجاز نیست');
    }
    if (spec.groupBy && (!source.fields[spec.groupBy]?.groupable)) throw new BadRequestException('گروه‌بندی انتخاب‌شده مجاز نیست');
    if (spec.filters !== undefined && (!Array.isArray(spec.filters) || spec.filters.length > 10)) throw new BadRequestException('حداکثر ۱۰ شرط فیلتر مجاز است');
    for (const filter of spec.filters ?? []) {
      const field = source.fields[filter.field];
      if (!field || field.filterable === false) throw new BadRequestException('فیلد فیلتر مجاز نیست');
      if (!['eq', 'neq', 'contains', 'in', 'gte', 'lte'].includes(filter.operator)) throw new BadRequestException('عملگر فیلتر نامعتبر است');
      if (filter.operator === 'contains' && field.type !== 'text') throw new BadRequestException('contains فقط برای فیلد متنی مجاز است');
      if (['gte', 'lte'].includes(filter.operator) && field.type === 'text') throw new BadRequestException('مقایسه بازه‌ای برای این فیلد مجاز نیست');
      if (filter.operator === 'in' && (!Array.isArray(filter.value) || filter.value.length < 1 || filter.value.length > 50)) throw new BadRequestException('فهرست مقادیر فیلتر نامعتبر است');
      const values = filter.operator === 'in' ? filter.value as unknown[] : [filter.value];
      if (values.some(value => value === null || value === undefined || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean'))) {
        throw new BadRequestException('مقدار فیلتر نامعتبر است');
      }
      if (values.some(value => typeof value === 'string' && value.length > 200)) throw new BadRequestException('طول مقدار فیلتر بیش از حد مجاز است');
      if (field.type === 'text' && values.some(value => typeof value !== 'string')) throw new BadRequestException('مقدار فیلد متنی باید رشته باشد');
      if (field.type === 'number' && values.some(value => !Number.isFinite(Number(value)))) throw new BadRequestException('مقدار فیلد عددی معتبر نیست');
      if (field.type === 'date' && values.some(value => typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value) || !Number.isFinite(new Date(value + 'T00:00:00.000Z').getTime()))) throw new BadRequestException('مقدار تاریخ فیلتر معتبر نیست');
    }
    const limit = spec.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequestException('حداکثر ۲۰۰ ردیف برای گزارش مجاز است');
    return source;
  }

  async execute(tenantId: string, spec: ReportSpec) {
    const source = this.validate(spec);
    const now = new Date();
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const defaultFrom = new Date(defaultTo.getTime() - 30 * 86400000);
    const from = this.date(spec.from, defaultFrom, 'from');
    const to = this.date(spec.to, defaultTo, 'to');
    if (from >= to || to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException('بازه گزارش باید مثبت و حداکثر ۳۶۶ روز باشد');

    const params: unknown[] = [tenantId, from, to];
    const clauses = [ (source.tenantExpression ?? 'o."tenantId"') + ' = $1', `${source.dateExpression} >= $2`, `${source.dateExpression} < $3`];
    for (const filter of spec.filters ?? []) {
      const field = source.fields[filter.field];
      const expression = field.expression;
      if (filter.operator === 'in') {
        const values = filter.value as unknown[];
        params.push(values);
        clauses.push(`${expression} = ANY($${params.length})`);
      } else {
        let value = filter.value;
        if (filter.operator === 'contains') value = String(value);
        params.push(value);
        const p = `$${params.length}`;
        if (filter.operator === 'contains') clauses.push(`POSITION(LOWER(${p}) IN LOWER(${expression}::text)) > 0`);
        else {
          const operator = ({ eq: '=', neq: '<>', gte: '>=', lte: '<=' } as const)[filter.operator];
          clauses.push(`${expression} ${operator} ${p}`);
        }
      }
    }

    const dimension = spec.groupBy ? source.fields[spec.groupBy] : undefined;
    const metric = spec.aggregate === 'count' ? 'COUNT(*)' : `${spec.aggregate.toUpperCase()}(${source.fields[spec.measure as string].expression})`;
    const select = dimension ? `${dimension.expression} AS "dimension", ${metric} AS "value"` : `${metric} AS "value"`;
    const group = dimension ? ` GROUP BY ${dimension.expression} ORDER BY "value" DESC NULLS LAST` : '';
    const limit = spec.limit ?? 100;
    const sql = `SELECT ${select} FROM ${source.from} WHERE ${clauses.join(' AND ')}${group} LIMIT ${limit}`;
    const rows = await this.dataSource.transaction(async manager => {
      await manager.query("SET LOCAL statement_timeout = '10s'");
      return manager.query(sql, params);
    });
    return {
      source: spec.source, sourceLabel: source.label, groupBy: spec.groupBy ?? null,
      groupLabel: dimension?.label ?? null, aggregate: spec.aggregate,
      measureLabel: spec.aggregate === 'count' ? 'تعداد' : source.fields[spec.measure as string].label,
      period: { from: from.toISOString(), to: to.toISOString() },
      rows: rows.map((row: any) => ({ dimension: row.dimension ?? null, value: row.value === null ? null : Number(row.value) })),
      rowCount: rows.length, generatedAt: new Date().toISOString(),
    };
  }

  async listSaved(tenantId: string, userId: string) {
    return this.dataSource.query(
      `SELECT id, title, description, "isShared", "createdAt", "updatedAt", "ownerUserId", ("ownerUserId" = $2) AS "isOwner"
         FROM tenant_saved_reports
        WHERE "tenantId" = $1 AND ("ownerUserId" = $2 OR "isShared" = true)
        ORDER BY "updatedAt" DESC LIMIT 100`, [tenantId, userId],
    );
  }

  async getSaved(tenantId: string, userId: string, id: string) {
    const [report] = await this.dataSource.query(
      `SELECT id, title, description, "isShared", config, "ownerUserId", "createdAt", "updatedAt"
         FROM tenant_saved_reports
        WHERE id = $1 AND "tenantId" = $2 AND ("ownerUserId" = $3 OR "isShared" = true)`,
      [id, tenantId, userId],
    );
    if (!report) throw new NotFoundException('گزارش ذخیره‌شده پیدا نشد');
    return report;
  }

  async save(tenantId: string, userId: string, input: { title: string; description?: string; isShared?: boolean; config: ReportSpec }) {
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 160) throw new BadRequestException('عنوان گزارش الزامی و حداکثر ۱۶۰ نویسه است');
    if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 1000)) throw new BadRequestException('توضیحات گزارش نامعتبر است');
    this.validate(input.config);
    const [row] = await this.dataSource.query(
      `INSERT INTO tenant_saved_reports ("tenantId", "ownerUserId", title, description, config, "isShared")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id, title, description, "isShared", "createdAt", "updatedAt"`,
      [tenantId, userId, title, input.description?.trim() || null, JSON.stringify(input.config), input.isShared === true],
    );
    return row;
  }

  async update(tenantId: string, userId: string, id: string, input: { title?: string; description?: string; isShared?: boolean; config?: ReportSpec }) {
    const current = await this.dataSource.query(
      'SELECT id FROM tenant_saved_reports WHERE id=$1 AND "tenantId"=$2 AND "ownerUserId"=$3',
      [id, tenantId, userId],
    );
    if (!current.length) throw new NotFoundException('گزارش متعلق به کاربر جاری پیدا نشد');
    const sets: string[] = [];
    const params: unknown[] = [id, tenantId, userId];
    if (input.title !== undefined) {
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 160) throw new BadRequestException('عنوان گزارش نامعتبر است');
      params.push(input.title.trim()); sets.push(`title=$${params.length}`);
    }
    if (input.description !== undefined) {
      if (typeof input.description !== 'string' || input.description.length > 1000) throw new BadRequestException('توضیحات گزارش نامعتبر است');
      params.push(input.description.trim() || null); sets.push(`description=$${params.length}`);
    }
    if (input.isShared !== undefined) { params.push(input.isShared === true); sets.push(`"isShared"=$${params.length}`); }
    if (input.config !== undefined) { this.validate(input.config); params.push(JSON.stringify(input.config)); sets.push(`config=$${params.length}::jsonb`); }
    if (!sets.length) throw new BadRequestException('تغییری برای ذخیره ارسال نشده است');
    sets.push('"updatedAt"=now()');
    const [row] = await this.dataSource.query(
      `UPDATE tenant_saved_reports SET ${sets.join(', ')} WHERE id=$1 AND "tenantId"=$2 AND "ownerUserId"=$3 RETURNING id,title,description,"isShared","createdAt","updatedAt"`,
      params,
    );
    return row;
  }

  async remove(tenantId: string, userId: string, id: string) {
    const result = await this.dataSource.query(
      'DELETE FROM tenant_saved_reports WHERE id=$1 AND "tenantId"=$2 AND "ownerUserId"=$3 RETURNING id',
      [id, tenantId, userId],
    );
    if (!result.length) throw new NotFoundException('گزارش متعلق به کاربر جاری پیدا نشد');
    return { deleted: true };
  }

  async executeSaved(tenantId: string, userId: string, id: string) {
    const report = await this.getSaved(tenantId, userId, id);
    return { report: { id: report.id, title: report.title }, result: await this.execute(tenantId, report.config) };
  }

  csv(result: Awaited<ReturnType<ReportBuilderService['execute']>>) {
    const quote = (value: unknown) => {
      let text = value === null || value === undefined ? '' : String(value);
      if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [[result.groupLabel ?? 'گروه', result.measureLabel], ...result.rows.map(row => [row.dimension ?? 'همه', row.value])];
    return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
  }
}
