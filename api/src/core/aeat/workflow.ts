import { payloadSha256 } from '../approvals/canonical';
import { loadApprovalPolicies } from '../approvals/policy-store';
import { approvalServiceOn } from '../approvals/sql-store';
import type { Clock } from '../approvals/types';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { emitEvent } from '../events/emit';
import { domainError } from '../errors';
import { newId } from '../ids';
import { assertMutableContent, assertStatusChange } from '../regulatory/guard';
import { buildDraft, buildIssuedBook, buildReceivedBook } from './compute';
import { loadPack, resolveEntity } from './load';
import { isModel, modelKind, parsePeriod, periodError, type ModelCode, type Period } from './period';
import type { BookModel, DraftModel, EntityProfile } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9][A-Za-z0-9./_-]{3,39}$/;

export interface AeatView {
  id: string;
  flow: 'aeat_model';
  model: ModelCode;
  legal_entity_id: string;
  period: string;
  period_start: string;
  period_end: string;
  status: string;
  content_sha256: string;
  external_ref: string | null;
  approval_request_id: string | null;
  validation_errors: { severity: 'error'; code: string; message: string }[];
  draft: DraftModel;
}

export interface LiveDraft {
  draft: DraftModel;
  content_sha256: string;
  issued: BookModel;
  received: BookModel;
}

export async function previewDraft(db: Writer, entityToken: string, model: string, periodToken: string): Promise<LiveDraft & { entity: EntityProfile }> {
  const parsed = await prepareRead(db, entityToken, model, periodToken);
  const pack = await loadPack(db, parsed.entity, parsed.model, parsed.period);
  const draft = buildDraft(parsed.model, pack);
  const canonical = canonicalOf(parsed.entity, parsed.model, parsed.period, draft);
  return {
    entity: parsed.entity,
    draft,
    content_sha256: payloadSha256(canonical),
    issued: buildIssuedBook(pack),
    received: buildReceivedBook(pack),
  };
}

export async function previewBook(
  db: Writer,
  entityToken: string,
  periodToken: string,
  book: 'issued' | 'received',
): Promise<{ entity: EntityProfile; period: Period; book: BookModel }> {
  const entity = await resolveEntity(db, entityToken);
  const period = parsePeriod(periodToken);
  if (!period) throw domainError('WC_VALIDATION', { period: 'El periodo no es válido' });
  // El 349 acepta trimestre, mes y año, así que la ventana es el periodo pedido.
  const pack = await loadPack(db, entity, '349', period);
  return { entity, period, book: book === 'issued' ? buildIssuedBook(pack) : buildReceivedBook(pack) };
}

