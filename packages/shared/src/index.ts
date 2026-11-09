export type UUID = string;

export type AssignmentPolicy = 'ANY_ASSIGNEE' | 'ALL_ASSIGNEES';
export type EntityStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ProcessDefinitionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type ProcessInstanceStatus = 'RUNNING' | 'COMPLETED' | 'CANCELLED';
export type WorkflowTaskStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'RETURNED';
export type TaskAction = 'APPROVED' | 'REJECTED' | 'RETURNED';
export type AssigneeActionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REASSIGNED' | 'RETURNED';
export type WorkflowTransitionAction = TaskAction;
export type ReassignmentTrigger = 'SLA' | 'INACTIVE_ASSIGNEE' | 'MANUAL';

export interface WorkflowAssignmentTargets {
  assigneeUserIds?: UUID[];
  assigneePositionIds?: UUID[];
  assigneeUnitIds?: UUID[];
}

export interface ProcessStepDefinition extends WorkflowAssignmentTargets {
  title: string;
  instructions?: string;
  assignmentPolicy?: AssignmentPolicy;
  dueInHours?: number;
}

export interface ProcessTransition {
  fromStepIndex: number;
  action: WorkflowTransitionAction;
  toStepIndex: number | null;
}

export interface ProcessWorkflowSchema {
  steps: ProcessStepDefinition[];
  transitions?: ProcessTransition[];
}

export interface OrganizationSummary {
  id: UUID;
  name: string;
  code: string;
}

export interface UserSummary {
  id: UUID;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
}

export interface TaskSummary {
  id: UUID;
  processInstanceId: UUID;
  title: string;
  status: WorkflowTaskStatus;
  assignmentPolicy: AssignmentPolicy;
  createdAt: string;
}

export interface FormFieldDefinition {
  key: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'checkbox' | 'file' | 'user' | 'organization-unit';
  label: string;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  validation?: Record<string, unknown>;
  defaultValue?: unknown;
}

export interface FormSchema {
  fields: FormFieldDefinition[];
  layout?: Record<string, unknown>;
}
