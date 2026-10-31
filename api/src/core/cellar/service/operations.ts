import { planOperation } from '../engine';
import type {
  AdditionRequest,
  BlendLine,
  BlendRequest,
  BottlingLine,
  BottlingRequest,
  BulkProductState,
  CellarState,
  CleaningRequest,
  FiscalMoveDraft,
  LossKind,
  LossLine,
  LossRequest,
  LotDraft,
  LotEdgeDraft,
  LotKind,
  LotRef,
  OperationRequest,
  PlanSuccess,
  StockMoveDraft,
  TransferLine,
  TransferRequest,
  VesselState,
  VesselStatus,
} from '../types';
import { findNegativeBalances } from '../../inventory/balances';
import { assertPeriodOpen, isBusinessDate, isInstant } from '../../inventory/periods';
import type { FiscalMove, PeriodLock, StockMove } from '../../inventory/types';
import { sessionOf } from '../../../auth/guard';
import { payloadSha256 } from '../../approvals/canonical';
import { loadApprovalPolicies } from '../../approvals/policy-store';
import { approvalServiceOn } from '../../approvals/sql-store';
import type { ApprovalPolicy } from '../../approvals/types';
import { newId } from '../../ids';
import { sql } from '../../db/sql';
import type { Tx, Writer } from '../../db/writer';
import { DomainError, domainError } from '../../errors';
import { businessDate } from '../../time';
import { takeCellarOperationNumber } from './number';
import {
  actorFor,
  auditInsert,
  auditUpdate,
  boolOf,
  countOf,
  decodeOpCursor,
  encodeOpCursor,
  fromPlan,
  intOf,
  invalid,
  isUuid,
  jsonObject,
  oneOf,
  optionalText,
  optionalUuid,
  parseLimit,
  positiveInt,
  readJson,
  requireText,
  requireUuid,
  slicePage,
  textOf,
  textOrNull,
  uuidList,
  type ListBody,
} from './http';

const OP_TYPES = [
  'reception',
  'bulk_reception',
  'crushing_pressing',
  'fermentation_end',
  'racking',
  'blend',
  'filtration',
  'addition',
  'stabilization',
  'cleaning',
  'sampling',
  'bottling',
  'labeling',
  'loss',
  'destruction',
] as const;

const ENGINE_TYPES = ['racking', 'blend', 'addition', 'bottling', 'loss', 'destruction', 'cleaning'] as const;
const LINE_TYPES = new Set(['racking', 'blend', 'bottling', 'loss', 'destruction']);
const STATUSES = ['draft', 'confirmed', 'rectified', 'discarded'] as const;
const LOSS_KINDS = ['authorized', 'incident'] as const;
const LOT_CODE = /^[A-Z0-9][A-Z0-9./-]{1,29}$/;
const LOT_KINDS = ['grape', 'must', 'wine', 'bottled'] as const;

export interface OperationHeader {
  id: string;
  legal_entity_id: string;
  number: string | null;
  op_type: string;
  occurred_at: string;
  status: string;
  rectifies_operation_id: string | null;
  reason: string | null;
  details: unknown;
  performed_by: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  approval_request_id: string | null;
  sisv_relevant: boolean;
  silicie_relevant: boolean;
  created_by: string;
  created_at: string;
}

export interface OperationView extends OperationHeader {
  lines: OperationLineView[];
  stock_moves: Record<string, unknown>[];
  fiscal_moves: Record<string, unknown>[];
  lots: Record<string, unknown>[];
  lot_edges: Record<string, unknown>[];
  addition: Record<string, unknown> | null;
  cleaning: Record<string, unknown> | null;
}

interface OperationLineView {
  id: string | null;
  operation_id: string;
  role: string;
  lot_id: string | null;
  vessel_id: string | null;
  location_id: string | null;
  product_id: string | null;
  product_state: string;
  volume_ml: number;
  qty_units: number;
  mass_g: number;
  loss_kind: string | null;
  notes: string | null;
}

interface ParsedHeader {
  op_type: (typeof ENGINE_TYPES)[number];
  legal_entity_id: string;
  occurred_at: string;
  fiscal_date: string;
  performed_by: string;
  reason: string | null;
}

interface ParsedLine {
  role: 'input' | 'output' | 'loss';
  lot_id: string | null;
  vessel_id: string | null;
  location_id: string | null;
  product_id: string | null;
  product_state: string;
  volume_ml: number;
  qty_units: number;
  loss_kind: LossKind | null;
  nominal_volume_ml: number | null;
  excise_product_key: string | null;
  nc_code: string | null;
}

interface AdditionInput {
  additive_product_id: string;
  quantity: string;
  quantity_unit: 'g' | 'kg' | 'ml' | 'l';
  dose: string;
  dose_unit: 'g/hl' | 'mg/l' | 'g/l';
  purpose: 'acidification' | 'sulphiting' | 'cleaning' | 'other';
  supplier_invoice_id: string | null;
  organic_approved: boolean;
}

interface CleaningInput {
  vessel_id: string | null;
  location_id: string | null;
  product_id: string;
  active_substance: string;
  quantity: string;
  quantity_unit: 'g' | 'kg' | 'ml' | 'l';
  efficacy_check: string;
  supplier_invoice_id: string | null;
}

interface NewLotInput {
  code: string;
  wine_id: string | null;
  excise_product_key: string | null;
}

interface StoredDraft {
  fiscal_date: string;
  lines: ParsedLine[];
  new_lot: NewLotInput | null;
  addition: (AdditionInput & { vessel_id: string; lot_id: string }) | null;
  cleaning: CleaningInput | null;
}

export interface OperationPreview {
  stock_moves: readonly StockMoveDraft[];
  fiscal_moves: readonly FiscalMoveDraft[];
  new_lots: readonly LotDraft[];
  lot_edges: readonly LotEdgeDraft[];
  vessels_after: readonly VesselState[];
}

