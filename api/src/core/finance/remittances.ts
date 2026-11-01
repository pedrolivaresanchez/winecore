import { Decimal } from 'decimal.js';
import { entityScope, type UserCtx } from '../auth/permissions';
import { sha256Hex } from '../hash';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { normalizeIban } from '../party/iban';
import { actorOf, idempotencyKey, readJson, remember, replay, requestHash, storedResponse } from './idempotency';
import { bytesOfBlob, openIban } from './ibanSeal';
import { approvalServiceOn } from '../approvals/sql-store';
import { contentKey, assertScope } from './payments';
import { approvalFor, requireDataKey } from './runtime';
import { buildPain001, buildPain008, isCreditorId, sepaReference, sepaTimestamp } from './sepa';
import { dateOnly, decimalOf, isTargetTable, moneyText, objectOf, parseAmount, parseDate, parseUuid, pathUuid, pick, requiredText, assertNotPast, todayMadrid, textOf, type TargetTable } from './support';
import { findEntity, loadDocument, loadParty, readBytes, storeBytes } from './store';

const ROUTE = 'POST /v1/remittances';
const REMITTANCE_STATUSES = new Set([
  'draft', 'pending_approval', 'approved', 'file_generated', 'uploaded_by_user', 'settled', 'partially_rejected', 'cancelled',
]);

interface ItemInput {
  targetTable: TargetTable;
  targetId: string;
  amount: Decimal | null;
}

export async function createRemittance(writer: Writer, user: UserCtx, request: Request) {
  const key = idempotencyKey(request);
  const raw = await readJson(request);
  const input = parseCreate(raw);
  const hash = requestHash(raw);
  const now = new Date();
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const again = replay(await storedResponse(tx, user.id, key), hash);
    if (again) return again;
    const body = await insertRemittance(tx, user, writer, input, now);
    remember(tx, user.id, key, hash, ROUTE, 201, body, now);
    return { status: 201, body };
  });
}

export async function requestRemittanceApproval(writer: Writer, user: UserCtx, request: Request, remittanceId: string) {
  const id = pathUuid(remittanceId);
  const key = idempotencyKey(request);
  const hash = requestHash({});
  const now = new Date();
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const again = replay(await storedResponse(tx, user.id, key), hash);
    if (again) return again;
    const current = await loadRemittance(tx, id, requireDataKey(writer));
    assertScope(user, 'finance.manage', current.legalEntityId);
    if (current.status !== 'draft') throw domainError('WC_FIN_STATE');
    const payload = hashPayload(current);
    const contentSha256 = contentKey(payload);
    const approval = await approvalServiceOn(tx, []).requestApproval({
      kind: 'sepa_remittance',
      legalEntityId: current.legalEntityId,
      subjectTable: 'finance.remittance',
      subjectId: id,
      payload,
      details: { content_sha256: contentSha256 },
      summary: `Remesa SEPA ${current.executionDate}`.slice(0, 300),
      requestedBy: user.id,
    });
    tx.write(sql`
      UPDATE finance.remittance
      SET status = 'pending_approval', approval_request_id = CAST(${approval.id} AS UUID)
      WHERE id = CAST(${id} AS UUID)
    `);
    tx.audit({
      table: 'finance.remittance',
      rowId: id,
      action: 'UPDATE',
      before: { status: 'draft' },
      after: { status: 'pending_approval', content_sha256: contentSha256 },
    });
    const body = { ...(await view(tx, id)), status: 'pending_approval', content_sha256: contentSha256 };
    remember(tx, user.id, key, hash, 'POST /v1/remittances/:id/request-approval', 200, body, now);
    return { status: 200, body };
  });
}

