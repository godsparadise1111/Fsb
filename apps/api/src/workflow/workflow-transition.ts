import { BadRequestException, ConflictException } from '@nestjs/common';

export type WorkflowTransitionAction = 'APPROVED' | 'REJECTED' | 'RETURNED';

export function resolveWorkflowTransitionTarget(
  schema: Record<string, unknown>,
  fromStepIndex: number,
  action: WorkflowTransitionAction,
  fallbackTarget: number | null,
  requireExplicit = false,
): number | null {
  const transitions = schema?.transitions;
  if (transitions === undefined) return fallbackTarget;
  if (!Array.isArray(transitions)) throw new ConflictException('Published process transition graph is invalid');
  const matches = transitions.filter((edge: any) =>
    edge && edge.fromStepIndex === fromStepIndex && edge.action === action,
  );
  if (!matches.length) {
    if (requireExplicit) throw new BadRequestException(`No ${action} transition is configured for step ${fromStepIndex + 1}`);
    return fallbackTarget;
  }
  if (matches.length !== 1) throw new ConflictException('Process transition graph contains ambiguous rules');
  const target = matches[0].toStepIndex;
  if (target === null) return null;
  if (!Number.isInteger(target) || target < 0) throw new ConflictException('Process transition target is invalid');
  return target as number;
}
