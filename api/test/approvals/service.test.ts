import { describe, expect, test } from 'bun:test';

import { payloadSha256 } from '../../src/core/approvals/canonical';
import {
  ApprovalService,
  InMemoryApprovalStore,
  type ApprovalServiceOptions,
} from '../../src/core/approvals/service';
import {
  type ApprovalPolicy,
  type ApprovalRequest,
  type ApproverContext,
  type Clock,
  type RoleAssignment,
} from '../../src/core/approvals/types';
import { expectError } from './helpers';

const NOW = '2026-10-31T12:00:00.000Z';
const STEP = '2026-10-31T11:59:00.000Z';
const PO = '11111111-1111-4111-8111-111111111111';
const CVPO = '22222222-2222-4222-8222-222222222222';
const REQUESTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002';
const APPROVER_PO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003';
const APPROVER_CVPO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004';
const ADMIN_PO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0005';
const CELLAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0006';
const SUBJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001';

const payload = {
  destination: 'AEAT',
  litres: '18340.00',
  period: '2026-08/2027-07',
  records: 12,
};

function user(
  userId: string,
  roles: readonly RoleAssignment[],
  stepUpAt: string | null = STEP,
  kind: ApproverContext['kind'] = 'user',
): ApproverContext {
  return { userId, roles, kind, stepUpAt };
}

function owner(stepUpAt: string | null = STEP): ApproverContext {
  return user(OWNER, [{ role: 'owner', legalEntityId: null }], stepUpAt);
}

function policy(overrides: Partial<ApprovalPolicy> & Pick<ApprovalPolicy, 'id' | 'kind'>): ApprovalPolicy {
  return {
    legalEntityId: null,
    minApprovals: 1,
    allowedRoles: ['owner', 'approver'],
    allowedUserIds: [],
    requiresStepUp: true,
    validityMinutes: 1440,
    updatedAt: NOW,
    updatedBy: 'seed',
    ...overrides,
  };
}

function harness(policies: readonly ApprovalPolicy[] = []): {
  store: InMemoryApprovalStore;
  service: ApprovalService;
  set(iso: string): void;
} {
  const store = new InMemoryApprovalStore();
  let now = Date.parse(NOW);
  const clock: Clock = { now: () => new Date(now) };
  const options: ApprovalServiceOptions = { store, policies, clock };
  return {
    store,
    service: new ApprovalService(options),
    set(iso: string) {
      now = Date.parse(iso);
    },
  };
}

async function request(
  service: ApprovalService,
  overrides: Partial<Parameters<ApprovalService['requestApproval']>[0]> = {},
): Promise<ApprovalRequest> {
  return service.requestApproval({
    kind: 'regulatory_submission',
    legalEntityId: PO,
    subjectTable: 'regulatory.submission',
    subjectId: SUBJECT,
    payload,
    summary: 'SILICIE P.O agosto 2026 a julio 2027',
    requestedBy: REQUESTER,
    ...overrides,
  });
}