export async function generateRemittanceFile(writer: Writer, user: UserCtx, request: Request, remittanceId: string) {
  const id = pathUuid(remittanceId);
  const key = idempotencyKey(request);
  const hash = requestHash({});
  const now = new Date();
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const again = replay(await storedResponse(tx, user.id, key), hash);
    if (again) return again;
    const current = await loadRemittance(tx, id, requireDataKey(writer));
    assertScope(user, 'finance.manage', current.legalEntityId);
    if (current.status !== 'pending_approval') throw domainError('WC_FIN_STATE');
    const contentSha256 = contentKey(hashPayload(current));
    const decision = await approvalFor(writer).decide({
      tx,
      remittanceId: id,
      legalEntityId: current.legalEntityId,
      kind: current.kind,
      contentSha256,
    });
    if (!decision.approved) throw domainError('WC_FIN_APPROVAL_REQUIRED');
    const xml = render(current, now);
    const bytes = new Uint8Array(Buffer.from(xml, 'utf8'));
    const file = await storeBytes(tx, {
      bytes,
      filename: current.kind === 'direct_debit' ? `remesa-adeudo-${current.executionDate}.xml` : `remesa-transferencia-${current.executionDate}.xml`,
      mime: 'application/xml',
      classification: 'personal_data',
      createdBy: user.id,
      now,
    });
    const approvalId = decision.approvalRequestId && /^[0-9a-f-]{36}$/i.test(decision.approvalRequestId)
      ? decision.approvalRequestId.toLowerCase()
      : null;
    tx.write(sql`
      UPDATE finance.remittance
      SET status = 'file_generated', file_attachment_id = CAST(${file.id} AS UUID), approval_request_id = CAST(${approvalId} AS UUID)
      WHERE id = CAST(${id} AS UUID)
    `);
    tx.audit({
      table: 'finance.remittance',
      rowId: id,
      action: 'UPDATE',
      before: { status: 'pending_approval', file_sha256: null },
      after: { status: 'file_generated', file_sha256: file.sha256, file_attachment_id: file.id, content_sha256: contentSha256 },
    });
    const body = {
      ...(await view(tx, id)),
      status: 'file_generated',
      file_sha256: file.sha256,
      file_attachment_id: file.id,
      content_sha256: contentSha256,
    };
    remember(tx, user.id, key, hash, 'POST /v1/remittances/:id/generate', 200, body, now);
    return { status: 200, body };
  });
}

export async function markRemittanceSubmitted(writer: Writer, user: UserCtx, request: Request, remittanceId: string) {
  const id = pathUuid(remittanceId);
  const key = idempotencyKey(request);
  const hash = requestHash({});
  const now = new Date();
  return writer.withWrite(actorOf(user, request), async (tx) => {
    const again = replay(await storedResponse(tx, user.id, key), hash);
    if (again) return again;
    const rows = await tx.read<Record<string, unknown>>(sql`
      SELECT status, legal_entity_id FROM finance.remittance WHERE id = CAST(${id} AS UUID)
    `);
    const row = rows[0];
    if (!row) throw domainError('WC_NOT_FOUND');
    assertScope(user, 'finance.manage', String(row.legal_entity_id).toLowerCase());
    if (String(row.status) !== 'file_generated') throw domainError('WC_FIN_STATE');
    tx.write(sql`
      UPDATE finance.remittance SET status = 'uploaded_by_user' WHERE id = CAST(${id} AS UUID)
    `);
    tx.audit({
      table: 'finance.remittance',
      rowId: id,
      action: 'UPDATE',
      before: { status: 'file_generated' },
      after: { status: 'uploaded_by_user' },
    });
    const body = { ...(await view(tx, id)), status: 'uploaded_by_user' };
    remember(tx, user.id, key, hash, 'POST /v1/remittances/:id/submitted', 200, body, now);
    return { status: 200, body };
  });
}

