/**
 * Human approvals bound to the SHA-256 of the exact payload.
 * State machine: docs/03-maquinas-estado.md §12. Errors: WC040–WC043,
 * WC_FORBIDDEN, WC_STEP_UP_REQUIRED (docs/02-modelo-dominio.md §5 and §20).
 */
/// <reference path="./node-crypto.d.ts" />
import { randomUUID } from 'node:crypto';

import { canonicalJson, payloadSha256 } from './canonical';
import { resolvePolicy, type ResolvedPolicy } from './policy';
import {
  APPROVAL_MESSAGES,
  type ApprovalDecision,
  type ApprovalPolicy,
  type ApprovalRequest,
  type ApprovalStatus,
  type ApproverContext,
  type Clock,
  type DecisionValue,
  type JsonValue,
  type StepUpMethod,
  approvalError,
} from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const SUBJECT_TABLE_RE = /^[a-z_]+\.[a-z_]+$/;
const NON_HUMAN_ROLES = new Set(['agent', 'mcp_client', 'machine']);

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface ApprovalServiceOptions {
  store: ApprovalStore;
  policies?: readonly ApprovalPolicy[];
  clock?: Clock;
}

export interface RequestApprovalInput {
  kind: ApprovalRequest['kind'];
  legalEntityId?: string | null;
  subjectTable: string;
  subjectId: string;
  payload: unknown;
  summary: string;
  requestedBy: string;
  details?: unknown;
  workflowRunRef?: string | null;
  /** Forwarded to policy resolution. Section 12 has no amount bands. */
  amount?: string | number;
}

export interface DecideInput {
  requestId: string;
  decision: DecisionValue;
  payloadSha256: string;
  actor: ApproverContext;
  note?: string | null;
  stepUpMethod?: StepUpMethod | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface DecideResult {
  request: ApprovalRequest;
  decision: ApprovalDecision;
}

export interface ConsumeInput {
  requestId: string;
  payloadSha256: string;
}

export interface StatusExpect {
  status: ApprovalStatus;
  payloadSha256: string;
}

export interface StatusPatch {
  status: ApprovalStatus;
  approvedAt?: string | null;
  consumedAt?: string | null;
}

/**
 * Persistence boundary. A SQL adapter would lock the request row
 * (`SELECT … FOR UPDATE`) inside `transact` and implement `compareAndSet`
 * as a single conditional update.
 */
export interface ApprovalTx {
  getRequest(): Promise<ApprovalRequest | null>;
  decisions(): Promise<readonly ApprovalDecision[]>;
  insertDecision(decision: ApprovalDecision): Promise<void>;
  compareAndSet(expect: StatusExpect, patch: StatusPatch): Promise<ApprovalRequest | null>;
}

export interface ApprovalStore {
  insertRequest(request: ApprovalRequest): Promise<void>;
  getRequest(id: string): Promise<ApprovalRequest | null>;
  listDecisions(requestId: string): Promise<readonly ApprovalDecision[]>;
  /**
   * Atomically applies `patch` when status and payload hash still match.
   * Concurrent calls for the same id are serialized. Returns null when the
   * precondition fails, so a single consume cannot run twice.
   */
  compareAndSet(
    id: string,
    expect: StatusExpect,
    patch: StatusPatch,
  ): Promise<ApprovalRequest | null>;
  transact<T>(requestId: string, run: (tx: ApprovalTx) => Promise<T>): Promise<T>;
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly decisions = new Map<string, ApprovalDecision[]>();
  private readonly tails = new Map<string, Promise<void>>();

  async insertRequest(request: ApprovalRequest): Promise<void> {
    if (this.requests.has(request.id)) {
      throw approvalError('WC_VALIDATION', 'La solicitud ya existe');
    }
    this.requests.set(request.id, structuredClone(request));
    this.decisions.set(request.id, []);
  }

  async getRequest(id: string): Promise<ApprovalRequest | null> {
    const found = this.requests.get(id);
    return found ? structuredClone(found) : null;
  }

  async listDecisions(requestId: string): Promise<readonly ApprovalDecision[]> {
    return (this.decisions.get(requestId) ?? []).map((row) => structuredClone(row));
  }

  compareAndSet(
    id: string,
    expect: StatusExpect,
    patch: StatusPatch,
  ): Promise<ApprovalRequest | null> {
    return this.exclusive(id, () => this.casUnlocked(id, expect, patch));
  }

  transact<T>(requestId: string, run: (tx: ApprovalTx) => Promise<T>): Promise<T> {
    return this.exclusive(requestId, () => run(this.transaction(requestId)));
  }