export async function generateAeat(
  writer: Writer,
  actor: Actor,
  input: { entityToken: string; model: string; periodToken: string; createdBy: string },
  clock: Clock,
): Promise<AeatView> {
  const id = await writer.withWrite(actor, async (tx) => {
    const parsed = await prepareRead(tx, input.entityToken, input.model, input.periodToken);
    const pack = await loadPack(tx, parsed.entity, parsed.model, parsed.period);
    const draft = buildDraft(parsed.model, pack);
    const canonical = canonicalOf(parsed.entity, parsed.model, parsed.period, draft);
    const hash = payloadSha256(canonical);
    const existing = await findOpen(tx, parsed.entity.id, modelKind(parsed.model), parsed.period);
    if (existing && !mutable(existing.status)) {
      if (['submitted', 'accepted', 'accepted_with_errors', 'rejected'].includes(existing.status)) {
        throw domainError('WC_ILLEGAL_TRANSITION', { period: 'Este periodo ya está marcado como presentado.' });
      }
      throw domainError('WC120', { period: 'El borrador está congelado. Márcalo como presentado o espera a que se rechace la aprobación.' });
    }
    const errors = issuesOf(draft);
    const rowId = existing?.id ?? newId();
    if (!existing) {
      tx.write(sql`
        INSERT INTO regulatory.submission (
          id, flow, legal_entity_id, kind, period_start, period_end, status, payload, payload_sha256,
          validation_errors, response_summary, created_by
        ) VALUES (
          CAST(${rowId} AS UUID),
          'aeat_model',
          CAST(${parsed.entity.id} AS UUID),
          ${modelKind(parsed.model)},
          CAST(${parsed.period.from} AS DATE),
          CAST(${parsed.period.to} AS DATE),
          'draft',
          ${sql.json(canonical)},
          ${hash},
          ${sql.json(errors)},
          ${sql.json({ model: parsed.model, period: parsed.period.token })},
          ${input.createdBy}
        )
      `);
    }
    if (existing) assertMutableContent(existing.status);
    if (existing) assertStatusChange(existing.status, 'draft');
    tx.write(sql`
      UPDATE regulatory.submission
      SET status = 'draft',
          payload = ${sql.json(canonical)},
          payload_sha256 = ${hash},
          validation_errors = ${sql.json(errors)},
          approval_request_id = NULL,
          updated_at = now()
      WHERE id = CAST(${rowId} AS UUID)
    `);
    tx.audit({
      table: 'regulatory.submission',
      rowId,
      action: existing ? 'UPDATE' : 'INSERT',
      before: existing ? { status: existing.status, payload_sha256: existing.payload_sha256 } : null,
      after: { status: 'draft', payload_sha256: hash, kind: modelKind(parsed.model) },
    });
    void clock;
    return rowId;
  });
  return getAeat(writer, id);
}

export async function validateAeat(writer: Writer, actor: Actor, id: string): Promise<AeatView> {
  await writer.withWrite(actor, async (tx) => {
    const row = await requireAeat(tx, id);
    if (!mutable(row.status)) {
      throw domainError('WC_ILLEGAL_TRANSITION', { status: 'Solo se valida un borrador que todavía no está en aprobación.' });
    }
    const fresh = await recompute(tx, row);
    if (fresh.hash !== row.payload_sha256) {
      tx.write(sql`
        UPDATE regulatory.submission
        SET status = 'draft',
            validation_errors = ${sql.json(changedIssue())},
            updated_at = now()
        WHERE id = CAST(${id} AS UUID)
      `);
      return;
    }
    const errors = issuesOf(fresh.draft);
    const next = errors.length === 0 ? 'validated' : 'draft';
    assertStatusChange(row.status, next);
    tx.write(sql`
      UPDATE regulatory.submission
      SET status = ${next},
          validation_errors = ${sql.json(errors)},
          updated_at = now()
      WHERE id = CAST(${id} AS UUID)
    `);
    tx.audit({
      table: 'regulatory.submission',
      rowId: id,
      action: 'UPDATE',
      before: { status: row.status },
      after: { status: next },
    });
  });
  return getAeat(writer, id);
}