export async function listOperations(writer: Writer, request: Request): Promise<ListBody<OperationHeader>> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = decodeOpCursor(url.searchParams.get('cursor'));
  const opType = optionalEnum(url.searchParams.get('op_type'), 'op_type', OP_TYPES);
  const status = optionalEnum(url.searchParams.get('status'), 'status', STATUSES);
  const entityId = optionalQueryUuid(url.searchParams.get('legal_entity_id'), 'legal_entity_id');
  const filters = ['TRUE'];
  if (opType) filters.push(sql`op_type = ${opType}`);
  if (status) filters.push(sql`status = ${status}`);
  if (entityId) filters.push(sql`legal_entity_id = CAST(${entityId} AS UUID)`);
  const where = filters.join(' AND ');
  const page = [...filters];
  if (cursor) {
    page.push(sql`(
      occurred_at < CAST(${cursor.occurredAt} AS TIMESTAMPTZ)
      OR (occurred_at = CAST(${cursor.occurredAt} AS TIMESTAMPTZ) AND id < CAST(${cursor.id} AS UUID))
    )`);
  }
  const total = await countOf(writer, `SELECT count(*)::VARCHAR AS total FROM cellar.operation WHERE ${where}`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT ${HEADER_COLUMNS}
    FROM cellar.operation
    WHERE ${page.join(' AND ')}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${limit + 1}
  `);
  return slicePage(rows.map(headerOf), limit, total, (row) => encodeOpCursor(row.occurred_at, row.id));
}

export async function getOperation(writer: Writer, _request: Request, id: string): Promise<OperationView> {
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  return readOperation(writer, id);
}

export async function createOperation(writer: Writer, request: Request): Promise<OperationView> {
  const parsed = parseBody(await readJson(request));
  const actor = actorFor(request, parsed.header.reason ?? 'borrador de operación');
  const operationId = newId();
  const policies = await loadApprovalPolicies(writer);
  await writer.withWrite(actor, async (tx) => {
    await assertEntity(tx, parsed.header.legal_entity_id);
    await assertReferences(tx, parsed.draft);
    insertDraft(tx, operationId, parsed.header, parsed.draft, actor.id);
    await ensureLossApproval(tx, policies, operationId, parsed.header, parsed.draft, actor.id);
  });
  return readOperation(writer, operationId);
}

export async function updateOperation(writer: Writer, request: Request, id: string): Promise<OperationView> {
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  const parsed = parseBody(await readJson(request));
  const actor = actorFor(request, parsed.header.reason ?? 'edición de borrador');
  const policies = await loadApprovalPolicies(writer);
  await writer.withWrite(actor, async (tx) => {
    const current = await loadStored(tx, id);
    if (current.status !== 'draft') throw linesLocked(current.status);
    await assertEntity(tx, parsed.header.legal_entity_id);
    await assertReferences(tx, parsed.draft);
    deleteDraftLines(tx, id);
    auditUpdate(tx, 'cellar.operation', id, { status: 'draft' }, parsed.header, sql`
      UPDATE cellar.operation SET
        legal_entity_id = CAST(${parsed.header.legal_entity_id} AS UUID),
        op_type = ${parsed.header.op_type},
        occurred_at = CAST(${parsed.header.occurred_at} AS TIMESTAMPTZ),
        reason = ${parsed.header.reason},
        performed_by = ${parsed.header.performed_by},
        details = ${sql.json(parsed.draft)}
      WHERE id = CAST(${id} AS UUID) AND status = 'draft'
    `);
    insertDraftLines(tx, id, parsed.draft.lines);
    await ensureLossApproval(tx, policies, id, parsed.header, parsed.draft, actor.id);
  });
  return readOperation(writer, id);
}

export async function previewOperation(writer: Writer, request: Request, id: string): Promise<OperationPreview> {
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  sessionOf(request);
  return writer.withWrite(actorFor(request, 'vista previa'), async (tx) => {
    const current = await loadStored(tx, id);
    if (current.status !== 'draft') throw linesLocked(current.status);
    const plan = await planStored(tx, current, sessionOf(request).id);
    return {
      stock_moves: plan.stockMoves,
      fiscal_moves: plan.fiscalMoves,
      new_lots: plan.newLots,
      lot_edges: plan.lotEdges,
      vessels_after: plan.vesselsAfter,
    };
  });
}

export async function confirmOperation(writer: Writer, request: Request, id: string): Promise<OperationView> {
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  const actor = actorFor(request, 'confirmación de operación');
  const policies = await loadApprovalPolicies(writer);
  await writer.withWrite(actor, async (tx) => {
    const current = await loadStored(tx, id);
    if (current.status !== 'draft') {
      throw new DomainError('WC032', 409, 'Solo se confirma un borrador');
    }
    await consumeLossApproval(tx, policies, current);
    const plan = await planStored(tx, current, actor.id);
    const number = await takeCellarOperationNumber(tx, current.header.legal_entity_id, current.header.fiscal_date);
    await persistConfirmed(tx, current, plan, actor.id, number);
  });
  return readOperation(writer, id);
}

export async function rectifyOperation(writer: Writer, request: Request, id: string): Promise<OperationView> {
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  const body = await readJson(request);
  const reason = requireText(body.reason, 'reason', 500);
  const actor = actorFor(request, reason);
  const performedBy = sessionOf(request).displayName || actor.id;
  const rectifyId = newId();
  await writer.withWrite(actor, async (tx) => {
    const rows = await tx.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id, op_type, occurred_at, status
      FROM cellar.operation
      WHERE id = CAST(${id} AS UUID)
    `);
    const original = rows[0];
    if (!original) throw domainError('WC_NOT_FOUND');
    if (textOf(original.status) !== 'confirmed') {
      throw new DomainError('WC032', 409, 'Solo se rectifica una operación confirmada');
    }
    if (textOf(original.op_type) === 'reception') {
      throw new DomainError(
        'WC_VALIDATION',
        422,
        'La entrada de uva se rectifica con la recepción de viñedo',
      );
    }
    const locks = await loadLocks(tx);
    const physical = postingInstant(textOf(original.occurred_at), locks);
    const fiscal = postingDay(businessDate(new Date(textOf(original.occurred_at))), locks);
    const number = await takeCellarOperationNumber(tx, textOf(original.legal_entity_id), fiscal.date);
    const reversals = await reversalDrafts(tx, id, rectifyId, actor.id, physical.instant, fiscal.date, reason);
    await assertLedgers(tx, {
      ok: true,
      stockMoves: reversals.stock,
      fiscalMoves: reversals.fiscal,
      newLots: [],
      lotEdges: [],
      vesselsAfter: [],
    } as unknown as PlanSuccess);
    const confirmedAt = new Date().toISOString();
    auditInsert(tx, 'cellar.operation', rectifyId, {
      id: rectifyId,
      rectifies_operation_id: id,
      number,
      status: 'confirmed',
      reason,
      regularization: physical.regularization || fiscal.regularization,
    }, sql`
      INSERT INTO cellar.operation (
        id, legal_entity_id, number, op_type, occurred_at, status,
        rectifies_operation_id, reason, details, performed_by, confirmed_by, confirmed_at,
        sisv_relevant, silicie_relevant, created_by
      ) VALUES (
        CAST(${rectifyId} AS UUID),
        CAST(${textOf(original.legal_entity_id)} AS UUID),
        ${number},
        ${textOf(original.op_type)},
        CAST(${physical.instant} AS TIMESTAMPTZ),
        'confirmed',
        CAST(${id} AS UUID),
        ${reason},
        ${sql.json({
          fiscal_date: fiscal.date,
          regularization: physical.regularization || fiscal.regularization,
        })},
        ${performedBy},
        CAST(${actor.id} AS UUID),
        CAST(${confirmedAt} AS TIMESTAMPTZ),
        TRUE,
        ${reversals.fiscal.length > 0},
        ${actor.id}
      )
    `);
    for (const move of reversals.stock) insertStock(tx, move);
    for (const move of reversals.fiscal) insertFiscal(tx, move);
    auditUpdate(tx, 'cellar.operation', id, { status: 'confirmed' }, { status: 'rectified' }, sql`
      UPDATE cellar.operation
      SET status = 'rectified'
      WHERE id = CAST(${id} AS UUID) AND status = 'confirmed'
    `);
  });
  return readOperation(writer, rectifyId);
}

function linesLocked(status: string): DomainError {
  if (status === 'draft') {
    return new DomainError('WC031', 409, 'El borrador no está bloqueado');
  }
  return new DomainError(
    status === 'confirmed' ? 'WC031' : 'WC032',
    409,
    'Una operación confirmada no se modifica; la corrección es una operación nueva',
  );
}

function parseBody(body: Record<string, unknown>): { header: ParsedHeader; draft: StoredDraft } {
  const header = parseHeader(body);
  const lines = LINE_TYPES.has(header.op_type) ? parseLines(body) : [];
  const addition = header.op_type === 'addition' ? parseAddition(body) : null;
  const cleaning = header.op_type === 'cleaning' ? parseCleaning(body) : null;
  const newLot = header.op_type === 'blend' || header.op_type === 'bottling' ? parseNewLot(body, header.op_type) : null;
  return {
    header,
    draft: { fiscal_date: header.fiscal_date, lines, new_lot: newLot, addition, cleaning },
  };
}

interface LoadedDraft {
  id: string;
  status: string;
  approvalRequestId: string | null;
  header: ParsedHeader;
  draft: StoredDraft;
}

async function loadStored(tx: Tx, id: string): Promise<LoadedDraft> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id, op_type, occurred_at,
           status, reason, performed_by, details, approval_request_id::VARCHAR AS approval_request_id
    FROM cellar.operation
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const draft = asStored(jsonObject(row.details));
  if (!draft) invalid({ details: 'El borrador no tiene los datos de la operación' });
  const opType = textOf(row.op_type);
  if (!(ENGINE_TYPES as readonly string[]).includes(opType)) {
    invalid({ op_type: 'El tipo de operación no está soportado' });
  }
  return {
    id,
    status: textOf(row.status),
    approvalRequestId: textOrNull(row.approval_request_id),
    header: {
      op_type: opType as ParsedHeader['op_type'],
      legal_entity_id: textOf(row.legal_entity_id),
      occurred_at: textOf(row.occurred_at),
      fiscal_date: draft.fiscal_date,
      performed_by: textOf(row.performed_by),
      reason: textOrNull(row.reason),
    },
    draft,
  };
}

async function planStored(tx: Tx, current: LoadedDraft, actorId: string): Promise<PlanSuccess> {
  const { header, draft } = current;
  assertNotFuture(header.occurred_at, header.fiscal_date);
  await assertReferences(tx, draft);
  const locks = await loadLocks(tx);
  assertPeriodOpen(header.occurred_at, locks.filter((lock) => lock.ledger === 'physical'));
  assertPeriodOpen(header.fiscal_date, locks.filter((lock) => lock.ledger === 'fiscal'));
  const built = await buildRequest(
    tx,
    header,
    draft.lines,
    draft.addition,
    draft.cleaning,
    draft.new_lot,
    current.id,
    actorId,
    current.approvalRequestId,
  );
  const plan = planOperation(built, { vessels: await vesselMap(tx, built) }, { newId });
  if (!plan.ok) throw fromPlan(plan);
  await assertLedgers(tx, plan);
  return plan;
}

function insertDraft(tx: Tx, operationId: string, header: ParsedHeader, draft: StoredDraft, actorId: string): void {
  auditInsert(tx, 'cellar.operation', operationId, {
    id: operationId,
    status: 'draft',
    op_type: header.op_type,
    legal_entity_id: header.legal_entity_id,
    occurred_at: header.occurred_at,
    number: null,
  }, sql`
    INSERT INTO cellar.operation (
      id, legal_entity_id, op_type, occurred_at, status, reason, details, performed_by, created_by
    ) VALUES (
      CAST(${operationId} AS UUID),
      CAST(${header.legal_entity_id} AS UUID),
      ${header.op_type},
      CAST(${header.occurred_at} AS TIMESTAMPTZ),
      'draft',
      ${header.reason},
      ${sql.json(draft)},
      ${header.performed_by},
      ${actorId}
    )
  `);
  insertDraftLines(tx, operationId, draft.lines);
}

function insertDraftLines(tx: Tx, operationId: string, lines: readonly ParsedLine[]): void {
  for (const line of lines) {
    if (!line.lot_id) continue;
    if (!line.vessel_id && !line.location_id) continue;
    insertLine(tx, operationId, line, line.lot_id, 'racking');
  }
}

function deleteDraftLines(tx: Tx, operationId: string): void {
  tx.write(sql`DELETE FROM cellar.operation_line WHERE operation_id = CAST(${operationId} AS UUID)`);
  tx.audit({
    table: 'cellar.operation_line',
    rowId: operationId,
    action: 'DELETE',
    before: { operation_id: operationId },
    after: null,
  });
}

/**
 * Vessel content is the stock ledger. Confirming writes the planned moves,
 * so `vesselsAfter` becomes the balance. A failed plan writes nothing.
 */
