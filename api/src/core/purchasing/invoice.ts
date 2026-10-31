import { detectMime } from '../attachments/mime';
import { listLinks, putAttachment } from '../attachments/store';
import { can, type Permission, type UserCtx } from '../auth/permissions';
import type { Actor, Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { sql } from '../db/sql';
import { add, dec, money2, near, parseAmount } from './amounts';
import type { ApprovedSupplierInvoice, SupplierInvoiceApprovalHook } from './approval';
import { suggestCategory } from './category';
import { attachmentRole, extractDocument, sourceFor, type OcrWorkforce } from './extract';
import {
  FIELD_KEYS,
  type ConfidenceMap,
  type Extraction,
} from './extraction';

const CAPTURE_ROUTE = 'POST /v1/supplier-invoices/capture';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT = /^6[0-9]{2,7}$/;
const ZERO: ConfidenceMap = {
  supplier_name: 0,
  supplier_tax_id: 0,
  number: 0,
  issue_date: 0,
  due_date: 0,
  lines: 0,
  vat: 0,
  totals: 0,
};

export type LineJson = {
  line_no: number;
  description: string;
  quantity: string;
  unit_price: string;
  line_base: string;
  vat_rate: string;
  vat_quota: string;
  withholding_rate: string;
  vat_deductible_pct: string;
  expense_account: string;
};

export type InvoiceJson = {
  id: string;
  legal_entity_id: string;
  legal_entity_code: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_tax_id: string | null;
  supplier_invoice_number: string | null;
  issue_date: string | null;
  accounting_date: string | null;
  due_date: string | null;
  source: string;
  status: string;
  category_code: string | null;
  category_suggested: boolean;
  organic_relevant: boolean;
  currency: string;
  subtotal: string | null;
  tax_total: string | null;
  withholding_total: string;
  total: string | null;
  payment_method: string | null;
  notes: string | null;
  ocr_confidence: number;
  confidence: ConfidenceMap;
  extractor: string | null;
  model: string | null;
  totals_ok: boolean;
  warnings: string[];
  duplicate_of_id: string | null;
  rejection_reason: string | null;
  attachment_id: string | null;
  lines: LineJson[];
  validated_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CaptureCommand = {
  bytes: Uint8Array;
  filename: string;
  entityRef: string | null;
  source: string | null;
  notes: string | null;
  extraction: unknown | null;
  idempotencyKey: string;
  requestHash: string;
};

type Category = { code: string; account: string; organic: boolean; name: string };
type EntityHit = { id: string; code: string };
type SupplierHit = { id: string; name: string; taxId: string };

function invalid(fields: Record<string, string>): never {
  throw domainError('WC_VALIDATION', fields);
}

function principal(userId: string): string {
  return `user:${userId}`;
}

function sameVersion(current: string, offered: string | null): boolean {
  if (!offered) return false;
  const left = Date.parse(current);
  const right = Date.parse(offered.replace(/^"|"$/g, ''));
  return Number.isFinite(left) && left === right;
}

function scopeAll(user: UserCtx, permission: Permission): boolean {
  return user.roles.some((role) => role.legalEntityId === null && can({ ...user, roles: [role] }, permission));
}

function assertEntity(user: UserCtx, permission: Permission, entityId: string): void {
  if (!can(user, permission, entityId)) throw domainError('WC_FORBIDDEN');
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value);
  return raw === '' ? null : raw;
}

function dateText(value: unknown): string | null {
  const raw = text(value);
  return raw ? raw.slice(0, 10) : null;
}

function moneyText(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return money2(dec(raw));
}

function lowerId(value: unknown): string | null {
  const raw = text(value);
  return raw ? raw.toLowerCase() : null;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function confidenceOf(value: unknown): ConfidenceMap {
  const record = jsonObject(value);
  const map = { ...ZERO };
  for (const key of FIELD_KEYS) {
    const item = record[key];
    if (typeof item === 'number' && Number.isFinite(item)) map[key] = item;
  }
  return map;
}

function warningsOf(input: {
  status: string;
  totalsOk: boolean;
  confidence: number;
  mismatch: boolean;
  suggested: boolean;
  unmatched: boolean;
}): string[] {
  const warnings: string[] = [];
  if (input.status === 'duplicate') warnings.push('duplicate');
  if (!input.totalsOk) warnings.push('totals');
  if (input.mismatch) warnings.push('entity_mismatch');
  if (input.unmatched) warnings.push('supplier_unmatched');
  if (input.confidence < 0.8) warnings.push('low_confidence');
  if (input.suggested) warnings.push('category_suggested');
  return warnings;
}

function liveTotalsOk(header: {
  subtotal: string | null;
  taxTotal: string | null;
  withholding: string;
  total: string | null;
}, lines: readonly LineJson[]): boolean {
  if (!header.total || !header.subtotal || !header.taxTotal || lines.length === 0) return false;
  const base = add(lines.map((line) => dec(line.line_base)));
  const vat = add(lines.map((line) => dec(line.vat_quota)));
  const withheld = add(lines.map((line) =>
    dec(line.line_base).times(dec(line.withholding_rate)).div(100).toDecimalPlaces(2)));
  const computed = base.plus(vat).minus(withheld);
  return near(base, dec(header.subtotal))
    && near(vat, dec(header.taxTotal))
    && near(withheld, dec(header.withholding))
    && near(computed, dec(header.total));
}

type Loaded = {
  row: Record<string, unknown>;
  lines: LineJson[];
  attachmentId: string | null;
};

async function load(read: Tx['read'] | Writer['read'], id: string): Promise<Loaded | null> {
  if (!UUID.test(id)) return null;
  const rows = await read<Record<string, unknown>>(sql`
    SELECT i.*, e.code AS entity_code,
           COALESCE(NULLIF(trim(c.trade_name), ''), c.legal_name) AS contact_name,
           c.tax_id AS contact_tax_id,
           cat.organic_relevant
    FROM purchasing.supplier_invoice i
    JOIN core.legal_entity e ON e.id = i.legal_entity_id
    LEFT JOIN party.contact c ON c.id = i.supplier_id
    LEFT JOIN purchasing.expense_category cat ON cat.code = i.category_code
    WHERE i.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  const lineRows = await read<Record<string, unknown>>(sql`
    SELECT line_no, description, quantity, unit_price, line_base, vat_rate, vat_quota,
           withholding_rate, vat_deductible_pct, expense_account
    FROM purchasing.supplier_invoice_line
    WHERE supplier_invoice_id = CAST(${id} AS UUID)
    ORDER BY line_no
  `);
  const links = await listLinks(read, 'purchasing.supplier_invoice', id.toLowerCase());
  const lines = lineRows.map((line) => ({
    line_no: Number(line.line_no),
    description: String(line.description),
    quantity: String(line.quantity),
    unit_price: String(line.unit_price),
    line_base: moneyText(line.line_base) ?? '0.00',
    vat_rate: String(line.vat_rate),
    vat_quota: moneyText(line.vat_quota) ?? '0.00',
    withholding_rate: String(line.withholding_rate),
    vat_deductible_pct: String(line.vat_deductible_pct),
    expense_account: String(line.expense_account),
  }));
  return { row, lines, attachmentId: links[0]?.id ?? null };
}

function viewOf(loaded: Loaded): InvoiceJson {
  const row = loaded.row;
  const ocr = jsonObject(row.ocr_extraction);
  const confidence = confidenceOf(ocr.confidence);
  const subtotal = moneyText(row.subtotal);
  const taxTotal = moneyText(row.tax_total);
  const withholding = moneyText(row.withholding_total) ?? '0.00';
  const total = moneyText(row.total);
  const status = String(row.status);
  const category = text(row.category_code);
  const suggested = text(ocr.suggested_category);
  const supplierId = lowerId(row.supplier_id);
  const totalsOk = liveTotalsOk({ subtotal, taxTotal, withholding, total }, loaded.lines);
  const overall = Number(row.ocr_confidence ?? ocr.overall ?? 0);
  return {
    id: lowerId(row.id) ?? '',
    legal_entity_id: lowerId(row.legal_entity_id) ?? '',
    legal_entity_code: String(row.entity_code),
    supplier_id: supplierId,
    supplier_name: text(row.contact_name) ?? text(ocr.supplier_name),
    supplier_tax_id: text(row.contact_tax_id) ?? text(ocr.supplier_tax_id),
    supplier_invoice_number: text(row.supplier_invoice_number),
    issue_date: dateText(row.issue_date),
    accounting_date: dateText(row.accounting_date),
    due_date: dateText(row.due_date),
    source: String(row.source),
    status,
    category_code: category,
    category_suggested: suggested != null && suggested === category,
    organic_relevant: row.organic_relevant === true,
    currency: String(row.currency),
    subtotal,
    tax_total: taxTotal,
    withholding_total: withholding,
    total,
    payment_method: text(row.payment_method),
    notes: text(row.notes),
    ocr_confidence: Number.isFinite(overall) ? overall : 0,
    confidence,
    extractor: text(ocr.extractor),
    model: text(ocr.model),
    totals_ok: totalsOk,
    warnings: warningsOf({
      status,
      totalsOk,
      confidence: Number.isFinite(overall) ? overall : 0,
      mismatch: ocr.entity_mismatch === true,
      suggested: suggested != null && suggested === category,
      unmatched: supplierId == null && text(ocr.supplier_tax_id) != null,
    }),
    duplicate_of_id: lowerId(row.duplicate_of_id),
    rejection_reason: text(row.rejection_reason),
    attachment_id: loaded.attachmentId,
    lines: loaded.lines,
    validated_at: text(row.validated_at),
    approved_at: text(row.approved_at),
    created_at: text(row.created_at) ?? '',
    updated_at: text(row.updated_at) ?? '',
  };
}

async function requireInvoice(read: Tx['read'] | Writer['read'], user: UserCtx, id: string, permission: Permission): Promise<InvoiceJson> {
  const loaded = await load(read, id);
  if (!loaded) throw domainError('WC_NOT_FOUND');
  assertEntity(user, permission, lowerId(loaded.row.legal_entity_id) ?? '');
  return viewOf(loaded);
}

function frozen(status: string): void {
  if (status === 'approved') throw domainError('WC090');
}

async function categoryByCode(tx: Tx, code: string | null): Promise<Category | null> {
  if (!code) return null;
  const rows = await tx.read<{ code: string; default_account: string; organic_relevant: boolean; name_es: string }>(sql`
    SELECT code, default_account, organic_relevant, name_es
    FROM purchasing.expense_category
    WHERE code = ${code} AND is_active
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    code: String(row.code),
    account: String(row.default_account),
    organic: row.organic_relevant === true,
    name: String(row.name_es),
  };
}

async function resolveEntity(tx: Tx, ref: string | null, buyerTax: string | null, buyerValid: boolean): Promise<{ entity: EntityHit; mismatch: boolean }> {
  let chosen: EntityHit | null = null;
  if (ref) {
    if (UUID.test(ref)) {
      const rows = await tx.read<{ id: unknown; code: unknown }>(sql`
        SELECT id, code FROM core.legal_entity WHERE id = CAST(${ref.toLowerCase()} AS UUID) AND is_active
      `);
      const row = rows[0];
      if (row) chosen = { id: String(row.id).toLowerCase(), code: String(row.code) };
    } else {
      const code = ref.trim().toUpperCase().replace(/\./g, '');
      const rows = await tx.read<{ id: unknown; code: unknown }>(sql`
        SELECT id, code FROM core.legal_entity WHERE code = ${code} AND is_active
      `);
      const row = rows[0];
      if (row) chosen = { id: String(row.id).toLowerCase(), code: String(row.code) };
    }
    if (!chosen) invalid({ legal_entity_id: 'No se reconoce la entidad' });
  }
  let suggested: EntityHit | null = null;
  if (buyerValid && buyerTax) {
    const rows = await tx.read<{ id: unknown; code: unknown }>(sql`
      SELECT id, code FROM core.legal_entity WHERE tax_id = ${buyerTax} AND is_active
    `);
    const row = rows[0];
    if (row) suggested = { id: String(row.id).toLowerCase(), code: String(row.code) };
  }
  const entity = chosen ?? suggested;
  if (!entity) invalid({ legal_entity_id: 'No se reconoce la entidad destinataria (P.O o CVPO)' });
  return { entity, mismatch: chosen != null && suggested != null && chosen.id !== suggested.id };
}

async function supplierByTax(tx: Tx, taxId: string | null, valid: boolean): Promise<SupplierHit | null> {
  if (!valid || !taxId) return null;
  const rows = await tx.read<{ id: unknown; legal_name: unknown; tax_id: unknown; is_supplier: unknown }>(sql`
    SELECT id, legal_name, tax_id, is_supplier
    FROM party.contact
    WHERE tax_id = ${taxId} AND archived_at IS NULL AND merged_into_id IS NULL
    LIMIT 1
  `);
  const row = rows[0];
  if (!row || row.is_supplier !== true) return null;
  return { id: String(row.id).toLowerCase(), name: String(row.legal_name), taxId: String(row.tax_id) };
}

type Twin = { id: string; status: string; created_at: string };

async function originalOf(
  tx: Tx,
  entityId: string,
  supplierId: string | null,
  number: string | null,
  selfId: string,
  selfCreatedAt: string,
): Promise<string | null> {
  if (!supplierId || !number) return null;
  const rows = await tx.read<Twin>(sql`
    SELECT id, status, created_at
    FROM purchasing.supplier_invoice
    WHERE legal_entity_id = CAST(${entityId} AS UUID)
      AND supplier_id = CAST(${supplierId} AS UUID)
      AND supplier_invoice_number = ${number}
      AND id <> CAST(${selfId} AS UUID)
      AND status IN ('captured', 'validated', 'approved')
  `);
  const firm = rows.filter((row) => row.status === 'approved' || row.status === 'validated');
  const pool = firm.length > 0
    ? firm
    : rows.filter((row) => row.created_at < selfCreatedAt || (row.created_at === selfCreatedAt && row.id < selfId));
  if (pool.length === 0) return null;
  pool.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
  return pool[0] ? String(pool[0].id).toLowerCase() : null;
}

function auditInvoice(id: string, before: unknown, after: unknown, action: 'INSERT' | 'UPDATE'): Parameters<Tx['audit']>[0] {
  return { table: 'purchasing.supplier_invoice', rowId: id, action, before, after };
}

function snapshot(invoice: {
  status: string;
  supplierId: string | null;
  number: string | null;
  total: string | null;
  duplicateOf: string | null;
}): Record<string, unknown> {
  return {
    status: invoice.status,
    supplier_id: invoice.supplierId,
    supplier_invoice_number: invoice.number,
    total: invoice.total,
    duplicate_of_id: invoice.duplicateOf,
  };
}

async function takeLines(tx: Tx, invoiceId: string): Promise<void> {
  const previous = await tx.read<{ id: unknown; line_no: unknown; line_base: unknown }>(sql`
    SELECT id, line_no, line_base
    FROM purchasing.supplier_invoice_line
    WHERE supplier_invoice_id = CAST(${invoiceId} AS UUID)
  `);
  if (previous.length === 0) return;
  tx.write(sql`DELETE FROM purchasing.supplier_invoice_line WHERE supplier_invoice_id = CAST(${invoiceId} AS UUID)`);
  for (const line of previous) {
    tx.audit({
      table: 'purchasing.supplier_invoice_line',
      rowId: String(line.id).toLowerCase(),
      action: 'DELETE',
      before: { line_no: Number(line.line_no), line_base: String(line.line_base) },
      after: null,
    });
  }
}

function insertLines(tx: Tx, invoiceId: string, lines: LineJson[]): void {
  for (const line of lines) {
    const lineId = newId();
    tx.write(sql`
      INSERT INTO purchasing.supplier_invoice_line (
        id, supplier_invoice_id, line_no, description, expense_account, quantity, unit_price,
        line_base, vat_rate, vat_deductible_pct, vat_quota, withholding_rate
      ) VALUES (
        CAST(${lineId} AS UUID),
        CAST(${invoiceId} AS UUID),
        ${line.line_no},
        ${line.description},
        ${line.expense_account},
        ${line.quantity},
        ${line.unit_price},
        ${line.line_base},
        ${line.vat_rate},
        ${line.vat_deductible_pct},
        ${line.vat_quota},
        ${line.withholding_rate}
      )
    `);
    tx.audit({
      table: 'purchasing.supplier_invoice_line',
      rowId: lineId,
      action: 'INSERT',
      before: null,
      after: { supplier_invoice_id: invoiceId, line_no: line.line_no, line_base: line.line_base, vat_quota: line.vat_quota },
    });
  }
}

function linesFromExtraction(extraction: Extraction, account: string): LineJson[] {
  return extraction.lines.map((line, index) => ({
    line_no: index + 1,
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unit_price,
    line_base: line.line_base,
    vat_rate: line.vat_rate,
    vat_quota: line.vat_quota,
    withholding_rate: line.withholding_rate,
    vat_deductible_pct: '100.00',
    expense_account: account,
  }));
}

function outbox(tx: Tx, eventType: string, id: string, entityId: string, payload: unknown, now: Date): void {
  tx.write(sql`
    INSERT INTO ops.outbox_event (
      event_type, aggregate_table, aggregate_id, legal_entity_id, payload, occurred_at
    ) VALUES (
      ${eventType},
      'purchasing.supplier_invoice',
      CAST(${id} AS UUID),
      CAST(${entityId} AS UUID),
      ${sql.json(payload)},
      ${now}
    )
  `);
}

export async function captureInvoice(
  writer: Writer,
  actor: Actor,
  user: UserCtx,
  command: CaptureCommand,
  workforce: OcrWorkforce,
  now = new Date(),
): Promise<{ status: number; body: InvoiceJson }> {
  const extraction = await extractDocument(
    { bytes: command.bytes, filename: command.filename },
    command.extraction,
    workforce,
  );
  const mime = detectMime(command.bytes) ?? 'application/octet-stream';
  return writer.withWrite(actor, async (tx) => {
    const prior = await tx.read<{ route: string; request_sha256: string; status_code: unknown; response: unknown }>(sql`
      SELECT route, request_sha256, status_code, response
      FROM ops.idempotency_key
      WHERE principal = ${principal(user.id)} AND key = ${command.idempotencyKey}
    `);
    const stored = prior[0];
    if (stored) {
      if (stored.route !== CAPTURE_ROUTE || stored.request_sha256 !== command.requestHash) {
        throw domainError('WC_IDEMPOTENCY_MISMATCH');
      }
      const response = typeof stored.response === 'string' ? JSON.parse(stored.response) as InvoiceJson : stored.response as InvoiceJson;
      return { status: Number(stored.status_code), body: response };
    }
    const { entity, mismatch } = await resolveEntity(tx, command.entityRef, extraction.buyer_tax_id, extraction.buyer_tax_valid);
    assertEntity(user, 'purchasing.write', entity.id);
    const supplier = await supplierByTax(tx, extraction.supplier_tax_id, extraction.supplier_tax_valid);
    const suggested = suggestCategory(extraction.lines.map((line) => line.description));
    const category = await categoryByCode(tx, suggested);
    const account = category?.account ?? '629';
    const id = newId();
    const createdAt = now.toISOString();
    const duplicateOf = await originalOf(
      tx,
      entity.id,
      supplier?.id ?? null,
      extraction.number,
      id,
      createdAt,
    );
    const status = duplicateOf ? 'duplicate' : 'captured';
    const source = sourceFor(mime, command.source);
    const lines = linesFromExtraction(extraction, account);
    const accountingDate = extraction.issue_date;
    const ocr = {
      extractor: extraction.extractor,
      model: extraction.model,
      supplier_name: extraction.supplier_name,
      supplier_tax_id: extraction.supplier_tax_id,
      buyer_tax_id: extraction.buyer_tax_id,
      confidence: extraction.confidence,
      overall: extraction.overall,
      totals_ok: extraction.totals_ok,
      vat_by_rate: extraction.vat_by_rate,
      suggested_category: category?.code ?? null,
      entity_mismatch: mismatch,
    };
    tx.write(sql`
      INSERT INTO purchasing.supplier_invoice (
        id, legal_entity_id, supplier_id, supplier_invoice_number, issue_date, accounting_date,
        received_at, source, status, category_code, currency, subtotal, tax_total, withholding_total,
        total, due_date, payment_method, ocr_extraction, ocr_confidence, duplicate_of_id, notes,
        created_by, created_at, updated_at
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${entity.id} AS UUID),
        CAST(${supplier?.id ?? null} AS UUID),
        ${extraction.number},
        CAST(${extraction.issue_date} AS DATE),
        CAST(${accountingDate} AS DATE),
        ${now},
        ${source},
        ${status},
        ${category?.code ?? null},
        ${extraction.currency},
        ${extraction.subtotal},
        ${extraction.tax_total},
        ${extraction.withholding_total},
        ${extraction.total},
        CAST(${extraction.due_date} AS DATE),
        ${extraction.payment_method},
        ${sql.json(ocr)},
        ${extraction.overall.toFixed(3)},
        CAST(${duplicateOf} AS UUID),
        ${command.notes},
        ${user.id},
        ${now},
        ${now}
      )
    `);
    tx.audit(auditInvoice(id, null, snapshot({
      status,
      supplierId: supplier?.id ?? null,
      number: extraction.number,
      total: extraction.total,
      duplicateOf,
    }), 'INSERT'));
    insertLines(tx, id, lines);
    const storedFile = await putAttachment(
      tx,
      { bytes: command.bytes, mime, name: command.filename },
      {
        table: 'purchasing.supplier_invoice',
        rowId: id,
        role: attachmentRole(source),
        createdBy: user.id,
      },
    );
    outbox(tx, 'purchasing.supplier_invoice.captured', id, entity.id, {
      status,
      source,
      supplier_id: supplier?.id ?? null,
      total: extraction.total,
      ocr_confidence: extraction.overall,
      extractor: extraction.extractor,
      duplicate_of_id: duplicateOf,
    }, now);
    const body = memoryView({
      id,
      entity,
      supplier,
      extraction,
      status,
      source,
      category,
      lines,
      duplicateOf,
      notes: command.notes,
      attachmentId: storedFile.id,
      mismatch,
      now,
    });
    tx.write(sql`
      INSERT INTO ops.idempotency_key (key, principal, route, request_sha256, status_code, response, created_at)
      VALUES (
        ${command.idempotencyKey},
        ${principal(user.id)},
        ${CAPTURE_ROUTE},
        ${command.requestHash},
        ${201},
        ${sql.json(body)},
        ${now}
      )
    `);
    return { status: 201, body };
  });
}

function memoryView(input: {
  id: string;
  entity: EntityHit;
  supplier: SupplierHit | null;
  extraction: Extraction;
  status: string;
  source: string;
  category: Category | null;
  lines: LineJson[];
  duplicateOf: string | null;
  notes: string | null;
  attachmentId: string;
  mismatch: boolean;
  now: Date;
}): InvoiceJson {
  const totalsOk = liveTotalsOk({
    subtotal: input.extraction.subtotal,
    taxTotal: input.extraction.tax_total,
    withholding: input.extraction.withholding_total,
    total: input.extraction.total,
  }, input.lines);
  const suggested = input.category != null;
  return {
    id: input.id,
    legal_entity_id: input.entity.id,
    legal_entity_code: input.entity.code,
    supplier_id: input.supplier?.id ?? null,
    supplier_name: input.supplier?.name ?? input.extraction.supplier_name,
    supplier_tax_id: input.supplier?.taxId ?? input.extraction.supplier_tax_id,
    supplier_invoice_number: input.extraction.number,
    issue_date: input.extraction.issue_date,
    accounting_date: input.extraction.issue_date,
    due_date: input.extraction.due_date,
    source: input.source,
    status: input.status,
    category_code: input.category?.code ?? null,
    category_suggested: suggested,
    organic_relevant: input.category?.organic ?? false,
    currency: input.extraction.currency,
    subtotal: input.extraction.subtotal,
    tax_total: input.extraction.tax_total,
    withholding_total: input.extraction.withholding_total,
    total: input.extraction.total,
    payment_method: input.extraction.payment_method,
    notes: input.notes,
    ocr_confidence: input.extraction.overall,
    confidence: input.extraction.confidence,
    extractor: input.extraction.extractor,
    model: input.extraction.model,
    totals_ok: totalsOk,
    warnings: warningsOf({
      status: input.status,
      totalsOk,
      confidence: input.extraction.overall,
      mismatch: input.mismatch,
      suggested,
      unmatched: input.supplier == null && input.extraction.supplier_tax_id != null,
    }),
    duplicate_of_id: input.duplicateOf,
    rejection_reason: null,
    attachment_id: input.attachmentId,
    lines: input.lines,
    validated_at: null,
    approved_at: null,
    created_at: input.now.toISOString(),
    updated_at: input.now.toISOString(),
  };
}

export async function listExpenseCategories(writer: Writer): Promise<{
  items: { code: string; name: string; default_account: string; organic_relevant: boolean }[];
}> {
  const rows = await writer.read<{
    code: string;
    name_es: string;
    default_account: string;
    organic_relevant: boolean;
  }>(sql`
    SELECT code, name_es, default_account, organic_relevant
    FROM purchasing.expense_category
    WHERE is_active
    ORDER BY name_es, code
  `);
  return {
    items: rows.map((row) => ({
      code: String(row.code),
      name: String(row.name_es),
      default_account: String(row.default_account),
      organic_relevant: row.organic_relevant === true,
    })),
  };
}

function monthFilter(raw: string | null): string | null {
  if (raw == null || raw.trim() === '') return null;
  const month = raw.trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) invalid({ month: 'El mes debe ser AAAA-MM' });
  return month;
}

async function categoryFilter(writer: Writer, raw: string | null): Promise<string | null> {
  if (raw == null || raw.trim() === '') return null;
  const code = raw.trim();
  if (!/^[a-z_]{2,30}$/.test(code)) invalid({ category: 'Categoría no válida' });
  const rows = await writer.read<{ code: string }>(sql`
    SELECT code FROM purchasing.expense_category WHERE code = ${code}
  `);
  if (!rows[0]) invalid({ category: 'Categoría no válida' });
  return code;
}

function searchFilter(raw: string | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.length > 80) invalid({ q: 'La búsqueda admite como máximo 80 caracteres' });
  const plain = trimmed.replace(/[%_\\]/g, '');
  if (plain === '') return null;
  return `%${plain}%`;
}

