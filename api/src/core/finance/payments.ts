import { Decimal } from 'decimal.js';
import { entityScope, type UserCtx } from '../auth/permissions';
import { canonicalJson } from '../db/audit';
import { sha256Hex } from '../hash';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { actorOf, idempotencyKey, readJson, remember, replay, requestHash, storedResponse } from './idempotency';
import {
  dateOnly,
  decimalOf,
  moneyText,
  textOf,
  allocationError,
  assertNotFuture,
  CASH_PROFESSIONAL_LIMIT,
  isTargetTable,
  objectOf,
  optionalText,
  parseAmount,
  parseDate,
  parseUuid,
  pathUuid,
  pick,
  raiseAllocation,
  requiredText,
  todayMadrid,
  type TargetTable,
} from './support';
import { findEntity, loadDocument, loadParty, registeredPaid, writeDocumentPaid, type PayableDocument } from './store';

const METHODS = new Set(['transfer', 'direct_debit', 'card', 'cash', 'stripe', 'compensation', 'other']);
const ROUTE = 'POST /v1/payments';

interface AllocationInput {
  targetTable: TargetTable;
  targetId: string;
  amount: Decimal;
}

export interface PaymentInput {
  direction: 'in' | 'out';
  method: string;
  amount: Decimal;
  valueDate: string;
  counterpartyId: string;
  legalEntityId: string | null;
  bankAccountId: string | null;
  reference: string | null;
  allocations: AllocationInput[];
}

interface AppliedAllocation {
  id: string;
  target_table: TargetTable;
  target_id: string;
  amount: string;
  outstanding: string;
  payment_status: string;
  document_number: string;
}

export async function createPayment(writer: Writer, user: UserCtx, request: Request) {
  const key = idempotencyKey(request);
  const raw = await readJson(request);
  const input = parsePayment(raw);
  const hash = requestHash(raw);
  const now = new Date();
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const again = replay(await storedResponse(tx, user.id, key), hash);
    if (again) return again;
    const body = await register(tx, user, input, {
      source: 'manual',
      bankAccountId: input.bankAccountId,
      reference: input.reference,
      now,
      warnings: true,
    });
    remember(tx, user.id, key, hash, ROUTE, 201, body, now);
    return { status: 201, body };
  });
}

export async function reversePayment(writer: Writer, user: UserCtx, request: Request, paymentId: string) {
  const id = pathUuid(paymentId);
  const key = idempotencyKey(request);
  const raw = objectOf(await readJson(request));
  const reason = requiredText(pick(raw, 'reason'), 'reason', 3, 500);
  const hash = requestHash(raw);
  const now = new Date();
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const again = replay(await storedResponse(tx, user.id, key), hash);
    if (again) return again;
    const body = await reverse(tx, user, id, reason, now);
    remember(tx, user.id, key, hash, 'POST /v1/payments/:id/reverse', 200, body, now);
    return { status: 200, body };
  });
}

export async function getPayment(writer: Writer, user: UserCtx, paymentId: string) {
  const id = pathUuid(paymentId);
  const body = await readPayment(writer, id);
  assertScope(user, 'finance.read', body.legal_entity_id);
  return body;
}

