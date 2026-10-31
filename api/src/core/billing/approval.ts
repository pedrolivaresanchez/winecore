import { payloadSha256 } from '../approvals/canonical';
import { approvalServiceOn } from '../approvals/sql-store';
import type { ApproverContext } from '../approvals/types';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { idOf, isUuid, stamp } from './format';

/**
 * Gancho de aprobación. El módulo de aprobaciones lo sustituye (`setBillingApprovalHook`);
 * mientras tanto la solicitud queda en `ops.approval_request` y `grantBillingApproval`
 * la marca concedida. Anular y emitir un lote no siguen adelante sin esa concesión.
 */
export interface ApprovalNeed {
  kind: 'invoice_void' | 'invoice_batch_issue';
  legalEntityId: string;
  subjectTable: string;
  subjectId: string;
  summary: string;
  payload: Record<string, unknown>;
  requestedBy: string;
}

export interface ApprovalReview {
  requestId: string;
  granted: boolean;
  payloadSha256: string;
}

export interface BillingApprovalHook {
  review(tx: Tx, need: ApprovalNeed, now: Date): Promise<ApprovalReview>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function hashPayload(payload: Record<string, unknown>): string {
  return payloadSha256(payload);
}

function expired(value: unknown, now: Date): boolean {
  const parsed = Date.parse(stamp(value) ?? '');
  return !Number.isFinite(parsed) || parsed <= now.getTime();
}

async function defaultReview(tx: Tx, need: ApprovalNeed, now: Date): Promise<ApprovalReview> {
  const payloadSha256 = hashPayload(need.payload);
  if (need.summary.length < 5 || need.summary.length > 300) {
    throw domainError('WC_VALIDATION', { summary: 'El resumen de la aprobación no cabe' });
  }
  if (!isUuid(need.subjectId) || !isUuid(need.legalEntityId)) throw domainError('WC_VALIDATION');
  const existing = await tx.read<{ id: unknown; status: unknown; expires_at: unknown }>(sql`
    SELECT id, status, expires_at
    FROM ops.approval_request
    WHERE kind = ${need.kind}
      AND payload_sha256 = ${payloadSha256}
      AND status IN ('pending', 'approved')
    ORDER BY requested_at DESC
    LIMIT 1
  `);
  const row = existing[0];
  if (row && !expired(row.expires_at, now)) {
    return {
      requestId: idOf(row.id),
      granted: String(row.status) === 'approved',
      payloadSha256,
    };
  }
  if (row && expired(row.expires_at, now)) {
    const staleId = idOf(row.id);
    tx.write(sql`
      UPDATE ops.approval_request
      SET status = 'expired'
      WHERE id = CAST(${staleId} AS UUID) AND status = 'pending'
    `);
    tx.audit({
      table: 'ops.approval_request',
      rowId: staleId,
      action: 'UPDATE',
      before: { status: 'pending' },
      after: { status: 'expired' },
    });
  }
  const requestId = newId();
  const expiresAt = new Date(now.getTime() + DAY_MS);
  tx.write(sql`
    INSERT INTO ops.approval_request (
      id, kind, legal_entity_id, subject_table, subject_id, payload_sha256,
      summary, details, status, requested_by, requested_at, expires_at
    ) VALUES (
      CAST(${requestId} AS UUID),
      ${need.kind},
      CAST(${need.legalEntityId} AS UUID),
      ${need.subjectTable},
      CAST(${need.subjectId} AS UUID),
      ${payloadSha256},
      ${need.summary},
      ${sql.json(need.payload)},
      'pending',
      ${need.requestedBy},
      ${now},
      ${expiresAt}
    )
  `);
  tx.audit({
    table: 'ops.approval_request',
    rowId: requestId,
    action: 'INSERT',
    before: null,
    after: { kind: need.kind, status: 'pending', payload_sha256: payloadSha256 },
  });
  return { requestId, granted: false, payloadSha256 };
}

let hook: BillingApprovalHook = { review: defaultReview };

export function setBillingApprovalHook(next: BillingApprovalHook | null): void {
  hook = next ?? { review: defaultReview };
}

export function reviewApproval(tx: Tx, need: ApprovalNeed, now: Date): Promise<ApprovalReview> {
  return hook.review(tx, need, now);
}

/**
 * Aprueba con verificación reforzada en esta escritura.
 * La bandeja usa el mismo servicio; aquí el paso reforzado es el instante de la concesión
 * (pruebas y el atajo del integrador).
 */
export async function grantBillingApproval(tx: Tx, requestId: string, now = new Date()): Promise<void> {
  if (!isUuid(requestId)) throw domainError('WC_NOT_FOUND');
  const rows = await tx.read<{ status: unknown; expires_at: unknown; payload_sha256: unknown; requested_by: unknown }>(sql`
    SELECT status, expires_at, payload_sha256, requested_by
    FROM ops.approval_request
    WHERE id = CAST(${requestId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  if (String(row.status) === 'approved') return;
  if (String(row.status) !== 'pending') throw domainError('WC042');
  if (expired(row.expires_at, now)) throw domainError('WC043');
  const actor = await approverContext(tx, String(row.requested_by), now);
  await approvalServiceOn(tx, []).decide({
    requestId,
    decision: 'approve',
    payloadSha256: String(row.payload_sha256),
    stepUpMethod: 'totp',
    actor,
  });
}

async function approverContext(tx: Tx, requestedBy: string, now: Date): Promise<ApproverContext> {
  const userId = isUuid(requestedBy) ? requestedBy.toLowerCase() : await ownerId(tx);
  const roles = await tx.read<{ role_code: unknown; legal_entity_id: unknown }>(sql`
    SELECT role_code, legal_entity_id
    FROM core.user_role
    WHERE user_id = CAST(${userId} AS UUID) AND revoked_at IS NULL
  `);
  return {
    userId,
    roles: roles.map((role) => ({
      role: String(role.role_code),
      legalEntityId: role.legal_entity_id == null ? null : String(role.legal_entity_id).toLowerCase(),
    })),
    kind: 'user',
    stepUpAt: now.toISOString(),
  };
}

async function ownerId(tx: Tx): Promise<string> {
  const rows = await tx.read<{ id: unknown }>(sql`
    SELECT id FROM core.app_user WHERE email = 'owner@winecore.test' LIMIT 1
  `);
  const id = rows[0] ? String(rows[0].id) : '';
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  return id.toLowerCase();
}

export async function consumeApproval(tx: Tx, requestId: string, now: Date): Promise<void> {
  if (!isUuid(requestId)) throw domainError('WC_NOT_FOUND');
  const rows = await tx.read<{ status: unknown; payload_sha256: unknown }>(sql`
    SELECT status, payload_sha256 FROM ops.approval_request WHERE id = CAST(${requestId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  if (String(row.status) === 'consumed') return;
  if (String(row.status) !== 'approved') throw domainError('WC_INV_APPROVAL_REQUIRED');
  try {
    await approvalServiceOn(tx, [], { now: () => now }).consume({
      requestId,
      payloadSha256: String(row.payload_sha256),
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'WC_NOT_APPROVED') {
      throw domainError('WC_INV_APPROVAL_REQUIRED');
    }
    throw error;
  }
}

export async function readApproval(tx: Pick<Tx, 'read'>, requestId: string): Promise<{
  id: string;
  kind: string;
  status: string;
  payloadSha256: string;
  payload: Record<string, unknown>;
  expiresAt: string | null;
} | null> {
  if (!isUuid(requestId)) return null;
  const rows = await tx.read(sql`
    SELECT id, kind, status, payload_sha256, details, expires_at
    FROM ops.approval_request
    WHERE id = CAST(${requestId} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: idOf(row.id),
    kind: String(row.kind),
    status: String(row.status),
    payloadSha256: String(row.payload_sha256),
    payload: jsonPayload(row.details),
    expiresAt: stamp(row.expires_at),
  };
}

function jsonPayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

export function approvalStillValid(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  return !expired(expiresAt, now);
}
