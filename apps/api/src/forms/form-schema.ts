import { BadRequestException } from '@nestjs/common';

type Field = {
  name: string; label: string; type: string; required?: boolean; options?: unknown[];
  minLength?: number; maxLength?: number; min?: number; max?: number;
};
type Condition = { field: string; operator: string; value?: unknown };
const operators = new Set(['exists', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);
const fieldTypes = new Set(['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'email', 'multiselect']);
const optionTypes = new Set(['select', 'multiselect']);
const textTypes = new Set(['text', 'textarea', 'email']);
// Defaults protect the database from oversized values when the designer did not set maxLength.
const DEFAULT_MAX_LENGTH: Record<string, number> = { text: 5000, textarea: 20000, email: 190 };
const HARD_MAX_LENGTH = 20000;

function readValue(data: Record<string, unknown>, path: string): unknown {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(path)) return undefined;
  return data[path];
}

/** Converts Persian and Arabic-Indic digits to ASCII so dates typed with a Persian keyboard validate. */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, ch => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x0660));
}

/** Accepts a real Gregorian date (YYYY-MM-DD) or a Jalali date (YYYY/MM/DD or YYYY-MM-DD, years 1300-1600). */
export function isValidDateString(raw: string): boolean {
  const value = normalizeDigits(raw.trim());
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year >= 1900 && year <= 2200) {
    if (!value.includes('-')) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  if (year >= 1300 && year <= 1600) {
    if (month < 1 || month > 12 || day < 1) return false;
    return day <= (month <= 6 ? 31 : 30);
  }
  return false;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function conditionMatches(raw: unknown, data: Record<string, unknown>): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Form rule condition must be an object');
  const condition = raw as Condition;
  if (typeof condition.field !== 'string' || !operators.has(condition.operator)) throw new BadRequestException('Form rule condition is invalid');
  const actual = readValue(data, condition.field);
  switch (condition.operator) {
    case 'exists': return actual !== undefined && actual !== null && actual !== '' && !(Array.isArray(actual) && actual.length === 0);
    case 'eq': return actual === condition.value;
    case 'neq': return actual !== condition.value;
    case 'gt': return typeof actual === 'number' && typeof condition.value === 'number' && actual > condition.value;
    case 'gte': return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value;
    case 'lt': return typeof actual === 'number' && typeof condition.value === 'number' && actual < condition.value;
    case 'lte': return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value;
    case 'in': return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(condition.value);
      return typeof actual === 'string' && typeof condition.value === 'string' && actual.includes(condition.value);
    default: return false;
  }
}

function optionalInteger(field: Record<string, unknown>, key: string, index: number, min: number, max: number): number | undefined {
  const value = field[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new BadRequestException(`Form field ${index + 1} ${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalFinite(field: Record<string, unknown>, key: string, index: number): number | undefined {
  const value = field[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadRequestException(`Form field ${index + 1} ${key} must be a finite number`);
  return value;
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
    if (optionTypes.has(field.type) && (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 100 ||
      field.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 160) ||
      new Set(field.options as string[]).size !== field.options.length)) {
      throw new BadRequestException(`Select field ${index + 1} requires 1 to 100 unique string options`);
    }
    if (textTypes.has(field.type)) {
      const minLength = optionalInteger(field, 'minLength', index, 0, HARD_MAX_LENGTH);
      const maxLength = optionalInteger(field, 'maxLength', index, 1, HARD_MAX_LENGTH);
      if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
        throw new BadRequestException(`Form field ${index + 1} minLength cannot exceed maxLength`);
      }
    } else if (field.minLength !== undefined || field.maxLength !== undefined) {
      throw new BadRequestException(`Form field ${index + 1} minLength/maxLength apply only to text fields`);
    }
    if (field.type === 'number') {
      const min = optionalFinite(field, 'min', index);
      const max = optionalFinite(field, 'max', index);
      if (min !== undefined && max !== undefined && min > max) throw new BadRequestException(`Form field ${index + 1} min cannot exceed max`);
    } else if (field.min !== undefined || field.max !== undefined) {
      throw new BadRequestException(`Form field ${index + 1} min/max apply only to number fields`);
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

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

export function validateFormSubmission(schema: Record<string, unknown>, data: Record<string, unknown>): void {
  const fields = validateFormSchema(schema);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('Form data must be an object');
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
    if (required.has(field.name) && isEmpty(value)) {
      throw new BadRequestException(`Form field ${field.name} is required`);
    }
    if (isEmpty(value)) continue;
    if (textTypes.has(field.type) || field.type === 'date') {
      if (typeof value !== 'string') throw new BadRequestException(`Form field ${field.name} must be text`);
      if (field.type === 'date') {
        if (!isValidDateString(value)) throw new BadRequestException(`Form field ${field.name} must be a valid date`);
      } else {
        const max = field.maxLength ?? DEFAULT_MAX_LENGTH[field.type];
        if (value.length > max) throw new BadRequestException(`Form field ${field.name} exceeds ${max} characters`);
        if (field.minLength !== undefined && value.length < field.minLength) throw new BadRequestException(`Form field ${field.name} needs at least ${field.minLength} characters`);
        if (field.type === 'email' && !emailPattern.test(value)) throw new BadRequestException(`Form field ${field.name} must be a valid email address`);
      }
    } else if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadRequestException(`Form field ${field.name} must be a finite number`);
      if (field.min !== undefined && value < field.min) throw new BadRequestException(`Form field ${field.name} must be at least ${field.min}`);
      if (field.max !== undefined && value > field.max) throw new BadRequestException(`Form field ${field.name} must be at most ${field.max}`);
    } else if (field.type === 'checkbox') {
      if (typeof value !== 'boolean') throw new BadRequestException(`Form field ${field.name} must be boolean`);
    } else if (field.type === 'select') {
      if (typeof value !== 'string' || !(field.options as string[]).includes(value)) throw new BadRequestException(`Form field ${field.name} has an invalid option`);
    } else if (field.type === 'multiselect') {
      const options = field.options as string[];
      if (!Array.isArray(value) || value.length > options.length || new Set(value).size !== value.length ||
        value.some(item => typeof item !== 'string' || !options.includes(item))) {
        throw new BadRequestException(`Form field ${field.name} has an invalid selection`);
      }
    }
  }
}
