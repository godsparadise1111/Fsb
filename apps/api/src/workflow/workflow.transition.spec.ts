import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { isAssignmentPolicySatisfied } from './workflow-assignment-policy';

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

const resolveAssignees = (service as any).resolveStepAssignees.bind(service) as (
  manager: any, organizationId: string, tenantId: string, config: Record<string, unknown>,
) => Promise<string[]>;

function assignmentManager(options: { positionCount?: number; unitCount?: number; resolved?: string[] }) {
  return {
    query: async (sql: string) => {
      if (sql.includes('FROM positions p')) return [{ count: options.positionCount ?? 0 }];
      if (sql.includes('FROM organization_units WHERE')) return [{ count: options.unitCount ?? 0 }];
      if (sql.includes('SELECT DISTINCT up."userId"')) {
        return (options.resolved ?? []).map(userId => ({ userId }));
      }
      throw new Error('Unexpected assignment query: ' + sql.slice(0, 80));
    },
  };
}

test('position assignment resolves active users in the selected organization', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const positionId = '22222222-2222-4222-8222-222222222222';
  const result = await resolveAssignees(
    assignmentManager({ positionCount: 1, resolved: [userId] }),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    { assigneePositionIds: [positionId] },
  );
  assert.deepEqual(result, [userId]);
});

test('unit assignment resolves its active position holders', async () => {
  const userIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const unitId = '33333333-3333-4333-8333-333333333333';
  const result = await resolveAssignees(
    assignmentManager({ unitCount: 1, resolved: userIds }),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    { assigneeUnitIds: [unitId] },
  );
  assert.deepEqual(result, userIds);
});

test('inactive or cross-organization position assignment is rejected', async () => {
  const positionId = '22222222-2222-4222-8222-222222222222';
  await assert.rejects(
    resolveAssignees(
      assignmentManager({ positionCount: 0, resolved: [] }),
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      { assigneePositionIds: [positionId] },
    ),
    BadRequestException,
  );
});

test('ANY_ASSIGNEE completes after the first approval', () => {
  assert.equal(isAssignmentPolicySatisfied('ANY_ASSIGNEE', [
    { status: 'APPROVED' }, { status: 'PENDING' }, { status: 'PENDING' },
  ]), true);
});

test('ALL_ASSIGNEES waits until every active assignee approves', () => {
  assert.equal(isAssignmentPolicySatisfied('ALL_ASSIGNEES', [
    { status: 'APPROVED' }, { status: 'PENDING' },
  ]), false);
  assert.equal(isAssignmentPolicySatisfied('ALL_ASSIGNEES', [
    { status: 'APPROVED' }, { status: 'APPROVED' },
  ]), true);
});

test('reassigned historical rows do not block an ALL_ASSIGNEES quorum', () => {
  assert.equal(isAssignmentPolicySatisfied('ALL_ASSIGNEES', [
    { status: 'APPROVED' }, { status: 'REASSIGNED' },
  ]), true);
});

test('empty active assignment sets never complete a task', () => {
  assert.equal(isAssignmentPolicySatisfied('ALL_ASSIGNEES', [{ status: 'REASSIGNED' }]), false);
  assert.equal(isAssignmentPolicySatisfied('ANY_ASSIGNEE', [{ status: 'REASSIGNED' }]), false);
});

test('a rejection never counts as approval for either assignment policy', () => {
  assert.equal(isAssignmentPolicySatisfied('ANY_ASSIGNEE', [
    { status: 'REJECTED' }, { status: 'PENDING' },
  ]), false);
  assert.equal(isAssignmentPolicySatisfied('ALL_ASSIGNEES', [
    { status: 'APPROVED' }, { status: 'REJECTED' },
  ]), false);
});