export async function listPayments(writer: Writer, user: UserCtx, request: Request) {
  const url = new URL(request.url);
  const entityValue = url.searchParams.get('entity')?.trim() || null;
  const direction = url.searchParams.get('direction')?.trim() || null;
  const counterparty = url.searchParams.get('counterparty_id')?.trim() || url.searchParams.get('contact_id')?.trim() || null;
  const from = url.searchParams.get('from')?.trim() || null;
  const to = url.searchParams.get('to')?.trim() || null;
  if (direction && direction !== 'in' && direction !== 'out') {
    throw domainError('WC_VALIDATION', { direction: 'Debe ser in o out' });
  }
  if (from) parseDate(from, 'from');
  if (to) parseDate(to, 'to');
  if (counterparty) parseUuid(counterparty, 'counterparty_id');
  const limit = limitOf(url.searchParams.get('limit'));
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const scope = entityScope(user, 'finance.read');
  let entityId: string | null = null;
  if (entityValue) {
    const entity = await findEntity(writer, entityValue);
    if (!entity) throw domainError('WC_VALIDATION', { entity: 'La entidad no existe' });
    assertScope(user, 'finance.read', entity.id);
    entityId = entity.id;
  }
  const filters = ['TRUE'];
  if (entityId) filters.push(sql`p.legal_entity_id = CAST(${entityId} AS UUID)`);
  else if (scope) {
    if (scope.length === 0) return { items: [], next_cursor: null, total: 0 };
    filters.push(`p.legal_entity_id IN (${scope.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})`);
  }
  if (direction) filters.push(sql`p.direction = ${direction}`);
  if (counterparty) filters.push(sql`p.counterparty_id = CAST(${counterparty} AS UUID)`);
  if (from) filters.push(sql`p.value_date >= CAST(${from} AS DATE)`);
  if (to) filters.push(sql`p.value_date <= CAST(${to} AS DATE)`);
  const where = filters.join(' AND ');
  const cursorSql = cursor
    ? sql` AND (p.value_date < CAST(${cursor.date} AS DATE) OR (p.value_date = CAST(${cursor.date} AS DATE) AND p.id < CAST(${cursor.id} AS UUID)))`
    : '';
  const rows = await writer.read<Record<string, unknown>>(
    `SELECT p.*, c.legal_name AS counterparty_name
     FROM finance.payment p
     LEFT JOIN party.contact c ON c.id = p.counterparty_id
     WHERE ${where}${cursorSql}
     ORDER BY p.value_date DESC, p.id DESC
     LIMIT ${limit + 1}`,
  );
  const totalRows = await writer.read<{ total: number }>(`SELECT count(*)::INTEGER AS total FROM finance.payment p WHERE ${where}`);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const ids = page.map((row) => String(row.id).toLowerCase());
  const allocations = await allocationsFor(writer, ids);
  const flat = ids.flatMap((id) => allocations.get(id) ?? []);
  const documents = await documentsFor(writer, flat);
  const items = page.map((row) => paymentBody(row, allocations.get(String(row.id).toLowerCase()) ?? [], documents));
  const last = page.at(-1);
  return {
    items,
    next_cursor: hasMore && last ? encodeCursor(dateOnly(last.value_date) ?? '', String(last.id).toLowerCase()) : null,
    total: Number(totalRows[0]?.total ?? 0),
  };
}

export interface RegisterOptions {
  source: 'manual' | 'bank_import' | 'remittance';
  bankAccountId: string | null;
  reference: string | null;
  now: Date;
  warnings: boolean;
  valueDateMayBeFuture?: boolean;
  /** Documentos ya actualizados en esta petición: el lector no ve las escrituras pendientes. */
  pending?: Map<string, PayableDocument>;
}

