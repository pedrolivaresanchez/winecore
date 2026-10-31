import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import type { UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { sha256Hex } from '../hash';
import { parseCamt053 } from './camt053';
import { actorOf, idempotencyKey, readJson, remember, replay, requestHash, storedResponse } from './idempotency';
import { parseN43, type ParsedMovement, type ParsedStatement } from './n43';
import { assertScope, register, type PaymentInput } from './payments';
import { suggestForLine, type SuggestCandidate, type Suggestion } from './suggest';
import {
  dateOnly,
  decimalOf,
  isTargetTable,
  moneyText,
  objectOf,
  optionalText,
  parseAmount,
  parseUuid,
  pathUuid,
  pick,
  requiredText,
  textOf,
  type TargetTable,
} from './support';
import { listOpenDocuments, loadDocument, storeBytes, type PayableDocument } from './store';
import { ibanLast4, isValidIban, normalizeIban } from '../party/iban';

const ROUTE = 'POST /v1/bank-statements';

export async function importStatement(writer: Writer, user: UserCtx, request: Request) {
  const key = idempotencyKey(request);
  const raw = await readJson(request);
  const input = parseImport(raw);
  const hash = requestHash(raw);
  const now = new Date();
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const again = replay(await storedResponse(tx, user.id, key), hash);
    if (again) return again;
    const body = await importFile(tx, user, input, now);
    remember(tx, user.id, key, hash, ROUTE, 201, body, now);
    return { status: 201, body };
  });
}

export async function listSuggestions(writer: Writer, user: UserCtx, importId: string) {
  const id = pathUuid(importId);
  const header = await oneImport(writer, id);
  assertScope(user, 'finance.read', header.legalEntityId);
  const lines = await writer.read<Record<string, unknown>>(sql`
    SELECT * FROM finance.bank_statement_line
    WHERE import_id = CAST(${id} AS UUID)
    ORDER BY booking_date, id
  `);
  return { import_id: id, format: header.format, lines: lines.map(lineOf) };
}

export async function confirmLine(writer: Writer, user: UserCtx, request: Request, importId: string, lineId: string) {
  const importKey = pathUuid(importId);
  const id = pathUuid(lineId);
  const key = idempotencyKey(request);
  const raw = await readJson(request);
  const hash = requestHash(raw);
  const now = new Date();
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const again = replay(await storedResponse(tx, user.id, key), hash);
    if (again) return again;
    const body = await confirm(tx, user, importKey, id, objectOf(raw), now);
    remember(tx, user.id, key, hash, 'POST /v1/bank-statements/:id/lines/:lineId/confirm', 201, body, now);
    return { status: 201, body };
  });
}

export async function ignoreLine(writer: Writer, user: UserCtx, request: Request, importId: string, lineId: string) {
  const importKey = pathUuid(importId);
  const id = pathUuid(lineId);
  const key = idempotencyKey(request);
  const raw = objectOf(await readJson(request));
  const reason = requiredText(pick(raw, 'reason'), 'reason', 3, 300);
  const hash = requestHash(raw);
  const now = new Date();
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const again = replay(await storedResponse(tx, user.id, key), hash);
    if (again) return again;
    const line = await requireLine(tx, importKey, id);
    assertScope(user, 'finance.write', line.legalEntityId);
    if (line.status === 'matched' || line.status === 'ignored') throw domainError('WC_FIN_STATE');
    tx.write(sql`
      UPDATE finance.bank_statement_line
      SET status = 'ignored', ignored_reason = ${reason}
      WHERE id = CAST(${id} AS UUID)
    `);
    tx.audit({
      table: 'finance.bank_statement_line',
      rowId: id,
      action: 'UPDATE',
      before: { status: line.status },
      after: { status: 'ignored', ignored_reason: reason },
    });
    const body = { id, status: 'ignored', ignored_reason: reason };
    remember(tx, user.id, key, hash, 'POST /v1/bank-statements/:id/lines/:lineId/ignore', 200, body, now);
    return { status: 200, body };
  });
}

