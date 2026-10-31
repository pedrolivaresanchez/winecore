/**
 * SQL ApprovalStore over ops.approval_*. Writes go through withWrite.
 * compareAndSet is one conditional update inside that single writer.
 */
import { domainError } from '../errors';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import {
  ApprovalService,
  systemClock,
  type ApprovalStore,
  type ApprovalTx,
  type StatusExpect,
  type StatusPatch,
} from './service';
import { loadApprovalPolicies } from './policy-store';
import {
  APPROVAL_STATUSES,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalStatus,
  type Clock,
  type DecisionValue,
  type JsonValue,
  type StepUpMethod,
} from './types';
import { isApprovalKind } from './policy';

type Read = <T = Record<string, unknown>>(statement: string) => Promise<T[]>;

export class SqlApprovalStore implements ApprovalStore {
  constructor(
    private readonly writer: Writer,
    private readonly actor: Actor,
    private readonly clock: Clock = systemClock,
  ) {}

  async insertRequest(request: ApprovalRequest): Promise<void> {
    await this.writer.withWrite(this.actor, async (tx) => {
      await assertLegalEntity(tx, request.legalEntityId);
      tx.write(insertRequestSql(request));
      tx.audit({
        table: 'ops.approval_request',
        rowId: request.id,
        action: 'INSERT',
        before: null,
        after: auditRequest(request),
      });
    });
  }

  getRequest(id: string): Promise<ApprovalRequest | null> {
    return this.fetchRequest((statement) => this.writer.read(statement), id);
  }

  async listDecisions(requestId: string): Promise<readonly ApprovalDecision[]> {
    const rows = await this.writer.read<Record<string, unknown>>(sql`
      SELECT id, request_id, decided_by, decision, decided_at, note,
             step_up_method, step_up_at, payload_sha256, ip, user_agent
      FROM ops.approval_decision
      WHERE request_id = CAST(${requestId} AS UUID)
      ORDER BY decided_at, id
    `);
    return rows.map((row) => mapDecision(row));
  }

  async compareAndSet(
    id: string,
    expect: StatusExpect,
    patch: StatusPatch,
  ): Promise<ApprovalRequest | null> {
    return this.writer.withWrite(this.actor, async (tx) => {
      const current = await this.fetchRequest(tx.read, id);
      if (!matches(current, expect)) return null;
      const next = applyPatch(current, patch);
      tx.write(patchSql(id, expect, patch));
      tx.audit({
        table: 'ops.approval_request',
        rowId: id,
        action: 'UPDATE',
        before: auditRequest(current),
        after: auditRequest(next),
      });
      return next;
    });
  }

  async transact<T>(requestId: string, run: (tx: ApprovalTx) => Promise<T>): Promise<T> {
    let thrown: unknown;
    const result = await this.writer.withWrite(this.actor, async (db) => {
      try {
        return await run(await this.bound(db, requestId));
      } catch (error) {
        thrown = error;
        return undefined as T;
      }
    });
    if (thrown) throw thrown;
    return result;
  }

  private async bound(db: Tx, requestId: string): Promise<ApprovalTx> {
    const state: { request: ApprovalRequest | null; inserted: ApprovalDecision[] } = {
      request: await this.fetchRequest(db.read, requestId),
      inserted: [],
    };
    const stored = state.request ? await this.fetchDecisions(db.read, requestId) : [];
    return {
      getRequest: () => Promise.resolve(state.request ? structuredClone(state.request) : null),
      decisions: () => Promise.resolve([...stored, ...state.inserted].map((row) => structuredClone(row))),
      insertDecision: async (decision) => {
        if (!state.request) throw domainError('WC_NOT_FOUND');
        if ([...stored, ...state.inserted].some((row) => row.decidedBy === decision.decidedBy || row.id === decision.id)) {
          throw domainError('WC041');
        }
        await assertUser(db, decision.decidedBy);
        db.write(decisionGuardSql(decision, this.clock.now()));
        db.write(insertDecisionSql(decision));
        db.audit({
          table: 'ops.approval_decision',
          rowId: decision.id,
          action: 'INSERT',
          before: null,
          after: auditDecision(decision),
        });
        state.inserted.push(structuredClone(decision));
      },
      compareAndSet: (expect, patch) => {
        if (!matches(state.request, expect)) return Promise.resolve(null);
        const next = applyPatch(state.request, patch);
        db.write(patchSql(requestId, expect, patch));
        db.audit({
          table: 'ops.approval_request',
          rowId: requestId,
          action: 'UPDATE',
          before: auditRequest(state.request),
          after: auditRequest(next),
        });
        state.request = next;
        return Promise.resolve(structuredClone(next));
      },
    };
  }

