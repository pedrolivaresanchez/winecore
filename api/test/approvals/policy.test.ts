import { describe, expect, test } from 'bun:test';

import { resolvePolicy } from '../../src/core/approvals/policy';
import {
  APPROVAL_KINDS,
  type ApprovalKind,
  type ApprovalPolicy,
} from '../../src/core/approvals/types';
import { expectError } from './helpers';

const DAY = 1440;
const WEEK = 10080;
const WINDOW = 5 * 60 * 1000;
const PO = '11111111-1111-4111-8111-111111111111';
const CVPO = '22222222-2222-4222-8222-222222222222';

const EXPECTED: {
  [K in ApprovalKind]: {
    approvals: number;
    roles: readonly string[];
    stepUp: boolean;
    minutes: number;
    self: boolean;
  };
} = {
  invoice_batch_issue: { approvals: 1, roles: ['owner', 'approver'], stepUp: true, minutes: DAY, self: true },
  intercompany_invoice_issue: {
    approvals: 1,
    roles: ['owner', 'approver'],
    stepUp: true,
    minutes: WEEK,
    self: true,
  },
  regulatory_submission: { approvals: 1, roles: ['owner', 'approver'], stepUp: true, minutes: DAY, self: false },
  emcs_submission: { approvals: 1, roles: ['owner', 'approver'], stepUp: true, minutes: DAY, self: false },
  edi_submission: { approvals: 1, roles: ['owner', 'approver'], stepUp: true, minutes: DAY, self: false },
  organic_report: { approvals: 1, roles: ['owner'], stepUp: true, minutes: WEEK, self: false },
  third_party_message: {
    approvals: 1,
    roles: ['owner', 'approver', 'admin'],
    stepUp: false,
    minutes: DAY,
    self: true,
  },
  cellar_loss: { approvals: 1, roles: ['owner', 'approver'], stepUp: true, minutes: WEEK, self: true },
  inventory_adjustment: { approvals: 1, roles: ['owner'], stepUp: true, minutes: WEEK, self: true },
  billing_rules_activation: { approvals: 1, roles: ['owner'], stepUp: true, minutes: WEEK, self: true },
  tariff_activation: { approvals: 1, roles: ['owner'], stepUp: true, minutes: WEEK, self: true },
  module_toggle: { approvals: 1, roles: ['owner'], stepUp: true, minutes: DAY, self: true },
};

function stored(overrides: Partial<ApprovalPolicy> & Pick<ApprovalPolicy, 'id' | 'kind'>): ApprovalPolicy {
  return {
    legalEntityId: null,
    minApprovals: 1,
    allowedRoles: ['owner'],
    allowedUserIds: [],
    requiresStepUp: true,
    validityMinutes: DAY,
    updatedAt: '2026-10-31T00:00:00.000Z',
    updatedBy: 'seed',
    ...overrides,
  };
}

