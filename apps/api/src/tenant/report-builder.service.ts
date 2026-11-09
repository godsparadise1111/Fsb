import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';

type Field = { label: string; expression: string; type: 'text' | 'date' | 'number'; groupable?: boolean; filterable?: boolean; whereExpression?: string };
type Source = { label: string; from: string; dateExpression: string; tenantExpression?: string; organizationExpression?: string; fields: Record<string, Field> };
export type ReportAccessScope = { tenantWide: boolean; organizationIds: string[]; executionTimeoutMs?: number };
export type ReportFilter = { field: string; operator: 'eq' | 'neq' | 'contains' | 'in' | 'gte' | 'lte'; value: unknown };
export type ReportSpec = { source: string; from?: string; to?: string; groupBy?: string; aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max'; measure?: string; filters?: ReportFilter[]; limit?: number; organizationId?: string };
export type ReportResult = { source: string; sourceLabel: string; groupBy: string | null; groupLabel: string | null; aggregate: string; measureLabel: string; period: { from: string; to: string }; rows: Array<{ dimension: string | null; value: number | null }>; rowCount: number; generatedAt: string; cached: boolean };

const SOURCES: Record<string, Source> = {
  organizations: {
    label: 'سازمان‌ها', from: 'organizations o', tenantExpression: 'o."tenantId"', organizationExpression: 'o.id', dateExpression: 'o."createdAt"',
    fields: {
      name: { label: 'نام سازمان', expression: 'o.name', type: 'text', groupable: true },
      code: { label: 'کد سازمان', expression: 'o.code', type: 'text', groupable: true },
      status: { label: 'وضعیت سازمان', expression: '(CASE WHEN o."isActive" THEN \'فعال\' ELSE \'غیرفعال\' END)', type: 'text', groupable: true },
      createdAt: { label: 'زمان ایجاد', expression: 'o."createdAt"', type: 'date' },
    },
  },
  users: {
    label: 'اعضای مشتری', from: 'users u INNER JOIN tenant_memberships tm ON tm."userId"=u.id', tenantExpression: 'tm."tenantId"', dateExpression: 'u."createdAt"',
    fields: {
      username: { label: 'نام کاربری', expression: 'u.username', type: 'text', groupable: true },
      fullName: { label: 'نام و نام خانوادگی', expression: 'concat(u."firstName", \' \', u."lastName")', type: 'text', groupable: true },
      accountStatus: { label: 'وضعیت حساب', expression: '(CASE WHEN u."isActive" THEN \'فعال\' ELSE \'غیرفعال\' END)', type: 'text', groupable: true },
      membershipStatus: { label: 'وضعیت عضویت', expression: '(CASE WHEN tm."isActive" THEN \'فعال\' ELSE \'غیرفعال\' END)', type: 'text', groupable: true },
      createdAt: { label: 'زمان ایجاد حساب', expression: 'u."createdAt"', type: 'date' },
    },
  },
  forms: {
    label: 'تعریف فرم‌ها', from: 'form_definitions fd INNER JOIN organizations o ON o.id=fd."organizationId"', dateExpression: 'fd."createdAt"', organizationExpression: 'o.id',
    fields: {
      name: { label: 'نام فرم', expression: 'fd.name', type: 'text', groupable: true },
      code: { label: 'کد فرم', expression: 'fd.code', type: 'text', groupable: true },
      status: { label: 'وضعیت فرم', expression: 'fd.status', type: 'text', groupable: true },
      organizationName: { label: 'سازمان', expression: 'o.name', type: 'text', groupable: true },
      createdAt: { label: 'زمان ایجاد', expression: 'fd."createdAt"', type: 'date' },
    },
  },
  processes: {
    label: 'نمونه‌های فرایند', from: 'process_instances pi INNER JOIN organizations o ON o.id=pi."organizationId"', dateExpression: 'pi."startedAt"', organizationExpression: 'o.id',
    fields: {
      title: { label: 'عنوان فرایند', expression: 'pi.title', type: 'text', groupable: true },
      status: { label: 'وضعیت', expression: 'pi.status', type: 'text', groupable: true },
      startedAt: { label: 'زمان شروع', expression: 'pi."startedAt"', type: 'date' },
      completedAt: { label: 'زمان تکمیل', expression: 'pi."completedAt"', type: 'date' },
      organizationName: { label: 'سازمان', expression: 'o.name', type: 'text', groupable: true },
      durationHours: { label: 'مدت تکمیل (ساعت)', expression: 'EXTRACT(EPOCH FROM (pi."completedAt"-pi."startedAt"))/3600.0', type: 'number' },
      startedByUserId: { label: 'شناسه آغازگر', expression: 'pi."startedByUserId"::text', type: 'text', groupable: true },
    },
  },
  tasks: {
    label: 'وظایف گردش‌کار', from: 'workflow_tasks wt INNER JOIN process_instances pi ON pi.id=wt."processInstanceId" INNER JOIN organizations o ON o.id=pi."organizationId"', dateExpression: 'wt."createdAt"', organizationExpression: 'o.id',
    fields: {
      title: { label: 'عنوان وظیفه', expression: 'wt.title', type: 'text', groupable: true },
      status: { label: 'وضعیت وظیفه', expression: 'wt.status', type: 'text', groupable: true },
      createdAt: { label: 'زمان ایجاد', expression: 'wt."createdAt"', type: 'date' },
      completedAt: { label: 'زمان تکمیل', expression: 'wt."completedAt"', type: 'date' },
      dueAt: { label: 'مهلت انجام', expression: 'wt."dueAt"', type: 'date' },
      organizationName: { label: 'سازمان', expression: 'o.name', type: 'text', groupable: true },
      processTitle: { label: 'عنوان نمونه فرایند', expression: 'pi.title', type: 'text', groupable: true },
      durationHours: { label: 'زمان انجام (ساعت)', expression: 'EXTRACT(EPOCH FROM (wt."completedAt"-wt."createdAt"))/3600.0', type: 'number' },
    },
  },
  submissions: {
    label: 'پاسخ‌های فرم', from: 'form_submissions fs INNER JOIN form_versions fv ON fv.id=fs."formVersionId" INNER JOIN form_definitions fd ON fd.id=fv."definitionId" INNER JOIN organizations o ON o.id=fd."organizationId"', dateExpression: 'fs."submittedAt"', organizationExpression: 'o.id',
    fields: {
      formName: { label: 'نام فرم', expression: 'fd.name', type: 'text', groupable: true },
      formCode: { label: 'کد فرم', expression: 'fd.code', type: 'text', groupable: true },
      submittedAt: { label: 'زمان ثبت پاسخ', expression: 'fs."submittedAt"', type: 'date' },
      organizationName: { label: 'سازمان', expression: 'o.name', type: 'text', groupable: true },
      submittedByUserId: { label: 'شناسه ثبت‌کننده', expression: 'fs."submittedByUserId"::text', type: 'text', groupable: true },
      hasProcess: { label: 'دارای فرایند', expression: '(CASE WHEN fs."processInstanceId" IS NULL THEN \'خیر\' ELSE \'بله\' END)', type: 'text', groupable: true },
    },
  },
};

@Injectable()
export class ReportBuilderService {
  constructor(private readonly dataSource: DataSource) {}

  private hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

  async reportAccessOptions(tenantId: string, userId: string) {
    const [membership] = await this.dataSource.query(
      'SELECT tm."isTenantAdmin" FROM tenant_memberships tm JOIN tenants t ON t.id=tm."tenantId" AND t.status=\'ACTIVE\' JOIN users u ON u.id=tm."userId" AND u."isActive"=true WHERE tm."tenantId"=$1 AND tm."userId"=$2 AND tm."isActive"=true',
      [tenantId,userId],
    );
    if (!membership) throw new ForbiddenException('عضویت فعال مشتری یافت نشد');
    const [platform] = await this.dataSource.query(
      'SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" AND r.scope=\'PLATFORM\' AND r."isActive"=true JOIN role_permissions rp ON rp."roleId"=r.id JOIN permissions p ON p.id=rp."permissionId" AND p.code IN (\'tenant.reports.read\',\'*\') WHERE ur."userId"=$1 AND ur."isActive"=true LIMIT 1',
      [userId],
    );
    const tenantWide = membership.isTenantAdmin === true || Boolean(platform);
    return { tenantWide, organizations: await this.accessibleOrganizations(tenantId,userId) };
  }

  async accessibleOrganizations(tenantId: string, userId: string) {
    const [membership] = await this.dataSource.query(
      'SELECT tm."isTenantAdmin" FROM tenant_memberships tm JOIN tenants t ON t.id=tm."tenantId" AND t.status=\'ACTIVE\' JOIN users u ON u.id=tm."userId" AND u."isActive"=true WHERE tm."tenantId"=$1 AND tm."userId"=$2 AND tm."isActive"=true',
      [tenantId, userId],
    );
    if (!membership) throw new ForbiddenException('عضویت فعال مشتری یافت نشد');
    if (membership.isTenantAdmin === true) {
      return this.dataSource.query('SELECT id,name,code FROM organizations WHERE "tenantId"=$1 AND "isActive"=true ORDER BY name', [tenantId]);
    }
    const [platform] = await this.dataSource.query(
      'SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" AND r.scope=\'PLATFORM\' AND r."isActive"=true JOIN role_permissions rp ON rp."roleId"=r.id JOIN permissions p ON p.id=rp."permissionId" AND p.code IN (\'tenant.reports.read\',\'*\') WHERE ur."userId"=$1 AND ur."isActive"=true LIMIT 1',
      [userId],
    );
    if (platform) return this.dataSource.query('SELECT id,name,code FROM organizations WHERE "tenantId"=$1 AND "isActive"=true ORDER BY name', [tenantId]);
    return this.dataSource.query(
      `SELECT DISTINCT o.id,o.name,o.code
         FROM user_roles ur
         JOIN roles r ON r.id=ur."roleId" AND r."isActive"=true AND r.scope='ORGANIZATION'
         JOIN role_permissions rp ON rp."roleId"=r.id
         JOIN permissions p ON p.id=rp."permissionId" AND p.code='tenant.reports.read'
         JOIN organizations o ON o.id=ur."organizationId" AND o."tenantId"=ur."tenantId" AND o."isActive"=true
         JOIN tenant_memberships tm ON tm."tenantId"=ur."tenantId" AND tm."userId"=ur."userId" AND tm."isActive"=true
        WHERE ur."tenantId"=$1 AND ur."userId"=$2 AND ur."isActive"=true
        ORDER BY o.name`, [tenantId, userId]);
  }

  async resolveScope(tenantId: string, userId: string, organizationId?: string): Promise<ReportAccessScope> {
    const [membership] = await this.dataSource.query(
      'SELECT tm."isTenantAdmin" FROM tenant_memberships tm JOIN tenants t ON t.id=tm."tenantId" AND t.status=\'ACTIVE\' JOIN users u ON u.id=tm."userId" AND u."isActive"=true WHERE tm."tenantId"=$1 AND tm."userId"=$2 AND tm."isActive"=true',
      [tenantId, userId],
    );
    if (!membership) throw new ForbiddenException('عضویت فعال مشتری یافت نشد');
    const [platform] = await this.dataSource.query(
      'SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur."roleId" AND r.scope=\'PLATFORM\' AND r."isActive"=true JOIN role_permissions rp ON rp."roleId"=r.id JOIN permissions p ON p.id=rp."permissionId" AND p.code IN (\'tenant.reports.read\',\'*\') WHERE ur."userId"=$1 AND ur."isActive"=true LIMIT 1',
      [userId],
    );
    if (membership.isTenantAdmin === true || platform) {
      if (organizationId) {
        const [organization] = await this.dataSource.query('SELECT id FROM organizations WHERE id=$1 AND "tenantId"=$2 AND "isActive"=true', [organizationId,tenantId]);
        if (!organization) throw new ForbiddenException('سازمان انتخاب‌شده متعلق به مشتری فعال نیست');
      }
      return { tenantWide: true, organizationIds: [] };
    }
    const organizations = await this.accessibleOrganizations(tenantId, userId);
    const ids = organizations.map((item: { id: string }) => item.id);
    if (organizationId) {
      if (!ids.includes(organizationId)) throw new ForbiddenException('به سازمان انتخاب‌شده دسترسی گزارش ندارید');
      return { tenantWide: false, organizationIds: [organizationId] };
    }
    throw new ForbiddenException('برای گزارش‌خوانی سازمانی، سازمان باید انتخاب شود');
  }

  private async sourceFor(tenantId: string, spec: ReportSpec, organizationIds: string[] = []) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new BadRequestException('تعریف گزارش نامعتبر است');
    if (spec.organizationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(spec.organizationId)) throw new BadRequestException('شناسه سازمان معتبر نیست');
    const base = Object.prototype.hasOwnProperty.call(SOURCES, spec.source) ? SOURCES[spec.source] : undefined;
    if (!base) throw new BadRequestException('منبع داده مجاز نیست');
    const source: Source = { ...base, fields: { ...base.fields } };
    if (spec.source !== 'submissions') return source;
    const versions = await this.dataSource.query(
      `SELECT fv.id AS "versionId",fv."versionNumber",fv.schema,fd.name AS "formName"
         FROM form_versions fv
         JOIN form_definitions fd ON fd.id=fv."definitionId"
         JOIN organizations o ON o.id=fd."organizationId" AND o."tenantId"=$1 AND o."isActive"=true
        WHERE fv.status IN ('PUBLISHED','RETIRED') AND EXISTS (SELECT 1 FROM form_submissions existing_fs WHERE existing_fs."formVersionId"=fv.id) AND ($2::uuid[] IS NULL OR fd."organizationId"=ANY($2::uuid[]))
          AND ($3::uuid IS NULL OR fd."organizationId"=$3)
        ORDER BY fd.name,fv."versionNumber" DESC LIMIT 500`,
      [tenantId, organizationIds.length ? organizationIds : null, spec.organizationId ?? null],
    ) as Array<{ versionId: string; versionNumber: number; schema: unknown; formName: string }>;
    const seen = new Set<string>();
    const collect = (node: unknown, version: typeof versions[number], depth = 0, keyHint?: string): void => {
      if (depth > 12 || node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const child of node.slice(0, 500)) collect(child, version, depth + 1); return; }
      const item = node as Record<string, unknown>;
      const rawId = item.fieldId ?? item.fieldKey ?? item.id ?? item.key ?? item.name ?? keyHint;
      const rawType = String(item.fieldType ?? item.dataType ?? item.controlType ?? item.widgetType ?? item.inputType ?? item.type ?? '').toLowerCase();
      const rawLabel = item.label ?? item.title ?? item.caption ?? item.name;
      const fieldId = typeof rawId === 'string' ? rawId.trim() : '';
      const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
      const excluded = /password|secret|file|attachment|signature|hidden|image|camera|document|email|phone|mobile|national.?id|identity/.test(rawType) || /e-?mail|phone|mobile|موبایل|تلفن|شماره تماس|کد ملی|شناسه ملی|آدرس/.test(label) || item.sensitive === true || item.isSensitive === true || item.isHidden === true;
      const type: Field['type'] | null = /number|numeric|decimal|integer|currency|amount|rating/.test(rawType) ? 'number'
        : /date|time/.test(rawType) ? 'date'
        : /text|string|email|phone|select|radio|checkbox|boolean|lookup|dropdown|switch|combobox|autocomplete|url/.test(rawType) ? 'text' : null;
      if (!excluded && fieldId && label && type && /^[A-Za-z0-9_-]{1,100}$/.test(fieldId)) {
        const key = 'custom_' + version.versionId.replace(/-/g, '') + '_' + fieldId.replace(/[^A-Za-z0-9_]/g, '_');
        if (!seen.has(key)) {
          seen.add(key);
          const json = "fs.data ->> '" + fieldId + "'";
          let expression = json;
          if (type === 'number') expression = "CASE WHEN COALESCE(" + json + ",'') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (" + json + ")::numeric END";
          if (type === 'date') expression = "CASE WHEN pg_input_is_valid(" + json + ",'date') THEN (" + json + ")::date END";
          source.fields[key] = {
            label: version.formName + ' · v' + version.versionNumber + ' · ' + label,
            expression, type, groupable: type === 'text', filterable: true,
            whereExpression: "fv.id = '" + version.versionId + "'::uuid",
          };
        }
      }
      for (const key of ['fields', 'children', 'elements', 'components', 'items', 'properties', 'schema', 'pages', 'sections']) {
        if (item[key] !== undefined) {
          const nested = item[key];
          if (key === 'fields' && nested && typeof nested === 'object' && !Array.isArray(nested)) {
            for (const [fieldKey, fieldSchema] of Object.entries(nested as Record<string, unknown>)) collect(fieldSchema, version, depth + 1, fieldKey);
          } else collect(nested, version, depth + 1);
        }
      }
    };
    for (const version of versions) collect(version.schema, version);
    return source;
  }

  async catalog(tenantId: string, organizationIds: string[] = [], organizationId?: string, tenantWide = true) {
    const result: Array<{ key: string; label: string; fields: Array<{ key: string; label: string; type: string; groupable: boolean; filterable: boolean }>; aggregates: string[] }> = [];
    for (const [key, base] of Object.entries(SOURCES)) {
      if (!tenantWide && key === 'users') continue;
      if (key === 'users' && organizationId) continue;
      const source = await this.sourceFor(tenantId, { source: key, aggregate: 'count', organizationId }, organizationIds);
      result.push({
        key, label: source.label,
        fields: Object.entries(source.fields).map(([fieldKey, field]) => ({
          key: fieldKey, label: field.label, type: field.type,
          groupable: field.groupable === true, filterable: field.filterable !== false,
        })),
        aggregates: ['count', ...(Object.values(source.fields).some(field => field.type === 'number') ? ['sum', 'avg', 'min', 'max'] : [])],
      });
    }
    return result;
  }

  private date(value: unknown, fallback: Date, name: string): Date {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) throw new BadRequestException(name + ' باید با قالب YYYY-MM-DD باشد');
    const parsed = new Date(value + 'T00:00:00.000Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException(name + ' معتبر نیست');
    return parsed;
  }

  private validate(spec: ReportSpec, source: Source) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new BadRequestException('تعریف گزارش نامعتبر است');
    if (JSON.stringify(spec).length > 20000) throw new BadRequestException('حجم تعریف گزارش بیش از حد مجاز است');
    const allowed = ['source', 'from', 'to', 'groupBy', 'aggregate', 'measure', 'filters', 'limit', 'organizationId'];
    if (Object.keys(spec).some(key => !allowed.includes(key))) throw new BadRequestException('فیلد اضافی در تعریف گزارش مجاز نیست');
    if (!['count', 'sum', 'avg', 'min', 'max'].includes(spec.aggregate)) throw new BadRequestException('عملگر تجمیع نامعتبر است');
    if (spec.aggregate !== 'count') {
      const measure = spec.measure && Object.prototype.hasOwnProperty.call(source.fields, spec.measure) ? source.fields[spec.measure] : undefined;
      if (!measure || measure.type !== 'number') throw new BadRequestException('شاخص عددی انتخاب‌شده مجاز نیست');
    }
    if (spec.groupBy && (!Object.prototype.hasOwnProperty.call(source.fields, spec.groupBy) || !source.fields[spec.groupBy]?.groupable)) throw new BadRequestException('گروه‌بندی انتخاب‌شده مجاز نیست');
    if (spec.filters !== undefined && (!Array.isArray(spec.filters) || spec.filters.length > 10)) throw new BadRequestException('حداکثر ۱۰ شرط فیلتر مجاز است');
    for (const filter of spec.filters ?? []) {
      if (!filter || typeof filter !== 'object' || Array.isArray(filter) || Object.keys(filter).some(key => !['field', 'operator', 'value'].includes(key))) throw new BadRequestException('ساختار شرط فیلتر نامعتبر است');
      const field = Object.prototype.hasOwnProperty.call(source.fields, filter.field) ? source.fields[filter.field] : undefined;
      if (!field || field.filterable === false) throw new BadRequestException('فیلد فیلتر مجاز نیست');
      if (!['eq', 'neq', 'contains', 'in', 'gte', 'lte'].includes(filter.operator)) throw new BadRequestException('عملگر فیلتر نامعتبر است');
      if (filter.operator === 'contains' && field.type !== 'text') throw new BadRequestException('contains فقط برای فیلد متنی مجاز است');
      if (['gte', 'lte'].includes(filter.operator) && field.type === 'text') throw new BadRequestException('مقایسه بازه‌ای برای این فیلد مجاز نیست');
      if (filter.operator === 'in' && (!Array.isArray(filter.value) || filter.value.length < 1 || filter.value.length > 50)) throw new BadRequestException('فهرست مقادیر فیلتر نامعتبر است');
      const values = filter.operator === 'in' ? filter.value as unknown[] : [filter.value];
      if (values.some(value => value === null || value === undefined || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean'))) throw new BadRequestException('مقدار فیلتر نامعتبر است');
      if (values.some(value => typeof value === 'string' && value.length > 200)) throw new BadRequestException('طول مقدار فیلتر بیش از حد مجاز است');
      if (field.type === 'text' && values.some(value => typeof value !== 'string')) throw new BadRequestException('مقدار فیلد متنی باید رشته باشد');
      if (field.type === 'number' && values.some(value =>
        (typeof value !== 'number' && typeof value !== 'string') ||
        (typeof value === 'string' && !value.trim()) ||
        !Number.isFinite(Number(value)),
      )) throw new BadRequestException('مقدار فیلد عددی معتبر نیست');
      if (field.type === 'date' && values.some(value => {
        if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return true;
        const parsed = new Date(value + 'T00:00:00.000Z');
        return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value;
      })) throw new BadRequestException('مقدار تاریخ فیلتر معتبر نیست');
    }
    const limit = spec.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequestException('حداکثر ۲۰۰ ردیف برای گزارش مجاز است');
  }

  async execute(tenantId: string, spec: ReportSpec, scope: ReportAccessScope = { tenantWide: true, organizationIds: [] }): Promise<ReportResult> {
    const source = await this.sourceFor(tenantId, spec, scope.organizationIds);
    this.validate(spec, source);
    if (!scope.tenantWide && (!spec.organizationId || !scope.organizationIds.includes(spec.organizationId))) throw new ForbiddenException('گزارش باید به یکی از سازمان‌های مجاز محدود شود');
    if (!scope.tenantWide && !source.organizationExpression) throw new ForbiddenException('این منبع فقط برای گزارش‌خوانی سطح مشتری در دسترس است');
    if (spec.source === 'users' && spec.organizationId) throw new BadRequestException('گزارش اعضای مشتری فقط در حالت همه سازمان‌ها قابل اجراست');
    const scopedIds = scope.tenantWide ? (spec.organizationId ? [spec.organizationId] : []) : [spec.organizationId as string];
    const scopeHash = this.hash({ tenantWide: scope.tenantWide, organizationIds: scope.tenantWide ? ['*'] : scopedIds });
    const cacheKey = this.hash(spec);
    const [cached] = await this.dataSource.query(
      'SELECT payload FROM tenant_report_cache WHERE "tenantId"=$1 AND "scopeHash"=$2 AND "cacheKey"=$3 AND "expiresAt">now()',
      [tenantId, scopeHash, cacheKey],
    );
    if (cached?.payload) return { ...cached.payload, cached: true };
    const now = new Date();
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const defaultFrom = new Date(defaultTo.getTime() - 30 * 86400000);
    const from = this.date(spec.from, defaultFrom, 'from');
    const to = this.date(spec.to, defaultTo, 'to');
    if (from >= to || to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException('بازه گزارش باید مثبت و حداکثر ۳۶۶ روز باشد');
    const params: unknown[] = [tenantId, from, to];
    const tenantExpr = source.tenantExpression ?? 'o."tenantId"';
    const clauses = [tenantExpr + '=$1', source.dateExpression + '>=$2', source.dateExpression + '<$3'];
    if (source.organizationExpression && scopedIds.length) {
      params.push(scopedIds);
      clauses.push(source.organizationExpression + '=ANY($' + params.length + '::uuid[])');
    }
    const selectedFields = new Set<string>();
    if (spec.groupBy) selectedFields.add(spec.groupBy);
    if (spec.measure) selectedFields.add(spec.measure);
    for (const filter of spec.filters ?? []) selectedFields.add(filter.field);
    const customVersions = new Set(Array.from(selectedFields).map(key => source.fields[key]?.whereExpression?.match(/'([0-9a-f-]{36})'/i)?.[1]).filter(Boolean));
    if (customVersions.size > 1) throw new BadRequestException('فیلدهای سفارشی انتخاب‌شده باید متعلق به یک نسخه فرم باشند');
    for (const key of selectedFields) {
      const field = source.fields[key];
      if (field?.whereExpression) clauses.push(field.whereExpression);
    }
    for (const filter of spec.filters ?? []) {
      const field = source.fields[filter.field];
      const expression = field.expression;
      if (filter.operator === 'in') {
        const arrayType = field.type === 'number' ? 'numeric' : field.type === 'date' ? 'date' : 'text';
        const values = (filter.value as unknown[]).map(value => field.type === 'number' ? Number(value) : value);
        params.push(values);
        clauses.push(expression + '=ANY($' + params.length + '::' + arrayType + '[])');
      } else {
        let value = filter.value;
        if (filter.operator === 'contains') value = String(value);
        if (field.type === 'number') value = Number(value);
        params.push(value);
        const parameter = '$' + params.length;
        if (filter.operator === 'contains') clauses.push('POSITION(LOWER(' + parameter + ') IN LOWER((' + expression + ')::text))>0');
        else {
          const operator = ({ eq: '=', neq: '<>', gte: '>=', lte: '<=' } as const)[filter.operator];
          clauses.push(expression + operator + parameter);
        }
      }
    }
    const dimension = spec.groupBy ? source.fields[spec.groupBy] : undefined;
    const measure = spec.aggregate === 'count' ? null : source.fields[spec.measure as string];
    const metric = spec.aggregate === 'count' ? 'COUNT(*)' : spec.aggregate.toUpperCase() + '(' + measure!.expression + ')';
    const select = dimension ? dimension.expression + ' AS "dimension",' + metric + ' AS "value"' : metric + ' AS "value"';
    const group = dimension ? ' GROUP BY ' + dimension.expression + ' ORDER BY "value" DESC NULLS LAST' : '';
    const sql = 'SELECT ' + select + ' FROM ' + source.from + ' WHERE ' + clauses.join(' AND ') + group + ' LIMIT ' + (spec.limit ?? 100);
    const rows = await this.dataSource.transaction(async manager => {
      const timeoutMs = Number.isInteger(scope.executionTimeoutMs) ? Math.min(60000, Math.max(1000, scope.executionTimeoutMs as number)) : 10000;
      await manager.query("SELECT set_config('statement_timeout',$1,true)", [timeoutMs + 'ms']);
      return manager.query(sql, params);
    });
    const payload: ReportResult = {
      source: spec.source, sourceLabel: source.label, groupBy: spec.groupBy ?? null,
      groupLabel: dimension?.label ?? null, aggregate: spec.aggregate,
      measureLabel: measure?.label ?? 'تعداد',
      period: { from: from.toISOString(), to: to.toISOString() },
      rows: rows.map((row: any) => ({ dimension: row.dimension === null || row.dimension === undefined ? null : String(row.dimension), value: row.value === null ? null : Number(row.value) })),
      rowCount: rows.length, generatedAt: new Date().toISOString(), cached: false,
    };
    await this.dataSource.query(
      'INSERT INTO tenant_report_cache ("tenantId","scopeHash","cacheKey",payload,"expiresAt") VALUES ($1,$2,$3,$4::jsonb,now()+interval \'60 seconds\') ON CONFLICT ("tenantId","scopeHash","cacheKey") DO UPDATE SET payload=EXCLUDED.payload,"expiresAt"=EXCLUDED."expiresAt","createdAt"=now()',
      [tenantId, scopeHash, cacheKey, JSON.stringify(payload)],
    );
    return payload;
  }

  async listSaved(tenantId: string, userId: string, organizationId?: string, tenantWide = true) {
    return this.dataSource.query(
      'SELECT id,title,description,"isShared","createdAt","updatedAt","ownerUserId",("ownerUserId"=$2) AS "isOwner" FROM tenant_saved_reports WHERE "tenantId"=$1 AND ("ownerUserId"=$2 OR "isShared"=true) AND ($3::uuid IS NULL OR config->>\'organizationId\'=$3::text) AND ($4::boolean OR config->>\'organizationId\' IS NOT NULL) ORDER BY "updatedAt" DESC LIMIT 100',
      [tenantId, userId, organizationId ?? null, tenantWide],
    );
  }

  async getSaved(tenantId: string, userId: string, id: string, organizationId?: string, tenantWide = true) {
    const [report] = await this.dataSource.query(
      'SELECT id,title,description,"isShared",config,"ownerUserId","createdAt","updatedAt",("ownerUserId"=$3) AS "isOwner" FROM tenant_saved_reports WHERE id=$1 AND "tenantId"=$2 AND ("ownerUserId"=$3 OR "isShared"=true) AND ($4::uuid IS NULL OR config->>\'organizationId\'=$4::text) AND ($5::boolean OR config->>\'organizationId\' IS NOT NULL)',
      [id, tenantId, userId, organizationId ?? null, tenantWide],
    );
    if (!report) throw new NotFoundException('گزارش ذخیره‌شده پیدا نشد');
    return report;
  }

  async save(tenantId: string, userId: string, input: { title: string; description?: string; isShared?: boolean; config: ReportSpec }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('اطلاعات ذخیره گزارش نامعتبر است');
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 160) throw new BadRequestException('عنوان گزارش الزامی و حداکثر ۱۶۰ نویسه است');
    if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 1000)) throw new BadRequestException('توضیحات گزارش نامعتبر است');
    const source = await this.sourceFor(tenantId, input.config, input.config.organizationId ? [input.config.organizationId] : []);
    this.validate(input.config, source);
    const [row] = await this.dataSource.query(
      'INSERT INTO tenant_saved_reports ("tenantId","ownerUserId",title,description,config,"isShared") VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id,title,description,"isShared","createdAt","updatedAt"',
      [tenantId, userId, title, input.description?.trim() || null, JSON.stringify(input.config), input.isShared === true],
    );
    return row;
  }

  async update(tenantId: string, userId: string, id: string, input: { title?: string; description?: string; isShared?: boolean; config?: ReportSpec }, organizationId?: string, tenantWide = true) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('اطلاعات ویرایش گزارش نامعتبر است');
    const current = await this.dataSource.query(
      'SELECT id FROM tenant_saved_reports WHERE id=$1 AND "tenantId"=$2 AND "ownerUserId"=$3 AND ($4::uuid IS NULL OR config->>\'organizationId\'=$4::text) AND ($5::boolean OR config->>\'organizationId\' IS NOT NULL)',
      [id, tenantId, userId, organizationId ?? null, tenantWide],
    );
    if (!current.length) throw new NotFoundException('گزارش متعلق به کاربر جاری پیدا نشد');
    const sets: string[] = [];
    const params: unknown[] = [id, tenantId, userId];
    if (input.title !== undefined) {
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 160) throw new BadRequestException('عنوان گزارش نامعتبر است');
      params.push(input.title.trim()); sets.push('title=$' + params.length);
    }
    if (input.description !== undefined) {
      if (typeof input.description !== 'string' || input.description.length > 1000) throw new BadRequestException('توضیحات گزارش نامعتبر است');
      params.push(input.description.trim() || null); sets.push('description=$' + params.length);
    }
    if (input.isShared !== undefined) { params.push(input.isShared === true); sets.push('"isShared"=$' + params.length); }
    if (input.config !== undefined) {
      const source = await this.sourceFor(tenantId, input.config, input.config.organizationId ? [input.config.organizationId] : []);
      this.validate(input.config, source);
      params.push(JSON.stringify(input.config)); sets.push('config=$' + params.length + '::jsonb');
    }
    if (!sets.length) throw new BadRequestException('تغییری برای ذخیره ارسال نشده است');
    sets.push('"updatedAt"=now()');
    const organizationParameter = params.length + 1;
    params.push(organizationId ?? null);
    const tenantWideParameter = params.length + 1;
    params.push(tenantWide);
    const scopeWhere = ' AND ($' + organizationParameter + '::uuid IS NULL OR config->>\'organizationId\'=$' + organizationParameter + '::text) AND ($' + tenantWideParameter + '::boolean OR config->>\'organizationId\' IS NOT NULL)';
    const [row] = await this.dataSource.query(
      'UPDATE tenant_saved_reports SET ' + sets.join(',') + ' WHERE id=$1 AND "tenantId"=$2 AND "ownerUserId"=$3' + scopeWhere + ' RETURNING id,title,description,"isShared","createdAt","updatedAt"',
      params,
    );
    return row;
  }

  async remove(tenantId: string, userId: string, id: string, organizationId?: string, tenantWide = true) {
    const rows = await this.dataSource.query(
      'DELETE FROM tenant_saved_reports WHERE id=$1 AND "tenantId"=$2 AND "ownerUserId"=$3 AND ($4::uuid IS NULL OR config->>\'organizationId\'=$4::text) AND ($5::boolean OR config->>\'organizationId\' IS NOT NULL) RETURNING id',
      [id, tenantId, userId, organizationId ?? null, tenantWide],
    );
    if (!rows.length) throw new NotFoundException('گزارش متعلق به کاربر جاری پیدا نشد');
    return { deleted: true };
  }

  async executeSaved(tenantId: string, userId: string, id: string, scope: ReportAccessScope) {
    const report = await this.getSaved(tenantId, userId, id, scope.tenantWide ? undefined : scope.organizationIds[0], scope.tenantWide);
    return { report: { id: report.id, title: report.title }, result: await this.execute(tenantId, report.config, scope) };
  }

  async createJob(tenantId: string, userId: string, spec: ReportSpec, scope: ReportAccessScope) {
    const source = await this.sourceFor(tenantId, spec, scope.organizationIds);
    this.validate(spec, source);
    if (!scope.tenantWide && (!source.organizationExpression || !spec.organizationId || !scope.organizationIds.includes(spec.organizationId))) throw new ForbiddenException('این منبع باید به یک سازمان مجاز محدود شود');
    return this.dataSource.transaction(async manager => {
      const membership = await manager.query(
        'SELECT 1 FROM tenant_memberships WHERE "tenantId"=$1 AND "userId"=$2 AND "isActive"=true FOR UPDATE',
        [tenantId, userId],
      );
      if (!membership.length) throw new ForbiddenException('عضویت فعال مشتری یافت نشد');
      const [pending] = await manager.query(
        'SELECT count(*)::int AS count FROM tenant_report_jobs WHERE "tenantId"=$1 AND "ownerUserId"=$2 AND status IN (\'PENDING\',\'PROCESSING\')',
        [tenantId, userId],
      );
      if (Number(pending?.count ?? 0) >= 10) throw new BadRequestException('حداکثر ۱۰ گزارش پس‌زمینه فعال یا در صف برای هر کاربر مجاز است');
      const [job] = await manager.query(
        'INSERT INTO tenant_report_jobs ("tenantId","ownerUserId","organizationId",config,"scopeOrganizationIds","isTenantWide",status) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,\'PENDING\') RETURNING id,status,"createdAt"',
        [tenantId, userId, spec.organizationId ?? null, JSON.stringify(spec), JSON.stringify(scope.organizationIds), scope.tenantWide],
      );
      return job;
    });
  }

  async getJob(tenantId: string, userId: string, id: string, scope: ReportAccessScope) {
    const [job] = await this.dataSource.query(
      'SELECT id,status,result,error,"organizationId","createdAt","startedAt","completedAt" FROM tenant_report_jobs WHERE id=$1 AND "tenantId"=$2 AND "ownerUserId"=$3',
      [id, tenantId, userId],
    );
    if (!job || (!scope.tenantWide && !scope.organizationIds.includes(job.organizationId))) throw new NotFoundException('گزارش پس‌زمینه پیدا نشد');
    return job;
  }

  async createSchedule(tenantId: string, userId: string, input: { config: ReportSpec; frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'; weekday?: number; timeOfDay: string; timezone: string }, scope: ReportAccessScope, nextRunAt: Date) {
    if (!input || !['DAILY', 'WEEKLY', 'MONTHLY'].includes(input.frequency)) throw new BadRequestException('تناوب زمان‌بندی معتبر نیست');
    const configuredKey = process.env.FSB_OUTBOX_ENCRYPTION_KEY;
    const decodedKey = configuredKey ? (/^[a-f0-9]{64}$/i.test(configuredKey) ? Buffer.from(configuredKey,'hex') : Buffer.from(configuredKey,'base64')) : Buffer.alloc(0);
    if (decodedKey.length !== 32) throw new ServiceUnavailableException('برای ارسال زمان‌بندی‌شده، کلید رمزگذاری Outbox با طول ۳۲ بایت باید تنظیم شود');
    if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(input.timeOfDay)) throw new BadRequestException('ساعت باید با قالب HH:MM باشد');
    if (typeof input.timezone !== 'string' || input.timezone.length > 80) throw new BadRequestException('منطقه زمانی معتبر نیست');
    try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(new Date()); } catch { throw new BadRequestException('منطقه زمانی معتبر نیست'); }
    if (input.frequency === 'WEEKLY' && (!Number.isInteger(input.weekday) || (input.weekday as number) < 0 || (input.weekday as number) > 6)) throw new BadRequestException('روز هفته برای زمان‌بندی هفتگی الزامی است');
    const source = await this.sourceFor(tenantId, input.config, scope.organizationIds);
    this.validate(input.config, source);
    if (!scope.tenantWide && (!source.organizationExpression || !input.config.organizationId || !scope.organizationIds.includes(input.config.organizationId))) throw new ForbiddenException('این منبع باید به یک سازمان مجاز محدود شود');
    return this.dataSource.transaction(async manager => {
      const membership = await manager.query(
        'SELECT 1 FROM tenant_memberships WHERE "tenantId"=$1 AND "userId"=$2 AND "isActive"=true FOR UPDATE',
        [tenantId, userId],
      );
      if (!membership.length) throw new ForbiddenException('عضویت فعال مشتری یافت نشد');
      const [recipient] = await manager.query(
        'SELECT u.email FROM users u WHERE u.id=$1 AND u."isActive"=true AND u.email IS NOT NULL',
        [userId],
      );
      if (!recipient?.email) throw new BadRequestException('برای زمان‌بندی گزارش، حساب کاربر باید ایمیل فعال داشته باشد');
      const [activeSchedules] = await manager.query(
        'SELECT count(*)::int AS count FROM tenant_report_schedules WHERE "tenantId"=$1 AND "ownerUserId"=$2 AND "isActive"=true',
        [tenantId, userId],
      );
      if (Number(activeSchedules?.count ?? 0) >= 20) throw new BadRequestException('حداکثر ۲۰ زمان‌بندی فعال برای هر کاربر مجاز است');
      const [row] = await manager.query(
        'INSERT INTO tenant_report_schedules ("tenantId","ownerUserId","organizationId",config,"scopeOrganizationIds","isTenantWide",frequency,weekday,"timeOfDay",timezone,"nextRunAt") VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9::time,$10,$11) RETURNING id,frequency,weekday,"timeOfDay",timezone,"nextRunAt","isActive"',
        [tenantId, userId, input.config.organizationId ?? null, JSON.stringify(input.config), JSON.stringify(scope.organizationIds), scope.tenantWide, input.frequency, input.frequency === 'WEEKLY' ? input.weekday : null, input.timeOfDay, input.timezone, nextRunAt],
      );
      return row;
    });
  }

  async listSchedules(tenantId: string, userId: string, organizationId?: string, tenantWide = true) {
    return this.dataSource.query(
      'SELECT id,frequency,weekday,"timeOfDay",timezone,"isActive","nextRunAt","lastRunAt","lastJobId","organizationId","createdAt" FROM tenant_report_schedules WHERE "tenantId"=$1 AND "ownerUserId"=$2 AND ($3::uuid IS NULL OR "organizationId"=$3) AND ($4::boolean OR "organizationId" IS NOT NULL) ORDER BY "createdAt" DESC LIMIT 100',
      [tenantId, userId, organizationId ?? null, tenantWide],
    );
  }

  async setScheduleActive(tenantId: string, userId: string, id: string, active: boolean, organizationId?: string, tenantWide = true) {
    const rows = await this.dataSource.query(
      'UPDATE tenant_report_schedules SET "isActive"=$4,"updatedAt"=now() WHERE id=$1 AND "tenantId"=$2 AND "ownerUserId"=$3 AND ($5::uuid IS NULL OR "organizationId"=$5) AND ($6::boolean OR "organizationId" IS NOT NULL) RETURNING id,"isActive","nextRunAt"',
      [id, tenantId, userId, active, organizationId ?? null, tenantWide],
    );
    if (!rows.length) throw new NotFoundException('زمان‌بندی گزارش پیدا نشد');
    return rows[0];
  }

  csv(result: ReportResult) {
    const quote = (value: unknown) => {
      let text = value === null || value === undefined ? '' : String(value);
      if (/^[\s]*[=+@\\-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const rows = [[result.groupLabel ?? 'گروه', result.measureLabel], ...result.rows.map(row => [row.dimension ?? 'همه', row.value])];
    return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
  }
}
