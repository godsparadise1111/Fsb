export type WorkflowAssignmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REASSIGNED' | 'RETURNED';
export type WorkflowAssignmentDecision = { status: WorkflowAssignmentStatus };

/**
 * REASSIGNED rows are historical and do not participate in the active quorum.
 * ANY_ASSIGNEE completes on the first approval; ALL_ASSIGNEES requires every
 * remaining active assignee to approve.
 */
export function isAssignmentPolicySatisfied(
  policy: 'ANY_ASSIGNEE' | 'ALL_ASSIGNEES',
  assignments: readonly WorkflowAssignmentDecision[],
): boolean {
  const active = assignments.filter(item => item.status !== 'REASSIGNED');
  if (policy === 'ANY_ASSIGNEE') return active.some(item => item.status === 'APPROVED');
  return active.length > 0 && active.every(item => item.status === 'APPROVED');
}