  private async fetchRequest(read: Read, id: string): Promise<ApprovalRequest | null> {
    const rows = await read<Record<string, unknown>>(sql`
      SELECT id, kind, legal_entity_id, subject_table, subject_id, payload_sha256,
             summary, details, status, requested_by, requested_at, expires_at,
             approved_at, consumed_at, workflow_run_ref
      FROM ops.approval_request
      WHERE id = CAST(${id} AS UUID)
    `);
    const row = rows[0];
    return row ? mapRequest(row) : null;
  }

  private async fetchDecisions(read: Read, requestId: string): Promise<ApprovalDecision[]> {
    const rows = await read<Record<string, unknown>>(sql`
      SELECT id, request_id, decided_by, decision, decided_at, note,
             step_up_method, step_up_at, payload_sha256, ip, user_agent
      FROM ops.approval_decision
      WHERE request_id = CAST(${requestId} AS UUID)
      ORDER BY decided_at, id
    `);
    return rows.map((row) => mapDecision(row));
  }
}

export async function openApprovalService(
  writer: Writer,
  actor: Actor,
  clock: Clock = systemClock,
): Promise<ApprovalService> {
  const policies = await loadApprovalPolicies(writer);
  return new ApprovalService({
    store: new SqlApprovalStore(writer, actor, clock),
    policies,
    clock,
  });
}

async function assertLegalEntity(tx: Tx, legalEntityId: string | null): Promise<void> {
  if (legalEntityId === null) return;
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.legal_entity WHERE id = CAST(${legalEntityId} AS UUID)
  `);
  if (!rows[0]) {
    throw domainError('WC_VALIDATION', { legalEntityId: 'La entidad no existe' });
  }
}

async function assertUser(tx: Tx, userId: string): Promise<void> {
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.app_user WHERE id = CAST(${userId} AS UUID)
  `);
  if (!rows[0]) throw domainError('WC_VALIDATION', { userId: 'El usuario no existe' });
  tx.write(sql`
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM core.app_user WHERE id = CAST(${userId} AS UUID)) THEN 1
      ELSE error('WC_VALIDATION: el usuario no existe')
    END
  `);
}

function decisionGuardSql(decision: ApprovalDecision, now: Date): string {
  return sql`
    SELECT CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM ops.approval_request WHERE id = CAST(${decision.requestId} AS UUID)
      ) THEN error('WC_NOT_FOUND: no encontrado')
      WHEN EXISTS (
        SELECT 1 FROM ops.approval_request
        WHERE id = CAST(${decision.requestId} AS UUID) AND status <> 'pending'
      ) THEN error('WC042: la solicitud no está pendiente')
      WHEN EXISTS (
        SELECT 1 FROM ops.approval_request
        WHERE id = CAST(${decision.requestId} AS UUID) AND expires_at < ${now}
      ) THEN error('WC043: la solicitud ha caducado')
      WHEN EXISTS (
        SELECT 1 FROM ops.approval_request
        WHERE id = CAST(${decision.requestId} AS UUID) AND payload_sha256 <> ${decision.payloadSha256}
      ) THEN error('WC040: el contenido aprobado no coincide')
      WHEN EXISTS (
        SELECT 1 FROM ops.approval_decision
        WHERE request_id = CAST(${decision.requestId} AS UUID)
          AND decided_by = CAST(${decision.decidedBy} AS UUID)
      ) THEN error('WC041: una decisión de aprobación no se modifica')
      ELSE 1
    END
  `;
}