  private transaction(requestId: string): ApprovalTx {
    return {
      getRequest: () => {
        const found = this.requests.get(requestId);
        return Promise.resolve(found ? structuredClone(found) : null);
      },
      decisions: () =>
        Promise.resolve((this.decisions.get(requestId) ?? []).map((row) => structuredClone(row))),
      insertDecision: (decision) => {
        if (!this.requests.has(requestId)) {
          throw approvalError('WC_NOT_FOUND', APPROVAL_MESSAGES.notFound);
        }
        const list = this.decisions.get(requestId) ?? [];
        this.decisions.set(requestId, list);
        if (list.some((row) => row.id === decision.id || row.decidedBy === decision.decidedBy)) {
          throw approvalError('WC041', APPROVAL_MESSAGES.WC041);
        }
        list.push(structuredClone(decision));
        return Promise.resolve();
      },
      compareAndSet: (expect, patch) => Promise.resolve(this.casUnlocked(requestId, expect, patch)),
    };
  }

  /** Check and write with no await between them. Callers must already hold `exclusive`. */
  private casUnlocked(
    id: string,
    expect: StatusExpect,
    patch: StatusPatch,
  ): ApprovalRequest | null {
    const current = this.requests.get(id);
    if (!current) return null;
    if (current.status !== expect.status) return null;
    if (current.payloadSha256 !== expect.payloadSha256) return null;
    const next: ApprovalRequest = {
      ...current,
      status: patch.status,
      approvedAt: patch.approvedAt !== undefined ? patch.approvedAt : current.approvedAt,
      consumedAt: patch.consumedAt !== undefined ? patch.consumedAt : current.consumedAt,
    };
    this.requests.set(id, next);
    return structuredClone(next);
  }

  private exclusive<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve();
    const run = previous.then(() => fn());
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(id, tail);
    return run;
  }
}

export class ApprovalService {
  private readonly store: ApprovalStore;
  private readonly policies: readonly ApprovalPolicy[];
  private readonly clock: Clock;

  constructor(options: ApprovalServiceOptions) {
    this.store = options.store;
    this.policies = options.policies ?? [];
    this.clock = options.clock ?? systemClock;
  }

