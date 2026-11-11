import { BadRequestException, ConflictException } from '@nestjs/common';

export type WorkflowTransitionAction = 'APPROVED' | 'REJECTED' | 'RETURNED';
type Condition = { field: string; operator: string; value?: unknown };

function readPath(data: Record<string, unknown>, path: string): unknown {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,7}$/.test(path)) {
    throw new ConflictException('Transition condition field path is invalid');
  }
  return path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)[key]
      : undefined, data);
}

function evaluateCondition(raw: unknown, data: Record<string, unknown>): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConflictException('Transition condition must be an object');
  }
  const condition = raw as Condition;
  if (typeof condition.field !== 'string' || typeof condition.operator !== 'string') {
    throw new ConflictException('Transition condition requires field and operator');
  }
  const actual = readPath(data, condition.field);
  switch (condition.operator) {
    case 'exists': return actual !== undefined && actual !== null;
    case 'eq': return actual === condition.value;
    case 'neq': return actual !== condition.value;
    case 'gt': return typeof actual === 'number' && typeof condition.value === 'number' && actual > condition.value;
    case 'gte': return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value;
    case 'lt': return typeof actual === 'number' && typeof condition.value === 'number' && actual < condition.value;
    case 'lte': return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value;
    case 'in': return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'contains': return typeof actual === 'string' && typeof condition.value === 'string' && actual.includes(condition.value);
    default: throw new ConflictException('Transition condition operator is not supported');
  }
}

function matchesRule(raw: unknown, data: Record<string, unknown>): boolean {
  if (raw === undefined) return true;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConflictException('Transition condition is invalid');
  const rule = raw as Record<string, unknown>;
  if (rule.all !== undefined || rule.any !== undefined) {
    const all = rule.all === undefined ? [] : rule.all;
    const any = rule.any === undefined ? [] : rule.any;
    if (!Array.isArray(all) || !Array.isArray(any) || all.length + any.length === 0 || all.length > 20 || any.length > 20) {
      throw new ConflictException('Transition all/any conditions must contain 1 to 20 rules in total');
    }
    return all.every(item => evaluateCondition(item, data)) &&
      (any.length === 0 || any.some(item => evaluateCondition(item, data)));
  }
  return evaluateCondition(rule, data);
}

export function resolveWorkflowTransitionTarget(
  schema: Record<string, unknown>,
  fromStepIndex: number,
  action: WorkflowTransitionAction,
  fallbackTarget: number | null,
  requireExplicit = false,
  data: Record<string, unknown> = {},
): number | null {
  const transitions = schema?.transitions;
  if (transitions === undefined) return fallbackTarget;
  if (!Array.isArray(transitions)) throw new ConflictException('Published process transition graph is invalid');
  const candidates = transitions.filter((edge: any) =>
    edge && edge.fromStepIndex === fromStepIndex && edge.action === action,
  );
  if (!candidates.length) {
    if (requireExplicit) throw new BadRequestException(`No ${action} transition is configured for step ${fromStepIndex + 1}`);
    return fallbackTarget;
  }
  const matching = candidates.filter((edge: any) => matchesRule(edge.when, data));
  if (!matching.length) throw new BadRequestException(`No ${action} transition condition matched for step ${fromStepIndex + 1}`);
  if (matching.length !== 1) throw new ConflictException('Process transition graph contains ambiguous matching rules');
  const target = matching[0].toStepIndex;
  if (target === null) return null;
  if (!Number.isInteger(target) || target < 0) throw new ConflictException('Process transition target is invalid');
  return target as number;
}