export async function requestAeatApproval(writer: Writer, actor: Actor, id: string, clock: Clock): Promise<AeatView> {
  const policies = await loadApprovalPolicies(writer);
  const demoted = await writer.withWrite(actor, async (tx) => {
    const row = await requireAeat(tx, id);
    if (row.status !== 'validated') {
      throw domainError('WC_ILLEGAL_TRANSITION', { status: 'Hay que validar el borrador, sin errores, antes de pedir la aprobación.' });
    }
    const fresh = await recompute(tx, row);
    const errors = fresh.hash === row.payload_sha256 ? issuesOf(fresh.draft) : changedIssue();
    if (fresh.hash !== row.payload_sha256 || errors.length > 0) {
      tx.write(sql`
        UPDATE regulatory.submission
        SET status = 'draft', validation_errors = ${sql.json(errors)}, updated_at = now()
        WHERE id = CAST(${id} AS UUID) AND status = 'validated'
      `);
      return true;
    }
    const approval = await approvalServiceOn(tx, policies, clock).requestApproval({
      kind: 'regulatory_submission',
      legalEntityId: row.legal_entity_id,
      subjectTable: 'regulatory.submission',
      subjectId: id,
      payload: fresh.canonical,
      summary: `Modelo ${row.model} ${row.period} (${row.legal_entity_id.slice(0, 8)})`,
      requestedBy: actor.id,
      details: {
        model: row.model,
        period: row.period,
        result: fresh.draft.result,
        documents: fresh.draft.documents.length,
        destination: 'asesor',
      },
    });
    if (approval.payloadSha256 !== fresh.hash) throw domainError('WC040');
    assertStatusChange('validated', 'pending_approval');
    tx.write(sql`
      UPDATE regulatory.submission
      SET status = 'pending_approval',
          approval_request_id = CAST(${approval.id} AS UUID),
          validation_errors = ${sql.json([])},
          updated_at = now()
      WHERE id = CAST(${id} AS UUID) AND status = 'validated' AND payload_sha256 = ${fresh.hash}
    `);
    tx.audit({
      table: 'regulatory.submission',
      rowId: id,
      action: 'UPDATE',
      before: { status: 'validated' },
      after: { status: 'pending_approval', approval_request_id: approval.id },
    });
    emitEvent(tx, {
      type: 'regulatory.submission.pending_approval',
      aggregate: 'regulatory.submission',
      aggregateId: id,
      payload: {
        legal_entity_id: row.legal_entity_id,
        submission_id: id,
        link: '/regulatorio/modelos',
      },
    });
    return false;
  });
  if (demoted) {
    throw domainError('WC_VALIDATION', { period: 'Los datos del periodo han cambiado. Vuelve a generar el borrador.' });
  }
  return getAeat(writer, id);
}

export async function markAeatFiled(
  writer: Writer,
  actor: Actor,
  id: string,
  externalRef: string,
  clock: Clock,
): Promise<AeatView> {
  const ref = externalRef.trim();
  if (!REF.test(ref)) {
    throw domainError('WC_VALIDATION', { external_ref: 'La referencia del justificante tiene que tener entre 4 y 40 caracteres.' });
  }
  const policies = await loadApprovalPolicies(writer);
  await writer.withWrite(actor, async (tx) => {
    const row = await requireAeat(tx, id);
    if (row.status === 'submitted' && row.external_ref === ref) return;
    if (row.status === 'submitted') {
      throw domainError('WC_ILLEGAL_TRANSITION', { external_ref: 'El modelo ya está marcado como presentado.' });
    }
    if (row.status !== 'approved') {
      throw domainError('WC_ILLEGAL_TRANSITION', { status: 'Solo se marca como presentado un borrador ya aprobado.' });
    }
    if (!row.approval_request_id) throw domainError('WC_NOT_APPROVED');
    const approval = await tx.read<{ status: string; payload_sha256: string }>(sql`
      SELECT status, payload_sha256 FROM ops.approval_request WHERE id = CAST(${row.approval_request_id} AS UUID)
    `);
    const current = approval[0];
    if (!current || current.status !== 'approved' || current.payload_sha256 !== row.payload_sha256) {
      throw domainError('WC_NOT_APPROVED');
    }
    assertStatusChange(row.status, 'submitted');
    await approvalServiceOn(tx, policies, clock).consume({
      requestId: row.approval_request_id,
      payloadSha256: row.payload_sha256,
    });
    tx.write(sql`
      UPDATE regulatory.submission
      SET status = 'submitted',
          external_ref = ${ref},
          response_summary = ${sql.json({ manual_submit: { mode: 'manual', external_ref: ref, filed_by: 'human' } })},
          updated_at = now()
      WHERE id = CAST(${id} AS UUID) AND status = 'approved'
    `);
    tx.audit({
      table: 'regulatory.submission',
      rowId: id,
      action: 'UPDATE',
      before: { status: 'approved' },
      after: { status: 'submitted', external_ref: ref },
    });
  });
  return getAeat(writer, id);
}

export async function getAeat(writer: Writer, id: string): Promise<AeatView> {
  const rows = await writer.read<Record<string, unknown>>(selectOne(sql`s.id = CAST(${id} AS UUID) AND s.flow = 'aeat_model'`));
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return toView(row);
}