async function persistConfirmed(
  tx: Tx,
  current: LoadedDraft,
  plan: PlanSuccess,
  actorId: string,
  number: string,
): Promise<void> {
  for (const lot of plan.newLots) insertLot(tx, lot);
  const confirmedAt = new Date().toISOString();
  const silicie = plan.fiscalMoves.length > 0;
  deleteDraftLines(tx, current.id);
  auditUpdate(tx, 'cellar.operation', current.id, { status: 'draft', number: null }, {
    status: 'confirmed',
    number,
    silicie_relevant: silicie,
  }, sql`
    UPDATE cellar.operation SET
      number = ${number},
      status = 'confirmed',
      confirmed_by = CAST(${actorId} AS UUID),
      confirmed_at = CAST(${confirmedAt} AS TIMESTAMPTZ),
      silicie_relevant = ${silicie}
    WHERE id = CAST(${current.id} AS UUID) AND status = 'draft'
  `);
  const newLotId = plan.newLots[0]?.id ?? null;
  for (const line of current.draft.lines) insertLine(tx, current.id, line, newLotId, current.header.op_type);
  for (const edge of plan.lotEdges) insertEdge(tx, edge);
  for (const move of plan.stockMoves) insertStock(tx, move);
  for (const move of plan.fiscalMoves) insertFiscal(tx, move);
  if (current.draft.addition && current.header.op_type === 'addition') {
    insertAddition(tx, current.id, current.draft.addition);
  }
  if (current.draft.cleaning) insertCleaning(tx, current.id, current.draft.cleaning);
}

async function buildRequest(
  tx: Tx,
  header: ParsedHeader,
  lines: readonly ParsedLine[],
  addition: AdditionInput | null,
  cleaning: CleaningInput | null,
  newLot: NewLotInput | null,
  operationId: string,
  actorId: string,
  approvalRequestId: string | null,
): Promise<OperationRequest> {
  const common = {
    id: operationId,
    legal_entity_id: header.legal_entity_id,
    occurred_at: header.occurred_at,
    fiscal_date: header.fiscal_date,
    performed_by: header.performed_by,
    created_by: actorId,
    reason: header.reason,
    approval_request_id: approvalRequestId,
  };
  if (header.op_type === 'racking') return buildTransfer(tx, common, lines);
  if (header.op_type === 'blend') return buildBlend(tx, common, lines, newLot);
  if (header.op_type === 'bottling') return buildBottling(tx, common, lines, newLot);
  if (header.op_type === 'loss') return buildLoss(tx, common, lines, 'loss');
  if (header.op_type === 'destruction') return buildLoss(tx, common, lines, 'destruction');
  if (header.op_type === 'addition') return buildAddition(tx, common, addition);
  return buildCleaning(tx, common, cleaning);
}

async function vesselMap(tx: Tx, request: OperationRequest): Promise<Map<string, VesselState>> {
  const ids = vesselIdsOf(request);
  const map = new Map<string, VesselState>();
  for (const id of ids) map.set(id, await loadVessel(tx, id));
  return map;
}

function vesselIdsOf(request: OperationRequest): string[] {
  const ids = new Set<string>();
  if (request.op_type === 'addition') ids.add(request.vessel_id);
  if (request.op_type === 'cleaning' && request.cleaning.vessel_id) ids.add(request.cleaning.vessel_id);
  if (
    request.op_type === 'racking'
    || request.op_type === 'blend'
    || request.op_type === 'bottling'
    || request.op_type === 'loss'
    || request.op_type === 'destruction'
  ) {
    for (const line of request.lines) {
      if ('vessel_id' in line && line.vessel_id) ids.add(line.vessel_id);
    }
  }
  return [...ids];
}

async function buildTransfer(
  tx: Tx,
  common: OperationRequest extends TransferRequest ? never : Omit<TransferRequest, 'op_type' | 'lines'>,
  lines: readonly ParsedLine[],
): Promise<TransferRequest> {
  const engine: TransferLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const field = `lines[${index}]`;
    const state = bulkState(line.product_state, `${field}.product_state`);
    if (line.role === 'loss') {
      engine.push({
        role: 'loss',
        lot: await requireLot(tx, line.lot_id, `${field}.lot_id`),
        vessel_id: requireVesselId(line.vessel_id, `${field}.vessel_id`),
        volume_ml: line.volume_ml,
        loss_kind: requireLossKind(line.loss_kind, field),
        product_state: state,
      });
      continue;
    }
    engine.push({
      role: line.role,
      lot: await requireLot(tx, line.lot_id, `${field}.lot_id`),
      vessel_id: requireVesselId(line.vessel_id, `${field}.vessel_id`),
      volume_ml: line.volume_ml,
      product_state: state,
    });
  }
  return { ...common, op_type: 'racking', lines: engine };
}

async function buildBlend(
  tx: Tx,
  common: Omit<BlendRequest, 'op_type' | 'lines' | 'new_lot'>,
  lines: readonly ParsedLine[],
  newLot: NewLotInput | null,
): Promise<BlendRequest> {
  if (!newLot) invalid({ new_lot: 'El ensamblaje crea un lote' });
  const engine: BlendLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const field = `lines[${index}]`;
    const state = bulkState(line.product_state, `${field}.product_state`);
    if (line.role === 'output') {
      engine.push({
        role: 'output',
        vessel_id: requireVesselId(line.vessel_id, `${field}.vessel_id`),
        volume_ml: line.volume_ml,
        product_state: state,
      });
      continue;
    }
    if (line.role === 'loss') {
      engine.push({
        role: 'loss',
        lot: await requireLot(tx, line.lot_id, `${field}.lot_id`),
        vessel_id: requireVesselId(line.vessel_id, `${field}.vessel_id`),
        volume_ml: line.volume_ml,
        loss_kind: requireLossKind(line.loss_kind, field),
        product_state: state,
      });
      continue;
    }
    engine.push({
      role: 'input',
      lot: await requireLot(tx, line.lot_id, `${field}.lot_id`),
      vessel_id: requireVesselId(line.vessel_id, `${field}.vessel_id`),
      volume_ml: line.volume_ml,
      product_state: state,
    });
  }
  return {
    ...common,
    op_type: 'blend',
    lines: engine,
    new_lot: { code: newLot.code, wine_id: newLot.wine_id, excise_product_key: newLot.excise_product_key },
  };
}

async function buildBottling(
  tx: Tx,
  common: Omit<BottlingRequest, 'op_type' | 'lines' | 'new_lot'>,
  lines: readonly ParsedLine[],
  newLot: NewLotInput | null,
): Promise<BottlingRequest> {
  if (!newLot) invalid({ new_lot: 'El envasado crea un lote' });
  const engine: BottlingLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const field = `lines[${index}]`;
    if (line.role === 'output') {
      if (line.product_state !== 'packaged_unlabeled' && line.product_state !== 'packaged_labeled') {
        invalid({ [`${field}.product_state`]: 'El envasado sale etiquetado o sin etiquetar' });
      }
      if (line.qty_units <= 0) invalid({ [`${field}.qty_units`]: 'Las unidades deben ser positivas' });
      if (line.nominal_volume_ml === null) invalid({ [`${field}.nominal_volume_ml`]: 'Falta el volumen nominal' });
      engine.push({
        role: 'output',
        location_id: line.location_id ?? invalid({ [`${field}.location_id`]: 'El envasado necesita una ubicación' }),
        product_id: line.product_id ?? invalid({ [`${field}.product_id`]: 'Falta el producto envasado' }),
        product_state: line.product_state,
        qty_units: line.qty_units,
        volume_ml: line.volume_ml,
        nominal_volume_ml: line.nominal_volume_ml,
        excise_product_key: line.excise_product_key,
        nc_code: line.nc_code,
      });
      continue;
    }
    if (line.role === 'loss') {
      engine.push({
        role: 'loss',
        lot: await requireLot(tx, line.lot_id, `${field}.lot_id`),
        vessel_id: requireVesselId(line.vessel_id, `${field}.vessel_id`),
        volume_ml: line.volume_ml,
        loss_kind: requireLossKind(line.loss_kind, field),
        product_state: 'wine',
      });
      continue;
    }
    if (line.product_state !== 'wine') invalid({ [`${field}.product_state`]: 'Solo se envasa vino' });
    engine.push({
      role: 'input',
      lot: await requireLot(tx, line.lot_id, `${field}.lot_id`),
      vessel_id: requireVesselId(line.vessel_id, `${field}.vessel_id`),
      volume_ml: line.volume_ml,
      product_state: 'wine',
    });
  }
  return { ...common, op_type: 'bottling', lines: engine, new_lot: { code: newLot.code } };
}

async function buildLoss(
  tx: Tx,
  common: Omit<LossRequest, 'op_type' | 'lines'>,
  lines: readonly ParsedLine[],
  opType: 'loss' | 'destruction',
): Promise<LossRequest> {
  const engine: LossLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const field = `lines[${index}]`;
    if (line.role !== 'loss') invalid({ [`${field}.role`]: 'La merma solo admite líneas de merma' });
    engine.push({
      role: 'loss',
      lot: await requireLot(tx, line.lot_id, `${field}.lot_id`),
      vessel_id: requireVesselId(line.vessel_id, `${field}.vessel_id`),
      volume_ml: line.volume_ml,
      loss_kind: requireLossKind(line.loss_kind, field),
      product_state: bulkState(line.product_state, `${field}.product_state`),
    });
  }
  return { ...common, op_type: opType, lines: engine };
}

function needsLossApproval(header: ParsedHeader, draft: StoredDraft): boolean {
  return header.op_type === 'destruction' || draft.lines.some((line) => line.loss_kind === 'incident');
}