export async function getInvoice(writer: Writer, user: UserCtx, id: string): Promise<InvoiceJson> {
  return requireInvoice(writer.read.bind(writer), user, id, 'purchasing.read');
}

export async function listInvoices(writer: Writer, user: UserCtx, url: URL): Promise<{
  items: InvoiceJson[];
  next_cursor: string | null;
  total: number;
}> {
  const status = url.searchParams.get('status');
  if (status && !['captured', 'validated', 'approved', 'rejected', 'duplicate'].includes(status)) {
    invalid({ status: 'Estado no válido' });
  }
  const month = monthFilter(url.searchParams.get('month'));
  const category = await categoryFilter(writer, url.searchParams.get('category'));
  const needle = searchFilter(url.searchParams.get('q') ?? url.searchParams.get('search'));
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw == null || limitRaw === '' ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid({ limit: 'Debe estar entre 1 y 100' });
  const entityRef = url.searchParams.get('entity') ?? url.searchParams.get('legal_entity_id');
  const filters = ['TRUE'];
  if (status) filters.push(sql`i.status = ${status}`);
  if (!scopeAll(user, 'purchasing.read')) {
    const ids = user.roles.flatMap((role) =>
      role.legalEntityId && can(user, 'purchasing.read', role.legalEntityId) ? [role.legalEntityId.toLowerCase()] : []);
    if (ids.length === 0) return { items: [], next_cursor: null, total: 0 };
    filters.push(`i.legal_entity_id IN (${ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})`);
  }
  if (entityRef) {
    const resolved = await writer.read<{ id: unknown }>(UUID.test(entityRef)
      ? sql`SELECT id FROM core.legal_entity WHERE id = CAST(${entityRef.toLowerCase()} AS UUID)`
      : sql`SELECT id FROM core.legal_entity WHERE code = ${entityRef.trim().toUpperCase().replace(/\./g, '')}`);
    const entityId = resolved[0] ? String(resolved[0].id).toLowerCase() : null;
    if (!entityId) invalid({ entity: 'No se reconoce la entidad' });
    assertEntity(user, 'purchasing.read', entityId);
    filters.push(sql`i.legal_entity_id = CAST(${entityId} AS UUID)`);
  }
  if (month) filters.push(sql`left(CAST(COALESCE(i.issue_date, i.accounting_date) AS VARCHAR), 7) = ${month}`);
  if (category) filters.push(sql`i.category_code = ${category}`);
  if (needle) {
    filters.push(sql`(
      strip_accents(lower(coalesce(c.legal_name, ''))) LIKE strip_accents(lower(${needle}))
      OR strip_accents(lower(coalesce(c.trade_name, ''))) LIKE strip_accents(lower(${needle}))
      OR strip_accents(lower(coalesce(c.tax_id, ''))) LIKE strip_accents(lower(${needle}))
      OR strip_accents(lower(coalesce(i.supplier_invoice_number, ''))) LIKE strip_accents(lower(${needle}))
      OR strip_accents(lower(coalesce(json_extract_string(i.ocr_extraction, '$.supplier_name'), ''))) LIKE strip_accents(lower(${needle}))
      OR strip_accents(lower(coalesce(json_extract_string(i.ocr_extraction, '$.supplier_tax_id'), ''))) LIKE strip_accents(lower(${needle}))
    )`);
  }
  const where = filters.join(' AND ');
  const cursor = url.searchParams.get('cursor');
  let cursorSql = '';
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (!decoded) invalid({ cursor: 'El cursor no es válido' });
    cursorSql = sql` AND (
      i.updated_at < CAST(${decoded.at} AS TIMESTAMPTZ)
      OR (i.updated_at = CAST(${decoded.at} AS TIMESTAMPTZ) AND i.id < CAST(${decoded.id} AS UUID))
    )`;
  }
  const rows = await writer.read<{ id: unknown }>(`
    SELECT i.id
    FROM purchasing.supplier_invoice i
    LEFT JOIN party.contact c ON c.id = i.supplier_id
    WHERE ${where}${cursorSql}
    ORDER BY i.updated_at DESC, i.id DESC
    LIMIT ${limit + 1}
  `);
  const totalRows = await writer.read<{ total: unknown }>(`
    SELECT count(*) AS total
    FROM purchasing.supplier_invoice i
    LEFT JOIN party.contact c ON c.id = i.supplier_id
    WHERE ${where}
  `);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items: InvoiceJson[] = [];
  for (const row of page) {
    const id = String(row.id).toLowerCase();
    items.push(await requireInvoice(writer.read.bind(writer), user, id, 'purchasing.read'));
  }
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: hasMore && last ? encodeCursor(last.updated_at, last.id) : null,
    total: Number(totalRows[0]?.total ?? 0),
  };
}

