import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { WorkflowService } from './workflow.service';

const service = Object.create(WorkflowService.prototype) as WorkflowService;
const resolve = (service as any).resolveTransitionTarget.bind(service) as (
  schema: Record<string, unknown>, from: number, action: 'APPROVED' | 'REJECTED' | 'RETURNED',
  fallback: number | null, requireExplicit?: boolean,
) => number | null;

test('legacy sequential workflow keeps the next-step fallback', () => {
  assert.equal(resolve({ steps: [] }, 0, 'APPROVED', 1), 1);
  assert.equal(resolve({ steps: [] }, 4, 'APPROVED', null), null);
});

test('explicit approval transition routes to its configured step', () => {
  const schema = { transitions: [{ fromStepIndex: 0, action: 'APPROVED', toStepIndex: 2 }] };
  assert.equal(resolve(schema, 0, 'APPROVED', 1, true), 2);
});

test('explicit terminal approval transition completes the process', () => {
  const schema = { transitions: [{ fromStepIndex: 2, action: 'APPROVED', toStepIndex: null }] };
  assert.equal(resolve(schema, 2, 'APPROVED', null, true), null);
});

test('a rejection without a configured branch is terminal', () => {
  const schema = { transitions: [{ fromStepIndex: 0, action: 'APPROVED', toStepIndex: null }] };
  assert.equal(resolve(schema, 0, 'REJECTED', null), null);
});

test('a configured rejection branch is honored', () => {
  const schema = { transitions: [{ fromStepIndex: 2, action: 'REJECTED', toStepIndex: 1 }] };
  assert.equal(resolve(schema, 2, 'REJECTED', null), 1);
});

test('RETURNED requires a published transition when an explicit graph exists', () => {
  const schema = { transitions: [{ fromStepIndex: 2, action: 'APPROVED', toStepIndex: null }] };
  assert.throws(() => resolve(schema, 2, 'RETURNED', null, true), BadRequestException);
});

test('ambiguous transition graphs fail closed', () => {
  const schema = { transitions: [
    { fromStepIndex: 1, action: 'APPROVED', toStepIndex: 2 },
    { fromStepIndex: 1, action: 'APPROVED', toStepIndex: null },
  ] };
  assert.throws(() => resolve(schema, 1, 'APPROVED', null, true), ConflictException);
});