  async requestApproval(input: RequestApprovalInput): Promise<ApprovalRequest> {
    if (typeof input.kind !== 'string') {
      throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.kind);
    }
    const legalEntityId = input.legalEntityId ?? null;
    if (legalEntityId !== null && !UUID_RE.test(legalEntityId)) {
      throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.entityId);
    }
    if (typeof input.subjectTable !== 'string' || !SUBJECT_TABLE_RE.test(input.subjectTable)) {
      throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.subjectTable);
    }
    if (typeof input.subjectId !== 'string' || !UUID_RE.test(input.subjectId)) {
      throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.subjectId);
    }
    if (typeof input.summary !== 'string' || input.summary.length < 5 || input.summary.length > 300) {
      throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.summary);
    }
    if (typeof input.requestedBy !== 'string' || input.requestedBy.trim() === '') {
      throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.requestedBy);
    }

    const policy = resolvePolicy(this.policies, {
      kind: input.kind,
      legalEntityId,
      amount: input.amount,
    });
    const hash = payloadSha256(input.payload);
    const details = cloneJson(input.details === undefined ? input.payload : input.details);
    const requestedMs = this.clock.now().getTime();
    const requester = input.requestedBy.trim();
    const request: ApprovalRequest = {
      id: randomUUID(),
      kind: input.kind,
      legalEntityId: legalEntityId === null ? null : legalEntityId.toLowerCase(),
      subjectTable: input.subjectTable,
      subjectId: input.subjectId.toLowerCase(),
      payloadSha256: hash,
      summary: input.summary,
      details,
      status: 'pending',
      requestedBy: UUID_RE.test(requester) ? requester.toLowerCase() : requester,
      requestedAt: new Date(requestedMs).toISOString(),
      expiresAt: new Date(requestedMs + policy.validityMinutes * 60_000).toISOString(),
      approvedAt: null,
      consumedAt: null,
      workflowRunRef: input.workflowRunRef ?? null,
    };
    await this.store.insertRequest(request);
    return structuredClone(request);
  }

  async decide(input: DecideInput): Promise<DecideResult> {
    const actor = assertActor(input.actor);
    if (actor.kind !== 'user') {
      throw approvalError('WC_FORBIDDEN', APPROVAL_MESSAGES.forbiddenHuman);
    }
    if (!UUID_RE.test(actor.userId)) {
      throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.userId);
    }
    if (input.decision !== 'approve' && input.decision !== 'reject') {
      throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.decision);
    }
    const hash = normalizeHash(input.payloadSha256);
    const stepUpMethod = normalizeStepUpMethod(input.stepUpMethod);
    const userId = actor.userId.toLowerCase();

    return this.store.transact(input.requestId, async (tx) => {
      const request = await tx.getRequest();
      if (!request) throw approvalError('WC_NOT_FOUND', APPROVAL_MESSAGES.notFound);

      const nowMs = this.clock.now().getTime();
      const policy = resolvePolicy(this.policies, {
        kind: request.kind,
        legalEntityId: request.legalEntityId,
      });
      if (!actorMayDecide(policy, request.legalEntityId, actor, userId)) {
        throw approvalError('WC_FORBIDDEN', APPROVAL_MESSAGES.forbiddenRole);
      }
      if (!policy.allowSelfApproval && userId === request.requestedBy) {
        throw approvalError('WC_FORBIDDEN', APPROVAL_MESSAGES.forbiddenSelf);
      }
      assertRecentStepUp(policy, actor, nowMs);

      if (request.status !== 'pending') {
        throw approvalError('WC042', APPROVAL_MESSAGES.WC042);
      }
      if (Date.parse(request.expiresAt) < nowMs) {
        await tx.compareAndSet(
          { status: 'pending', payloadSha256: request.payloadSha256 },
          { status: 'expired' },
        );
        throw approvalError('WC043', APPROVAL_MESSAGES.WC043);
      }
      if (hash !== request.payloadSha256) {
        throw approvalError('WC040', APPROVAL_MESSAGES.WC040);
      }
      const existing = await tx.decisions();
      if (existing.some((row) => row.decidedBy === userId)) {
        throw approvalError('WC041', APPROVAL_MESSAGES.WC041);
      }

      const note = resolveNote(input.decision, input.note);
      const decidedAt = new Date(nowMs).toISOString();
      const decision: ApprovalDecision = {
        id: randomUUID(),
        requestId: request.id,
        decidedBy: userId,
        decision: input.decision,
        decidedAt,
        note,
        stepUpMethod,
        stepUpAt: actor.stepUpAt,
        payloadSha256: request.payloadSha256,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      };
      await tx.insertDecision(decision);

      if (input.decision === 'reject') {
        const updated = await tx.compareAndSet(
          { status: 'pending', payloadSha256: request.payloadSha256 },
          { status: 'rejected' },
        );
        if (!updated) throw approvalError('WC042', APPROVAL_MESSAGES.WC042);
        return { request: updated, decision };
      }

      const rows = await tx.decisions();
      const approvers = new Set(
        rows.filter((row) => row.decision === 'approve').map((row) => row.decidedBy),
      );
      if (approvers.size >= policy.requiredApprovals) {
        const updated = await tx.compareAndSet(
          { status: 'pending', payloadSha256: request.payloadSha256 },
          { status: 'approved', approvedAt: decidedAt },
        );
        if (!updated) throw approvalError('WC042', APPROVAL_MESSAGES.WC042);
        return { request: updated, decision };
      }
      const pending = await tx.getRequest();
      if (!pending) throw approvalError('WC_NOT_FOUND', APPROVAL_MESSAGES.notFound);
      return { request: pending, decision };
    });
  }

  async consume(input: ConsumeInput): Promise<ApprovalRequest> {
    const hash = normalizeHash(input.payloadSha256);
    const current = await this.store.getRequest(input.requestId);
    if (!current) throw approvalError('WC_NOT_FOUND', APPROVAL_MESSAGES.notFound);

    if (current.status === 'consumed') {
      throw approvalError('WC_ALREADY_CONSUMED', APPROVAL_MESSAGES.alreadyConsumed);
    }
    if (current.status === 'expired') {
      throw approvalError('WC043', APPROVAL_MESSAGES.WC043);
    }
    const nowMs = this.clock.now().getTime();
    if (current.status === 'approved' && Date.parse(current.expiresAt) < nowMs) {
      await this.store.compareAndSet(
        input.requestId,
        { status: 'approved', payloadSha256: current.payloadSha256 },
        { status: 'expired' },
      );
      throw approvalError('WC043', APPROVAL_MESSAGES.WC043);
    }
    if (current.status !== 'approved') {
      throw approvalError('WC_NOT_APPROVED', APPROVAL_MESSAGES.notApproved);
    }
    if (hash !== current.payloadSha256) {
      throw approvalError('WC040', APPROVAL_MESSAGES.WC040);
    }

    const updated = await this.store.compareAndSet(
      input.requestId,
      { status: 'approved', payloadSha256: current.payloadSha256 },
      { status: 'consumed', consumedAt: new Date(nowMs).toISOString() },
    );
    if (updated) return updated;

    const latest = await this.store.getRequest(input.requestId);
    if (!latest) throw approvalError('WC_NOT_FOUND', APPROVAL_MESSAGES.notFound);
    if (latest.status === 'consumed') {
      throw approvalError('WC_ALREADY_CONSUMED', APPROVAL_MESSAGES.alreadyConsumed);
    }
    if (latest.status === 'expired' || Date.parse(latest.expiresAt) < this.clock.now().getTime()) {
      throw approvalError('WC043', APPROVAL_MESSAGES.WC043);
    }
    if (latest.payloadSha256 !== hash) {
      throw approvalError('WC040', APPROVAL_MESSAGES.WC040);
    }
    throw approvalError('WC_NOT_APPROVED', APPROVAL_MESSAGES.notApproved);
  }
}