export async function listAeat(
  writer: Writer,
  filter: { entityId?: string; model?: ModelCode; period?: Period },
): Promise<AeatView[]> {
  const where = [`s.flow = 'aeat_model'`];
  if (filter.entityId) where.push(sql`s.legal_entity_id = CAST(${filter.entityId} AS UUID)`);
  if (filter.model) where.push(sql`s.kind = ${modelKind(filter.model)}`);
  if (filter.period) {
    where.push(sql`s.period_start = CAST(${filter.period.from} AS DATE)`);
    where.push(sql`s.period_end = CAST(${filter.period.to} AS DATE)`);
  }
  const rows = await writer.read<Record<string, unknown>>(
    `${selectBody()} WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC`,
  );
  return rows.map(toView);
}

async function prepareRead(
  db: Pick<Tx, 'read'>,
  entityToken: string,
  modelToken: string,
  periodToken: string,
): Promise<{ entity: EntityProfile; model: ModelCode; period: Period }> {
  if (!isModel(modelToken)) throw domainError('WC_VALIDATION', { model: 'El modelo no está en el alcance de WineCore' });
  const period = parsePeriod(periodToken);
  if (!period) throw domainError('WC_VALIDATION', { period: 'El periodo no es válido' });
  const error = periodError(modelToken, period);
  if (error) throw domainError('WC_VALIDATION', { period: error });
  const entity = await resolveEntity(db, entityToken);
  return { entity, model: modelToken, period };
}

async function recompute(tx: Tx, row: Stored): Promise<{ draft: DraftModel; canonical: Canonical; hash: string }> {
  const entity = await resolveEntity(tx, row.legal_entity_id);
  const period = parsePeriod(row.period);
  if (!period || !isModel(row.model)) throw domainError('WC_VALIDATION', { period: 'El borrador guardado no se puede leer' });
  const pack = await loadPack(tx, entity, row.model, period);
  const draft = buildDraft(row.model, pack);
  const canonical = canonicalOf(entity, row.model, period, draft);
  return { draft, canonical, hash: payloadSha256(canonical) };
}

interface Canonical {
  flow: 'aeat_model';
  model: ModelCode;
  legal_entity_id: string;
  period: string;
  period_start: string;
  period_end: string;
  draft: DraftModel;
}

function canonicalOf(entity: EntityProfile, model: ModelCode, period: Period, draft: DraftModel): Canonical {
  return {
    flow: 'aeat_model',
    model,
    legal_entity_id: entity.id,
    period: period.token,
    period_start: period.from,
    period_end: period.to,
    draft,
  };
}

function issuesOf(draft: DraftModel): { severity: 'error'; code: string; message: string }[] {
  return draft.reconciliation.filter((row) => !row.ok).map((row) => ({
    severity: 'error' as const,
    code: row.name,
    message: row.label,
  }));
}

function changedIssue(): { severity: 'error'; code: string; message: string }[] {
  return [{
    severity: 'error',
    code: 'datos_cambiados',
    message: 'Los datos del periodo han cambiado. Vuelve a generar el borrador.',
  }];
}

interface Stored {
  id: string;
  legal_entity_id: string;
  model: ModelCode;
  period: string;
  status: string;
  payload_sha256: string;
  external_ref: string | null;
  approval_request_id: string | null;
}