function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(`${updatedAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { at: string; id: string } | null {
  try {
    const textValue = Buffer.from(cursor, 'base64url').toString('utf8');
    const split = textValue.lastIndexOf('|');
    if (split <= 0) return null;
    const at = textValue.slice(0, split);
    const id = textValue.slice(split + 1);
    if (!Number.isFinite(Date.parse(at)) || !UUID.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

type PatchLine = {
  description?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
  line_base?: unknown;
  vat_rate?: unknown;
  vat_quota?: unknown;
  withholding_rate?: unknown;
  expense_account?: unknown;
  vat_deductible_pct?: unknown;
};

function amountField(value: unknown, field: string): string {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : typeof value === 'string' ? value : null;
  const parsed = parseAmount(raw);
  if (!parsed) invalid({ [field]: 'Importe no válido' });
  return money2(parsed);
}

export async function patchInvoice(
  writer: Writer,
  actor: Actor,
  user: UserCtx,
  id: string,
  body: unknown,
  offered: string | null,
  now = new Date(),
): Promise<InvoiceJson> {
  const patch = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!patch) invalid({ body: 'El cuerpo debe ser un objeto' });
  if (!offered) invalid({ 'if-match': 'Falta la versión del gasto' });
  await writer.withWrite(actor, async (tx) => {
    const current = await requireInvoice(tx.read.bind(tx), user, id, 'purchasing.write');
    frozen(current.status);
    if (current.status === 'rejected' || current.status === 'duplicate') {
      invalid({ status: 'El gasto ya no se puede editar' });
    }
    if (!sameVersion(current.updated_at, offered)) throw domainError('WC_STALE_VERSION');
    let supplierId = current.supplier_id;
    if ('supplier_id' in patch) {
      const raw = patch.supplier_id;
      if (typeof raw !== 'string' || !UUID.test(raw)) invalid({ supplier_id: 'Proveedor no válido' });
      const rows = await tx.read<{ is_supplier: unknown; archived_at: unknown }>(sql`
        SELECT is_supplier, archived_at FROM party.contact WHERE id = CAST(${raw.toLowerCase()} AS UUID)
      `);
      const supplier = rows[0];
      if (!supplier || supplier.archived_at != null) invalid({ supplier_id: 'El proveedor no existe' });
      if (supplier.is_supplier !== true) invalid({ supplier_id: 'El contacto no es un proveedor' });
      supplierId = raw.toLowerCase();
    }
    const number = 'supplier_invoice_number' in patch
      ? clipRequired(patch.supplier_invoice_number, 'supplier_invoice_number', 60)
      : current.supplier_invoice_number;
    const issue = 'issue_date' in patch ? requireDate(patch.issue_date, 'issue_date') : current.issue_date;
    const accounting = 'accounting_date' in patch
      ? requireDate(patch.accounting_date, 'accounting_date')
      : current.accounting_date ?? issue;
    const due = 'due_date' in patch
      ? (patch.due_date == null || patch.due_date === '' ? null : requireDate(patch.due_date, 'due_date'))
      : current.due_date;
    let categoryCode = current.category_code;
    let account: string | null = null;
    if ('category_code' in patch) {
      if (typeof patch.category_code !== 'string') invalid({ category_code: 'Categoría no válida' });
      const category = await categoryByCode(tx, patch.category_code);
      if (!category) invalid({ category_code: 'Categoría no válida' });
      categoryCode = category.code;
      account = category.account;
    }
    const subtotal = 'subtotal' in patch ? amountField(patch.subtotal, 'subtotal') : current.subtotal;
    const taxTotal = 'tax_total' in patch ? amountField(patch.tax_total, 'tax_total') : current.tax_total;
    const withholding = 'withholding_total' in patch
      ? amountField(patch.withholding_total, 'withholding_total')
      : current.withholding_total;
    const total = 'total' in patch ? amountField(patch.total, 'total') : current.total;
    const payment = 'payment_method' in patch ? paymentOf(patch.payment_method) : current.payment_method;
    const notes = 'notes' in patch ? clipOptional(patch.notes, 'notes', 2000) : current.notes;
    let lines = current.lines;
    if ('lines' in patch) {
      if (!Array.isArray(patch.lines) || patch.lines.length === 0) invalid({ lines: 'Hace falta al menos una línea' });
      const fallback = account ?? lines[0]?.expense_account ?? '629';
      lines = patch.lines.map((line, index) => parsePatchLine(line, index, fallback));
    } else if (account && categoryCode !== current.category_code) {
      lines = lines.map((line) => ({ ...line, expense_account: account }));
    }
    const duplicateOf = await originalOf(tx, current.legal_entity_id, supplierId, number, current.id, current.created_at);
    const status = duplicateOf ? 'duplicate' : 'captured';
    // DuckDB reescribe la fila al cambiar una clave foránea (categoría o duplicado)
    // y entonces las líneas, que apuntan a la factura, lo impiden. Se quitan y se vuelven a crear.
    const rewriteLines = 'lines' in patch
      || categoryCode !== current.category_code
      || duplicateOf !== current.duplicate_of_id;
    if (rewriteLines) await takeLines(tx, current.id);
    if (rewriteLines) {
      tx.write(sql`
        UPDATE purchasing.supplier_invoice SET
          supplier_id = CAST(${supplierId} AS UUID),
          supplier_invoice_number = ${number},
          issue_date = CAST(${issue} AS DATE),
          accounting_date = CAST(${accounting} AS DATE),
          due_date = CAST(${due} AS DATE),
          category_code = ${categoryCode},
          subtotal = ${subtotal},
          tax_total = ${taxTotal},
          withholding_total = ${withholding},
          total = ${total},
          payment_method = ${payment},
          notes = ${notes},
          status = ${status},
          duplicate_of_id = CAST(${duplicateOf} AS UUID),
          validated_by = NULL,
          validated_at = NULL,
          updated_at = ${now}
        WHERE id = CAST(${current.id} AS UUID)
      `);
      insertLines(tx, current.id, lines);
    } else {
      tx.write(sql`
        UPDATE purchasing.supplier_invoice SET
          supplier_id = CAST(${supplierId} AS UUID),
          supplier_invoice_number = ${number},
          issue_date = CAST(${issue} AS DATE),
          accounting_date = CAST(${accounting} AS DATE),
          due_date = CAST(${due} AS DATE),
          subtotal = ${subtotal},
          tax_total = ${taxTotal},
          withholding_total = ${withholding},
          total = ${total},
          payment_method = ${payment},
          notes = ${notes},
          status = ${status},
          validated_by = NULL,
          validated_at = NULL,
          updated_at = ${now}
        WHERE id = CAST(${current.id} AS UUID)
      `);
    }
    tx.audit(auditInvoice(current.id, snapshot({
      status: current.status,
      supplierId: current.supplier_id,
      number: current.supplier_invoice_number,
      total: current.total,
      duplicateOf: current.duplicate_of_id,
    }), snapshot({ status, supplierId, number, total, duplicateOf }), 'UPDATE'));
  });
  return getInvoice(writer, user, id);
}

function clipRequired(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') invalid({ [field]: 'Texto no válido' });
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > max || trimmed.includes('\0')) invalid({ [field]: 'Texto no válido' });
  return trimmed;
}

function clipOptional(value: unknown, field: string, max: number): string | null {
  if (value == null || value === '') return null;
  return clipRequired(value, field, max);
}

function requireDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid({ [field]: 'Fecha no válida' });
  return value;
}

function paymentOf(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !['transfer', 'direct_debit', 'card', 'cash', 'other'].includes(value)) {
    invalid({ payment_method: 'Forma de pago no válida' });
  }
  return value;
}

function parsePatchLine(value: unknown, index: number, account: string): LineJson {
  const line = value && typeof value === 'object' ? value as PatchLine : null;
  if (!line) invalid({ lines: `La línea ${index + 1} no es válida` });
  const description = clipRequired(line.description, 'lines', 500);
  const lineBase = amountField(line.line_base, 'lines');
  const vatRate = amountField(line.vat_rate, 'lines');
  const vatQuota = amountField(line.vat_quota, 'lines');
  const quantity = line.quantity == null ? '1.000' : amountField(line.quantity, 'lines');
  const unitPrice = line.unit_price == null ? lineBase : amountField(line.unit_price, 'lines');
  const withholding = line.withholding_rate == null ? '0.00' : amountField(line.withholding_rate, 'lines');
  const deductible = line.vat_deductible_pct == null ? '100.00' : amountField(line.vat_deductible_pct, 'lines');
  const deductibleNumber = Number(deductible);
  if (deductibleNumber < 0 || deductibleNumber > 100) invalid({ lines: 'El IVA deducible debe estar entre 0 y 100' });
  const expense = typeof line.expense_account === 'string' && ACCOUNT.test(line.expense_account)
    ? line.expense_account
    : account;
  if (!ACCOUNT.test(expense)) invalid({ lines: 'La cuenta de gasto no es válida' });
  return {
    line_no: index + 1,
    description,
    quantity,
    unit_price: unitPrice,
    line_base: lineBase,
    vat_rate: vatRate,
    vat_quota: vatQuota,
    withholding_rate: withholding,
    vat_deductible_pct: deductible,
    expense_account: expense,
  };
}

async function assertReady(tx: Tx, invoice: InvoiceJson): Promise<void> {
  const fields: Record<string, string> = {};
  if (!invoice.supplier_id) fields.supplier_id = 'El proveedor es obligatorio';
  if (!invoice.supplier_invoice_number) fields.supplier_invoice_number = 'El número de factura es obligatorio';
  if (!invoice.issue_date) fields.issue_date = 'La fecha de expedición es obligatoria';
  if (!invoice.accounting_date && !invoice.issue_date) fields.accounting_date = 'La fecha contable es obligatoria';
  if (!invoice.category_code) fields.category_code = 'La categoría de gasto es obligatoria';
  if (invoice.currency !== 'EUR') fields.currency = 'La moneda debe ser EUR';
  if (!invoice.total) fields.total = 'El total es obligatorio';
  else if (dec(invoice.total).lt(0)) fields.total = 'El total no puede ser negativo';
  if (invoice.lines.length === 0) fields.lines = 'Hace falta al menos una línea';
  else if (!invoice.totals_ok) fields.lines = 'La suma de las líneas no cuadra con el total (± 0,01 €)';
  if (invoice.supplier_id) {
    const rows = await tx.read<{ is_supplier: unknown; archived_at: unknown }>(sql`
      SELECT is_supplier, archived_at FROM party.contact WHERE id = CAST(${invoice.supplier_id} AS UUID)
    `);
    const supplier = rows[0];
    if (!supplier || supplier.archived_at != null || supplier.is_supplier !== true) {
      fields.supplier_id = 'El contacto no es un proveedor';
    }
  }
  if (Object.keys(fields).length > 0) invalid(fields);
}

export async function validateInvoice(
  writer: Writer,
  actor: Actor,
  user: UserCtx,
  id: string,
  offered: string | null,
  now = new Date(),
): Promise<InvoiceJson> {
  await writer.withWrite(actor, async (tx) => {
    const current = await requireInvoice(tx.read.bind(tx), user, id, 'purchasing.write');
    if (current.status === 'validated') return;
    frozen(current.status);
    if (current.status !== 'captured') invalid({ status: 'El gasto no se puede validar en este estado' });
    if (!offered) invalid({ 'if-match': 'Falta la versión del gasto' });
    if (!sameVersion(current.updated_at, offered)) throw domainError('WC_STALE_VERSION');
    const accounting = current.accounting_date ?? current.issue_date;
    const prepared = { ...current, accounting_date: accounting };
    await assertReady(tx, prepared);
    const duplicateOf = await originalOf(
      tx,
      current.legal_entity_id,
      current.supplier_id,
      current.supplier_invoice_number,
      current.id,
      current.created_at,
    );
    if (duplicateOf) {
      await takeLines(tx, current.id);
      tx.write(sql`
        UPDATE purchasing.supplier_invoice SET
          status = 'duplicate',
          duplicate_of_id = CAST(${duplicateOf} AS UUID),
          accounting_date = CAST(${accounting} AS DATE),
          updated_at = ${now}
        WHERE id = CAST(${current.id} AS UUID)
      `);
      insertLines(tx, current.id, current.lines);
      tx.audit(auditInvoice(current.id, { status: 'captured' }, { status: 'duplicate', duplicate_of_id: duplicateOf }, 'UPDATE'));
      return;
    }
    tx.write(sql`
      UPDATE purchasing.supplier_invoice SET
        status = 'validated',
        accounting_date = CAST(${accounting} AS DATE),
        validated_by = CAST(${user.id} AS UUID),
        validated_at = ${now},
        updated_at = ${now}
      WHERE id = CAST(${current.id} AS UUID)
    `);
    tx.audit(auditInvoice(current.id, { status: 'captured' }, { status: 'validated', validated_by: user.id }, 'UPDATE'));
    const twins = await tx.read<{ id: unknown }>(sql`
      SELECT id FROM purchasing.supplier_invoice
      WHERE legal_entity_id = CAST(${current.legal_entity_id} AS UUID)
        AND supplier_id = CAST(${current.supplier_id} AS UUID)
        AND supplier_invoice_number = ${current.supplier_invoice_number}
        AND id <> CAST(${current.id} AS UUID)
        AND status = 'captured'
    `);
    for (const twin of twins) {
      const twinId = String(twin.id).toLowerCase();
      const loaded = await load(tx.read.bind(tx), twinId);
      if (!loaded || String(loaded.row.status) !== 'captured') continue;
      await takeLines(tx, twinId);
      tx.write(sql`
        UPDATE purchasing.supplier_invoice SET
          status = 'duplicate',
          duplicate_of_id = CAST(${current.id} AS UUID),
          updated_at = ${now}
        WHERE id = CAST(${twinId} AS UUID) AND status = 'captured'
      `);
      insertLines(tx, twinId, loaded.lines);
      tx.audit(auditInvoice(twinId, { status: 'captured' }, { status: 'duplicate', duplicate_of_id: current.id }, 'UPDATE'));
    }
  });
  return getInvoice(writer, user, id);
}

export async function approveInvoice(
  writer: Writer,
  actor: Actor,
  user: UserCtx,
  id: string,
  offered: string | null,
  hook: SupplierInvoiceApprovalHook,
  now = new Date(),
): Promise<InvoiceJson> {
  await writer.withWrite(actor, async (tx) => {
    const current = await requireInvoice(tx.read.bind(tx), user, id, 'purchasing.approve');
    if (current.status === 'approved') return;
    frozen(current.status);
    if (current.status !== 'validated') invalid({ status: 'Solo se aprueba un gasto validado' });
    if (!offered) invalid({ 'if-match': 'Falta la versión del gasto' });
    if (!sameVersion(current.updated_at, offered)) throw domainError('WC_STALE_VERSION');
    const duplicateOf = await originalOf(
      tx,
      current.legal_entity_id,
      current.supplier_id,
      current.supplier_invoice_number,
      current.id,
      current.created_at,
    );
    if (duplicateOf) {
      await takeLines(tx, current.id);
      tx.write(sql`
        UPDATE purchasing.supplier_invoice SET
          status = 'duplicate',
          duplicate_of_id = CAST(${duplicateOf} AS UUID),
          validated_by = NULL,
          validated_at = NULL,
          updated_at = ${now}
        WHERE id = CAST(${current.id} AS UUID)
      `);
      insertLines(tx, current.id, current.lines);
      tx.audit(auditInvoice(current.id, { status: 'validated' }, { status: 'duplicate', duplicate_of_id: duplicateOf }, 'UPDATE'));
      return;
    }
    tx.write(sql`
      UPDATE purchasing.supplier_invoice SET
        status = 'approved',
        approved_by = CAST(${user.id} AS UUID),
        approved_at = ${now},
        updated_at = ${now}
      WHERE id = CAST(${current.id} AS UUID)
    `);
    tx.audit(auditInvoice(current.id, { status: 'validated' }, { status: 'approved', approved_by: user.id }, 'UPDATE'));
    outbox(tx, 'purchasing.supplier_invoice.approved', current.id, current.legal_entity_id, {
      status: 'approved',
      supplier_id: current.supplier_id,
      total: current.total,
      accounting_date: current.accounting_date,
    }, now);
    const approved: ApprovedSupplierInvoice = {
      id: current.id,
      legalEntityId: current.legal_entity_id,
      supplierId: current.supplier_id ?? '',
      supplierInvoiceNumber: current.supplier_invoice_number ?? '',
      accountingDate: current.accounting_date ?? '',
      currency: current.currency,
      subtotal: current.subtotal ?? '0.00',
      taxTotal: current.tax_total ?? '0.00',
      withholdingTotal: current.withholding_total,
      total: current.total ?? '0.00',
      categoryCode: current.category_code ?? '',
    };
    await hook.onApproved(approved);
  });
  return getInvoice(writer, user, id);
}

export async function rejectInvoice(
  writer: Writer,
  actor: Actor,
  user: UserCtx,
  id: string,
  offered: string | null,
  reason: unknown,
  now = new Date(),
): Promise<InvoiceJson> {
  const textReason = typeof reason === 'string' ? reason.trim() : '';
  if (textReason.length < 3 || textReason.length > 500) invalid({ reason: 'El motivo es obligatorio' });
  await writer.withWrite(actor, async (tx) => {
    const current = await requireInvoice(tx.read.bind(tx), user, id, 'purchasing.write');
    if (current.status === 'rejected') return;
    frozen(current.status);
    if (current.status !== 'captured' && current.status !== 'validated') {
      invalid({ status: 'El gasto no se puede rechazar en este estado' });
    }
    if (!offered) invalid({ 'if-match': 'Falta la versión del gasto' });
    if (!sameVersion(current.updated_at, offered)) throw domainError('WC_STALE_VERSION');
    tx.write(sql`
      UPDATE purchasing.supplier_invoice SET
        status = 'rejected',
        rejection_reason = ${textReason},
        updated_at = ${now}
      WHERE id = CAST(${current.id} AS UUID)
    `);
    tx.audit(auditInvoice(current.id, { status: current.status }, { status: 'rejected' }, 'UPDATE'));
  });
  return getInvoice(writer, user, id);
}

export async function findEntity(writer: Writer, ref: string): Promise<{ id: string; code: string } | null> {
  const rows = await writer.read<{ id: unknown; code: unknown }>(UUID.test(ref)
    ? sql`SELECT id, code FROM core.legal_entity WHERE id = CAST(${ref.toLowerCase()} AS UUID) AND is_active`
    : sql`SELECT id, code FROM core.legal_entity WHERE code = ${ref.trim().toUpperCase().replace(/\./g, '')} AND is_active`);
  const row = rows[0];
  if (!row) return null;
  return { id: String(row.id).toLowerCase(), code: String(row.code) };
}