function lossPayload(header: ParsedHeader, draft: StoredDraft) {
  return {
    op_type: header.op_type,
    legal_entity_id: header.legal_entity_id.toLowerCase(),
    fiscal_date: header.fiscal_date,
    reason: header.reason,
    performed_by: header.performed_by,
    lines: draft.lines,
    new_lot: draft.new_lot,
    addition: draft.addition,
    cleaning: draft.cleaning,
  };
}

function lossSummary(header: ParsedHeader): string {
  const kind = header.op_type === 'destruction' ? 'Destrucción' : 'Merma por incidencia';
  const reason = header.reason?.trim() || 'de bodega';
  const text = `${kind}: ${reason}`;
  if (text.length < 5) return 'Merma de bodega';
  return text.length > 300 ? text.slice(0, 300) : text;
}

async function ensureLossApproval(
  tx: Tx,
  policies: readonly ApprovalPolicy[],
  operationId: string,
  header: ParsedHeader,
  draft: StoredDraft,
  requestedBy: string,
): Promise<void> {
  if (!needsLossApproval(header, draft)) return;
  const request = await approvalServiceOn(tx, policies).requestApproval({
    kind: 'cellar_loss',
    legalEntityId: header.legal_entity_id,
    subjectTable: 'cellar.operation',
    subjectId: operationId,
    payload: lossPayload(header, draft),
    summary: lossSummary(header),
    requestedBy,
  });
  tx.write(sql`
    UPDATE cellar.operation
    SET approval_request_id = CAST(${request.id} AS UUID)
    WHERE id = CAST(${operationId} AS UUID)
  `);
  tx.audit({
    table: 'cellar.operation',
    rowId: operationId,
    action: 'UPDATE',
    before: { approval_request_id: null },
    after: { approval_request_id: request.id },
  });
}

async function consumeLossApproval(
  tx: Tx,
  policies: readonly ApprovalPolicy[],
  current: LoadedDraft,
): Promise<void> {
  if (!needsLossApproval(current.header, current.draft)) return;
  if (!current.approvalRequestId) throw domainError('WC_NOT_APPROVED');
  await approvalServiceOn(tx, policies).consume({
    requestId: current.approvalRequestId,
    payloadSha256: payloadSha256(lossPayload(current.header, current.draft)),
  });
}

async function buildAddition(
  tx: Tx,
  common: Omit<AdditionRequest, 'op_type' | 'vessel_id' | 'lot' | 'addition'>,
  addition: AdditionInput | null,
): Promise<AdditionRequest> {
  if (!addition) invalid({ addition: 'Falta la adición' });
  const vesselId = additionVessel(addition);
  return {
    ...common,
    op_type: 'addition',
    vessel_id: vesselId,
    lot: await requireLot(tx, additionLot(addition), 'lot_id'),
    addition,
  };
}

function additionVessel(addition: AdditionInput & { vessel_id?: string }): string {
  const id = (addition as { vessel_id?: string }).vessel_id;
  return id ?? invalid({ vessel_id: 'Falta el recipiente' });
}

function additionLot(addition: AdditionInput & { lot_id?: string }): string | null {
  return (addition as { lot_id?: string }).lot_id ?? null;
}

async function buildCleaning(
  tx: Tx,
  common: Omit<CleaningRequest, 'op_type' | 'cleaning'>,
  cleaning: CleaningInput | null,
): Promise<CleaningRequest> {
  if (!cleaning) invalid({ cleaning: 'Falta el registro de limpieza' });
  if (cleaning.location_id) {
    const rows = await tx.read(sql`SELECT id FROM inventory.location WHERE id = CAST(${cleaning.location_id} AS UUID)`);
    if (rows.length === 0) invalid({ 'cleaning.location_id': 'La ubicación no existe' });
  }
  return { ...common, op_type: 'cleaning', cleaning };
}

async function requireLot(tx: Tx, lotId: string | null, field: string): Promise<LotRef> {
  if (lotId === null) invalid({ [field]: 'Falta el lote' });
  return loadLot(tx, lotId);
}

function requireVesselId(value: string | null, field: string): string {
  if (value === null) invalid({ [field]: 'Falta el recipiente' });
  return value;
}

function requireLossKind(value: LossKind | null, field: string): LossKind {
  if (value === null) invalid({ [`${field}.loss_kind`]: 'La merma necesita un tipo (autorizada o incidencia)' });
  return value;
}

function bulkState(value: string, field: string): BulkProductState {
  if (value === 'must' || value === 'wine') return value;
  invalid({ [field]: 'El estado debe ser mosto o vino' });
}

async function loadLot(tx: Tx, id: string): Promise<LotRef> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, kind, vintage, producer_entity_id::VARCHAR AS producer_entity_id,
           wine_id::VARCHAR AS wine_id, is_organic
    FROM inventory.lot
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) invalid({ lot_id: 'El lote no existe' });
  const kind = textOf(row.kind);
  if (!(LOT_KINDS as readonly string[]).includes(kind)) invalid({ lot_id: 'El tipo de lote no es válido' });
  const ancestors = await tx.read<{ lot_id: string }>(sql`
    WITH RECURSIVE walk AS (
      SELECT parent_lot_id AS lot_id, 1 AS depth
      FROM inventory.lot_edge
      WHERE child_lot_id = CAST(${id} AS UUID)
      UNION ALL
      SELECT e.parent_lot_id, walk.depth + 1
      FROM inventory.lot_edge e
      JOIN walk ON e.child_lot_id = walk.lot_id
      WHERE walk.depth < 32
    )
    SELECT DISTINCT lot_id::VARCHAR AS lot_id FROM walk
  `);
  const fiscal = await tx.read<{ excise_product_key: string | null; abv_pct: string | null }>(sql`
    SELECT excise_product_key, abv_pct::VARCHAR AS abv_pct
    FROM inventory.fiscal_move
    WHERE lot_id = CAST(${id} AS UUID)
    ORDER BY fiscal_date DESC, created_at DESC
    LIMIT 1
  `);
  const latest = fiscal[0];
  return {
    id: textOf(row.id),
    code: textOf(row.code),
    kind: kind as LotKind,
    vintage: row.vintage == null ? null : intOf(row.vintage),
    producer_entity_id: textOf(row.producer_entity_id),
    wine_id: textOrNull(row.wine_id),
    is_organic: boolOf(row.is_organic),
    ancestor_lot_ids: ancestors.map((item) => item.lot_id),
    excise_product_key: latest?.excise_product_key ?? null,
    abv_pct: abvOf(latest?.abv_pct ?? null),
  };
}

async function loadVessel(tx: Tx, id: string): Promise<VesselState> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT v.id::VARCHAR AS id, v.kind, v.material, v.capacity_ml::VARCHAR AS capacity_ml, v.status,
           v.location_id::VARCHAR AS location_id,
           loc.tax_warehouse_id::VARCHAR AS tax_warehouse_id,
           loc.controlling_entity_id::VARCHAR AS controlling_entity_id,
           loc.is_active
    FROM cellar.vessel v
    JOIN inventory.location loc ON loc.id = v.location_id
    WHERE v.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) invalid({ vessel_id: 'El recipiente no existe' });
  if (row.is_active !== true) invalid({ location_id: 'La ubicación del recipiente está archivada' });
  const balances = await tx.read<Record<string, unknown>>(sql`
    SELECT lot_id::VARCHAR AS lot_id, product_state, owner_entity_id::VARCHAR AS owner_entity_id,
           sum(volume_ml)::VARCHAR AS volume_ml
    FROM inventory.stock_move
    WHERE vessel_id = CAST(${id} AS UUID)
    GROUP BY lot_id, product_state, owner_entity_id
    HAVING sum(volume_ml) <> 0 OR sum(qty_units) <> 0 OR sum(mass_g) <> 0
  `);
  if (balances.length > 1) {
    throw new DomainError('WC026', 422, 'El recipiente contiene más de un lote', { vessel_id: id });
  }
  const balance = balances[0];
  const volume = balance ? intOf(balance.volume_ml) : 0;
  const lotId = balance ? textOrNull(balance.lot_id) : null;
  const product = balance ? textOrNull(balance.product_state) : null;
  if (volume > 0 && product !== 'must' && product !== 'wine') {
    invalid({ vessel_id: 'El recipiente no contiene mosto ni vino' });
  }
  let excise: string | null = null;
  if (lotId) {
    const fiscal = await tx.read<{ excise_product_key: string | null }>(sql`
      SELECT excise_product_key
      FROM inventory.fiscal_move
      WHERE lot_id = CAST(${lotId} AS UUID) AND excise_product_key IS NOT NULL
      ORDER BY fiscal_date DESC, created_at DESC
      LIMIT 1
    `);
    excise = fiscal[0]?.excise_product_key ?? null;
  }
  const kind = textOf(row.kind);
  const material = textOf(row.material);
  const status = textOf(row.status);
  return {
    id: textOf(row.id),
    kind: kind as VesselState['kind'],
    material: material as VesselState['material'],
    capacity_ml: intOf(row.capacity_ml),
    lot_id: volume === 0 ? null : lotId,
    volume_ml: volume,
    owner_entity_id: balance ? textOf(balance.owner_entity_id) : textOf(row.controlling_entity_id),
    product_state: volume === 0 ? null : (product as BulkProductState),
    location_id: textOf(row.location_id),
    status: status as VesselStatus,
    tax_warehouse_id: textOrNull(row.tax_warehouse_id),
    excise_product_key: excise,
  };
}