export async function listRemittances(writer: Writer, user: UserCtx, request: Request) {
  const url = new URL(request.url);
  const entityValue = url.searchParams.get('entity')?.trim() || null;
  const status = url.searchParams.get('status')?.trim() || null;
  if (status && !REMITTANCE_STATUSES.has(status)) {
    throw domainError('WC_VALIDATION', { status: 'Estado de remesa no válido' });
  }
  const kind = url.searchParams.get('kind')?.trim() || null;
  if (kind && kind !== 'direct_debit' && kind !== 'credit_transfer') {
    throw domainError('WC_VALIDATION', { kind: 'Usa direct_debit o credit_transfer' });
  }
  const limit = limitOf(url.searchParams.get('limit'));
  const offset = offsetOf(url.searchParams.get('cursor'));
  const scope = entityScope(user, 'finance.read');
  let entityId: string | null = null;
  if (entityValue) {
    const entity = await findEntity(writer, entityValue);
    if (!entity) throw domainError('WC_VALIDATION', { entity: 'La entidad no existe' });
    assertScope(user, 'finance.read', entity.id);
    entityId = entity.id;
  }
  const filters = ['TRUE'];
  if (entityId) filters.push(sql`r.legal_entity_id = CAST(${entityId} AS UUID)`);
  else if (scope) {
    if (scope.length === 0) return { items: [], next_cursor: null, total: 0 };
    filters.push(`r.legal_entity_id IN (${scope.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})`);
  }
  if (status) filters.push(sql`r.status = ${status}`);
  if (kind) filters.push(sql`r.kind = ${kind}`);
  const where = filters.join(' AND ');
  const rows = await writer.read<Record<string, unknown>>(
    `SELECT r.id, r.legal_entity_id, e.code AS entity_code, r.kind, r.status, r.bank_account_id,
            r.execution_date, r.total, r.created_at
     FROM finance.remittance r
     JOIN core.legal_entity e ON e.id = r.legal_entity_id
     WHERE ${where}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ${limit + 1} OFFSET ${offset}`,
  );
  const totalRows = await writer.read<{ total: number }>(
    `SELECT count(*)::INTEGER AS total FROM finance.remittance r WHERE ${where}`,
  );
  const page = rows.length > limit ? rows.slice(0, limit) : rows;
  return {
    items: page.map((row) => ({
      id: String(row.id).toLowerCase(),
      legal_entity_id: String(row.legal_entity_id).toLowerCase(),
      entity_code: String(row.entity_code),
      kind: String(row.kind),
      status: String(row.status),
      bank_account_id: String(row.bank_account_id).toLowerCase(),
      execution_date: dateOnly(row.execution_date),
      total: moneyText(decimalOf(row.total)),
      created_at: row.created_at == null ? null : String(row.created_at),
    })),
    next_cursor: rows.length > limit ? String(offset + limit) : null,
    total: Number(totalRows[0]?.total ?? 0),
  };
}

export async function getRemittance(writer: Writer, user: UserCtx, remittanceId: string) {
  const id = pathUuid(remittanceId);
  const body = await view(writer, id);
  assertScope(user, 'finance.read', String(body.legal_entity_id));
  return body;
}

export async function downloadRemittanceFile(writer: Writer, user: UserCtx, remittanceId: string): Promise<Response> {
  const id = pathUuid(remittanceId);
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT legal_entity_id, file_attachment_id, status
    FROM finance.remittance WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  assertScope(user, 'finance.manage', String(row.legal_entity_id).toLowerCase());
  if (row.file_attachment_id == null) throw domainError('WC_FIN_STATE');
  const file = await readBytes(writer, String(row.file_attachment_id));
  if (!file) throw domainError('WC_NOT_FOUND');
  return new Response(Buffer.from(file.bytes), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'X-Content-Sha256': file.sha256,
    },
  });
}

interface LoadedItem {
  id: string;
  targetTable: TargetTable;
  targetId: string;
  counterpartyId: string;
  counterpartyName: string;
  amount: string;
  mandateRef: string | null;
  mandateDate: string | null;
  endToEndId: string;
  iban: string;
  bic: string | null;
  documentNumber: string;
}

interface LoadedRemittance {
  id: string;
  legalEntityId: string;
  legalName: string;
  kind: 'direct_debit' | 'credit_transfer';
  status: string;
  bankAccountId: string;
  executionDate: string;
  creditorIban: string;
  creditorBic: string | null;
  creditorSchemeId: string | null;
  items: LoadedItem[];
}