export async function register(
  tx: Tx,
  user: UserCtx,
  input: PaymentInput,
  options: RegisterOptions,
): Promise<Record<string, unknown>> {
  const command = { ...input, ...options };
  if (!command.valueDateMayBeFuture) assertNotFuture(command.valueDate, 'value_date', todayMadrid(command.now));
  const party = await loadParty(tx, command.counterpartyId, null);
  if (!party) throw domainError('WC_VALIDATION', { counterparty_id: 'La contraparte no existe' });
  let resolvedEntity: string | null = null;
  if (command.legalEntityId) {
    const entity = await findEntity(tx, command.legalEntityId);
    if (!entity) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });
    resolvedEntity = entity.id;
  }
  const docs = new Map<string, PayableDocument>();
  for (const allocation of command.allocations) {
    const key = `${allocation.targetTable}:${allocation.targetId}`;
    if (docs.has(key)) throw domainError('WC_VALIDATION', { allocations: 'El documento está repetido' });
    const doc = options.pending?.get(key) ?? await loadDocument(tx, allocation.targetTable, allocation.targetId);
    if (!doc) raiseAllocation('WC101', { target_table: allocation.targetTable, target_id: allocation.targetId });
    docs.set(key, doc);
  }
  const entityId = resolvedEntity ?? [...docs.values()][0]?.legalEntityId ?? null;
  if (!entityId) throw domainError('WC_VALIDATION', { legal_entity_id: 'Indica la entidad' });
  assertScope(user, 'finance.write', entityId);
  if (command.bankAccountId) {
    const accounts = await tx.read<{ legal_entity_id: string }>(sql`
      SELECT legal_entity_id FROM finance.bank_account
      WHERE id = CAST(${command.bankAccountId} AS UUID) AND is_active
    `);
    const account = accounts[0];
    if (!account || String(account.legal_entity_id).toLowerCase() !== entityId) {
      throw domainError('WC_VALIDATION', { bank_account_id: 'La cuenta no es de la entidad' });
    }
  }
  let allocated = new Decimal(0);
  const applied: AppliedAllocation[] = [];
  const paidByDoc = new Map<string, Decimal>();
  for (const allocation of command.allocations) {
    const doc = docs.get(`${allocation.targetTable}:${allocation.targetId}`)!;
    if (doc.legalEntityId !== entityId) {
      throw domainError('WC_VALIDATION', { allocations: 'Los documentos no son de la misma entidad' });
    }
    if (!doc.counterpartyId || doc.counterpartyId !== command.counterpartyId) {
      throw domainError('WC_VALIDATION', { counterparty_id: 'La contraparte no coincide con el documento' });
    }
    const code = allocationError({
      paymentAmount: command.amount,
      alreadyAllocated: allocated,
      adding: allocation.amount,
      payable: doc.payable && doc.direction === command.direction,
      outstanding: doc.outstanding,
    });
    if (code) {
      raiseAllocation(code, {
        target_table: doc.targetTable,
        target_id: doc.targetId,
        outstanding: moneyText(doc.outstanding),
        amount: moneyText(allocation.amount),
      });
    }
    allocated = allocated.plus(allocation.amount);
    const next = (paidByDoc.get(doc.targetId) ?? doc.amountPaid).plus(allocation.amount);
    paidByDoc.set(doc.targetId, next);
    applied.push({
      id: newId(),
      target_table: allocation.targetTable,
      target_id: allocation.targetId,
      amount: moneyText(allocation.amount),
      outstanding: '',
      payment_status: '',
      document_number: doc.documentNumber,
    });
  }
  const warnings: string[] = [];
  if (command.warnings && command.method === 'cash' && command.amount.gt(CASH_PROFESSIONAL_LIMIT) && party.kind === 'company') {
    warnings.push('El pago en efectivo supera 1.000 € entre profesionales. Confirma el límite con el asesor.');
  }
  const id = newId();
  tx.write(sql`
    INSERT INTO finance.payment (
      id, legal_entity_id, direction, method, amount, currency, value_date, bank_account_id,
      counterparty_id, reference, source, status, created_by, created_at
    ) VALUES (
      CAST(${id} AS UUID), CAST(${entityId} AS UUID), ${command.direction}, ${command.method},
      ${command.amount}, 'EUR', CAST(${command.valueDate} AS DATE),
      CAST(${command.bankAccountId} AS UUID), CAST(${command.counterpartyId} AS UUID),
      ${command.reference}, ${command.source}, 'registered', ${user.id}, ${command.now}
    )
  `);
  tx.audit({
    table: 'finance.payment',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: {
      direction: command.direction,
      method: command.method,
      amount: moneyText(command.amount),
      value_date: command.valueDate,
      counterparty_id: command.counterpartyId,
      source: command.source,
      status: 'registered',
    },
  });
  const seen = new Set<string>();
  for (const allocation of applied) {
    const doc = docs.get(`${allocation.target_table}:${allocation.target_id}`)!;
    tx.write(sql`
      INSERT INTO finance.payment_allocation (id, payment_id, target_table, target_id, amount, allocated_by, allocated_at)
      VALUES (
        CAST(${allocation.id} AS UUID), CAST(${id} AS UUID), ${allocation.target_table},
        CAST(${allocation.target_id} AS UUID), ${decimalOf(allocation.amount)}, ${user.id}, ${command.now}
      )
    `);
    tx.audit({
      table: 'finance.payment_allocation',
      rowId: allocation.id,
      action: 'INSERT',
      before: null,
      after: {
        payment_id: id,
        target_table: allocation.target_table,
        target_id: allocation.target_id,
        amount: allocation.amount,
      },
    });
    if (seen.has(doc.targetId)) continue;
    seen.add(doc.targetId);
    const paid = paidByDoc.get(doc.targetId) ?? doc.amountPaid;
    const updated = writeDocumentPaid(tx, doc, paid, command.now);
    options.pending?.set(`${doc.targetTable}:${doc.targetId}`, {
      ...doc,
      amountPaid: paid,
      outstanding: doc.total.minus(paid),
      paymentStatus: updated.paymentStatus,
      payable: doc.origin === 'holded'
        ? updated.paymentStatus === 'open' || updated.paymentStatus === 'partially_paid'
        : doc.payable,
    });
    for (const item of applied) {
      if (item.target_id !== doc.targetId) continue;
      item.outstanding = updated.outstanding;
      item.payment_status = updated.paymentStatus;
    }
  }
  return {
    id,
    legal_entity_id: entityId,
    direction: command.direction,
    method: command.method,
    amount: moneyText(command.amount),
    currency: 'EUR',
    value_date: command.valueDate,
    counterparty_id: command.counterpartyId,
    counterparty_name: party.legalName,
    bank_account_id: command.bankAccountId,
    reference: command.reference,
    source: command.source,
    status: 'registered',
    allocations: applied,
    unallocated: moneyText(command.amount.minus(allocated)),
    warnings,
  };
}