async function importFile(
  tx: Tx,
  user: UserCtx,
  input: { bankAccountId: string; format: 'n43' | 'camt053'; filename: string; bytes: Uint8Array; text: string },
  now: Date,
) {
  const accounts = await tx.read<Record<string, unknown>>(sql`
    SELECT id, legal_entity_id, iban_last4, is_active
    FROM finance.bank_account
    WHERE id = CAST(${input.bankAccountId} AS UUID)
  `);
  const account = accounts[0];
  if (!account || account.is_active !== true) {
    throw domainError('WC_VALIDATION', { bank_account_id: 'La cuenta no existe' });
  }
  const entityId = String(account.legal_entity_id).toLowerCase();
  assertScope(user, 'finance.write', entityId);
  const parsed = input.format === 'n43' ? parseN43(input.text) : parseCamt053(input.text);
  assertAccount(parsed, String(account.iban_last4));
  const fileSha = createHash('sha256').update(input.bytes).digest('hex');
  const duplicate = await tx.read<{ id: string }>(sql`
    SELECT id FROM finance.bank_statement_import
    WHERE bank_account_id = CAST(${input.bankAccountId} AS UUID) AND file_sha256 = ${fileSha}
  `);
  if (duplicate[0]) throw domainError('WC_FIN_DUPLICATE_FILE');
  const existing = await tx.read<{ external_id: string; id: string }>(sql`
    SELECT external_id, id FROM finance.bank_statement_line
    WHERE bank_account_id = CAST(${input.bankAccountId} AS UUID)
  `);
  const known = new Map(existing.map((row) => [String(row.external_id), String(row.id).toLowerCase()]));
  const seen = new Map<string, number>();
  const fresh: Array<ParsedMovement & { externalId: string }> = [];
  const duplicates: Array<{ external_id: string; line_id: string }> = [];
  for (const movement of parsed.movements) {
    const index = seen.get(movement.fingerprint) ?? 0;
    seen.set(movement.fingerprint, index + 1);
    const externalId = sha256Hex(`${movement.fingerprint}#${index}`);
    const prior = known.get(externalId);
    if (prior) duplicates.push({ external_id: externalId, line_id: prior });
    else fresh.push({ ...movement, externalId });
  }
  const attachment = await storeBytes(tx, {
    bytes: input.bytes,
    filename: input.filename,
    mime: input.format === 'n43' ? 'text/plain' : 'application/xml',
    classification: 'personal_data',
    createdBy: user.id,
    now,
  });
  const importId = newId();
  tx.write(sql`
    INSERT INTO finance.bank_statement_import (
      id, bank_account_id, format, attachment_id, file_sha256, period_from, period_to, lines_count, imported_by, imported_at
    ) VALUES (
      CAST(${importId} AS UUID), CAST(${input.bankAccountId} AS UUID), ${input.format},
      CAST(${attachment.id} AS UUID), ${fileSha}, CAST(${parsed.periodFrom} AS DATE),
      CAST(${parsed.periodTo} AS DATE), ${parsed.movements.length}, ${user.id}, ${now}
    )
  `);
  tx.audit({
    table: 'finance.bank_statement_import',
    rowId: importId,
    action: 'INSERT',
    before: null,
    after: { format: input.format, file_sha256: fileSha, lines_count: parsed.movements.length, inserted: fresh.length },
  });
  const open = await listOpenDocuments(tx, entityId);
  const documents = new Map(open.map((doc) => [`${doc.targetTable}:${doc.targetId}`, doc]));
  const pending = new Map(documents);
  const candidates = open.map(candidateOf);
  let matched = 0;
  let suggested = 0;
  const lines: Array<Record<string, unknown>> = [];
  for (const movement of fresh) {
    for (const [key, doc] of pending) {
      const candidate = candidates.find((item) => `${item.targetTable}:${item.targetId}` === key);
      if (candidate) candidate.outstanding = doc.outstanding;
    }
    const suggestions = suggestForLine(movement, candidates);
    const winners = suggestions.filter((item) => item.score === '1.00');
    const winner = winners.length === 1 ? winners[0] : null;
    const winnerDoc = winner && isTargetTable(winner.target_table)
      ? pending.get(`${winner.target_table}:${winner.target_id}`)
      : null;
    let paymentId: string | null = null;
    let status = suggestions.length > 0 ? 'suggested' : 'unmatched';
    if (winner && winnerDoc?.counterpartyId && isTargetTable(winner.target_table)) {
      const payment = await register(tx, user, paymentInput(movement, entityId, input.bankAccountId, winner, winnerDoc.counterpartyId), {
        source: 'bank_import',
        bankAccountId: input.bankAccountId,
        reference: movement.reference,
        now,
        warnings: false,
        valueDateMayBeFuture: true,
        pending,
      });
      paymentId = String(payment.id);
      status = 'matched';
      matched += 1;
    } else if (suggestions.length > 0) {
      suggested += 1;
    }
    const lineId = newId();
    tx.write(sql`
      INSERT INTO finance.bank_statement_line (
        id, import_id, bank_account_id, booking_date, value_date, amount, description,
        counterparty_name, reference, external_id, status, suggestions, matched_payment_id
      ) VALUES (
        CAST(${lineId} AS UUID), CAST(${importId} AS UUID), CAST(${input.bankAccountId} AS UUID),
        CAST(${movement.bookingDate} AS DATE), CAST(${movement.valueDate} AS DATE),
        ${decimalOf(movement.amount)}, ${movement.description}, ${movement.counterpartyName},
        ${movement.reference}, ${movement.externalId}, ${status}, ${sql.json(suggestions)},
        CAST(${paymentId} AS UUID)
      )
    `);
    tx.audit({
      table: 'finance.bank_statement_line',
      rowId: lineId,
      action: 'INSERT',
      before: null,
      after: { external_id: movement.externalId, status, amount: movement.amount, matched_payment_id: paymentId },
    });
    lines.push({ id: lineId, status, amount: movement.amount, suggestions, matched_payment_id: paymentId });
  }
  return {
    id: importId,
    bank_account_id: input.bankAccountId,
    format: input.format,
    file_sha256: fileSha,
    period_from: parsed.periodFrom,
    period_to: parsed.periodTo,
    lines_count: parsed.movements.length,
    inserted: fresh.length,
    duplicates: duplicates.length,
    duplicate_lines: duplicates,
    matched,
    suggested,
    lines,
  };
}