async function insertRemittance(
  tx: Tx,
  user: UserCtx,
  writer: Writer,
  input: { legalEntityId: string; kind: 'direct_debit' | 'credit_transfer'; bankAccountId: string; executionDate: string; items: ItemInput[] },
  now: Date,
) {
  const today = todayMadrid(now);
  assertNotPast(input.executionDate, 'execution_date', today);
  const entity = await findEntity(tx, input.legalEntityId);
  if (!entity) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });
  assertScope(user, 'finance.manage', entity.id);
  const key = requireDataKey(writer);
  const accounts = await tx.read<Record<string, unknown>>(sql`
    SELECT id, legal_entity_id, iban_enc, bic, sepa_creditor_id, is_active
    FROM finance.bank_account WHERE id = CAST(${input.bankAccountId} AS UUID)
  `);
  const account = accounts[0];
  if (!account || account.is_active !== true || String(account.legal_entity_id).toLowerCase() !== entity.id) {
    throw domainError('WC_VALIDATION', { bank_account_id: 'La cuenta no es de la entidad' });
  }
  const creditorBlob = bytesOfBlob(account.iban_enc);
  if (!creditorBlob) throw domainError('WC_VALIDATION', { bank_account_id: 'La cuenta no tiene IBAN' });
  const creditorIban = openIban(creditorBlob, key);
  if (input.kind === 'direct_debit') {
    const creditorId = textOf(account.sepa_creditor_id);
    if (!creditorId || !isCreditorId(creditorId)) {
      throw domainError('WC_VALIDATION', { sepa_creditor_id: 'La cuenta no tiene identificador de acreedor SEPA' });
    }
  }
  const prepared: Array<LoadedItem & { amountDecimal: Decimal }> = [];
  let total = new Decimal(0);
  for (const item of input.items) {
    const doc = await loadDocument(tx, item.targetTable, item.targetId);
    if (!doc || !doc.payable || doc.legalEntityId !== entity.id) {
      throw domainError('WC101', undefined, { target_table: item.targetTable, target_id: item.targetId });
    }
    if (input.kind === 'direct_debit' && (doc.targetTable !== 'billing.invoice' || doc.direction !== 'in')) {
      throw domainError('WC_VALIDATION', { items: 'Un adeudo solo incluye facturas emitidas' });
    }
    if (input.kind === 'credit_transfer' && (doc.targetTable !== 'purchasing.supplier_invoice' || doc.direction !== 'out')) {
      throw domainError('WC_VALIDATION', { items: 'Una transferencia solo incluye facturas recibidas aprobadas' });
    }
    const amount = item.amount ?? doc.outstanding;
    if (amount.gt(doc.outstanding)) {
      throw domainError('WC100', undefined, { target_id: doc.targetId, outstanding: moneyText(doc.outstanding) });
    }
    if (!doc.counterpartyId) throw domainError('WC101', undefined, { target_id: doc.targetId });
    const party = await loadParty(tx, doc.counterpartyId, key);
    if (!party?.iban) throw domainError('WC_VALIDATION', { iban: 'La contraparte no tiene IBAN' });
    if (input.kind === 'direct_debit') {
      if (!party.mandateRef || !party.mandateDate) {
        throw domainError('WC_FIN_MANDATE', { counterparty_id: 'Faltan la referencia y la fecha del mandato' });
      }
      if (party.mandateDate > today) {
        throw domainError('WC_FIN_MANDATE', { sepa_mandate_date: 'La fecha del mandato no puede ser futura' });
      }
    }
    const clash = await tx.read<{ id: string }>(sql`
      SELECT r.id
      FROM finance.remittance_item i
      JOIN finance.remittance r ON r.id = i.remittance_id
      WHERE i.target_table = ${item.targetTable}
        AND i.target_id = CAST(${item.targetId} AS UUID)
        AND i.status = 'included'
        AND r.status NOT IN ('cancelled')
      LIMIT 1
    `);
    if (clash[0]) throw domainError('WC_VALIDATION', { items: 'El documento ya está en una remesa' });
    const itemId = newId();
    total = total.plus(amount);
    prepared.push({
      id: itemId,
      targetTable: item.targetTable,
      targetId: item.targetId,
      counterpartyId: doc.counterpartyId,
      counterpartyName: party.legalName,
      amount: moneyText(amount),
      amountDecimal: amount,
      mandateRef: party.mandateRef,
      mandateDate: party.mandateDate,
      endToEndId: sepaReference('E', itemId),
      iban: party.iban,
      bic: null,
      documentNumber: doc.documentNumber,
    });
  }
  const id = newId();
  tx.write(sql`
    INSERT INTO finance.remittance (
      id, legal_entity_id, kind, status, bank_account_id, execution_date, total, created_by, created_at
    ) VALUES (
      CAST(${id} AS UUID), CAST(${entity.id} AS UUID), ${input.kind}, 'draft',
      CAST(${input.bankAccountId} AS UUID), CAST(${input.executionDate} AS DATE), ${total}, ${user.id}, ${now}
    )
  `);
  tx.audit({
    table: 'finance.remittance',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { kind: input.kind, status: 'draft', total: moneyText(total), execution_date: input.executionDate },
  });
  for (const item of prepared) {
    tx.write(sql`
      INSERT INTO finance.remittance_item (
        id, remittance_id, target_table, target_id, counterparty_id, amount, mandate_ref, end_to_end_id, status
      ) VALUES (
        CAST(${item.id} AS UUID), CAST(${id} AS UUID), ${item.targetTable}, CAST(${item.targetId} AS UUID),
        CAST(${item.counterpartyId} AS UUID), ${item.amountDecimal}, ${input.kind === 'direct_debit' ? item.mandateRef : null},
        ${item.endToEndId}, 'included'
      )
    `);
    tx.audit({
      table: 'finance.remittance_item',
      rowId: item.id,
      action: 'INSERT',
      before: null,
      after: {
        remittance_id: id,
        target_table: item.targetTable,
        target_id: item.targetId,
        amount: item.amount,
        end_to_end_id: item.endToEndId,
        mandate_ref: input.kind === 'direct_debit' ? item.mandateRef : null,
      },
    });
  }
  return {
    id,
    legal_entity_id: entity.id,
    kind: input.kind,
    status: 'draft',
    bank_account_id: input.bankAccountId.toLowerCase(),
    execution_date: input.executionDate,
    total: moneyText(total),
    file_sha256: null,
    file_attachment_id: null,
    items: prepared.map((item) => ({
      id: item.id,
      target_table: item.targetTable,
      target_id: item.targetId,
      counterparty_id: item.counterpartyId,
      amount: item.amount,
      mandate_ref: input.kind === 'direct_debit' ? item.mandateRef : null,
      end_to_end_id: item.endToEndId,
      status: 'included',
    })),
  };
}

