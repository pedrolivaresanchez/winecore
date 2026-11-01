import Decimal from 'decimal.js';
import type { UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { dateOf, intOf, money2 } from './overview';
import { entityPredicate, legacyScope } from './scope';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface LegacyLine {
  line_no: number;
  sku: string | null;
  description: string | null;
  quantity: string | null;
  unit_price: string | null;
  line_base: string | null;
  tax_code: string | null;
}

export interface LegacyInvoiceDetail {
  id: string;
  number: string;
  issue_date: string;
  due_date: string | null;
  counterparty_name: string;
  counterparty_contact_id: string | null;
  description: string | null;
  subtotal: string;
  vat: string;
  withholding: string;
  total: string;
  paid: string | null;
  pending: string | null;
  status_holded: string;
  kind: string;
  entity_code: string;
  legal_entity_id: string;
  lines: LegacyLine[];
}

export interface HoldedSeller {
  legalName: string;
  taxId: string;
  addressLine: string;
  postalCode: string;
  city: string;
  province: string;
}

export interface HoldedInvoiceLoaded {
  detail: LegacyInvoiceDetail;
  seller: HoldedSeller;
}

export interface HoldedDocumentLoaded {
  detail: LegacyDocumentDetail;
  seller: HoldedSeller;
}

export interface LegacyDocumentDetail {
  id: string;
  number: string;
  issue_date: string;
  due_date: string | null;
  counterparty_name: string;
  counterparty_contact_id: string | null;
  description: string | null;
  subtotal: string;
  vat: string;
  withholding: string | null;
  total: string;
  status_holded: string;
  kind: 'quote' | 'delivery_note';
  entity_code: string;
  legal_entity_id: string;
  lines: LegacyLine[];
}

export async function loadLegacyInvoice(writer: Writer, user: UserCtx, rawId: string): Promise<LegacyInvoiceDetail> {
  return (await readHoldedInvoice(writer, user, rawId)).detail;
}

export async function readHoldedInvoice(writer: Writer, user: UserCtx, rawId: string): Promise<HoldedInvoiceLoaded> {
  const id = parseId(rawId);
  const scope = entityPredicate(legacyScope(user, 'both'));
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT h.id, h.entity_id, h.kind, h.number,
           CAST(h.issue_date AS VARCHAR) AS issue_date,
           CAST(h.due_date AS VARCHAR) AS due_date,
           h.counterparty_name, CAST(h.counterparty_contact_id AS VARCHAR) AS counterparty_contact_id, h.description,
           CAST(h.subtotal AS VARCHAR) AS subtotal,
           CAST(h.vat AS VARCHAR) AS vat,
           CAST(h.withholding AS VARCHAR) AS withholding,
           CAST(h.total AS VARCHAR) AS total,
           CAST(h.paid AS VARCHAR) AS paid,
           CAST(h.pending AS VARCHAR) AS pending,
           h.status_holded,
           e.code AS entity_code,
           e.legal_name, e.tax_id, e.address_line, e.postal_code, e.city, e.province
      FROM legacy.holded_invoice h
      JOIN core.legal_entity e ON e.id = h.entity_id
     WHERE h.id = CAST(${sql`${id}`} AS UUID)
       AND ${scope}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const issueDate = dateOf(row.issue_date);
  const kind = String(row.kind ?? '');
  const number = String(row.number ?? '');
  const lines = await loadLines(writer, String(row.entity_id), kind, number, issueDate);
  return {
    seller: sellerOf(row),
    detail: {
      id: String(row.id),
      number,
      issue_date: issueDate,
      due_date: dayOrNull(row.due_date),
      counterparty_name: String(row.counterparty_name ?? ''),
      counterparty_contact_id: uuidOrNull(row.counterparty_contact_id),
      description: textOrNull(row.description),
      subtotal: money2(row.subtotal),
      vat: money2(row.vat),
      withholding: money2(row.withholding),
      total: money2(row.total),
      paid: moneyOrNull(row.paid),
      pending: moneyOrNull(row.pending),
      status_holded: String(row.status_holded ?? ''),
      kind,
      entity_code: String(row.entity_code ?? ''),
      legal_entity_id: String(row.entity_id),
      lines,
    },
  };
}

export async function loadLegacyDocument(writer: Writer, user: UserCtx, rawId: string): Promise<LegacyDocumentDetail> {
  return (await readHoldedDocument(writer, user, rawId)).detail;
}

export async function readHoldedDocument(writer: Writer, user: UserCtx, rawId: string): Promise<HoldedDocumentLoaded> {
  const id = parseId(rawId);
  const scope = entityPredicate(legacyScope(user, 'both'));
  const quote = await writer.read<Record<string, unknown>>(`
    SELECT h.id, h.entity_id, h.number,
           CAST(h.issue_date AS VARCHAR) AS issue_date,
           CAST(h.valid_until AS VARCHAR) AS due_date,
           h.counterparty_name, CAST(h.counterparty_contact_id AS VARCHAR) AS counterparty_contact_id, h.description,
           CAST(h.subtotal AS VARCHAR) AS subtotal,
           CAST(h.vat AS VARCHAR) AS vat,
           CAST(h.total AS VARCHAR) AS total,
           h.status_holded,
           e.code AS entity_code,
           e.legal_name, e.tax_id, e.address_line, e.postal_code, e.city, e.province
      FROM legacy.holded_quote h
      JOIN core.legal_entity e ON e.id = h.entity_id
     WHERE h.id = CAST(${sql`${id}`} AS UUID)
       AND ${scope}
  `);
  if (quote[0]) return documentOf(writer, quote[0], 'quote');
  const note = await writer.read<Record<string, unknown>>(`
    SELECT h.id, h.entity_id, h.number,
           CAST(h.issue_date AS VARCHAR) AS issue_date,
           COALESCE(NULLIF(trim(h.destination), ''), NULLIF(trim(h.description), ''), '') AS counterparty_name,
           h.description,
           CAST(h.subtotal AS VARCHAR) AS subtotal,
           CAST(h.vat AS VARCHAR) AS vat,
           CAST(h.withholding AS VARCHAR) AS withholding,
           CAST(h.total AS VARCHAR) AS total,
           h.invoiced_status AS status_holded,
           e.code AS entity_code,
           e.legal_name, e.tax_id, e.address_line, e.postal_code, e.city, e.province
      FROM legacy.holded_delivery_note h
      JOIN core.legal_entity e ON e.id = h.entity_id
     WHERE h.id = CAST(${sql`${id}`} AS UUID)
       AND ${scope}
  `);
  const row = note[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return documentOf(writer, row, 'delivery_note');
}

async function documentOf(
  writer: Writer,
  row: Record<string, unknown>,
  kind: 'quote' | 'delivery_note',
): Promise<HoldedDocumentLoaded> {
  const issueDate = dateOf(row.issue_date);
  const number = String(row.number ?? '');
  const lines = await loadLines(writer, String(row.entity_id), kind, number, issueDate);
  return {
    seller: sellerOf(row),
    detail: {
      id: String(row.id),
      number,
      issue_date: issueDate,
      due_date: dayOrNull(row.due_date),
      counterparty_name: String(row.counterparty_name ?? ''),
      counterparty_contact_id: uuidOrNull(row.counterparty_contact_id),
      description: textOrNull(row.description),
      subtotal: money2(row.subtotal),
      vat: money2(row.vat),
      withholding: kind === 'delivery_note' ? moneyOrNull(row.withholding) : null,
      total: money2(row.total),
      status_holded: String(row.status_holded ?? ''),
      kind,
      entity_code: String(row.entity_code ?? ''),
      legal_entity_id: String(row.entity_id),
      lines,
    },
  };
}

function sellerOf(row: Record<string, unknown>): HoldedSeller {
  return {
    legalName: String(row.legal_name ?? ''),
    taxId: String(row.tax_id ?? ''),
    addressLine: String(row.address_line ?? ''),
    postalCode: String(row.postal_code ?? ''),
    city: String(row.city ?? ''),
    province: String(row.province ?? ''),
  };
}

/**
 * Una línea pertenece a la cabecera cuando coinciden sociedad, tipo
 * (venta, compra, presupuesto o albarán), número y fecha del documento.
 */
async function loadLines(
  writer: Writer,
  entityId: string,
  kind: string,
  number: string,
  issueDate: string,
): Promise<LegacyLine[]> {
  if (!DAY_RE.test(issueDate) || !UUID_RE.test(entityId)) return [];
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT l.line_seq, l.sku, l.description, l.item,
           CAST(l.units AS VARCHAR) AS units,
           CAST(l.subtotal AS VARCHAR) AS subtotal,
           l.tax_rate_label
      FROM legacy.holded_invoice_line l
     WHERE l.entity_id = CAST(${sql`${entityId}`} AS UUID)
       AND l.kind = ${sql`${kind}`}
       AND l.document_number = ${sql`${number}`}
       AND l.document_date = CAST(${sql`${issueDate}`} AS DATE)
     ORDER BY l.line_seq
  `);
  return rows.map(lineOf);
}

function lineOf(row: Record<string, unknown>): LegacyLine {
  return {
    line_no: intOf(row.line_seq),
    sku: textOrNull(row.sku),
    description: textOrNull(row.description) ?? textOrNull(row.item),
    quantity: quantityOf(row.units),
    unit_price: unitPriceOf(row.subtotal, row.units),
    line_base: row.subtotal == null || row.subtotal === '' ? null : money2(row.subtotal),
    tax_code: textOrNull(row.tax_rate_label),
  };
}

function parseId(raw: string): string {
  const id = raw.trim().toLowerCase();
  if (!UUID_RE.test(id)) throw domainError('WC_NOT_FOUND');
  return id;
}

function dayOrNull(value: unknown): string | null {
  if (value == null || value === '') return null;
  const day = dateOf(value);
  return DAY_RE.test(day) ? day : null;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function uuidOrNull(value: unknown): string | null {
  const text = textOrNull(value);
  return text != null && UUID_RE.test(text) ? text.toLowerCase() : null;
}

function moneyOrNull(value: unknown): string | null {
  if (value == null || value === '') return null;
  return money2(value);
}

function quantityOf(value: unknown): string | null {
  if (value == null || value === '') return null;
  try {
    const decimal = new Decimal(String(value));
    if (!decimal.isFinite()) return null;
    const fixed = decimal.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
    return fixed.replace(/(\.\d*?)0+$/u, '$1').replace(/\.$/u, '');
  } catch {
    return null;
  }
}

function unitPriceOf(base: unknown, units: unknown): string | null {
  if (base == null || base === '' || units == null || units === '') return null;
  try {
    const quantity = new Decimal(String(units));
    const lineBase = new Decimal(String(base));
    if (!quantity.isFinite() || quantity.isZero() || !lineBase.isFinite()) return null;
    const price = lineBase.div(quantity).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
    const trimmed = price.toFixed(6).replace(/(\.\d*?)0+$/u, '$1').replace(/\.$/u, '');
    const [whole, frac = ''] = trimmed.split('.');
    if (frac.length >= 2) return `${whole}.${frac}`;
    return `${whole}.${frac.padEnd(2, '0')}`;
  } catch {
    return null;
  }
}
