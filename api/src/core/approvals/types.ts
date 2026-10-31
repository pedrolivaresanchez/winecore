/**
 * Approvals domain types. Column names follow `ops.approval_policy`,
 * `ops.approval_request` and `ops.approval_decision` (docs/02-ddl/0002_ops.sql).
 * `allowSelfApproval` is not a SQL column. UI-39 forbids it for submissions to
 * AEAT, the Junta, EDI and the certifier, and allows it for internal kinds
 * unless a stored policy says otherwise.
 */

export const APPROVAL_KINDS = [
  'invoice_batch_issue',
  'intercompany_invoice_issue',
  'regulatory_submission',
  'emcs_submission',
  'edi_submission',
  'organic_report',
  'cellar_loss',
  'inventory_adjustment',
  'billing_rules_activation',
  'tariff_activation',
  'module_toggle',
  'third_party_message',
] as const;

export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'consumed',
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type DecisionValue = 'approve' | 'reject';

export type StepUpMethod = 'passkey' | 'totp';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ApprovalPolicy {
  id: string;
  kind: ApprovalKind;
  legalEntityId: string | null;
  minApprovals: number;
  allowedRoles: readonly string[];
  allowedUserIds: readonly string[];
  requiresStepUp: boolean;
  validityMinutes: number;
  updatedAt: string;
  updatedBy: string;
  /**
   * When omitted, external submissions forbid self-approval and internal kinds allow it.
   */
  allowSelfApproval?: boolean;
}

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  legalEntityId: string | null;
  subjectTable: string;
  subjectId: string;
  payloadSha256: string;
  summary: string;
  details: JsonValue;
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  approvedAt: string | null;
  consumedAt: string | null;
  workflowRunRef: string | null;
}

export interface ApprovalDecision {
  id: string;
  requestId: string;
  decidedBy: string;
  decision: DecisionValue;
  decidedAt: string;
  note: string | null;
  stepUpMethod: StepUpMethod | null;
  stepUpAt: string | null;
  payloadSha256: string;
  ip: string | null;
  userAgent: string | null;
}

export interface RoleAssignment {
  role: string;
  legalEntityId: string | null;
}

/** Person, agent or machine client trying to decide. Only `user` may succeed. */
export interface ApproverContext {
  userId: string;
  roles: readonly RoleAssignment[];
  kind: 'user' | 'agent' | 'machine';
  stepUpAt: string | null;
}

export interface Clock {
  now(): Date;
}