function insertRequestSql(request: ApprovalRequest): string {
  return sql`
    INSERT INTO ops.approval_request (
      id, kind, legal_entity_id, subject_table, subject_id, payload_sha256,
      summary, details, status, requested_by, requested_at, expires_at,
      approved_at, consumed_at, workflow_run_ref
    ) VALUES (
      CAST(${request.id} AS UUID),
      ${request.kind},
      CASE WHEN ${request.legalEntityId} IS NULL THEN NULL ELSE CAST(${request.legalEntityId} AS UUID) END,
      ${request.subjectTable},
      CAST(${request.subjectId} AS UUID),
      ${request.payloadSha256},
      ${request.summary},
      ${sql.json(request.details)},
      ${request.status},
      ${request.requestedBy},
      ${new Date(request.requestedAt)},
      ${new Date(request.expiresAt)},
      ${request.approvedAt === null ? null : new Date(request.approvedAt)},
      ${request.consumedAt === null ? null : new Date(request.consumedAt)},
      ${request.workflowRunRef}
    )
  `;
}

function insertDecisionSql(decision: ApprovalDecision): string {
  return sql`
    INSERT INTO ops.approval_decision (
      id, request_id, decided_by, decision, decided_at, note,
      step_up_method, step_up_at, payload_sha256, ip, user_agent
    ) VALUES (
      CAST(${decision.id} AS UUID),
      CAST(${decision.requestId} AS UUID),
      CAST(${decision.decidedBy} AS UUID),
      ${decision.decision},
      ${new Date(decision.decidedAt)},
      ${decision.note},
      ${decision.stepUpMethod},
      ${decision.stepUpAt === null ? null : new Date(decision.stepUpAt)},
      ${decision.payloadSha256},
      ${decision.ip},
      ${decision.userAgent}
    )
  `;
}

function patchSql(id: string, expect: StatusExpect, patch: StatusPatch): string {
  const sets = [sql`status = ${patch.status}`];
  if (patch.approvedAt !== undefined) {
    sets.push(sql`approved_at = ${patch.approvedAt === null ? null : new Date(patch.approvedAt)}`);
  }
  if (patch.consumedAt !== undefined) {
    sets.push(sql`consumed_at = ${patch.consumedAt === null ? null : new Date(patch.consumedAt)}`);
  }
  const where = sql`
    WHERE id = CAST(${id} AS UUID)
      AND status = ${expect.status}
      AND payload_sha256 = ${expect.payloadSha256}
  `;
  return `UPDATE ops.approval_request SET ${sets.join(', ')} ${where}`;
}

function matches(request: ApprovalRequest | null, expect: StatusExpect): request is ApprovalRequest {
  return request !== null && request.status === expect.status && request.payloadSha256 === expect.payloadSha256;
}

function applyPatch(request: ApprovalRequest, patch: StatusPatch): ApprovalRequest {
  return {
    ...request,
    status: patch.status,
    approvedAt: patch.approvedAt !== undefined ? patch.approvedAt : request.approvedAt,
    consumedAt: patch.consumedAt !== undefined ? patch.consumedAt : request.consumedAt,
  };
}

