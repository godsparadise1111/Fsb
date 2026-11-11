import { BadRequestException } from '@nestjs/common';

type Field = { name: string; label: string; type: string; required?: boolean; options?: unknown[] };
type Condition = { field: string; operator: string; value?: unknown };
const operators = new Set(['exists', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);
const fieldTypes = new Set(['text', 'textarea', 'number', 'date', 'select', 'checkbox']);

function readValue(data: Record<string, unknown>, path: string): unknown {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(path)) return undefined;
  return data[path];
}

function conditionMatches(raw: unknown, data: Record<string, unknown>): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Form rule condition must be an object');
  const condition = raw as Condition;
  if (typeof condition.field !== 'string' || !operators.has(condition.operator)) throw new BadRequestException('Form rule condition is invalid');
  const actual = readValue(data, condition.field);
  switch (condition.operator) {
    case 'exists': return actual !== undefined && actual !== null && actual !== '';
    case 'eq': return actual === condition.value;
    case 'neq': return actual !== condition.value;
    case 'gt': return typeof actual === 'number' && typeof condition.value === 'number' && actual > condition.value;
    case 'gte': return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value;
    case 'lt': return typeof actual === 'number' && typeof condition.value === 'number' && actual < condition.value;
    case 'lte': return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value;
    case 'in': return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'contains': return typeof actual === 'string' && typeof condition.value === 'string' && actual.includes(condition.value);
    default: return false;
  }
}

export function validateFormSchema(schema: Record<string, unknown>): Field[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new BadRequestException('Form schema must be an object');
  const fields = schema.fields;
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 200) throw new BadRequestException('Form schema must contain 1 to 200 fields');
  const names = new Set<string>();
  const parsed = fields.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException(`Form field ${index + 1} must be an object`);
    const field = raw as Record<string, unknown>;
    if (typeof field.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.name) || names.has(field.name)) {
      throw new BadRequestException(`Form field ${index + 1} has an invalid or duplicate name`);
    }
    if (typeof field.label !== 'string' || field.label.trim().length < 1 || field.label.length > 160) {
      throw new BadRequestException(`Form field ${index + 1} requires a label of 1 to 160 characters`);
    }
    if (typeof field.type !== 'string' || !fieldTypes.has(field.type)) throw new BadRequestException(`Form field ${index + 1} has an unsupported type`);
    if (field.required !== undefined && typeof field.required !== 'boolean') throw new BadRequestException(`Form field ${index + 1} required must be boolean`);
    if (field.type === 'select' && (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 100 ||
      field.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 160))) {
      throw new BadRequestException(`Select field ${index + 1} requires 1 to 100 string options`);
    }
    names.add(field.name);
    return field as unknown as Field;
  });
  const rules = schema.rules ?? [];
  if (!Array.isArray(rules) || rules.length > 200) throw new BadRequestException('Form rules must be an array of at most 200 items');
  for (const [index, raw] of rules.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException(`Form rule ${index + 1} must be an object`);
    const rule = raw as Record<string, unknown>;
    if (!rule.when || typeof rule.when !== 'object' || Array.isArray(rule.when)) throw new BadRequestException(`Form rule ${index + 1} requires a condition`);
    const condition = rule.when as Condition;
    if (typeof condition.field !== 'string' || !names.has(condition.field) || !operators.has(condition.operator)) {
      throw new BadRequestException(`Form rule ${index + 1} references an unknown field or unsupported operator`);
    }
    if (!rule.then || typeof rule.then !== 'object' || Array.isArray(rule.then)) throw new BadRequestException(`Form rule ${index + 1} requires a then object`);
    const then = rule.then as Record<string, unknown>;
    for (const key of ['required', 'visible', 'hidden']) {
      if (then[key] !== undefined && (!Array.isArray(then[key]) || (then[key] as unknown[]).length > 200 ||
        (then[key] as unknown[]).some(name => typeof name !== 'string' || !names.has(name)))) {
        throw new BadRequestException(`Form rule ${index + 1} then.${key} contains an unknown field`);
      }
    }
  }
  return parsed;
}

export function validateFormSubmission(schema: Record<string, unknown>, data: Record<string, unknown>): void {
  const fields = validateFormSchema(schema);
  const allowed = new Set(fields.map(field => field.name));
  for (const key of Object.keys(data)) if (!allowed.has(key)) throw new BadRequestException(`Unknown form field: ${key}`);
  const required = new Set(fields.filter(field => field.required === true).map(field => field.name));
  const hidden = new Set<string>();
  const visibleTargets = new Set<string>();
  const visibleNow = new Set<string>();
  for (const raw of (schema.rules as Array<Record<string, unknown>> | undefined) ?? []) {
    const then = raw.then as Record<string, unknown>;
    for (const name of (then.visible as string[] | undefined) ?? []) visibleTargets.add(name);
    if (!conditionMatches(raw.when, data)) continue;
    for (const name of (then.visible as string[] | undefined) ?? []) visibleNow.add(name);
    for (const name of (then.required as string[] | undefined) ?? []) required.add(name);
    for (const name of (then.hidden as string[] | undefined) ?? []) hidden.add(name);
  }
  for (const field of fields) {
    if (hidden.has(field.name) || (visibleTargets.has(field.name) && !visibleNow.has(field.name))) continue;
    const value = data[field.name];
    if (required.has(field.name) && (value === undefined || value === null || value === '')) {
      throw new BadRequestException(`Form field ${field.name} is required`);
    }
    if (value === undefined || value === null || value === '') continue;
    if (field.type === 'text' || field.type === 'textarea' || field.type === 'date') {
      if (typeof value !== 'string') throw new BadRequestException(`Form field ${field.name} must be text`);
    } else if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadRequestException(`Form field ${field.name} must be a finite number`);
    } else if (field.type === 'checkbox') {
      if (typeof value !== 'boolean') throw new BadRequestException(`Form field ${field.name} must be boolean`);
    } else if (field.type === 'select') {
      if (typeof value !== 'string' || !(field.options as string[]).includes(value)) throw new BadRequestException(`Form field ${field.name} has an invalid option`);
    }
  }
}