describe('requestApproval', () => {
  test('freezes the canonical payload hash and the policy expiry', async () => {
    const { service } = harness();
    const reordered = { records: 12, period: payload.period, litres: payload.litres, destination: 'AEAT' };
    const created = await request(service, { payload: reordered, workflowRunRef: 'run-synthetic-1' });
    expect(created.status).toBe('pending');
    expect(created.payloadSha256).toBe(payloadSha256(payload));
    expect(created.payloadSha256).toHaveLength(64);
    expect(created.requestedAt).toBe(NOW);
    expect(created.expiresAt).toBe('2026-11-01T12:00:00.000Z');
    expect(created.details).toEqual(payload);
    expect(created.workflowRunRef).toBe('run-synthetic-1');
    expect(created.approvedAt).toBeNull();
    expect(created.consumedAt).toBeNull();
  });

  test('a seven-day kind expires seven days later', async () => {
    const { service } = harness();
    const created = await request(service, {
      kind: 'cellar_loss',
      summary: 'Destrucción de 20 litros por incidencia',
      payload: { litres: '20.00', reason: 'rotura' },
    });
    expect(created.expiresAt).toBe('2026-11-07T12:00:00.000Z');
  });

  test('summary, subject and payload are validated', async () => {
    const { service } = harness();
    await expectError(request(service, { summary: 'abc' }), 'WC_VALIDATION', 'El resumen debe tener entre 5 y 300 caracteres');
    await expectError(
      request(service, { subjectTable: 'Regulatory.Submission' }),
      'WC_VALIDATION',
      'La tabla del asunto no es válida',
    );
    await expectError(
      request(service, { payload: { ok: true, extra: undefined } }),
      'WC_VALIDATION',
      'El contenido no se puede representar de forma canónica',
    );
  });

  test('details are stored apart from the hashed payload', async () => {
    const { service } = harness();
    const details = { records: 12, to: 'avisos@winecore.test' };
    const created = await request(service, { details });
    expect(created.payloadSha256).toBe(payloadSha256(payload));
    expect(created.payloadSha256).not.toEqual(payloadSha256(details));
    expect(created.details).toEqual(details);
  });
});