async function confirm(tx: Tx, user: UserCtx, importId: string, lineId: string, body: Record<string, unknown>, now: Date) {
  const line = await requireLine(tx, importId, lineId);
  assertScope(user, 'finance.write', line.legalEntityId);
  if (line.status === 'matched' || line.status === 'ignored') throw domainError('WC_FIN_STATE');
  const chosen = allocationsOf(body, line);
  const amount = decimalOf(line.amount).abs();
  let sum = new Decimal(0);
  const allocations = [];
  let counterpartyId: string | null = null;
  for (const allocation of chosen) {
    sum = sum.plus(allocation.amount);
    const doc = await loadDocument(tx, allocation.targetTable, allocation.targetId);
    if (!doc?.counterpartyId) {
      throw domainError('WC101', undefined, { target_table: allocation.targetTable, target_id: allocation.targetId });
    }
    if (counterpartyId && counterpartyId !== doc.counterpartyId) {
      throw domainError('WC_VALIDATION', { allocations: 'Los documentos no son de la misma contraparte' });
    }
    counterpartyId = doc.counterpartyId;
    allocations.push(allocation);
  }
  if (!counterpartyId) throw domainError('WC_VALIDATION', { allocations: 'Indica el documento' });
  if (sum.gt(amount)) {
    throw domainError('WC100', undefined, { amount: moneyText(amount), allocated: moneyText(sum) });
  }
  const payment = await register(tx, user, {
    direction: decimalOf(line.amount).isNegative() ? 'out' : 'in',
    method: 'transfer',
    amount,
    valueDate: line.valueDate ?? line.bookingDate,
    counterpartyId,
    legalEntityId: line.legalEntityId,
    bankAccountId: line.bankAccountId,
    reference: line.reference,
    allocations,
  }, {
    source: 'bank_import',
    bankAccountId: line.bankAccountId,
    reference: line.reference,
    now,
    warnings: false,
    valueDateMayBeFuture: true,
  });
  tx.write(sql`
    UPDATE finance.bank_statement_line
    SET status = 'matched', matched_payment_id = CAST(${String(payment.id)} AS UUID)
    WHERE id = CAST(${lineId} AS UUID)
  `);
  tx.audit({
    table: 'finance.bank_statement_line',
    rowId: lineId,
    action: 'UPDATE',
    before: { status: line.status },
    after: { status: 'matched', matched_payment_id: payment.id },
  });
  return { line_id: lineId, status: 'matched', payment };
}

function allocationsOf(body: Record<string, unknown>, line: LoadedLine) {
  const many = pick(body, 'allocations');
  const rows = Array.isArray(many)
    ? many
    : [body];
  if (rows.length === 0) throw domainError('WC_VALIDATION', { allocations: 'Indica el documento' });
  return rows.map((item, index) => {
    const row = objectOf(item, `allocations.${index}`);
    const targetTable = String(pick(row, 'target_table', 'targetTable') ?? '');
    if (!isTargetTable(targetTable)) {
      throw domainError('WC_VALIDATION', { target_table: 'Documento no admitido' });
    }
    const targetId = parseUuid(pick(row, 'target_id', 'targetId'), 'target_id');
    const explicit = pick(row, 'amount');
    const amount = explicit === undefined ? decimalOf(line.amount).abs() : parseAmount(explicit, 'amount');
    return { targetTable, targetId, amount };
  });
}