async function assertLedgers(tx: Tx, plan: PlanSuccess): Promise<void> {
  if (plan.stockMoves.length > 0) {
    const existing = await loadStock(tx, plan.stockMoves);
    const findings = findNegativeBalances([...existing, ...plan.stockMoves]);
    const hit = findings.find((finding) => plan.stockMoves.some((move) => sameStock(move, finding)));
    if (hit) throw new DomainError(hit.code, 422, capitalize(hit.message.replace(/^WC\d{3}:\s*/, '')));
  }
  if (plan.fiscalMoves.length > 0) {
    const existing = await loadFiscal(tx, plan.fiscalMoves);
    const findings = findNegativeBalances([...existing, ...plan.fiscalMoves]);
    const hit = findings.find((finding) => plan.fiscalMoves.some((move) => sameFiscal(move, finding)));
    if (hit) throw new DomainError(hit.code, 422, capitalize(hit.message.replace(/^WC\d{3}:\s*/, '')));
  }
}

function sameStock(move: StockMoveDraft, finding: { location_id: string | null; vessel_id: string | null; owner_entity_id: string | null; lot_id: string | null; product_id: string | null; product_state: string | null }): boolean {
  return move.location_id === finding.location_id
    && move.vessel_id === finding.vessel_id
    && move.owner_entity_id === finding.owner_entity_id
    && move.lot_id === finding.lot_id
    && move.product_id === finding.product_id
    && move.product_state === finding.product_state;
}

function sameFiscal(move: FiscalMoveDraft, finding: { tax_warehouse_id: string | null; product_class: string | null; excise_product_key: string | null }): boolean {
  return move.tax_warehouse_id === finding.tax_warehouse_id
    && move.product_class === finding.product_class
    && move.excise_product_key === finding.excise_product_key;
}

async function loadStock(tx: Tx, drafts: readonly StockMoveDraft[]): Promise<StockMove[]> {
  const vesselIds = unique(drafts.map((move) => move.vessel_id));
  const lotIds = unique(drafts.map((move) => move.lot_id));
  const clauses: string[] = [];
  if (vesselIds.length > 0) clauses.push(`vessel_id IN (${uuidList(vesselIds)})`);
  if (lotIds.length > 0) clauses.push(`lot_id IN (${uuidList(lotIds)})`);
  if (clauses.length === 0) return [];
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, occurred_at, move_type, location_id::VARCHAR AS location_id,
           vessel_id::VARCHAR AS vessel_id, owner_entity_id::VARCHAR AS owner_entity_id,
           lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id, product_state,
           qty_units, volume_ml::VARCHAR AS volume_ml, mass_g::VARCHAR AS mass_g, loss_kind,
           source_table, source_id::VARCHAR AS source_id, source_line_id::VARCHAR AS source_line_id,
           reverses_move_id::VARCHAR AS reverses_move_id, created_by
    FROM inventory.stock_move
    WHERE ${clauses.join(' OR ')}
  `);
  return rows.map((row) => ({
    id: textOf(row.id),
    occurred_at: textOf(row.occurred_at),
    move_type: textOf(row.move_type) as StockMove['move_type'],
    location_id: textOf(row.location_id),
    vessel_id: textOrNull(row.vessel_id),
    owner_entity_id: textOf(row.owner_entity_id),
    lot_id: textOrNull(row.lot_id),
    product_id: textOrNull(row.product_id),
    product_state: textOf(row.product_state) as StockMove['product_state'],
    qty_units: intOf(row.qty_units),
    volume_ml: intOf(row.volume_ml),
    mass_g: intOf(row.mass_g),
    loss_kind: textOrNull(row.loss_kind) as StockMove['loss_kind'],
    source_table: textOf(row.source_table),
    source_id: textOf(row.source_id),
    source_line_id: textOrNull(row.source_line_id),
    reverses_move_id: textOrNull(row.reverses_move_id),
    created_by: textOf(row.created_by),
  }));
}

async function loadFiscal(tx: Tx, drafts: readonly FiscalMoveDraft[]): Promise<FiscalMove[]> {
  const warehouses = unique(drafts.map((move) => move.tax_warehouse_id));
  if (warehouses.length === 0) return [];
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, tax_warehouse_id::VARCHAR AS tax_warehouse_id, fiscal_date::VARCHAR AS fiscal_date,
           physical_date::VARCHAR AS physical_date, move_type, product_class,
           lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id,
           volume_ml::VARCHAR AS volume_ml, units, abv_pct::VARCHAR AS abv_pct, excise_product_key, nc_code,
           justification_type, justification_ref, counterparty_contact_id::VARCHAR AS counterparty_contact_id,
           counterparty_excise_number, fiscal_trigger, source_table, source_id::VARCHAR AS source_id,
           source_line_id::VARCHAR AS source_line_id, silicie_entry_id::VARCHAR AS silicie_entry_id,
           reverses_move_id::VARCHAR AS reverses_move_id, reason, created_by
    FROM inventory.fiscal_move
    WHERE tax_warehouse_id IN (${uuidList(warehouses)})
  `);
  return rows.map((row) => ({
    id: textOf(row.id),
    tax_warehouse_id: textOf(row.tax_warehouse_id),
    fiscal_date: textOf(row.fiscal_date).slice(0, 10),
    physical_date: row.physical_date == null ? null : textOf(row.physical_date).slice(0, 10),
    move_type: textOf(row.move_type) as FiscalMove['move_type'],
    product_class: textOf(row.product_class) as FiscalMove['product_class'],
    lot_id: textOrNull(row.lot_id),
    product_id: textOrNull(row.product_id),
    volume_ml: intOf(row.volume_ml),
    units: intOf(row.units),
    abv_pct: abvOf(row.abv_pct),
    excise_product_key: textOrNull(row.excise_product_key),
    nc_code: textOrNull(row.nc_code),
    justification_type: textOf(row.justification_type) as FiscalMove['justification_type'],
    justification_ref: textOf(row.justification_ref),
    counterparty_contact_id: textOrNull(row.counterparty_contact_id),
    counterparty_excise_number: textOrNull(row.counterparty_excise_number),
    fiscal_trigger: textOf(row.fiscal_trigger) as FiscalMove['fiscal_trigger'],
    source_table: textOf(row.source_table),
    source_id: textOf(row.source_id),
    source_line_id: textOrNull(row.source_line_id),
    silicie_entry_id: textOrNull(row.silicie_entry_id),
    reverses_move_id: textOrNull(row.reverses_move_id),
    reason: textOrNull(row.reason),
    created_by: textOf(row.created_by),
  }));
}