describe('decide', () => {
  test('WC040 when the hash is not the one frozen on the request', async () => {
    const { service, store } = harness();
    const created = await request(service);
    const error = await expectError(
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: payloadSha256({ ...payload, records: 13 }),
        actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
        stepUpMethod: 'passkey',
      }),
      'WC040',
      'El contenido ha cambiado; vuelve a pedir la aprobación',
    );
    expect(error.httpStatus).toBe(409);
    expect((await store.getRequest(created.id))?.status).toBe('pending');
    expect(await store.listDecisions(created.id)).toHaveLength(0);
  });

  test('a matching hash is accepted in either hex case', async () => {
    const { service } = harness();
    const created = await request(service);
    const decided = await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256.toUpperCase(),
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
      stepUpMethod: 'totp',
    });
    expect(decided.request.status).toBe('approved');
    expect(decided.decision.payloadSha256).toBe(created.payloadSha256);
    expect(decided.decision.stepUpMethod).toBe('totp');
  });

  test('WC041 when the same person tries to decide again while it is pending', async () => {
    const policies = [
      policy({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0001',
        kind: 'regulatory_submission',
        legalEntityId: PO,
        minApprovals: 2,
      }),
    ];
    const { service, store } = harness(policies);
    const created = await request(service);
    const actor = user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]);
    const first = await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor,
      stepUpMethod: 'passkey',
    });
    expect(first.request.status).toBe('pending');
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'reject',
        payloadSha256: created.payloadSha256,
        actor,
        note: 'Quiero cambiar mi decisión anterior',
        stepUpMethod: 'passkey',
      }),
      'WC041',
      'Una decisión de aprobación no se modifica',
    );
    const rows = await store.listDecisions(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe('approve');
    expect(rows[0]?.id).toBe(first.decision.id);
    expect((await store.getRequest(created.id))?.status).toBe('pending');
  });

  test('WC042 when the request is no longer pending', async () => {
    const { service, store } = harness();
    const created = await request(service);
    await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
      stepUpMethod: 'passkey',
    });
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: owner(),
        stepUpMethod: 'passkey',
      }),
      'WC042',
      'La solicitud no está pendiente',
    );
    expect(await store.listDecisions(created.id)).toHaveLength(1);
  });

  test('WC042 comes before expiry when the status is already expired', async () => {
    const { service, store } = harness();
    const created = await request(service);
    await store.insertRequest({
      ...created,
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddd0001',
      status: 'expired',
      expiresAt: '2026-12-01T00:00:00.000Z',
    });
    await expectError(
      service.decide({
        requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddd0001',
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: owner(),
        stepUpMethod: 'passkey',
      }),
      'WC042',
    );
  });

  test('the request is still valid at expires_at and WC043 one millisecond later', async () => {
    const onTime = harness();
    const stillValid = await request(onTime.service);
    onTime.set(stillValid.expiresAt);
    const approved = await onTime.service.decide({
      requestId: stillValid.id,
      decision: 'approve',
      payloadSha256: stillValid.payloadSha256,
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }], stillValid.expiresAt),
      stepUpMethod: 'passkey',
    });
    expect(approved.request.status).toBe('approved');

    const { service, store, set } = harness();
    const pending = await request(service);
    const after = new Date(Date.parse(pending.expiresAt) + 1).toISOString();
    set(after);
    await expectError(
      service.decide({
        requestId: pending.id,
        decision: 'approve',
        payloadSha256: pending.payloadSha256,
        actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }], after),
        stepUpMethod: 'passkey',
      }),
      'WC043',
      'La solicitud ha caducado',
    );
    expect((await store.getRequest(pending.id))?.status).toBe('expired');
    await expectError(
      service.decide({
        requestId: pending.id,
        decision: 'approve',
        payloadSha256: pending.payloadSha256,
        actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }], after),
        stepUpMethod: 'passkey',
      }),
      'WC042',
    );
  });

  test('WC_STEP_UP_REQUIRED without a recent strong authentication', async () => {
    const { service } = harness();
    const created = await request(service);
    const base = {
      requestId: created.id,
      decision: 'approve' as const,
      payloadSha256: created.payloadSha256,
      stepUpMethod: 'passkey' as const,
    };
    await expectError(
      service.decide({
        ...base,
        actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }], null),
      }),
      'WC_STEP_UP_REQUIRED',
      'Falta una verificación reforzada reciente',
    );
    const stale = new Date(Date.parse(NOW) - 5 * 60 * 1000 - 1).toISOString();
    await expectError(
      service.decide({
        ...base,
        actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }], stale),
      }),
      'WC_STEP_UP_REQUIRED',
    );
    const future = new Date(Date.parse(NOW) + 1).toISOString();
    await expectError(
      service.decide({
        ...base,
        actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }], future),
      }),
      'WC_STEP_UP_REQUIRED',
    );
    const exact = new Date(Date.parse(NOW) - 5 * 60 * 1000).toISOString();
    const decided = await service.decide({
      ...base,
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }], exact),
    });
    expect(decided.request.status).toBe('approved');
    expect(decided.decision.stepUpAt).toBe(exact);
  });

  test('reject also requires step-up when the policy does', async () => {
    const { service } = harness();
    const created = await request(service);
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'reject',
        payloadSha256: created.payloadSha256,
        note: 'El cuadre no coincide con el libro',
        actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }], null),
      }),
      'WC_STEP_UP_REQUIRED',
    );
  });

  test('third_party_message does not require step-up and admin may decide it', async () => {
    const { service } = harness();
    const created = await request(service, {
      kind: 'third_party_message',
      summary: 'Recordatorio de factura al cliente',
      payload: { to: 'cliente@winecore.test', subject: 'Factura' },
    });
    const decided = await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: user(ADMIN_PO, [{ role: 'admin', legalEntityId: PO }], null),
    });
    expect(decided.request.status).toBe('approved');
    expect(decided.decision.stepUpAt).toBeNull();
  });

  test('WC_FORBIDDEN for agents and machine clients even with a human role', async () => {
    const { service } = harness();
    const created = await request(service);
    const roles = [{ role: 'owner', legalEntityId: null }] as const;
    for (const kind of ['agent', 'machine'] as const) {
      await expectError(
        service.decide({
          requestId: created.id,
          decision: 'approve',
          payloadSha256: created.payloadSha256,
          actor: user(OWNER, roles, STEP, kind),
          stepUpMethod: 'passkey',
        }),
        'WC_FORBIDDEN',
        'Solo una persona puede decidir una aprobación',
      );
    }
  });

  test('WC_FORBIDDEN when the role or the entity does not cover the request', async () => {
    const { service } = harness();
    const created = await request(service);
    const attempt = (actor: ApproverContext) =>
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor,
        stepUpMethod: 'passkey',
      });
    await expectError(
      attempt(user(CELLAR, [{ role: 'cellar', legalEntityId: PO }])),
      'WC_FORBIDDEN',
      'No tiene permiso para decidir esta aprobación',
    );
    await expectError(
      attempt(user(APPROVER_CVPO, [{ role: 'approver', legalEntityId: CVPO }])),
      'WC_FORBIDDEN',
    );
    await expectError(
      attempt(user(ADMIN_PO, [{ role: 'admin', legalEntityId: PO }])),
      'WC_FORBIDDEN',
    );
    const organic = await request(service, {
      kind: 'organic_report',
      summary: 'Informe ecológico del periodo',
      payload: { period: '2026' },
    });
    await expectError(
      service.decide({
        requestId: organic.id,
        decision: 'approve',
        payloadSha256: organic.payloadSha256,
        actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
        stepUpMethod: 'passkey',
      }),
      'WC_FORBIDDEN',
    );
  });

  test('a null entity on the role covers every entity', async () => {
    const { service } = harness();
    const created = await request(service);
    const decided = await service.decide({
      requestId: created.id,
      decision: 'reject',
      payloadSha256: created.payloadSha256,
      note: 'No corresponde a esta entidad',
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: null }]),
      stepUpMethod: 'passkey',
    });
    expect(decided.request.status).toBe('rejected');
  });

  test('an owner grant for one entity does not cover the other', async () => {
    const { service } = harness();
    const created = await request(service);
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: user(OWNER, [{ role: 'owner', legalEntityId: CVPO }]),
        stepUpMethod: 'passkey',
      }),
      'WC_FORBIDDEN',
      'No tiene permiso para decidir esta aprobación',
    );
  });

  test('an entity-scoped owner cannot decide a global module change', async () => {
    const { service } = harness();
    const created = await request(service, {
      kind: 'module_toggle',
      legalEntityId: null,
      subjectTable: 'core.module_state',
      summary: 'Desactivar el módulo de viñedo',
      payload: { module: 'vineyard', enabled: false },
    });
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: user(OWNER, [{ role: 'owner', legalEntityId: PO }]),
        stepUpMethod: 'passkey',
      }),
      'WC_FORBIDDEN',
    );
    const decided = await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: owner(),
      stepUpMethod: 'passkey',
    });
    expect(decided.request.status).toBe('approved');
  });

  test('the requester cannot decide unless the policy allows self-approval', async () => {
    const { service } = harness();
    const created = await request(service, { requestedBy: OWNER });
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: owner(),
        stepUpMethod: 'passkey',
      }),
      'WC_FORBIDDEN',
      'El solicitante no puede decidir su propia solicitud',
    );
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'reject',
        payloadSha256: created.payloadSha256,
        note: 'El solicitante no puede retirarla así',
        actor: owner(),
        stepUpMethod: 'passkey',
      }),
      'WC_FORBIDDEN',
      'El solicitante no puede decidir su propia solicitud',
    );
  });

  test('a stored policy can allow the requester to approve', async () => {
    const policies = [
      policy({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0002',
        kind: 'invoice_batch_issue',
        legalEntityId: PO,
        allowSelfApproval: true,
      }),
    ];
    const { service } = harness(policies);
    const created = await request(service, {
      kind: 'invoice_batch_issue',
      requestedBy: OWNER,
      summary: 'Emisión del lote de octubre',
      payload: { invoices: 3, total: '120.00' },
    });
    const decided = await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: owner(),
      stepUpMethod: 'passkey',
    });
    expect(decided.request.status).toBe('approved');
    expect(decided.decision.decidedBy).toBe(OWNER);
  });

  test('a non-empty allow-list restricts who may decide', async () => {
    const policies = [
      policy({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0003',
        kind: 'regulatory_submission',
        legalEntityId: PO,
        allowedUserIds: [OWNER],
      }),
    ];
    const { service } = harness(policies);
    const created = await request(service);
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
        stepUpMethod: 'passkey',
      }),
      'WC_FORBIDDEN',
    );
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: user(OWNER, [{ role: 'cellar', legalEntityId: null }]),
        stepUpMethod: 'passkey',
      }),
      'WC_FORBIDDEN',
    );
    const decided = await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: owner(),
      stepUpMethod: 'passkey',
    });
    expect(decided.request.status).toBe('approved');
  });

  test('two distinct approvers are required when the policy says so', async () => {
    const policies = [
      policy({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0004',
        kind: 'regulatory_submission',
        legalEntityId: PO,
        minApprovals: 2,
      }),
    ];
    const { service } = harness(policies);
    const created = await request(service);
    const first = await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
      stepUpMethod: 'passkey',
    });
    expect(first.request.status).toBe('pending');
    expect(first.request.approvedAt).toBeNull();
    const second = await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: owner(),
      stepUpMethod: 'passkey',
    });
    expect(second.request.status).toBe('approved');
    expect(second.request.approvedAt).toBe(NOW);
  });

  test('one rejection ends the request', async () => {
    const policies = [
      policy({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0005',
        kind: 'regulatory_submission',
        legalEntityId: PO,
        minApprovals: 2,
      }),
    ];
    const { service, store } = harness(policies);
    const created = await request(service);
    await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
      stepUpMethod: 'passkey',
    });
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'reject',
        payloadSha256: created.payloadSha256,
        actor: owner(),
        stepUpMethod: 'passkey',
        note: 'corto',
      }),
      'WC_VALIDATION',
      'El motivo del rechazo debe tener entre 10 y 500 caracteres',
    );
    const rejected = await service.decide({
      requestId: created.id,
      decision: 'reject',
      payloadSha256: created.payloadSha256,
      actor: owner(),
      stepUpMethod: 'passkey',
      note: '  El cuadre de litros no cuadra  ',
    });
    expect(rejected.request.status).toBe('rejected');
    expect(rejected.decision.note).toBe('El cuadre de litros no cuadra');
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: user(ADMIN_PO, [{ role: 'approver', legalEntityId: null }]),
        stepUpMethod: 'passkey',
      }),
      'WC042',
    );
    await expectError(
      service.consume({ requestId: created.id, payloadSha256: created.payloadSha256 }),
      'WC_NOT_APPROVED',
      'La solicitud no está aprobada',
    );
    expect((await store.getRequest(created.id))?.status).toBe('rejected');
  });

  test('WC002 when the actor context is missing', async () => {
    const { service } = harness();
    const created = await request(service);
    await expectError(
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: undefined as unknown as ApproverContext,
      }),
      'WC002',
      'Falta contexto de actor',
    );
  });

  test('WC_NOT_FOUND for an unknown request', async () => {
    const { service } = harness();
    await expectError(
      service.decide({
        requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001',
        decision: 'approve',
        payloadSha256: payloadSha256(payload),
        actor: owner(),
        stepUpMethod: 'passkey',
      }),
      'WC_NOT_FOUND',
      'La solicitud no existe',
    );
  });

  test('two concurrent approvals for a single seat: exactly one is stored', async () => {
    const { service, store } = harness();
    const created = await request(service);
    const results = await Promise.allSettled([
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
        stepUpMethod: 'passkey',
      }),
      service.decide({
        requestId: created.id,
        decision: 'approve',
        payloadSha256: created.payloadSha256,
        actor: owner(),
        stepUpMethod: 'passkey',
      }),
    ]);
    const ok = results.filter((result) => result.status === 'fulfilled');
    const denied = results.filter((result) => result.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(denied).toHaveLength(1);
    const failure = denied[0];
    if (failure === undefined || failure.status !== 'rejected') throw new Error('missing rejection');
    if (!(failure.reason instanceof Error) || !('code' in failure.reason)) throw new Error('bad error');
    expect(failure.reason.code).toBe('WC042');
    expect((await store.getRequest(created.id))?.status).toBe('approved');
    expect(await store.listDecisions(created.id)).toHaveLength(1);
  });
});