function paymentInput(
  movement: ParsedMovement,
  entityId: string,
  bankAccountId: string,
  winner: Suggestion,
  counterpartyId: string,
): PaymentInput {
  const amount = decimalOf(movement.amount).abs();
  return {
    direction: decimalOf(movement.amount).isNegative() ? 'out' : 'in',
    method: 'transfer',
    amount,
    valueDate: movement.valueDate ?? movement.bookingDate,
    counterpartyId,
    legalEntityId: entityId,
    bankAccountId,
    reference: movement.reference,
    allocations: [{
      targetTable: winner.target_table as TargetTable,
      targetId: winner.target_id,
      amount,
    }],
  };
}

async function requireLine(tx: Tx, importId: string, lineId: string): Promise<LoadedLine> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT l.*, a.legal_entity_id
    FROM finance.bank_statement_line l
    JOIN finance.bank_account a ON a.id = l.bank_account_id
    WHERE l.id = CAST(${lineId} AS UUID) AND l.import_id = CAST(${importId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return {
    id: lineId,
    status: String(row.status),
    amount: String(decimalOf(row.amount).toFixed(2)),
    bookingDate: dateOnly(row.booking_date) ?? '',
    valueDate: dateOnly(row.value_date),
    reference: textOf(row.reference),
    bankAccountId: String(row.bank_account_id).toLowerCase(),
    legalEntityId: String(row.legal_entity_id).toLowerCase(),
    suggestions: asList(row.suggestions) as Suggestion[],
  };
}

interface LoadedLine {
  id: string;
  status: string;
  amount: string;
  bookingDate: string;
  valueDate: string | null;
  reference: string | null;
  bankAccountId: string;
  legalEntityId: string;
  suggestions: Suggestion[];
}

async function oneImport(tx: { read: Tx['read'] }, id: string) {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT i.format, a.legal_entity_id
    FROM finance.bank_statement_import i
    JOIN finance.bank_account a ON a.id = i.bank_account_id
    WHERE i.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return { format: String(row.format), legalEntityId: String(row.legal_entity_id).toLowerCase() };
}

function lineOf(row: Record<string, unknown>) {
  return {
    id: String(row.id).toLowerCase(),
    booking_date: dateOnly(row.booking_date),
    value_date: dateOnly(row.value_date),
    amount: moneyText(decimalOf(row.amount)),
    description: String(row.description),
    counterparty_name: textOf(row.counterparty_name),
    reference: textOf(row.reference),
    status: String(row.status),
    suggestions: asList(row.suggestions),
    matched_payment_id: row.matched_payment_id == null ? null : String(row.matched_payment_id).toLowerCase(),
  };
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function candidateOf(doc: PayableDocument): SuggestCandidate {
  return {
    targetTable: doc.targetTable,
    targetId: doc.targetId,
    documentNumber: doc.documentNumber,
    contactName: doc.counterpartyName,
    outstanding: doc.outstanding,
    direction: doc.direction,
  };
}

function assertAccount(parsed: ParsedStatement, last4: string): void {
  const sample = parsed.movements[0];
  if (!sample) return;
  if (parsed.format === 'n43' && sample.accountLast4 !== last4) {
    throw domainError('WC_VALIDATION', { bank_account_id: 'El extracto no corresponde a la cuenta' });
  }
  if (parsed.format === 'camt053' && isValidIban(sample.accountKey) && ibanLast4(normalizeIban(sample.accountKey)) !== last4) {
    throw domainError('WC_VALIDATION', { bank_account_id: 'El extracto no corresponde a la cuenta' });
  }
}

function parseImport(raw: unknown): { bankAccountId: string; format: 'n43' | 'camt053'; filename: string; bytes: Uint8Array; text: string } {
  const body = objectOf(raw);
  const bankAccountId = parseUuid(pick(body, 'bank_account_id', 'bankAccountId'), 'bank_account_id');
  const format = String(pick(body, 'format') ?? '');
  if (format !== 'n43' && format !== 'camt053') {
    throw domainError('WC_VALIDATION', { format: 'Usa n43 o camt053' });
  }
  const filename = optionalText(pick(body, 'filename'), 'filename', 80) ?? (format === 'n43' ? 'extracto.n43' : 'extracto.xml');
  const encoded = pick(body, 'content_base64');
  const plain = pick(body, 'content');
  if (typeof encoded === 'string' && typeof plain === 'string') {
    throw domainError('WC_VALIDATION', { content: 'Indica el fichero una sola vez' });
  }
  let bytes: Uint8Array;
  if (typeof encoded === 'string') bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
  else if (typeof plain === 'string') bytes = new Uint8Array(Buffer.from(plain.replace(/^\uFEFF/, ''), 'utf8'));
  else throw domainError('WC_VALIDATION', { content: 'Falta el fichero' });
  if (bytes.length === 0 || bytes.length > 2_000_000) {
    throw domainError('WC_VALIDATION', { content: 'El fichero está vacío o es demasiado grande' });
  }
  return { bankAccountId, format, filename, bytes, text: Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '') };
}
