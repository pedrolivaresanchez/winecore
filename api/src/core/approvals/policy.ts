/**
 * Default approval policies from docs/03-maquinas-estado.md §12, plus the
 * self-approval rule from UI-39 and the 5-minute step-up window from ADR 008.
 */
import {
  APPROVAL_KINDS,
  APPROVAL_MESSAGES,
  type ApprovalKind,
  type ApprovalPolicy,
  approvalError,
} from './types';

/** Passkey/TOTP must be strictly no older than this (UI-03 and TASK-APR-001: ≤ 5 min). */
export const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;

const NON_HUMAN_ROLES = new Set(['agent', 'mcp_client', 'machine']);

interface KindDefault {
  requiredApprovals: number;
  allowedRoles: readonly string[];
  requiresStepUp: boolean;
  validityMinutes: number;
  /** UI-39: the requester does not approve their own request unless a stored policy says so. */
  allowSelfApproval: boolean;
}

const ownerApprover = ['owner', 'approver'] as const;

/**
 * Seeds described in the state machine. Every default forbids self-approval.
 * AEAT, Junta, EDI and the organic certifier are called out in UI-39; the same
 * default applies to the other kinds until a stored policy allows it.
 */
export const DEFAULT_POLICIES: { readonly [K in ApprovalKind]: KindDefault } = {
  invoice_batch_issue: {
    requiredApprovals: 1,
    allowedRoles: ownerApprover,
    requiresStepUp: true,
    validityMinutes: DAY_MINUTES,
    allowSelfApproval: false,
  },
  intercompany_invoice_issue: {
    requiredApprovals: 1,
    allowedRoles: ownerApprover,
    requiresStepUp: true,
    validityMinutes: WEEK_MINUTES,
    allowSelfApproval: false,
  },
  regulatory_submission: {
    requiredApprovals: 1,
    allowedRoles: ownerApprover,
    requiresStepUp: true,
    validityMinutes: DAY_MINUTES,
    allowSelfApproval: false,
  },
  emcs_submission: {
    requiredApprovals: 1,
    allowedRoles: ownerApprover,
    requiresStepUp: true,
    validityMinutes: DAY_MINUTES,
    allowSelfApproval: false,
  },
  edi_submission: {
    requiredApprovals: 1,
    allowedRoles: ownerApprover,
    requiresStepUp: true,
    validityMinutes: DAY_MINUTES,
    allowSelfApproval: false,
  },
  organic_report: {
    requiredApprovals: 1,
    allowedRoles: ['owner'],
    requiresStepUp: true,
    validityMinutes: WEEK_MINUTES,
    allowSelfApproval: false,
  },
  third_party_message: {
    requiredApprovals: 1,
    allowedRoles: ['owner', 'approver', 'admin'],
    requiresStepUp: false,
    validityMinutes: DAY_MINUTES,
    allowSelfApproval: false,
  },
  cellar_loss: {
    requiredApprovals: 1,
    allowedRoles: ownerApprover,
    requiresStepUp: true,
    validityMinutes: WEEK_MINUTES,
    allowSelfApproval: false,
  },
  inventory_adjustment: {
    requiredApprovals: 1,
    allowedRoles: ['owner'],
    requiresStepUp: true,
    validityMinutes: WEEK_MINUTES,
    allowSelfApproval: false,
  },
  billing_rules_activation: {
    requiredApprovals: 1,
    allowedRoles: ['owner'],
    requiresStepUp: true,
    validityMinutes: WEEK_MINUTES,
    allowSelfApproval: false,
  },
  tariff_activation: {
    requiredApprovals: 1,
    allowedRoles: ['owner'],
    requiresStepUp: true,
    validityMinutes: WEEK_MINUTES,
    allowSelfApproval: false,
  },
  module_toggle: {
    requiredApprovals: 1,
    allowedRoles: ['owner'],
    requiresStepUp: true,
    validityMinutes: DAY_MINUTES,
    allowSelfApproval: false,
  },
};

export interface PolicyQuery {
  kind: ApprovalKind;
  legalEntityId?: string | null;
  /**
   * Accepted so callers can pass the action amount. Section 12 defines no
   * amount bands, so it does not change the resolved policy.
   */
  amount?: string | number;
}