describe('consume', () => {
  test('WC040 when the executed payload is not the approved one', async () => {
    const { service, store } = harness();
    const created = await request(service);
    await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
      stepUpMethod: 'passkey',
    });
    await expectError(
      service.consume({ requestId: created.id, payloadSha256: payloadSha256({ changed: true }) }),
      'WC040',
    );
    expect((await store.getRequest(created.id))?.status).toBe('approved');
  });

  test('WC043 when an approved request is consumed too late', async () => {
    const { service, store, set } = harness();
    const created = await request(service);
    await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
      stepUpMethod: 'passkey',
    });
    set(new Date(Date.parse(created.expiresAt) + 1).toISOString());
    await expectError(
      service.consume({ requestId: created.id, payloadSha256: created.payloadSha256 }),
      'WC043',
    );
    expect((await store.getRequest(created.id))?.status).toBe('expired');
  });

  test('a pending request cannot be consumed', async () => {
    const { service } = harness();
    const created = await request(service);
    await expectError(
      service.consume({ requestId: created.id, payloadSha256: created.payloadSha256 }),
      'WC_NOT_APPROVED',
    );
  });

  test('two concurrent consume calls: exactly one succeeds', async () => {
    const { service, store } = harness();
    const created = await request(service);
    await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: created.payloadSha256,
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
      stepUpMethod: 'passkey',
    });
    const results = await Promise.allSettled([
      service.consume({ requestId: created.id, payloadSha256: created.payloadSha256 }),
      service.consume({ requestId: created.id, payloadSha256: created.payloadSha256 }),
    ]);
    const ok = results.filter((result) => result.status === 'fulfilled');
    const denied = results.filter((result) => result.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(denied).toHaveLength(1);
    const winner = ok[0];
    const failure = denied[0];
    if (winner === undefined || winner.status !== 'fulfilled') throw new Error('missing success');
    if (failure === undefined || failure.status !== 'rejected') throw new Error('missing rejection');
    expect(winner.value.status).toBe('consumed');
    expect(winner.value.consumedAt).toBe(NOW);
    if (!(failure.reason instanceof Error) || !('code' in failure.reason)) throw new Error('bad error');
    expect(failure.reason.code).toBe('WC_ALREADY_CONSUMED');
    const stored = await store.getRequest(created.id);
    expect(stored?.status).toBe('consumed');
    expect(stored?.consumedAt).toBe(NOW);
  });
});