function cloneJson(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function assertActor(actor: ApproverContext | null | undefined): ApproverContext {
  if (
    actor == null ||
    (actor.kind !== 'user' && actor.kind !== 'agent' && actor.kind !== 'machine') ||
    typeof actor.userId !== 'string' ||
    (actor.stepUpAt !== null && typeof actor.stepUpAt !== 'string') ||
    !Array.isArray(actor.roles)
  ) {
    throw approvalError('WC002', APPROVAL_MESSAGES.WC002);
  }
  for (const assignment of actor.roles) {
    if (
      assignment == null ||
      typeof assignment.role !== 'string' ||
      (assignment.legalEntityId !== null && typeof assignment.legalEntityId !== 'string')
    ) {
      throw approvalError('WC002', APPROVAL_MESSAGES.WC002);
    }
  }
  return actor;
}

/**
 * A role covers the request when it is allowed by the policy and its entity
 * is NULL (every entity, `core.user_role`) or equal to the request's entity.
 * Owner is not treated as implicit global: a grant tied to one entity stays there.
 */
function actorMayDecide(
  policy: ResolvedPolicy,
  requestEntityId: string | null,
  actor: ApproverContext,
  userId: string,
): boolean {
  if (policy.allowedUserIds.length > 0 && !policy.allowedUserIds.includes(userId)) {
    return false;
  }
  return actor.roles.some((assignment) => {
    if (!policy.allowedRoles.includes(assignment.role)) return false;
    if (NON_HUMAN_ROLES.has(assignment.role)) return false;
    if (assignment.legalEntityId === null) return true;
    if (requestEntityId === null) return false;
    return assignment.legalEntityId.toLowerCase() === requestEntityId;
  });
}

function assertRecentStepUp(policy: ResolvedPolicy, actor: ApproverContext, nowMs: number): void {
  if (!policy.requiresStepUp) return;
  if (actor.stepUpAt === null) {
    throw approvalError('WC_STEP_UP_REQUIRED', APPROVAL_MESSAGES.stepUp);
  }
  const at = Date.parse(actor.stepUpAt);
  if (Number.isNaN(at)) {
    throw approvalError('WC_STEP_UP_REQUIRED', APPROVAL_MESSAGES.stepUp);
  }
  const age = nowMs - at;
  if (age < 0 || age > policy.stepUpWindowMs) {
    throw approvalError('WC_STEP_UP_REQUIRED', APPROVAL_MESSAGES.stepUp);
  }
}

function resolveNote(decision: DecisionValue, note: string | null | undefined): string | null {
  if (note == null || note.trim() === '') {
    if (decision === 'reject') {
      throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.rejectNote);
    }
    return null;
  }
  const trimmed = note.trim();
  if (decision === 'reject' && (trimmed.length < 10 || trimmed.length > 500)) {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.rejectNote);
  }
  if (trimmed.length > 500) {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.noteLength);
  }
  return trimmed;
}

function normalizeHash(value: unknown): string {
  if (typeof value !== 'string') {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.hash);
  }
  const normalized = value.trim().toLowerCase();
  if (!HASH_RE.test(normalized)) {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.hash);
  }
  return normalized;
}

function normalizeStepUpMethod(value: StepUpMethod | null | undefined): StepUpMethod | null {
  if (value == null) return null;
  if (value !== 'passkey' && value !== 'totp') {
    throw approvalError('WC_VALIDATION', APPROVAL_MESSAGES.stepUpMethod);
  }
  return value;
}