function unique(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

async function loadLocks(tx: Tx): Promise<PeriodLock[]> {
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT ledger, locked_until::VARCHAR AS locked_until, locked_by, locked_at, reason
    FROM inventory.period_lock
  `);
  return rows.map((row) => ({
    ledger: textOf(row.ledger) === 'fiscal' ? 'fiscal' : 'physical',
    locked_until: textOf(row.locked_until).slice(0, 10),
    locked_by: textOf(row.locked_by),
    locked_at: textOf(row.locked_at),
    reason: textOf(row.reason),
  }));
}

async function assertEntity(tx: Tx, entityId: string): Promise<void> {
  const rows = await tx.read(sql`
    SELECT id FROM core.legal_entity WHERE id = CAST(${entityId} AS UUID) AND is_active
  `);
  if (rows.length === 0) invalid({ legal_entity_id: 'La entidad no existe' });
}

async function assertReferences(tx: Tx, draft: StoredDraft): Promise<void> {
  for (let index = 0; index < draft.lines.length; index += 1) {
    const line = draft.lines[index];
    if (!line) continue;
    if (line.lot_id) await assertRow(tx, 'inventory.lot', line.lot_id, `lines[${index}].lot_id`, 'El lote no existe');
    if (line.vessel_id) await assertRow(tx, 'cellar.vessel', line.vessel_id, `lines[${index}].vessel_id`, 'El recipiente no existe');
    if (line.location_id) await assertRow(tx, 'inventory.location', line.location_id, `lines[${index}].location_id`, 'La ubicación no existe');
    if (line.product_id) await assertRow(tx, 'catalog.product', line.product_id, `lines[${index}].product_id`, 'El producto no existe');
  }
  if (draft.new_lot?.wine_id) {
    await assertRow(tx, 'catalog.wine', draft.new_lot.wine_id, 'new_lot.wine_id', 'El vino no existe');
  }
  if (draft.addition) {
    await assertRow(tx, 'catalog.product', draft.addition.additive_product_id, 'addition.additive_product_id', 'El producto enológico no existe');
    await assertRow(tx, 'inventory.lot', draft.addition.lot_id, 'lot_id', 'El lote no existe');
    await assertRow(tx, 'cellar.vessel', draft.addition.vessel_id, 'vessel_id', 'El recipiente no existe');
  }
  if (draft.cleaning) {
    await assertRow(tx, 'catalog.product', draft.cleaning.product_id, 'cleaning.product_id', 'El producto de limpieza no existe');
    if (draft.cleaning.location_id) {
      await assertRow(tx, 'inventory.location', draft.cleaning.location_id, 'cleaning.location_id', 'La ubicación no existe');
    }
    if (draft.cleaning.vessel_id) {
      await assertRow(tx, 'cellar.vessel', draft.cleaning.vessel_id, 'cleaning.vessel_id', 'El recipiente no existe');
    }
  }
}

async function assertRow(tx: Tx, table: string, id: string, field: string, message: string): Promise<void> {
  if (!isUuid(id)) invalid({ [field]: 'Debe ser un UUID' });
  const rows = await tx.read(`SELECT id FROM ${table} WHERE id = CAST('${id}' AS UUID)`);
  if (rows.length === 0) invalid({ [field]: message });
}

function asStored(value: unknown): StoredDraft | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<StoredDraft>;
  if (typeof record.fiscal_date !== 'string' || !Array.isArray(record.lines)) return null;
  return {
    fiscal_date: record.fiscal_date,
    lines: record.lines,
    new_lot: record.new_lot ?? null,
    addition: record.addition ?? null,
    cleaning: record.cleaning ?? null,
  };
}

function postingInstant(occurredAt: string, locks: readonly PeriodLock[]): { instant: string; regularization: boolean } {
  const physical = locks.filter((lock) => lock.ledger === 'physical');
  try {
    assertPeriodOpen(occurredAt, physical);
    return { instant: occurredAt, regularization: false };
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'WC021') throw error;
    const instant = new Date().toISOString();
    assertPeriodOpen(instant, physical);
    return { instant, regularization: true };
  }
}

function postingDay(fiscalDate: string, locks: readonly PeriodLock[]): { date: string; regularization: boolean } {
  const fiscal = locks.filter((lock) => lock.ledger === 'fiscal');
  try {
    assertPeriodOpen(fiscalDate, fiscal);
    return { date: fiscalDate, regularization: false };
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'WC021') throw error;
    const date = businessDate(new Date());
    assertPeriodOpen(date, fiscal);
    return { date, regularization: true };
  }
}

async function reversalDrafts(
  tx: Tx,
  operationId: string,
  rectifyId: string,
  actorId: string,
  occurredAt: string,
  fiscalDate: string,
  reason: string,
): Promise<{
  stock: Array<Omit<StockMoveDraft, 'move_type' | 'reverses_move_id'> & { move_type: 'reversal'; reverses_move_id: string }>;
  fiscal: Array<Omit<FiscalMoveDraft, 'move_type' | 'reverses_move_id'> & { move_type: 'reversal'; reverses_move_id: string }>;
}> {
  const stockRows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, move_type, location_id::VARCHAR AS location_id, vessel_id::VARCHAR AS vessel_id,
           owner_entity_id::VARCHAR AS owner_entity_id, lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id,
           product_state, qty_units, volume_ml::VARCHAR AS volume_ml, mass_g::VARCHAR AS mass_g
    FROM inventory.stock_move
    WHERE source_table = 'cellar.operation' AND source_id = CAST(${operationId} AS UUID)
    ORDER BY id
  `);
  const fiscalRows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, tax_warehouse_id::VARCHAR AS tax_warehouse_id, move_type, product_class,
           lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id, volume_ml::VARCHAR AS volume_ml, units,
           abv_pct::VARCHAR AS abv_pct, excise_product_key, nc_code
    FROM inventory.fiscal_move
    WHERE source_table = 'cellar.operation' AND source_id = CAST(${operationId} AS UUID)
    ORDER BY id
  `);
  const stock = stockRows.map((row) => ({
    id: newId(),
    occurred_at: occurredAt,
    move_type: 'reversal' as const,
    location_id: textOf(row.location_id),
    vessel_id: textOrNull(row.vessel_id),
    owner_entity_id: textOf(row.owner_entity_id),
    lot_id: textOrNull(row.lot_id),
    product_id: textOrNull(row.product_id),
    product_state: textOf(row.product_state) as StockMoveDraft['product_state'],
    qty_units: -intOf(row.qty_units),
    volume_ml: -intOf(row.volume_ml),
    mass_g: -intOf(row.mass_g),
    loss_kind: null,
    source_table: 'cellar.operation' as const,
    source_id: rectifyId,
    source_line_id: null,
    reverses_move_id: textOf(row.id),
    created_by: actorId,
  }));
  const fiscal = fiscalRows.map((row) => ({
    id: newId(),
    tax_warehouse_id: textOf(row.tax_warehouse_id),
    fiscal_date: fiscalDate,
    physical_date: fiscalDate,
    move_type: 'reversal' as const,
    product_class: textOf(row.product_class) as FiscalMoveDraft['product_class'],
    lot_id: textOrNull(row.lot_id),
    product_id: textOrNull(row.product_id),
    volume_ml: -intOf(row.volume_ml),
    units: -intOf(row.units),
    abv_pct: abvOf(row.abv_pct),
    excise_product_key: textOrNull(row.excise_product_key),
    nc_code: textOrNull(row.nc_code),
    justification_type: 'internal' as const,
    justification_ref: rectifyId,
    counterparty_contact_id: null,
    counterparty_excise_number: null,
    fiscal_trigger: 'operation' as const,
    source_table: 'cellar.operation' as const,
    source_id: rectifyId,
    source_line_id: null,
    silicie_entry_id: null,
    reverses_move_id: textOf(row.id),
    reason,
    created_by: actorId,
  }));
  return { stock, fiscal };
}

function insertLot(tx: Tx, lot: LotDraft): void {
  auditInsert(tx, 'inventory.lot', lot.id, lot, sql`
    INSERT INTO inventory.lot (
      id, producer_entity_id, code, kind, wine_id, vintage, is_organic, status, origin,
      created_by_operation_id, notes
    ) VALUES (
      CAST(${lot.id} AS UUID),
      CAST(${lot.producer_entity_id} AS UUID),
      ${lot.code},
      ${lot.kind},
      CAST(${lot.wine_id} AS UUID),
      ${lot.vintage},
      ${lot.is_organic},
      ${lot.status},
      ${lot.origin},
      CAST(${lot.created_by_operation_id} AS UUID),
      ${lot.notes}
    )
  `);
}

function insertLine(tx: Tx, operationId: string, line: ParsedLine, newLotId: string | null, opType: string): void {
  const lotId = (opType === 'blend' || opType === 'bottling') && line.role === 'output' ? newLotId : line.lot_id;
  if (!lotId) throw new Error('La línea no tiene lote');
  const vesselId = opType === 'bottling' && line.role === 'output' ? null : line.vessel_id;
  const id = newId();
  const stored = {
    id,
    operation_id: operationId,
    role: line.role,
    lot_id: lotId,
    vessel_id: vesselId,
    location_id: line.location_id,
    product_id: line.product_id,
    product_state: line.product_state,
    volume_ml: line.volume_ml,
    qty_units: line.qty_units,
    mass_g: 0,
    loss_kind: line.role === 'loss' ? line.loss_kind : null,
  };
  auditInsert(tx, 'cellar.operation_line', id, stored, sql`
    INSERT INTO cellar.operation_line (
      id, operation_id, role, lot_id, vessel_id, location_id, product_id, product_state,
      volume_ml, qty_units, mass_g, loss_kind
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${operationId} AS UUID),
      ${stored.role},
      CAST(${stored.lot_id} AS UUID),
      CAST(${stored.vessel_id} AS UUID),
      CAST(${stored.location_id} AS UUID),
      CAST(${stored.product_id} AS UUID),
      ${stored.product_state},
      ${stored.volume_ml},
      ${stored.qty_units},
      0,
      ${stored.loss_kind}
    )
  `);
}

function insertEdge(tx: Tx, edge: LotEdgeDraft): void {
  const rowId = `${edge.child_lot_id}|${edge.parent_lot_id}|${edge.operation_id}`;
  auditInsert(tx, 'inventory.lot_edge', rowId, edge, sql`
    INSERT INTO inventory.lot_edge (child_lot_id, parent_lot_id, operation_id, volume_ml, mass_g)
    VALUES (
      CAST(${edge.child_lot_id} AS UUID),
      CAST(${edge.parent_lot_id} AS UUID),
      CAST(${edge.operation_id} AS UUID),
      ${edge.volume_ml},
      ${edge.mass_g}
    )
  `);
}

function insertStock(tx: Tx, move: StockMoveDraft | (Omit<StockMoveDraft, 'move_type' | 'reverses_move_id'> & { move_type: 'reversal'; reverses_move_id: string })): void {
  auditInsert(tx, 'inventory.stock_move', move.id, move, sql`
    INSERT INTO inventory.stock_move (
      id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
      product_state, qty_units, volume_ml, mass_g, loss_kind, source_table, source_id,
      source_line_id, reverses_move_id, created_by
    ) VALUES (
      CAST(${move.id} AS UUID),
      CAST(${move.occurred_at} AS TIMESTAMPTZ),
      ${move.move_type},
      CAST(${move.location_id} AS UUID),
      CAST(${move.vessel_id} AS UUID),
      CAST(${move.owner_entity_id} AS UUID),
      CAST(${move.lot_id} AS UUID),
      CAST(${move.product_id} AS UUID),
      ${move.product_state},
      ${move.qty_units},
      ${move.volume_ml},
      ${move.mass_g},
      ${move.loss_kind},
      ${move.source_table},
      CAST(${move.source_id} AS UUID),
      CAST(${move.source_line_id} AS UUID),
      CAST(${move.reverses_move_id} AS UUID),
      ${move.created_by}
    )
  `);
}

function insertFiscal(tx: Tx, move: FiscalMoveDraft | (Omit<FiscalMoveDraft, 'move_type' | 'reverses_move_id'> & { move_type: 'reversal'; reverses_move_id: string })): void {
  auditInsert(tx, 'inventory.fiscal_move', move.id, move, sql`
    INSERT INTO inventory.fiscal_move (
      id, tax_warehouse_id, fiscal_date, physical_date, move_type, product_class, lot_id, product_id,
      volume_ml, units, abv_pct, excise_product_key, nc_code, justification_type, justification_ref,
      counterparty_contact_id, counterparty_excise_number, fiscal_trigger, source_table, source_id,
      source_line_id, silicie_entry_id, reverses_move_id, reason, created_by
    ) VALUES (
      CAST(${move.id} AS UUID),
      CAST(${move.tax_warehouse_id} AS UUID),
      CAST(${move.fiscal_date} AS DATE),
      CAST(${move.physical_date} AS DATE),
      ${move.move_type},
      ${move.product_class},
      CAST(${move.lot_id} AS UUID),
      CAST(${move.product_id} AS UUID),
      ${move.volume_ml},
      ${move.units},
      CAST(${move.abv_pct} AS DECIMAL(5,2)),
      ${move.excise_product_key},
      ${move.nc_code},
      ${move.justification_type},
      ${move.justification_ref},
      CAST(${move.counterparty_contact_id} AS UUID),
      ${move.counterparty_excise_number},
      ${move.fiscal_trigger},
      ${move.source_table},
      CAST(${move.source_id} AS UUID),
      CAST(${move.source_line_id} AS UUID),
      CAST(${move.silicie_entry_id} AS UUID),
      CAST(${move.reverses_move_id} AS UUID),
      ${move.reason},
      ${move.created_by}
    )
  `);
}

function insertAddition(tx: Tx, operationId: string, addition: AdditionInput): void {
  const vesselId = (addition as AdditionInput & { vessel_id: string }).vessel_id;
  const lotId = (addition as AdditionInput & { lot_id: string }).lot_id;
  const id = newId();
  auditInsert(tx, 'cellar.addition', id, { id, operation_id: operationId, ...addition }, sql`
    INSERT INTO cellar.addition (
      id, operation_id, lot_id, vessel_id, additive_product_id, quantity, quantity_unit,
      dose, dose_unit, purpose, supplier_invoice_id
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${operationId} AS UUID),
      CAST(${lotId} AS UUID),
      CAST(${vesselId} AS UUID),
      CAST(${addition.additive_product_id} AS UUID),
      CAST(${addition.quantity} AS DECIMAL(12,3)),
      ${addition.quantity_unit},
      CAST(${addition.dose} AS DECIMAL(12,3)),
      ${addition.dose_unit},
      ${addition.purpose},
      CAST(${addition.supplier_invoice_id} AS UUID)
    )
  `);
}

function insertCleaning(tx: Tx, operationId: string, cleaning: CleaningInput): void {
  const id = newId();
  auditInsert(tx, 'cellar.cleaning_record', id, { id, operation_id: operationId, ...cleaning }, sql`
    INSERT INTO cellar.cleaning_record (
      id, operation_id, vessel_id, location_id, product_id, active_substance, quantity,
      quantity_unit, efficacy_check, supplier_invoice_id
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${operationId} AS UUID),
      CAST(${cleaning.vessel_id} AS UUID),
      CAST(${cleaning.location_id} AS UUID),
      CAST(${cleaning.product_id} AS UUID),
      ${cleaning.active_substance},
      CAST(${cleaning.quantity} AS DECIMAL(12,3)),
      ${cleaning.quantity_unit},
      ${cleaning.efficacy_check},
      CAST(${cleaning.supplier_invoice_id} AS UUID)
    )
  `);
}

const HEADER_COLUMNS = `
  id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id, number, op_type, occurred_at, status,
  rectifies_operation_id::VARCHAR AS rectifies_operation_id, reason, details, performed_by,
  confirmed_by::VARCHAR AS confirmed_by, confirmed_at, approval_request_id::VARCHAR AS approval_request_id,
  sisv_relevant, silicie_relevant, created_by, created_at