describe('happy path', () => {
  test('request, human step-up approval and a single consume', async () => {
    const { service, store } = harness();
    const created = await request(service);
    const decided = await service.decide({
      requestId: created.id,
      decision: 'approve',
      payloadSha256: payloadSha256(payload),
      actor: user(APPROVER_PO, [{ role: 'approver', legalEntityId: PO }]),
      stepUpMethod: 'passkey',
      ip: '203.0.113.10',
      userAgent: 'WineCoreTest/1',
    });
    expect(decided.request.status).toBe('approved');
    expect(decided.request.approvedAt).toBe(NOW);
    expect(decided.decision.decidedBy).toBe(APPROVER_PO);
    expect(decided.decision.decision).toBe('approve');
    expect(decided.decision.stepUpMethod).toBe('passkey');
    expect(decided.decision.stepUpAt).toBe(STEP);
    expect(decided.decision.payloadSha256).toBe(created.payloadSha256);
    expect(decided.decision.ip).toBe('203.0.113.10');
    expect(decided.decision.userAgent).toBe('WineCoreTest/1');
    expect(decided.decision.note).toBeNull();

    const consumed = await service.consume({
      requestId: created.id,
      payloadSha256: created.payloadSha256,
    });
    expect(consumed.status).toBe('consumed');
    expect(consumed.consumedAt).toBe(NOW);
    expect(consumed.payloadSha256).toBe(created.payloadSha256);

    await expectError(
      service.consume({ requestId: created.id, payloadSha256: created.payloadSha256 }),
      'WC_ALREADY_CONSUMED',
      'La solicitud ya se ha ejecutado',
    );
    const rows = await store.listDecisions(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(decided.decision.id);
  });
});