async function findOpen(tx: Tx, entityId: string, kind: string, period: Period): Promise<Stored | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT s.id::VARCHAR AS id, s.kind, s.legal_entity_id::VARCHAR AS legal_entity_id,
           s.period_start::VARCHAR AS period_start, s.period_end::VARCHAR AS period_end, s.status,
           s.payload_sha256, s.approval_request_id::VARCHAR AS approval_request_id, s.external_ref
    FROM regulatory.submission s
    WHERE s.flow = 'aeat_model'
      AND s.legal_entity_id = CAST(${entityId} AS UUID)
      AND s.kind = ${kind}
      AND s.period_start = CAST(${period.from} AS DATE)
      AND s.period_end = CAST(${period.to} AS DATE)
      AND s.status NOT IN ('cancelled', 'rectified')
    ORDER BY s.created_at DESC
    LIMIT 1
  `);
  const row = rows[0];
  return row ? storedOf(row) : null;
}

async function requireAeat(tx: Tx, id: string): Promise<Stored> {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const rows = await tx.read<Record<string, unknown>>(selectOne(sql`s.id = CAST(${id} AS UUID) AND s.flow = 'aeat_model'`));
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return storedOf(row);
}

function storedOf(row: Record<string, unknown>): Stored {
  const kind = String(row.kind ?? '');
  const model = kind.startsWith('aeat_') ? kind.slice(5) : '';
  if (!isModel(model)) throw domainError('WC_VALIDATION', { model: 'El envío no es un modelo de la AEAT' });
  const start = String(row.period_start ?? '').slice(0, 10);
  const end = String(row.period_end ?? '').slice(0, 10);
  return {
    id: String(row.id).toLowerCase(),
    legal_entity_id: String(row.legal_entity_id).toLowerCase(),
    model,
    period: periodToken(model, start, end),
    status: String(row.status),
    payload_sha256: String(row.payload_sha256),
    external_ref: row.external_ref == null ? null : String(row.external_ref),
    approval_request_id: row.approval_request_id == null ? null : String(row.approval_request_id).toLowerCase(),
  };
}

function periodToken(model: ModelCode, start: string, end: string): string {
  const year = start.slice(0, 4);
  if (model === '390' || model === '347') return year;
  if (start.endsWith('-01-01') && end.endsWith('-12-31')) return year;
  const month = Number(start.slice(5, 7));
  const endMonth = Number(end.slice(5, 7));
  if (start.endsWith('-01') && endMonth === month + 2) return `${year}-Q${Math.ceil(month / 3)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return start.slice(0, 7);
  return `${year}-Q${Math.ceil(month / 3) || 1}`;
}

function toView(row: Record<string, unknown>): AeatView {
  const stored = storedOf(row);
  const payload = jsonOf(row.payload);
  const draft = payload.draft;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw domainError('WC_VALIDATION', { payload: 'El borrador guardado no se puede leer' });
  }
  const errors = asErrors(row.validation_errors);
  return {
    id: stored.id,
    flow: 'aeat_model',
    model: stored.model,
    legal_entity_id: stored.legal_entity_id,
    period: stored.period,
    period_start: String(row.period_start).slice(0, 10),
    period_end: String(row.period_end).slice(0, 10),
    status: stored.status,
    content_sha256: stored.payload_sha256,
    external_ref: stored.external_ref,
    approval_request_id: stored.approval_request_id,
    validation_errors: errors,
    draft: draft as DraftModel,
  };
}

function asErrors(value: unknown): { severity: 'error'; code: string; message: string }[] {
  const parsed = typeof value === 'string' ? safeParse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { severity?: string; code?: string; message?: string };
    if (row.severity !== 'error' || typeof row.code !== 'string' || typeof row.message !== 'string') return [];
    return [{ severity: 'error' as const, code: row.code, message: row.message }];
  });
}

function jsonOf(value: unknown): { draft?: unknown } {
  const parsed = typeof value === 'string' ? safeParse(value) : value;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as { draft?: unknown };
  return {};
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mutable(status: string): boolean {
  return status === 'draft' || status === 'validated';
}

function selectBody(): string {
  return `SELECT s.id::VARCHAR AS id, s.kind, s.legal_entity_id::VARCHAR AS legal_entity_id,
    s.period_start::VARCHAR AS period_start, s.period_end::VARCHAR AS period_end, s.status,
    s.payload::VARCHAR AS payload, s.payload_sha256, s.validation_errors::VARCHAR AS validation_errors,
    s.approval_request_id::VARCHAR AS approval_request_id, s.external_ref
    FROM regulatory.submission s`;
}

function selectOne(where: string): string {
  return `${selectBody()} WHERE ${where}`;
}
