import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export interface RecoveryReplayContext {
  manager: EntityManager;
  tenantId: string;
  incidentId: string;
  processInstanceId: string;
  incidentType: string;
  fingerprint: string;
  idempotencyKey: string;
  details: Record<string, unknown>;
}

export interface RecoveryReplayHandler {
  readonly id: string;
  readonly incidentTypes: readonly string[];
  readonly systemOnly: true;
  readonly idempotent: true;
  readonly requiresIdempotencyKey: true;
  readonly mayPerformHumanAction: false;
  readonly mayAdvanceProcessStage: false;
  execute(context: RecoveryReplayContext): Promise<Record<string, unknown>>;
}

/**
 * Explicit allow-list for system recovery handlers.
 * Empty by default: adding a handler requires code review and an implementation
 * that persists its idempotency key in the same transaction as its effects.
 */
@Injectable()
export class WorkflowRecoveryReplayRegistry {
  private readonly handlers = new Map<string, RecoveryReplayHandler>();

  register(handler: RecoveryReplayHandler): void {
    if (!handler.id || !/^[a-z0-9][a-z0-9._-]{2,79}$/.test(handler.id)) throw new Error('Invalid recovery handler id');
    if (handler.systemOnly !== true || handler.idempotent !== true ||
        handler.requiresIdempotencyKey !== true || handler.mayPerformHumanAction !== false ||
        handler.mayAdvanceProcessStage !== false) {
      throw new Error('Recovery replay handlers must be system-only, idempotent, key-protected and must never perform human actions or advance stages');
    }
    if (!handler.incidentTypes.length || handler.incidentTypes.some(type =>
      !['TERMINAL_PROCESS_HAS_ACTIVE_TASKS','RUNNING_PROCESS_TASK_COUNT_MISMATCH'].includes(type))) {
      throw new Error('Handler incident types must be explicitly allow-listed');
    }
    if (this.handlers.has(handler.id)) throw new Error('Recovery replay handler already registered');
    for (const type of handler.incidentTypes) {
      if ([...this.handlers.values()].some(existing => existing.incidentTypes.includes(type))) {
        throw new Error(`A replay handler is already registered for ${type}`);
      }
    }
    this.handlers.set(handler.id, Object.freeze(handler));
  }

  resolve(incidentType: string): RecoveryReplayHandler | null {
    return [...this.handlers.values()].find(handler => handler.incidentTypes.includes(incidentType)) ?? null;
  }

  listCapabilities() {
    return [...this.handlers.values()].map(handler => ({
      id: handler.id,
      incidentTypes: [...handler.incidentTypes],
      systemOnly: handler.systemOnly,
      idempotent: handler.idempotent,
      requiresIdempotencyKey: handler.requiresIdempotencyKey,
    }));
  }
}