function mapRequest(row: Record<string, unknown>): ApprovalRequest {
  const kind = text(row.kind);
  const status = text(row.status);
  if (!kind || !isApprovalKind(kind)) {
    throw domainError('WC_VALIDATION', { kind: 'El tipo de aprobación no es válido' });
  }
  if (!status || !isStatus(status)) {
    throw domainError('WC_VALIDATION', { status: 'El estado de la aprobación no es válido' });
  }
  const id = text(row.id);
  const subjectTable = text(row.subject_table);
  const subjectId = text(row.subject_id);
  const payloadSha256 = text(row.payload_sha256);
  const summary = text(row.summary);
  const requestedBy = text(row.requested_by);
  const requestedAt = text(row.requested_at);
  const expiresAt = text(row.expires_at);
  if (!id || !subjectTable || !subjectId || !payloadSha256 || !summary || !requestedBy || !requestedAt || !expiresAt) {
    throw domainError('WC_VALIDATION', { request: 'La solicitud de aprobación está incompleta' });
  }
  return {
    id: id.toLowerCase(),
    kind,
    legalEntityId: row.legal_entity_id == null ? null : String(row.legal_entity_id).toLowerCase(),
    subjectTable,
    subjectId: subjectId.toLowerCase(),
    payloadSha256: payloadSha256.toLowerCase(),
    summary,
    details: jsonValue(row.details),
    status,
    requestedBy,
    requestedAt: asIso(requestedAt),
    expiresAt: asIso(expiresAt),
    approvedAt: row.approved_at == null ? null : asIso(String(row.approved_at)),
    consumedAt: row.consumed_at == null ? null : asIso(String(row.consumed_at)),
    workflowRunRef: row.workflow_run_ref == null ? null : String(row.workflow_run_ref),
  };
}

function mapDecision(row: Record<string, unknown>): ApprovalDecision {
  const decision = text(row.decision);
  if (decision !== 'approve' && decision !== 'reject') {
    throw domainError('WC_VALIDATION', { decision: 'La decisión no es válida' });
  }
  const id = text(row.id);
  const requestId = text(row.request_id);
  const decidedBy = text(row.decided_by);
  const decidedAt = text(row.decided_at);
  const payloadSha256 = text(row.payload_sha256);
  if (!id || !requestId || !decidedBy || !decidedAt || !payloadSha256) {
    throw domainError('WC_VALIDATION', { decision: 'La decisión está incompleta' });
  }
  return {
    id: id.toLowerCase(),
    requestId: requestId.toLowerCase(),
    decidedBy: decidedBy.toLowerCase(),
    decision: decision as DecisionValue,
    decidedAt: asIso(decidedAt),
    note: row.note == null ? null : String(row.note),
    stepUpMethod: stepMethod(row.step_up_method),
    stepUpAt: row.step_up_at == null ? null : asIso(String(row.step_up_at)),
    payloadSha256: payloadSha256.toLowerCase(),
    ip: row.ip == null ? null : String(row.ip),
    userAgent: row.user_agent == null ? null : String(row.user_agent),
  };
}

function auditRequest(request: ApprovalRequest): Record<string, unknown> {
  return {
    kind: request.kind,
    legal_entity_id: request.legalEntityId,
    status: request.status,
    payload_sha256: request.payloadSha256,
    summary: request.summary,
    requested_by: request.requestedBy,
    expires_at: request.expiresAt,
    approved_at: request.approvedAt,
    consumed_at: request.consumedAt,
  };
}

function auditDecision(decision: ApprovalDecision): Record<string, unknown> {
  return {
    request_id: decision.requestId,
    decided_by: decision.decidedBy,
    decision: decision.decision,
    note: decision.note,
    step_up_method: decision.stepUpMethod,
    step_up_at: decision.stepUpAt,
    payload_sha256: decision.payloadSha256,
  };
}

function jsonValue(value: unknown): JsonValue {
  if (value == null) return {};
  if (typeof value === 'string') {
    return JSON.parse(value) as JsonValue;
  }
  return value as JsonValue;
}

function stepMethod(value: unknown): StepUpMethod | null {
  if (value === 'passkey' || value === 'totp') return value;
  return null;
}

function isStatus(value: string): value is ApprovalStatus {
  return (APPROVAL_STATUSES as readonly string[]).includes(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value;
}

function asIso(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}
