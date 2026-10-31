import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { norm } from './amounts';
import { dataWindow, type ModelCode, type Period } from './period';
import type {
  CashIn,
  EntityProfile,
  FiscalPack,
  IssuedDoc,
  ReceivedDoc,
  ReceivedLine,
  TaxSlice,
} from './types';

type Read = Pick<Tx, 'read'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadPack(
  db: Read,
  entity: EntityProfile,
  model: ModelCode,
  period: Period,
): Promise<FiscalPack> {
  const window = dataWindow(model, period);
  const [issued, received, cash, verifactuEnabled] = await Promise.all([
    loadIssued(db, entity.id, window.from, window.to),
    loadReceived(db, entity.id, window.from, window.to),
    loadCash(db, entity.id, window.from, window.to),
    loadVerifactu(db),
  ]);
  return { entity, period, issued, received, cash, verifactuEnabled };
}

export async function resolveEntity(db: Read, token: string): Promise<EntityProfile> {
  const key = token.trim();
  const rows = await db.read<Record<string, unknown>>(UUID.test(key)
    ? sql`
      SELECT id::VARCHAR AS id, code, person_type, income_tax
      FROM core.legal_entity
      WHERE id = CAST(${key} AS UUID) OR code = ${key.toUpperCase()}
    `
    : sql`
      SELECT id::VARCHAR AS id, code, person_type, income_tax
      FROM core.legal_entity
      WHERE code = ${key.toUpperCase()}
    `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND', { entity: 'No existe esa entidad' });
  const personType = String(row.person_type);
  const incomeTax = String(row.income_tax);
  if ((personType !== 'natural' && personType !== 'legal') || (incomeTax !== 'IRPF' && incomeTax !== 'IS')) {
    throw domainError('WC_VALIDATION', { entity: 'La entidad no tiene un régimen reconocible' });
  }
  return { id: String(row.id).toLowerCase(), code: String(row.code), personType, incomeTax };
}

async function loadIssued(db: Read, entityId: string, from: string, to: string): Promise<IssuedDoc[]> {
  const invoices = await db.read<Record<string, unknown>>(sql`
    SELECT i.id::VARCHAR AS id, i.number, i.issue_date::VARCHAR AS issue_date,
           i.operation_date::VARCHAR AS operation_date, i.invoice_type,
           i.customer_id::VARCHAR AS customer_id, i.customer_snapshot::VARCHAR AS customer_snapshot,
           i.subtotal::VARCHAR AS subtotal, i.tax_total::VARCHAR AS tax_total,
           i.surcharge_total::VARCHAR AS surcharge_total, i.withholding_total::VARCHAR AS withholding_total,
           i.total::VARCHAR AS total,
           c.legal_name, c.tax_id, c.country_code, c.include_in_m347
    FROM billing.invoice i
    LEFT JOIN party.contact c ON c.id = i.customer_id
    WHERE i.legal_entity_id = CAST(${entityId} AS UUID)
      AND i.status = 'issued'
      AND i.issue_date >= CAST(${from} AS DATE)
      AND i.issue_date <= CAST(${to} AS DATE)
    ORDER BY i.issue_date, i.number, i.id
  `);
  const ids = invoices.map((row) => String(row.id).toLowerCase());
  const taxes = ids.length === 0 ? [] : await db.read<Record<string, unknown>>(`
    SELECT invoice_id::VARCHAR AS invoice_id, tax_code, regime_key, rate::VARCHAR AS rate,
           base::VARCHAR AS base, quota::VARCHAR AS quota, surcharge_rate::VARCHAR AS surcharge_rate,
           surcharge_quota::VARCHAR AS surcharge_quota, exemption, qualification, withholding::VARCHAR AS withholding
    FROM billing.invoice_tax
    WHERE invoice_id IN (${ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})
    ORDER BY tax_code
  `);
  const rects = ids.length === 0 ? [] : await db.read<Record<string, unknown>>(`
    SELECT rectifying_invoice_id::VARCHAR AS rectifying_invoice_id, rectified_number,
           rectified_issue_date::VARCHAR AS rectified_issue_date
    FROM billing.invoice_rectification
    WHERE rectifying_invoice_id IN (${ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})
    ORDER BY rectified_issue_date, rectified_number
  `);
  const records = ids.length === 0 ? [] : await db.read<Record<string, unknown>>(`
    SELECT invoice_id::VARCHAR AS invoice_id, send_status, aeat_csv
    FROM regulatory.verifactu_record
    WHERE record_type = 'alta'
      AND invoice_id IN (${ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})
  `);
  const byInvoice = group(taxes, 'invoice_id');
  const rectByInvoice = group(rects, 'rectifying_invoice_id');
  const recordByInvoice = new Map<string, { status: string; csv: string | null }>();
  for (const row of records) {
    const id = String(row.invoice_id).toLowerCase();
    const status = String(row.send_status);
    const current = recordByInvoice.get(id);
    if (!current || rank(status) >= rank(current.status)) {
      recordByInvoice.set(id, { status, csv: row.aeat_csv == null ? current?.csv ?? null : String(row.aeat_csv) });
    }
  }
  return invoices.map((row) => {
    const id = String(row.id).toLowerCase();
    const snapshot = jsonObject(row.customer_snapshot);
    const record = recordByInvoice.get(id);
    return {
      id,
      number: text(row.number),
      issueDate: day(row.issue_date),
      operationDate: row.operation_date == null ? null : day(row.operation_date),
      invoiceType: text(row.invoice_type),
      customerId: row.customer_id == null ? null : String(row.customer_id).toLowerCase(),
      customerName: text(snapshot.name) || text(row.legal_name),
      customerTaxId: text(snapshot.tax_id) || text(row.tax_id),
      customerCountry: text(snapshot.country) || text(row.country_code) || 'ES',
      includeIn347: flag(row.include_in_m347, true),
      subtotal: moneyOf(row.subtotal),
      taxTotal: moneyOf(row.tax_total),
      surchargeTotal: moneyOf(row.surcharge_total),
      withholdingTotal: moneyOf(row.withholding_total),
      total: moneyOf(row.total),
      verifactuStatus: record?.status ?? null,
      verifactuCsv: record?.csv ?? null,
      rectified: (rectByInvoice.get(id) ?? []).map((item) => ({
        number: text(item.rectified_number),
        issueDate: day(item.rectified_issue_date),
      })),
      taxes: (byInvoice.get(id) ?? []).map(taxOf),
    };
  });
}

async function loadReceived(db: Read, entityId: string, from: string, to: string): Promise<ReceivedDoc[]> {
  const invoices = await db.read<Record<string, unknown>>(sql`
    SELECT i.id::VARCHAR AS id, i.supplier_invoice_number, i.issue_date::VARCHAR AS issue_date,
           i.accounting_date::VARCHAR AS accounting_date, i.category_code,
           i.subtotal::VARCHAR AS subtotal, i.tax_total::VARCHAR AS tax_total,
           i.withholding_total::VARCHAR AS withholding_total, i.total::VARCHAR AS total,
           i.supplier_id::VARCHAR AS supplier_id,
           c.legal_name, c.tax_id, c.tax_id_type, c.country_code, c.vat_regime, c.include_in_m347,
           e.name_es AS category_name
    FROM purchasing.supplier_invoice i
    JOIN party.contact c ON c.id = i.supplier_id
    LEFT JOIN purchasing.expense_category e ON e.code = i.category_code
    WHERE i.legal_entity_id = CAST(${entityId} AS UUID)
      AND i.status = 'approved'
      AND i.accounting_date >= CAST(${from} AS DATE)
      AND i.accounting_date <= CAST(${to} AS DATE)
    ORDER BY i.accounting_date, i.supplier_invoice_number, i.id
  `);
  const ids = invoices.map((row) => String(row.id).toLowerCase());
  const lineRows = ids.length === 0 ? [] : await db.read<Record<string, unknown>>(`
    SELECT supplier_invoice_id::VARCHAR AS supplier_invoice_id, vat_rate::VARCHAR AS vat_rate,
           line_base::VARCHAR AS line_base, vat_quota::VARCHAR AS vat_quota,
           withholding_rate::VARCHAR AS withholding_rate, vat_deductible_pct::VARCHAR AS vat_deductible_pct
    FROM purchasing.supplier_invoice_line
    WHERE supplier_invoice_id IN (${ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})
    ORDER BY supplier_invoice_id, line_no
  `);
  const byInvoice = group(lineRows, 'supplier_invoice_id');
  return invoices.map((row) => {
    const id = String(row.id).toLowerCase();
    const lines: ReceivedLine[] = (byInvoice.get(id) ?? []).map((line) => ({
      rate: moneyOf(line.vat_rate),
      base: moneyOf(line.line_base),
      quota: moneyOf(line.vat_quota),
      withholdingRate: moneyOf(line.withholding_rate),
      deductiblePct: moneyOf(line.vat_deductible_pct),
    }));
    return {
      id,
      number: text(row.supplier_invoice_number),
      issueDate: day(row.issue_date),
      accountingDate: day(row.accounting_date),
      categoryCode: text(row.category_code),
      categoryName: text(row.category_name),
      supplierId: String(row.supplier_id).toLowerCase(),
      supplierName: text(row.legal_name),
      supplierTaxId: text(row.tax_id),
      supplierTaxIdType: text(row.tax_id_type),
      supplierCountry: text(row.country_code) || 'ES',
      supplierVatRegime: text(row.vat_regime) || 'general',
      includeIn347: flag(row.include_in_m347, true),
      subtotal: moneyOf(row.subtotal),
      taxTotal: moneyOf(row.tax_total),
      withholdingTotal: moneyOf(row.withholding_total),
      total: moneyOf(row.total),
      lines,
    };
  });
}

async function loadCash(db: Read, entityId: string, from: string, to: string): Promise<CashIn[]> {
  const rows = await db.read<Record<string, unknown>>(sql`
    SELECT p.id::VARCHAR AS id, p.counterparty_id::VARCHAR AS counterparty_id,
           p.amount::VARCHAR AS amount, p.value_date::VARCHAR AS value_date,
           c.legal_name, c.tax_id, c.country_code, c.include_in_m347
    FROM finance.payment p
    LEFT JOIN party.contact c ON c.id = p.counterparty_id
    WHERE p.legal_entity_id = CAST(${entityId} AS UUID)
      AND p.direction = 'in'
      AND p.method = 'cash'
      AND p.status = 'registered'
      AND p.reverses_payment_id IS NULL
      AND p.value_date >= CAST(${from} AS DATE)
      AND p.value_date <= CAST(${to} AS DATE)
    ORDER BY p.value_date, p.id
  `);
  return rows.map((row) => ({
    id: String(row.id).toLowerCase(),
    counterpartyId: row.counterparty_id == null ? null : String(row.counterparty_id).toLowerCase(),
    name: text(row.legal_name),
    taxId: text(row.tax_id),
    country: text(row.country_code) || 'ES',
    includeIn347: flag(row.include_in_m347, true),
    amount: moneyOf(row.amount),
    valueDate: day(row.value_date),
  }));
}

async function loadVerifactu(db: Read): Promise<boolean> {
  const rows = await db.read<{ enabled: unknown }>(sql`
    SELECT enabled FROM core.module_state WHERE module_key = 'verifactu'
  `);
  return flag(rows[0]?.enabled, false);
}

function taxOf(row: Record<string, unknown>): TaxSlice {
  return {
    taxCode: text(row.tax_code),
    regimeKey: text(row.regime_key),
    rate: moneyOf(row.rate),
    base: moneyOf(row.base),
    quota: moneyOf(row.quota),
    surchargeRate: moneyOf(row.surcharge_rate),
    surchargeQuota: moneyOf(row.surcharge_quota),
    exemption: row.exemption == null || row.exemption === '' ? null : String(row.exemption),
    qualification: row.qualification == null || row.qualification === '' ? null : String(row.qualification),
    withholding: moneyOf(row.withholding),
  };
}

function group(rows: Record<string, unknown>[], key: string): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const id = String(row[key]).toLowerCase();
    const list = map.get(id) ?? [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}

function rank(status: string): number {
  if (status === 'accepted' || status === 'accepted_with_errors') return 2;
  if (status === 'pending' || status === 'sending') return 1;
  return 0;
}

function jsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === 'string' ? safeJson(value) : value;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  return {};
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function day(value: unknown): string {
  if (value instanceof Date) {
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const date = String(value.getUTCDate()).padStart(2, '0');
    return `${value.getUTCFullYear()}-${month}-${date}`;
  }
  return String(value ?? '').slice(0, 10);
}

function moneyOf(value: unknown): string {
  if (value == null || value === '') return '0.00';
  return norm(String(value));
}

function flag(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (value === true || value === 1 || value === 'true' || value === 't') return true;
  if (value === false || value === 0 || value === 'false' || value === 'f') return false;
  return fallback;
}