async function loadRemittance(tx: Tx, id: string, key: Uint8Array): Promise<LoadedRemittance> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT r.*, e.legal_name, a.iban_enc, a.bic, a.sepa_creditor_id
    FROM finance.remittance r
    JOIN core.legal_entity e ON e.id = r.legal_entity_id
    JOIN finance.bank_account a ON a.id = r.bank_account_id
    WHERE r.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const creditorBlob = bytesOfBlob(row.iban_enc);
  if (!creditorBlob) throw domainError('WC_VALIDATION', { bank_account_id: 'La cuenta no tiene IBAN' });
  const items = await tx.read<Record<string, unknown>>(sql`
    SELECT * FROM finance.remittance_item WHERE remittance_id = CAST(${id} AS UUID) ORDER BY end_to_end_id
  `);
  const loaded: LoadedItem[] = [];
  for (const item of items) {
    const table = String(item.target_table);
    if (!isTargetTable(table)) continue;
    const doc = await loadDocument(tx, table, String(item.target_id));
    const party = await loadParty(tx, String(item.counterparty_id), key);
    if (!party?.iban || !doc) throw domainError('WC_VALIDATION', { items: 'La remesa ya no se puede generar' });
    loaded.push({
      id: String(item.id).toLowerCase(),
      targetTable: table,
      targetId: String(item.target_id).toLowerCase(),
      counterpartyId: String(item.counterparty_id).toLowerCase(),
      counterpartyName: party.legalName,
      amount: moneyText(decimalOf(item.amount)),
      mandateRef: textOf(item.mandate_ref),
      mandateDate: party.mandateDate,
      endToEndId: String(item.end_to_end_id),
      iban: party.iban,
      bic: null,
      documentNumber: doc.documentNumber,
    });
  }
  const kind = String(row.kind) === 'credit_transfer' ? 'credit_transfer' : 'direct_debit';
  return {
    id,
    legalEntityId: String(row.legal_entity_id).toLowerCase(),
    legalName: String(row.legal_name),
    kind,
    status: String(row.status),
    bankAccountId: String(row.bank_account_id).toLowerCase(),
    executionDate: dateOnly(row.execution_date) ?? '',
    creditorIban: openIban(creditorBlob, key),
    creditorBic: textOf(row.bic),
    creditorSchemeId: textOf(row.sepa_creditor_id),
    items: loaded,
  };
}