describe('resolvePolicy', () => {
  for (const kind of APPROVAL_KINDS) {
    test(`default policy for ${kind} follows §12`, () => {
      const resolved = resolvePolicy([], { kind, legalEntityId: null });
      const spec = EXPECTED[kind];
      expect(resolved.source).toBe('default');
      expect(resolved.policyId).toBeNull();
      expect(resolved.requiredApprovals).toBe(spec.approvals);
      expect([...resolved.allowedRoles]).toEqual([...spec.roles]);
      expect(resolved.requiresStepUp).toBe(spec.stepUp);
      expect(resolved.validityMinutes).toBe(spec.minutes);
      expect(resolved.allowSelfApproval).toBe(spec.self);
      expect(resolved.stepUpWindowMs).toBe(WINDOW);
    });
  }

  test('an entity policy overrides the global one for that entity only', () => {
    const policies = [
      stored({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0001', kind: 'regulatory_submission', minApprovals: 1 }),
      stored({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0002',
        kind: 'regulatory_submission',
        legalEntityId: PO,
        minApprovals: 2,
        allowedRoles: ['owner'],
      }),
    ];
    const po = resolvePolicy(policies, { kind: 'regulatory_submission', legalEntityId: PO });
    const cvpo = resolvePolicy(policies, { kind: 'regulatory_submission', legalEntityId: CVPO });
    const global = resolvePolicy(policies, { kind: 'regulatory_submission', legalEntityId: null });
    expect(po.requiredApprovals).toBe(2);
    expect(po.legalEntityId).toBe(PO);
    expect(po.source).toBe('stored');
    expect([...po.allowedRoles]).toEqual(['owner']);
    expect(cvpo.requiredApprovals).toBe(1);
    expect(cvpo.policyId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccc0001');
    expect(global.policyId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccc0001');
    expect(global.requiredApprovals).toBe(1);
  });

  test('amount does not change the resolved policy', () => {
    const low = resolvePolicy([], {
      kind: 'invoice_batch_issue',
      legalEntityId: PO,
      amount: '10.00',
    });
    const high = resolvePolicy([], {
      kind: 'invoice_batch_issue',
      legalEntityId: PO,
      amount: 1000000,
    });
    expect(low).toEqual(high);
  });

  test('two policies for the same kind and entity are rejected', async () => {
    const policies = [
      stored({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0001', kind: 'module_toggle' }),
      stored({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0002', kind: 'module_toggle' }),
    ];
    const error = await expectError(
      Promise.resolve().then(() => resolvePolicy(policies, { kind: 'module_toggle' })),
      'WC_VALIDATION',
    );
    expect(error.fields?.policy).toBe('Hay más de una política para este tipo y entidad');
  });

  test('a policy cannot list a machine or agent as approver', async () => {
    const policies = [
      stored({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0003',
        kind: 'edi_submission',
        allowedRoles: ['owner', 'agent'],
      }),
    ];
    const error = await expectError(
      Promise.resolve().then(() => resolvePolicy(policies, { kind: 'edi_submission' })),
      'WC_VALIDATION',
    );
    expect(error.fields?.policy).toBe('Un cliente de máquina no puede ser aprobador');
  });

  test('a policy cannot leave a kind without an approver', async () => {
    const policies = [
      stored({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0004',
        kind: 'cellar_loss',
        allowedRoles: [],
      }),
    ];
    const error = await expectError(
      Promise.resolve().then(() => resolvePolicy(policies, { kind: 'cellar_loss' })),
      'WC_VALIDATION',
    );
    expect(error.fields?.policy).toBe('Ningún tipo puede quedar sin aprobador');
  });

  test('min approvals and validity stay inside the SQL checks', async () => {
    const tooMany = [
      stored({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0005',
        kind: 'tariff_activation',
        minApprovals: 4,
      }),
    ];
    const tooShort = [
      stored({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0006',
        kind: 'tariff_activation',
        validityMinutes: 4,
      }),
    ];
    await expectError(
      Promise.resolve().then(() => resolvePolicy(tooMany, { kind: 'tariff_activation' })),
      'WC_VALIDATION',
    );
    await expectError(
      Promise.resolve().then(() => resolvePolicy(tooShort, { kind: 'tariff_activation' })),
      'WC_VALIDATION',
    );
  });

  test('a stored policy overrides the self-approval default either way', () => {
    const allowExternal = stored({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0007',
      kind: 'regulatory_submission',
      allowSelfApproval: true,
    });
    const forbidInternal = stored({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0008',
      kind: 'invoice_batch_issue',
      allowSelfApproval: false,
    });
    expect(resolvePolicy([allowExternal], { kind: 'regulatory_submission' }).allowSelfApproval).toBe(true);
    expect(resolvePolicy([forbidInternal], { kind: 'invoice_batch_issue' }).allowSelfApproval).toBe(false);
    expect(resolvePolicy([], { kind: 'invoice_batch_issue' }).allowSelfApproval).toBe(true);
    expect(resolvePolicy([], { kind: 'edi_submission' }).allowSelfApproval).toBe(false);
  });
});