`;

async function readOperation(writer: Writer, id: string): Promise<OperationView> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT
      id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id, number, op_type, occurred_at, status,
      rectifies_operation_id::VARCHAR AS rectifies_operation_id, reason, details, performed_by,
      confirmed_by::VARCHAR AS confirmed_by, confirmed_at, approval_request_id::VARCHAR AS approval_request_id,
      sisv_relevant, silicie_relevant, created_by, created_at
    FROM cellar.operation
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const stored = asStored(jsonObject(row.details));
  const status = textOf(row.status);
  const [lines, stock, fiscal, lots, edges, addition, cleaning] = await Promise.all([
    writer.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, operation_id::VARCHAR AS operation_id, role, lot_id::VARCHAR AS lot_id,
             vessel_id::VARCHAR AS vessel_id, location_id::VARCHAR AS location_id,
             product_id::VARCHAR AS product_id, product_state, volume_ml::VARCHAR AS volume_ml,
             qty_units, mass_g::VARCHAR AS mass_g, loss_kind, notes
      FROM cellar.operation_line
      WHERE operation_id = CAST(${id} AS UUID)
      ORDER BY id
    `),
    writer.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, occurred_at, move_type, location_id::VARCHAR AS location_id,
             vessel_id::VARCHAR AS vessel_id, owner_entity_id::VARCHAR AS owner_entity_id,
             lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id, product_state,
             qty_units, volume_ml::VARCHAR AS volume_ml, mass_g::VARCHAR AS mass_g, loss_kind,
             source_table, source_id::VARCHAR AS source_id, source_line_id::VARCHAR AS source_line_id,
             reverses_move_id::VARCHAR AS reverses_move_id, created_by, created_at
      FROM inventory.stock_move
      WHERE source_table = 'cellar.operation' AND source_id = CAST(${id} AS UUID)
      ORDER BY id
    `),
    writer.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, tax_warehouse_id::VARCHAR AS tax_warehouse_id,
             fiscal_date::VARCHAR AS fiscal_date, physical_date::VARCHAR AS physical_date, move_type,
             product_class, lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id,
             volume_ml::VARCHAR AS volume_ml, units, abv_pct::VARCHAR AS abv_pct, excise_product_key, nc_code,
             justification_type, justification_ref, counterparty_contact_id::VARCHAR AS counterparty_contact_id,
             counterparty_excise_number, fiscal_trigger, source_table, source_id::VARCHAR AS source_id,
             source_line_id::VARCHAR AS source_line_id, silicie_entry_id::VARCHAR AS silicie_entry_id,
             reverses_move_id::VARCHAR AS reverses_move_id, reason, created_by, created_at
      FROM inventory.fiscal_move
      WHERE source_table = 'cellar.operation' AND source_id = CAST(${id} AS UUID)
      ORDER BY id
    `),
    writer.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, producer_entity_id::VARCHAR AS producer_entity_id, code, kind,
             wine_id::VARCHAR AS wine_id, vintage, is_organic, status, origin,
             created_by_operation_id::VARCHAR AS created_by_operation_id, notes, created_at
      FROM inventory.lot
      WHERE created_by_operation_id = CAST(${id} AS UUID)
      ORDER BY code
    `),
    writer.read<Record<string, unknown>>(sql`
      SELECT child_lot_id::VARCHAR AS child_lot_id, parent_lot_id::VARCHAR AS parent_lot_id,
             operation_id::VARCHAR AS operation_id, volume_ml::VARCHAR AS volume_ml,
             mass_g::VARCHAR AS mass_g, created_at
      FROM inventory.lot_edge
      WHERE operation_id = CAST(${id} AS UUID)
      ORDER BY parent_lot_id
    `),
    writer.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, operation_id::VARCHAR AS operation_id, lot_id::VARCHAR AS lot_id,
             vessel_id::VARCHAR AS vessel_id, additive_product_id::VARCHAR AS additive_product_id,
             quantity::VARCHAR AS quantity, quantity_unit, dose::VARCHAR AS dose, dose_unit, purpose,
             supplier_invoice_id::VARCHAR AS supplier_invoice_id, created_at
      FROM cellar.addition
      WHERE operation_id = CAST(${id} AS UUID)
    `),
    writer.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, operation_id::VARCHAR AS operation_id, vessel_id::VARCHAR AS vessel_id,
             location_id::VARCHAR AS location_id, product_id::VARCHAR AS product_id, active_substance,
             quantity::VARCHAR AS quantity, quantity_unit, efficacy_check,
             supplier_invoice_id::VARCHAR AS supplier_invoice_id, created_at
      FROM cellar.cleaning_record
      WHERE operation_id = CAST(${id} AS UUID)
    `),
  ]);
  const draftLines = status === 'draft' && stored
    ? stored.lines.map((line) => ({
      id: null,
      operation_id: textOf(row.id),
      role: line.role,
      lot_id: line.lot_id,
      vessel_id: line.vessel_id,
      location_id: line.location_id,
      product_id: line.product_id,
      product_state: line.product_state,
      volume_ml: line.volume_ml,
      qty_units: line.qty_units,
      mass_g: 0,
      loss_kind: line.loss_kind,
      notes: null,
    }))
    : lines.map(lineOf);
  return {
    ...headerOf(row),
    lines: draftLines,
    stock_moves: stock.map(intMove),
    fiscal_moves: fiscal.map(intFiscal),
    lots: lots.map(intLot),
    lot_edges: edges.map(intEdge),
    addition: status === 'draft'
      ? (stored?.addition as Record<string, unknown> | null | undefined) ?? null
      : addition[0] ?? null,
    cleaning: status === 'draft'
      ? (stored?.cleaning as Record<string, unknown> | null | undefined) ?? null
      : cleaning[0] ?? null,
  };
}

function headerOf(row: Record<string, unknown>): OperationHeader {
  return {
    id: textOf(row.id),
    legal_entity_id: textOf(row.legal_entity_id),
    number: textOrNull(row.number),
    op_type: textOf(row.op_type),
    occurred_at: textOf(row.occurred_at),
    status: textOf(row.status),
    rectifies_operation_id: textOrNull(row.rectifies_operation_id),
    reason: textOrNull(row.reason),
    details: jsonObject(row.details),
    performed_by: textOf(row.performed_by),
    confirmed_by: textOrNull(row.confirmed_by),
    confirmed_at: textOrNull(row.confirmed_at),
    approval_request_id: textOrNull(row.approval_request_id),
    sisv_relevant: boolOf(row.sisv_relevant),
    silicie_relevant: boolOf(row.silicie_relevant),
    created_by: textOf(row.created_by),
    created_at: textOf(row.created_at),
  };
}

function lineOf(row: Record<string, unknown>): OperationLineView {
  return {
    id: textOf(row.id),
    operation_id: textOf(row.operation_id),
    role: textOf(row.role),
    lot_id: textOf(row.lot_id),
    vessel_id: textOrNull(row.vessel_id),
    location_id: textOrNull(row.location_id),
    product_id: textOrNull(row.product_id),
    product_state: textOf(row.product_state),
    volume_ml: intOf(row.volume_ml),
    qty_units: intOf(row.qty_units),
    mass_g: intOf(row.mass_g),
    loss_kind: textOrNull(row.loss_kind),
    notes: textOrNull(row.notes),
  };
}

function intMove(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, qty_units: intOf(row.qty_units), volume_ml: intOf(row.volume_ml), mass_g: intOf(row.mass_g) };
}

function intFiscal(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    fiscal_date: textOf(row.fiscal_date).slice(0, 10),
    physical_date: row.physical_date == null ? null : textOf(row.physical_date).slice(0, 10),
    volume_ml: intOf(row.volume_ml),
    units: intOf(row.units),
    abv_pct: abvOf(row.abv_pct),
  };
}

function intLot(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, vintage: row.vintage == null ? null : intOf(row.vintage), is_organic: boolOf(row.is_organic) };
}

function intEdge(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, volume_ml: intOf(row.volume_ml), mass_g: intOf(row.mass_g) };
}

function parseHeader(body: Record<string, unknown>): ParsedHeader {
  const opType = oneOf(body.op_type, 'op_type', ENGINE_TYPES);
  const occurredAt = requireText(body.occurred_at, 'occurred_at', 40);
  if (!isInstant(occurredAt)) invalid({ occurred_at: 'Debe ser un instante ISO-8601 con zona horaria' });
  const fiscal = body.fiscal_date === undefined || body.fiscal_date === null
    ? businessDate(new Date(occurredAt))
    : requireText(body.fiscal_date, 'fiscal_date', 10);
  if (!isBusinessDate(fiscal)) invalid({ fiscal_date: 'Debe ser una fecha YYYY-MM-DD' });
  return {
    op_type: opType,
    legal_entity_id: requireUuid(body.legal_entity_id, 'legal_entity_id'),
    occurred_at: occurredAt,
    fiscal_date: fiscal,
    performed_by: requireText(body.performed_by, 'performed_by', 120),
    reason: optionalText(body.reason, 'reason', 500),
  };
}

function assertNotFuture(occurredAt: string, fiscalDate: string): void {
  const today = businessDate(new Date());
  const fields: Record<string, string> = {};
  if (businessDate(new Date(occurredAt)) > today) fields.occurred_at = 'La fecha no puede ser futura';
  if (fiscalDate > today) fields.fiscal_date = 'La fecha no puede ser futura';
  if (Object.keys(fields).length > 0) invalid(fields);
}

function parseLines(body: Record<string, unknown>): ParsedLine[] {
  if (!Array.isArray(body.lines) || body.lines.length === 0) invalid({ lines: 'La operación no tiene líneas' });
  return body.lines.map((line, index) => parseLine(line, index));
}

function parseLine(value: unknown, index: number): ParsedLine {
  const field = `lines[${index}]`;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid({ [field]: 'La línea no es válida' });
  const line = value as Record<string, unknown>;
  const role = oneOf(line.role, `${field}.role`, ['input', 'output', 'loss'] as const);
  const lossKind = line.loss_kind === undefined || line.loss_kind === null
    ? null
    : oneOf(line.loss_kind, `${field}.loss_kind`, LOSS_KINDS);
  if (role === 'loss' && lossKind === null) invalid({ [`${field}.loss_kind`]: 'La merma necesita un tipo' });
  if (role !== 'loss' && lossKind !== null) invalid({ [`${field}.loss_kind`]: 'Solo la merma lleva tipo' });
  return {
    role,
    lot_id: optionalUuid(line.lot_id, `${field}.lot_id`),
    vessel_id: optionalUuid(line.vessel_id, `${field}.vessel_id`),
    location_id: optionalUuid(line.location_id, `${field}.location_id`),
    product_id: optionalUuid(line.product_id, `${field}.product_id`),
    product_state: requireText(line.product_state, `${field}.product_state`, 40),
    volume_ml: positiveInt(line.volume_ml, `${field}.volume_ml`),
    qty_units: line.qty_units === undefined ? 0 : nonNegative(line.qty_units, `${field}.qty_units`),
    loss_kind: lossKind,
    nominal_volume_ml: line.nominal_volume_ml === undefined || line.nominal_volume_ml === null
      ? null
      : positiveInt(line.nominal_volume_ml, `${field}.nominal_volume_ml`),
    excise_product_key: optionalText(line.excise_product_key, `${field}.excise_product_key`, 40),
    nc_code: optionalText(line.nc_code, `${field}.nc_code`, 8),
  };
}

function parseNewLot(body: Record<string, unknown>, opType: string): NewLotInput {
  const value = body.new_lot;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid({ new_lot: 'Falta el lote nuevo' });
  const lot = value as Record<string, unknown>;
  const code = requireText(lot.code, 'new_lot.code', 30);
  if (!LOT_CODE.test(code)) invalid({ 'new_lot.code': 'El código de lote no es válido' });
  return {
    code,
    wine_id: opType === 'blend' ? optionalUuid(lot.wine_id, 'new_lot.wine_id') : null,
    excise_product_key: opType === 'blend' ? optionalText(lot.excise_product_key, 'new_lot.excise_product_key', 40) : null,
  };
}

function parseAddition(body: Record<string, unknown>): AdditionInput & { vessel_id: string; lot_id: string } {
  const value = body.addition;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid({ addition: 'Falta la adición' });
  const addition = value as Record<string, unknown>;
  const parsed = {
    vessel_id: requireUuid(body.vessel_id, 'vessel_id'),
    lot_id: requireUuid(body.lot_id, 'lot_id'),
    additive_product_id: requireUuid(addition.additive_product_id, 'addition.additive_product_id'),
    quantity: requireText(addition.quantity, 'addition.quantity', 20),
    quantity_unit: oneOf(addition.quantity_unit, 'addition.quantity_unit', ['g', 'kg', 'ml', 'l'] as const),
    dose: requireText(addition.dose, 'addition.dose', 20),
    dose_unit: oneOf(addition.dose_unit, 'addition.dose_unit', ['g/hl', 'mg/l', 'g/l'] as const),
    purpose: oneOf(addition.purpose, 'addition.purpose', ['acidification', 'sulphiting', 'cleaning', 'other'] as const),
    supplier_invoice_id: optionalUuid(addition.supplier_invoice_id, 'addition.supplier_invoice_id'),
    organic_approved: addition.organic_approved === true,
  };
  if (typeof addition.organic_approved !== 'boolean') {
    invalid({ 'addition.organic_approved': 'Falta si el producto es apto en ecológico' });
  }
  return parsed;
}

function parseCleaning(body: Record<string, unknown>): CleaningInput {
  const value = body.cleaning;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid({ cleaning: 'Falta el registro de limpieza' });
  const cleaning = value as Record<string, unknown>;
  return {
    vessel_id: optionalUuid(cleaning.vessel_id, 'cleaning.vessel_id'),
    location_id: optionalUuid(cleaning.location_id, 'cleaning.location_id'),
    product_id: requireUuid(cleaning.product_id, 'cleaning.product_id'),
    active_substance: requireText(cleaning.active_substance, 'cleaning.active_substance', 120),
    quantity: requireText(cleaning.quantity, 'cleaning.quantity', 20),
    quantity_unit: oneOf(cleaning.quantity_unit, 'cleaning.quantity_unit', ['g', 'kg', 'ml', 'l'] as const),
    efficacy_check: requireText(cleaning.efficacy_check, 'cleaning.efficacy_check', 200),
    supplier_invoice_id: optionalUuid(cleaning.supplier_invoice_id, 'cleaning.supplier_invoice_id'),
  };
}

function nonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid({ [field]: 'Debe ser un entero mayor o igual que cero' });
  }
  return value;
}

function abvOf(value: unknown): string | null {
  if (value == null) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match || match[1] === undefined) return null;
  return `${match[1]}.${(match[2] ?? '').slice(0, 2).padEnd(2, '0')}`;
}

function capitalize(message: string): string {
  if (message.length === 0) return message;
  return message.charAt(0).toUpperCase() + message.slice(1);
}

function optionalEnum<T extends string>(value: string | null, field: string, allowed: readonly T[]): T | null {
  if (value === null || value.trim() === '') return null;
  return oneOf(value, field, allowed);
}

function optionalQueryUuid(value: string | null, field: string): string | null {
  if (value === null || value.trim() === '') return null;
  return requireUuid(value, field);
}