function hashPayload(remittance: LoadedRemittance) {
  return {
    kind: remittance.kind,
    legal_entity_id: remittance.legalEntityId,
    bank_account_id: remittance.bankAccountId,
    execution_date: remittance.executionDate,
    creditor_iban_sha256: sha256Hex(normalizeIban(remittance.creditorIban)),
    items: remittance.items.map((item) => ({
      target_table: item.targetTable,
      target_id: item.targetId,
      counterparty_id: item.counterpartyId,
      amount: item.amount,
      mandate_ref: item.mandateRef,
      mandate_date: item.mandateDate,
      end_to_end_id: item.endToEndId,
      counterparty_iban_sha256: sha256Hex(normalizeIban(item.iban)),
    })),
  };
}

function render(remittance: LoadedRemittance, now: Date): string {
  const createdAt = sepaTimestamp(now);
  const messageId = sepaReference('M', remittance.id);
  const paymentInfoId = sepaReference('P', remittance.id);
  if (remittance.kind === 'direct_debit') {
    if (!remittance.creditorSchemeId) {
      throw domainError('WC_VALIDATION', { sepa_creditor_id: 'La cuenta no tiene identificador de acreedor SEPA' });
    }
    return buildPain008({
      messageId,
      paymentInfoId,
      createdAt,
      collectionDate: remittance.executionDate,
      initiatorName: remittance.legalName,
      creditorName: remittance.legalName,
      creditorIban: remittance.creditorIban,
      creditorBic: remittance.creditorBic,
      creditorSchemeId: remittance.creditorSchemeId,
      transactions: remittance.items.map((item) => {
        if (!item.mandateRef || !item.mandateDate) throw domainError('WC_FIN_MANDATE');
        return {
          endToEndId: item.endToEndId,
          amount: item.amount,
          mandateId: item.mandateRef,
          mandateDate: item.mandateDate,
          debtorName: item.counterpartyName,
          debtorIban: item.iban,
          debtorBic: item.bic,
          remittance: `Factura ${item.documentNumber}`,
        };
      }),
    });
  }
  return buildPain001({
    messageId,
    paymentInfoId,
    createdAt,
    executionDate: remittance.executionDate,
    initiatorName: remittance.legalName,
    debtorName: remittance.legalName,
    debtorIban: remittance.creditorIban,
    debtorBic: remittance.creditorBic,
    transactions: remittance.items.map((item) => ({
      endToEndId: item.endToEndId,
      amount: item.amount,
      creditorName: item.counterpartyName,
      creditorIban: item.iban,
      creditorBic: item.bic,
      remittance: `Factura ${item.documentNumber}`,
    })),
  });
}