async function reverse(tx: Tx, user: UserCtx, id: string, reason: string, now: Date) {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT p.*, c.legal_name AS counterparty_name
    FROM finance.payment p
    LEFT JOIN party.contact c ON c.id = p.counterparty_id
    WHERE p.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const entityId = String(row.legal_entity_id).toLowerCase();
  assertScope(user, 'finance.manage', entityId);
  if (String(row.status) !== 'registered') throw domainError('WC_FIN_STATE');
  const allocations = await tx.read<Record<string, unknown>>(sql`
    SELECT id, target_table, target_id, amount
    FROM finance.payment_allocation
    WHERE payment_id = CAST(${id} AS UUID)
  `);
  tx.write(sql`
    UPDATE finance.payment
    SET status = 'reversed', reversal_reason = ${reason}
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({
    table: 'finance.payment',
    rowId: id,
    action: 'UPDATE',
    before: { status: 'registered' },
    after: { status: 'reversed', reversal_reason: reason },
  });
  const documents = new Map<string, { outstanding: string; payment_status: string; document_number: string }>();
  const seen = new Set<string>();
  for (const allocation of allocations) {
    const table = String(allocation.target_table);
    if (!isTargetTable(table)) continue;
    const targetId = String(allocation.target_id).toLowerCase();
    const key = `${table}:${targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const doc = await loadDocument(tx, table, targetId);
    if (!doc) continue;
    const paid = await registeredPaid(tx, table, targetId, id);
    const updated = writeDocumentPaid(tx, doc, paid, now);
    documents.set(key, {
      outstanding: updated.outstanding,
      payment_status: updated.paymentStatus,
      document_number: doc.documentNumber,
    });
  }
  return {
    ...paymentBody(row, allocations, documents),
    status: 'reversed',
    reversal_reason: reason,
  };
}

export async function readPayment(tx: { read: Tx['read'] }, id: string) {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT p.*, c.legal_name AS counterparty_name
    FROM finance.payment p
    LEFT JOIN party.contact c ON c.id = p.counterparty_id
    WHERE p.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const allocations = await allocationsFor(tx, [id]);
  const documents = new Map<string, { outstanding: string; payment_status: string; document_number: string }>();
  for (const allocation of allocations.get(id) ?? []) {
    const table = String(allocation.target_table);
    if (!isTargetTable(table)) continue;
    const doc = await loadDocument(tx, table, String(allocation.target_id));
    if (!doc) continue;
    documents.set(`${table}:${doc.targetId}`, {
      outstanding: moneyText(doc.outstanding),
      payment_status: doc.paymentStatus,
      document_number: doc.documentNumber,
    });
  }
  return paymentBody(row, allocations.get(id) ?? [], documents);
}

function paymentBody(
  row: Record<string, unknown>,
  allocations: Record<string, unknown>[],
  documents: Map<string, { outstanding: string; payment_status: string; document_number: string }>,
) {
  const amount = decimalOf(row.amount);
  let allocated = new Decimal(0);
  const items = allocations.map((allocation) => {
    const part = decimalOf(allocation.amount);
    allocated = allocated.plus(part);
    const key = `${String(allocation.target_table)}:${String(allocation.target_id).toLowerCase()}`;
    const doc = documents.get(key);
    return {
      id: String(allocation.id).toLowerCase(),
      target_table: String(allocation.target_table),
      target_id: String(allocation.target_id).toLowerCase(),
      amount: moneyText(part),
      document_number: doc?.document_number ?? null,
      outstanding: doc?.outstanding ?? null,
      payment_status: doc?.payment_status ?? null,
    };
  });
  return {
    id: String(row.id).toLowerCase(),
    legal_entity_id: String(row.legal_entity_id).toLowerCase(),
    direction: String(row.direction),
    method: String(row.method),
    amount: moneyText(amount),
    currency: String(row.currency),
    value_date: dateOnly(row.value_date),
    counterparty_id: row.counterparty_id == null ? null : String(row.counterparty_id).toLowerCase(),
    counterparty_name: textOf(row.counterparty_name),
    bank_account_id: row.bank_account_id == null ? null : String(row.bank_account_id).toLowerCase(),
    reference: textOf(row.reference),
    source: String(row.source),
    status: String(row.status),
    reversal_reason: textOf(row.reversal_reason),
    allocations: items,
    unallocated: moneyText(amount.minus(allocated)),
  };
}

async function documentsFor(tx: { read: Tx['read'] }, rows: Record<string, unknown>[]) {
  const grouped = new Map<string, { outstanding: string; payment_status: string; document_number: string }>();
  const idsOf = (table: string) => [...new Set(rows
    .filter((row) => String(row.target_table) === table)
    .map((row) => String(row.target_id).toLowerCase()))];
  await fillDocuments(tx, grouped, 'billing.invoice', 'number', idsOf('billing.invoice'));
  await fillDocuments(tx, grouped, 'purchasing.supplier_invoice', 'supplier_invoice_number', idsOf('purchasing.supplier_invoice'));
  await fillDocuments(tx, grouped, 'legacy.open_item', 'document_number', idsOf('legacy.open_item'));
  return grouped;
}

async function fillDocuments(
  tx: { read: Tx['read'] },
  grouped: Map<string, { outstanding: string; payment_status: string; document_number: string }>,
  table: string,
  numberColumn: string,
  ids: string[],
) {
  if (ids.length === 0) return;
  const amount = table === 'legacy.open_item' ? 'amount' : 'total';
  const status = table === 'legacy.open_item' ? 'status' : 'payment_status';
  const rows = await tx.read<Record<string, unknown>>(
    `SELECT id, ${numberColumn} AS document_number, ${status} AS payment_status, ${amount} AS total, amount_paid
     FROM ${table}
     WHERE id IN (${ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})`,
  );
  for (const row of rows) {
    const outstanding = decimalOf(row.total).minus(decimalOf(row.amount_paid));
    grouped.set(`${table}:${String(row.id).toLowerCase()}`, {
      outstanding: moneyText(outstanding),
      payment_status: String(row.payment_status),
      document_number: textOf(row.document_number) ?? '',
    });
  }
}

async function allocationsFor(tx: { read: Tx['read'] }, ids: string[]) {
  const grouped = new Map<string, Record<string, unknown>[]>();
  if (ids.length === 0) return grouped;
  const rows = await tx.read<Record<string, unknown>>(
    `SELECT * FROM finance.payment_allocation WHERE payment_id IN (${ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')}) ORDER BY allocated_at, id`,
  );
  for (const row of rows) {
    const paymentId = String(row.payment_id).toLowerCase();
    const list = grouped.get(paymentId) ?? [];
    list.push(row);
    grouped.set(paymentId, list);
  }
  return grouped;
}

function parsePayment(raw: unknown): PaymentInput {
  const body = objectOf(raw);
  const direction = String(pick(body, 'direction') ?? '');
  if (direction !== 'in' && direction !== 'out') {
    throw domainError('WC_VALIDATION', { direction: 'Debe ser in o out' });
  }
  const method = String(pick(body, 'method') ?? '');
  if (!METHODS.has(method)) throw domainError('WC_VALIDATION', { method: 'Forma de pago no válida' });
  const amount = parseAmount(pick(body, 'amount'), 'amount');
  const valueDate = parseDate(pick(body, 'value_date', 'valueDate'), 'value_date');
  const counterpartyId = parseUuid(pick(body, 'counterparty_id', 'counterpartyId'), 'counterparty_id');
  const entityRaw = pick(body, 'legal_entity_id', 'legalEntityId', 'entity');
  const legalEntityId = entityRaw === undefined || entityRaw === null || entityRaw === ''
    ? null
    : requiredText(entityRaw, 'legal_entity_id', 2, 36);
  const bankRaw = pick(body, 'bank_account_id', 'bankAccountId');
  const bankAccountId = bankRaw === undefined || bankRaw === null || bankRaw === ''
    ? null
    : parseUuid(bankRaw, 'bank_account_id');
  const reference = optionalText(pick(body, 'reference'), 'reference', 140);
  const allocationsRaw = pick(body, 'allocations');
  if (!Array.isArray(allocationsRaw)) throw domainError('WC_VALIDATION', { allocations: 'Indica las imputaciones' });
  const allocations = allocationsRaw.map((item, index) => {
    const row = objectOf(item, `allocations.${index}`);
    const targetTable = String(pick(row, 'target_table', 'targetTable') ?? '');
    if (!isTargetTable(targetTable)) {
      throw domainError('WC_VALIDATION', { [`allocations.${index}.target_table`]: 'Documento no admitido' });
    }
    return {
      targetTable,
      targetId: parseUuid(pick(row, 'target_id', 'targetId'), `allocations.${index}.target_id`),
      amount: parseAmount(pick(row, 'amount'), `allocations.${index}.amount`),
    };
  });
  return { direction, method, amount, valueDate, counterpartyId, legalEntityId, bankAccountId, reference, allocations };
}

export function assertScope(user: UserCtx, permission: 'finance.read' | 'finance.write' | 'finance.manage', entityId: string): void {
  const scope = entityScope(user, permission);
  if (scope === null) return;
  if (!scope.some((item) => item.toLowerCase() === entityId.toLowerCase())) throw domainError('WC_FORBIDDEN');
}

function limitOf(value: string | null): number {
  if (!value) return 50;
  if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 100) {
    throw domainError('WC_VALIDATION', { limit: 'Debe ser un entero entre 1 y 100' });
  }
  return Number(value);
}

function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(value: string | null): { date: string; id: string } | null {
  if (!value) return null;
  try {
    const text = Buffer.from(value, 'base64url').toString('utf8');
    const split = text.lastIndexOf('|');
    if (split <= 0) throw new Error('cursor');
    const date = text.slice(0, split);
    const id = text.slice(split + 1);
    parseDate(date, 'cursor');
    parseUuid(id, 'cursor');
    return { date, id };
  } catch {
    throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });
  }
}

export function contentKey(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
