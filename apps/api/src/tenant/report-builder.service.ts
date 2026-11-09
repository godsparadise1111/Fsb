import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';

type Field = { label: string; expression: string; type: 'text' | 'date' | 'number'; groupable?: boolean; filterable?: boolean; whereExpression?: string };
type Source = { label: string; from: string; dateExpression: string; tenantExpression?: string; organizationExpression?: string; fields: Record<string, Field> };
export type ReportAccessScope = { tenantWide: boolean; organizationIds: string[] };
export type ReportFilter = { field: string; operator: 'eq' | 'neq' | 'contains' | 'in' | 'gte' | 'lte'; value: unknown };
export type ReportSpec = { source: string; from?: string; to?: string; groupBy?: string; aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max'; measure?: string; filters?: ReportFilter[]; limit?: number; organizationId?: string };

const SOURCES: Record<string, Source> = {
  organizations: {
    label: 'سازمان‌ها',
    from: 'organizations o',
    dateExpression: 'o."createdAt"',
    organizationExpression: 'o.id',
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
    organizationExpression: 'o.id',
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
    organizationExpression: 'o.id',
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
    organizationExpression: 'o.id',
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
    organizationExpression: 'o.id',
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

  private hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

  private async sourceFor(tenantId: string, spec: ReportSpec, organizationIds: string[] = []) {
    const base = SOURCES[spec.source];
    if (!base) throw new BadRequestException('منبع داده مجاز نیست');
    const source: Source = { ...base, fields: { ...base.fields } };
    if (spec.source !== 'submissions') return source;
    const versions = await this.dataSource.query(
      `SELECT fv.id AS "versionId",fv."versionNumber",fv.schema,fd.id AS "definitionId",fd.name AS "formName",fd."organizationId"
         FROM form_versions fv
         JOIN form_definitions fd ON fd.id=fv."definitionId"
         JOIN organizations o ON o.id=fd."organizationId" AND o."tenantId"=$1 AND o."isActive"=true
        WHERE fv.status='PUBLISHED' AND ($2::uuid[] IS NULL OR fd."organizationId"=ANY($2::uuid[]))
          AND ($3::uuid IS NULL OR fd."organizationId"=$3)
        ORDER BY fd.name,fv."versionNumber" DESC
        LIMIT 500`,
      [tenantId, organizationIds.length ? organizationIds : null, spec.organizationId ?? null],
    ) as Array<{versionId:string;versionNumber:number;schema:unknown;definitionId:string;formName:string;organizationId:string}>;
    const seen = new Set<string>();
    const collect = (node: unknown, version: typeof versions[number], depth = 0): void => {
      if (depth > 12 || node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const item of node.slice(0, 500)) collect(item, version, depth + 1); return; }
      const item = node as Record<string, unknown>;
      const rawId = item.fieldId ?? item.id ?? item.key ?? item.name;
      const rawType = String(item.fieldType ?? item.dataType ?? item.type ?? '').toLowerCase();
      const rawLabel = item.label ?? item.title ?? item.caption ?? item.name;
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
      const type: Field['type'] | null = /number|numeric|decimal|integer|currency|amount|rating/.test(rawType) ? 'number'
        : /date|time/.test(rawType) ? 'date'
        : /text|string|email|phone|select|radio|checkbox|boolean|lookup/.test(rawType) ? 'text' : null;
      if (id && label && type && /^[A-Za-z0-9_-]{1,100}$/.test(id)) {
        const fieldKey = `custom_${version.versionId.replace(/-/g, '')}_${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
        if (!seen.has(fieldKey)) {
          seen.add(fieldKey);
          const jsonValue = `fs.data ->> '${id}'`;
          const expression = type === 'number'
            ? `CASE WHEN COALESCE(${jsonValue},'') ~ '^-?[0-9]+(\\.[0-9]+)?
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${name} باید با قالب YYYY-MM-DD باشد`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${name} معتبر نیست`);
    return parsed;
  }

  private validate(spec: ReportSpec, sourceOverride?: Source) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new BadRequestException('تعریف گزارش نامعتبر است');
    if (JSON.stringify(spec).length > 20000) throw new BadRequestException('حجم تعریف گزارش بیش از حد مجاز است');
    const allowedKeys = new Set(['source', 'from', 'to', 'groupBy', 'aggregate', 'measure', 'filters', 'limit', 'organizationId']);
    if (Object.keys(spec).some(key => !allowedKeys.has(key))) throw new BadRequestException('فیلد اضافی در تعریف گزارش مجاز نیست');
    const source = sourceOverride ?? SOURCES[spec.source];
    if (!source) throw new BadRequestException('منبع داده مجاز نیست');
    if (!['count', 'sum', 'avg', 'min', 'max'].includes(spec.aggregate)) throw new BadRequestException('عملگر تجمیع نامعتبر است');
    if (spec.aggregate !== 'count') {
      const measure = spec.measure ? source.fields[spec.measure] : undefined;
      if (!measure || measure.type !== 'number') throw new BadRequestException('شاخص عددی انتخاب‌شده مجاز نیست');
    }
    if (spec.groupBy && (!source.fields[spec.groupBy]?.groupable)) throw new BadRequestException('گروه‌بندی انتخاب‌شده مجاز نیست');
    if (spec.filters !== undefined && (!Array.isArray(spec.filters) || spec.filters.length > 10)) throw new BadRequestException('حداکثر ۱۰ شرط فیلتر مجاز است');
    for (const filter of spec.filters ?? []) {
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw new BadRequestException('ساختار شرط فیلتر نامعتبر است');
      if (Object.keys(filter).some(key => !['field', 'operator', 'value'].includes(key))) throw new BadRequestException('فیلد اضافی در شرط فیلتر مجاز نیست');
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
      if (field.type === 'date' && values.some(value => { if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return true; const parsed = new Date(value + 'T00:00:00.000Z'); return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value; })) throw new BadRequestException('مقدار تاریخ فیلتر معتبر نیست');
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
    const clauses = [ (source.tenantExpression ?? 'o.\"tenantId\"') + ' = $1', `${source.dateExpression} >= $2`, `${source.dateExpression} < $3`];\n    if (source.organizationExpression) {\n      if (scopeIds.length) { params.push(scopeIds); clauses.push(`${source.organizationExpression} = ANY(${params.length}::uuid[])`); }\n      else if (spec.organizationId) { params.push(spec.organizationId); clauses.push(`${source.organizationExpression} = ${params.length}::uuid`); }\n    }
    for (const filter of spec.filters ?? []) {
      const field = source.fields[filter.field];
      const expression = field.expression;\n      if (field.whereExpression) clauses.push(field.whereExpression);
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

    const dimension = spec.groupBy ? source.fields[spec.groupBy] : undefined;\n    if (dimension?.whereExpression) clauses.push(dimension.whereExpression);\n    const measureField = spec.aggregate === 'count' ? undefined : source.fields[spec.measure as string];\n    if (measureField?.whereExpression) clauses.push(measureField.whereExpression);
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
      `SELECT id, title, description, "isShared", config, "ownerUserId", "createdAt", "updatedAt", ("ownerUserId" = $3) AS "isOwner"
         FROM tenant_saved_reports
        WHERE id = $1 AND "tenantId" = $2 AND ("ownerUserId" = $3 OR "isShared" = true)`,
      [id, tenantId, userId],
    );
    if (!report) throw new NotFoundException('گزارش ذخیره‌شده پیدا نشد');
    return report;
  }

  async save(tenantId: string, userId: string, input: { title: string; description?: string; isShared?: boolean; config: ReportSpec }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('اطلاعات ذخیره گزارش نامعتبر است');
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 160) throw new BadRequestException('عنوان گزارش الزامی و حداکثر ۱۶۰ نویسه است');
    if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 1000)) throw new BadRequestException('توضیحات گزارش نامعتبر است');
    const source = await this.sourceFor(tenantId, input.config, input.config.organizationId ? [input.config.organizationId] : []);\n    this.validate(input.config, source);
    const [row] = await this.dataSource.query(
      `INSERT INTO tenant_saved_reports ("tenantId", "ownerUserId", title, description, config, "isShared")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING id, title, description, "isShared", "createdAt", "updatedAt"`,
      [tenantId, userId, title, input.description?.trim() || null, JSON.stringify(input.config), input.isShared === true],
    );
    return row;
  }

  async update(tenantId: string, userId: string, id: string, input: { title?: string; description?: string; isShared?: boolean; config?: ReportSpec }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('اطلاعات ویرایش گزارش نامعتبر است');
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
    if (input.config !== undefined) { const source = await this.sourceFor(tenantId, input.config, input.config.organizationId ? [input.config.organizationId] : []); this.validate(input.config, source); params.push(JSON.stringify(input.config)); sets.push(`config=${params.length}::jsonb`); }
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
 THEN (${jsonValue})::numeric END`
            : type === 'date'
              ? `CASE WHEN COALESCE(${jsonValue},'') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${name} باید با قالب YYYY-MM-DD باشد`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${name} معتبر نیست`);
    return parsed;
  }

  private validate(spec: ReportSpec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new BadRequestException('تعریف گزارش نامعتبر است');
    if (JSON.stringify(spec).length > 20000) throw new BadRequestException('حجم تعریف گزارش بیش از حد مجاز است');
    const allowedKeys = new Set(['source', 'from', 'to', 'groupBy', 'aggregate', 'measure', 'filters', 'limit', 'organizationId']);
    if (Object.keys(spec).some(key => !allowedKeys.has(key))) throw new BadRequestException('فیلد اضافی در تعریف گزارش مجاز نیست');
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
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw new BadRequestException('ساختار شرط فیلتر نامعتبر است');
      if (Object.keys(filter).some(key => !['field', 'operator', 'value'].includes(key))) throw new BadRequestException('فیلد اضافی در شرط فیلتر مجاز نیست');
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
      if (field.type === 'date' && values.some(value => { if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return true; const parsed = new Date(value + 'T00:00:00.000Z'); return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value; })) throw new BadRequestException('مقدار تاریخ فیلتر معتبر نیست');
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
      `SELECT id, title, description, "isShared", config, "ownerUserId", "createdAt", "updatedAt", ("ownerUserId" = $3) AS "isOwner"
         FROM tenant_saved_reports
        WHERE id = $1 AND "tenantId" = $2 AND ("ownerUserId" = $3 OR "isShared" = true)`,
      [id, tenantId, userId],
    );
    if (!report) throw new NotFoundException('گزارش ذخیره‌شده پیدا نشد');
    return report;
  }

  async save(tenantId: string, userId: string, input: { title: string; description?: string; isShared?: boolean; config: ReportSpec }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('اطلاعات ذخیره گزارش نامعتبر است');
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
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('اطلاعات ویرایش گزارش نامعتبر است');
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
 THEN (${jsonValue})::date END`
              : jsonValue;
          source.fields[fieldKey] = {
            label: `${version.formName} · v${version.versionNumber} · ${label}`,
            expression, type, groupable: type === 'text', filterable: true,
            whereExpression: `fv.id = '${version.versionId}'::uuid`,
          };
        }
      }
      for (const [key, value] of Object.entries(item)) {
        if (['fields','children','elements','components','items','properties','schema','pages','sections'].includes(key)) collect(value, version, depth + 1);
      }
    };
    for (const version of versions) collect(version.schema, version);
    return source;
  }

  async accessibleOrganizations(tenantId: string, userId: string) {
    return this.dataSource.query(
      `SELECT DISTINCT o.id,o.name,o.code
         FROM user_roles ur
         JOIN roles r ON r.id=ur."roleId" AND r."isActive"=true AND r.scope='ORGANIZATION'
         JOIN role_permissions rp ON rp."roleId"=r.id
         JOIN permissions p ON p.id=rp."permissionId" AND p.code='tenant.reports.read'
         JOIN organizations o ON o.id=ur."organizationId" AND o."tenantId"=ur."tenantId" AND o."isActive"=true
         JOIN tenant_memberships tm ON tm."tenantId"=ur."tenantId" AND tm."userId"=ur."userId" AND tm."isActive"=true
        WHERE ur."tenantId"=$1 AND ur."userId"=$2 AND ur."isActive"=true
        ORDER BY o.name`, [tenantId,userId]);
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
    if (JSON.stringify(spec).length > 20000) throw new BadRequestException('حجم تعریف گزارش بیش از حد مجاز است');
    const allowedKeys = new Set(['source', 'from', 'to', 'groupBy', 'aggregate', 'measure', 'filters', 'limit', 'organizationId']);
    if (Object.keys(spec).some(key => !allowedKeys.has(key))) throw new BadRequestException('فیلد اضافی در تعریف گزارش مجاز نیست');
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
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw new BadRequestException('ساختار شرط فیلتر نامعتبر است');
      if (Object.keys(filter).some(key => !['field', 'operator', 'value'].includes(key))) throw new BadRequestException('فیلد اضافی در شرط فیلتر مجاز نیست');
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
      if (field.type === 'date' && values.some(value => { if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return true; const parsed = new Date(value + 'T00:00:00.000Z'); return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value; })) throw new BadRequestException('مقدار تاریخ فیلتر معتبر نیست');
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
      `SELECT id, title, description, "isShared", config, "ownerUserId", "createdAt", "updatedAt", ("ownerUserId" = $3) AS "isOwner"
         FROM tenant_saved_reports
        WHERE id = $1 AND "tenantId" = $2 AND ("ownerUserId" = $3 OR "isShared" = true)`,
      [id, tenantId, userId],
    );
    if (!report) throw new NotFoundException('گزارش ذخیره‌شده پیدا نشد');
    return report;
  }

  async save(tenantId: string, userId: string, input: { title: string; description?: string; isShared?: boolean; config: ReportSpec }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('اطلاعات ذخیره گزارش نامعتبر است');
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
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('اطلاعات ویرایش گزارش نامعتبر است');
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