export interface ResolvedPolicy {
  policyId: string | null;
  kind: ApprovalKind;
  legalEntityId: string | null;
  requiredApprovals: number;
  allowedRoles: readonly string[];
  allowedUserIds: readonly string[];
  allowSelfApproval: boolean;
  requiresStepUp: boolean;
  stepUpWindowMs: number;
  validityMinutes: number;
  source: 'stored' | 'default';
}

export function resolvePolicy(
  policies: readonly ApprovalPolicy[],
  query: PolicyQuery,
): ResolvedPolicy {
  // Amount is part of the query contract. No threshold table exists in §12.
  void query.amount;

  if (!isApprovalKind(query.kind)) {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.kind);
  }

  const entityId = normalizeEntityId(query.legalEntityId);

  const sameKind = policies.filter((policy) => policy.kind === query.kind);
  const exact = sameKind.filter((policy) => sameEntity(policy, entityId));
  const globals = sameKind.filter((policy) => policy.legalEntityId === null);
  const chosen = one(exact) ?? (entityId === null ? null : one(globals));

  if (!chosen) return fromDefault(query.kind);
  return fromStored(chosen);
}

export function isApprovalKind(value: string): value is ApprovalKind {
  return (APPROVAL_KINDS as readonly string[]).includes(value);
}

function fromDefault(kind: ApprovalKind): ResolvedPolicy {
  const spec = DEFAULT_POLICIES[kind];
  return {
    policyId: null,
    kind,
    legalEntityId: null,
    requiredApprovals: spec.requiredApprovals,
    allowedRoles: [...spec.allowedRoles],
    allowedUserIds: [],
    allowSelfApproval: spec.allowSelfApproval,
    requiresStepUp: spec.requiresStepUp,
    stepUpWindowMs: STEP_UP_WINDOW_MS,
    validityMinutes: spec.validityMinutes,
    source: 'default',
  };
}

function fromStored(policy: ApprovalPolicy): ResolvedPolicy {
  assertPolicy(policy);
  return {
    policyId: policy.id.toLowerCase(),
    kind: policy.kind,
    legalEntityId: policy.legalEntityId === null ? null : policy.legalEntityId.toLowerCase(),
    requiredApprovals: policy.minApprovals,
    allowedRoles: [...policy.allowedRoles],
    allowedUserIds: policy.allowedUserIds.map((userId) => userId.toLowerCase()),
    allowSelfApproval: policy.allowSelfApproval ?? false,
    requiresStepUp: policy.requiresStepUp,
    stepUpWindowMs: STEP_UP_WINDOW_MS,
    validityMinutes: policy.validityMinutes,
    source: 'stored',
  };
}

function one(rows: readonly ApprovalPolicy[]): ApprovalPolicy | null {
  const first = rows[0];
  if (first === undefined) return null;
  if (rows.length > 1) {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.policyAmbiguous);
  }
  return first;
}

function assertPolicy(policy: ApprovalPolicy): void {
  if (!isApprovalKind(policy.kind)) {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.kind);
  }
  assertUuid(policy.id, APPROVAL_MESSAGES.policy);
  if (policy.legalEntityId !== null) assertUuid(policy.legalEntityId, APPROVAL_MESSAGES.entityId);
  if (!Number.isInteger(policy.minApprovals) || policy.minApprovals < 1 || policy.minApprovals > 3) {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.policy);
  }
  if (
    !Number.isInteger(policy.validityMinutes) ||
    policy.validityMinutes < 5 ||
    policy.validityMinutes > 10080
  ) {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.policy);
  }
  if (typeof policy.requiresStepUp !== 'boolean') {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.policy);
  }
  if (policy.allowSelfApproval !== undefined && typeof policy.allowSelfApproval !== 'boolean') {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.policy);
  }
  if (policy.allowedRoles.length === 0) {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.policyNoApprover);
  }
  for (const role of policy.allowedRoles) {
    if (NON_HUMAN_ROLES.has(role)) {
      throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.policyMachine);
    }
  }
  for (const userId of policy.allowedUserIds) {
    assertUuid(userId, APPROVAL_MESSAGES.userId);
  }
}

function normalizeEntityId(value: string | null | undefined): string | null {
  if (value == null) return null;
  assertUuid(value, APPROVAL_MESSAGES.entityId);
  return value.toLowerCase();
}

function sameEntity(policy: ApprovalPolicy, entityId: string | null): boolean {
  if (policy.legalEntityId === null) return entityId === null;
  return policy.legalEntityId.toLowerCase() === entityId;
}

function assertUuid(value: string, message: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw approvalError('WC_VALIDATION', message);
  }
}