async function view(tx: { read: Tx['read'] }, id: string) {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT r.*, a.sha256 AS file_sha256
    FROM finance.remittance r
    LEFT JOIN core.attachment a ON a.id = r.file_attachment_id
    WHERE r.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const items = await tx.read<Record<string, unknown>>(sql`
    SELECT i.id, i.target_table, i.target_id, i.counterparty_id, c.legal_name AS counterparty_name,
           i.amount, i.mandate_ref, i.end_to_end_id, i.status,
           COALESCE(inv.number, sup.supplier_invoice_number) AS document_number
    FROM finance.remittance_item i
    LEFT JOIN party.contact c ON c.id = i.counterparty_id
    LEFT JOIN billing.invoice inv
      ON i.target_table = 'billing.invoice' AND inv.id = i.target_id
    LEFT JOIN purchasing.supplier_invoice sup
      ON i.target_table = 'purchasing.supplier_invoice' AND sup.id = i.target_id
    WHERE i.remittance_id = CAST(${id} AS UUID)
    ORDER BY i.end_to_end_id
  `);
  return {
    id: String(row.id).toLowerCase(),
    legal_entity_id: String(row.legal_entity_id).toLowerCase(),
    kind: String(row.kind),
    status: String(row.status),
    bank_account_id: String(row.bank_account_id).toLowerCase(),
    execution_date: dateOnly(row.execution_date),
    total: moneyText(decimalOf(row.total)),
    file_sha256: textOf(row.file_sha256),
    file_attachment_id: row.file_attachment_id == null ? null : String(row.file_attachment_id).toLowerCase(),
    items: items.map((item) => ({
      id: String(item.id).toLowerCase(),
      target_table: String(item.target_table),
      target_id: String(item.target_id).toLowerCase(),
      counterparty_id: String(item.counterparty_id).toLowerCase(),
      counterparty_name: textOf(item.counterparty_name),
      document_number: textOf(item.document_number),
      amount: moneyText(decimalOf(item.amount)),
      mandate_ref: textOf(item.mandate_ref),
      end_to_end_id: String(item.end_to_end_id),
      status: String(item.status),
    })),
  };
}

function limitOf(value: string | null): number {
  if (!value) return 50;
  if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 100) {
    throw domainError('WC_VALIDATION', { limit: 'Debe ser un entero entre 1 y 100' });
  }
  return Number(value);
}

/** The cursor is the offset of the next page; the list is short enough that it never drifts far. */
function offsetOf(value: string | null): number {
  if (!value) return 0;
  if (!/^\d{1,7}$/.test(value)) throw domainError('WC_VALIDATION', { cursor: 'Cursor no válido' });
  return Number(value);
}

function parseCreate(raw: unknown) {
  const body = objectOf(raw);
  const kindRaw = String(pick(body, 'kind') ?? '');
  if (kindRaw !== 'direct_debit' && kindRaw !== 'credit_transfer') {
    throw domainError('WC_VALIDATION', { kind: 'Debe ser direct_debit o credit_transfer' });
  }
  const kind: 'direct_debit' | 'credit_transfer' = kindRaw;
  const legalEntityId = requiredText(pick(body, 'legal_entity_id', 'legalEntityId', 'entity'), 'legal_entity_id', 2, 36);
  const bankAccountId = parseUuid(pick(body, 'bank_account_id', 'bankAccountId'), 'bank_account_id');
  const executionDate = parseDate(pick(body, 'execution_date', 'executionDate'), 'execution_date');
  const itemsRaw = pick(body, 'items');
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0 || itemsRaw.length > 500) {
    throw domainError('WC_VALIDATION', { items: 'Indica entre 1 y 500 documentos' });
  }
  const items = itemsRaw.map((item, index) => {
    const row = objectOf(item, `items.${index}`);
    const targetTable = String(pick(row, 'target_table', 'targetTable') ?? '');
    if (!isTargetTable(targetTable)) {
      throw domainError('WC_VALIDATION', { [`items.${index}.target_table`]: 'Documento no admitido' });
    }
    const amountRaw = pick(row, 'amount');
    return {
      targetTable,
      targetId: parseUuid(pick(row, 'target_id', 'targetId'), `items.${index}.target_id`),
      amount: amountRaw === undefined ? null : parseAmount(amountRaw, `items.${index}.amount`),
    };
  });
  return { legalEntityId, kind, bankAccountId, executionDate, items };
}
