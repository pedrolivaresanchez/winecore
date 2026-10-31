import { Decimal } from 'decimal.js';
import { domainError } from '../errors';
import { sql } from '../db/sql';
import { add, dec, money2, near } from './amounts';

export type Readable = {
  read<T = Record<string, unknown>>(statement: string): Promise<T[]>;
};

export type BookInvoice = {
  id: string;
  number: string;
  issueDate: string;
  accountingDate: string;
  categoryName: string;
  taxId: string;
  supplierName: string;
  subtotal: string;
  taxTotal: string;
  withholdingTotal: string;
  total: string;
};

export type BookLine = {
  vatRate: string;
  lineBase: string;
  vatQuota: string;
};

export type ReceivedBook = {
  csv: string;
  totals: {
    invoices: number;
    base: string;
    quota: string;
    withholding: string;
    total: string;
  };
};

const QUARTERS = [
  { from: '01-01', to: '03-31' },
  { from: '04-01', to: '06-30' },
  { from: '07-01', to: '09-30' },
  { from: '10-01', to: '12-31' },
] as const;

const HEADER = [
  'Ejercicio',
  'Periodo',
  'Fecha de expedición',
  'Número',
  'Tipo',
  'NIF',
  'Nombre',
  'Régimen',
  'Base',
  'Tipo IVA',
  'Cuota',
  'Recargo',
  'Total factura',
  'Retención',
];

export function parseQuarter(period: string): { from: string; to: string; year: number; quarter: number } | null {
  const match = /^(\d{4})-?[TtQq]([1-4])$/u.exec(period.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const bounds = QUARTERS[quarter - 1];
  if (!year || !bounds) return null;
  return { year, quarter, from: `${match[1]}-${bounds.from}`, to: `${match[1]}-${bounds.to}` };
}

function csv(value: string): string {
  if (/[;"\r\n]/u.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function amount(value: string): string {
  return money2(dec(value)).replace('.', ',');
}

function spanishDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

function lineWithholding(base: string, rate: string): Decimal {
  return dec(base).times(dec(rate)).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Libro de facturas recibidas. Solo debe recibir gastos aprobados del periodo.
 * Si una factura no cuadra con sus líneas, no se exporta.
 * Régimen 01: supuesto de régimen general hasta que la asesoría fije el formato.
 */
export function renderReceivedBook(
  period: { year: number; quarter: number },
  invoices: readonly BookInvoice[],
  linesByInvoice: ReadonlyMap<string, readonly (BookLine & { withholdingRate: string })[]>,
): ReceivedBook {
  const rows: string[] = [];
  let base = new Decimal(0);
  let quota = new Decimal(0);
  let withholding = new Decimal(0);
  let total = new Decimal(0);
  const periodo = `${period.quarter}T`;

  for (const invoice of invoices) {
    const lines = linesByInvoice.get(invoice.id) ?? [];
    const lineBase = add(lines.map((line) => dec(line.lineBase)));
    const lineVat = add(lines.map((line) => dec(line.vatQuota)));
    const lineWithheld = add(lines.map((line) => lineWithholding(line.lineBase, line.withholdingRate)));
    const computed = lineBase.plus(lineVat).minus(lineWithheld);
    const consistent = lines.length > 0
      && near(lineBase, dec(invoice.subtotal))
      && near(lineVat, dec(invoice.taxTotal))
      && near(lineWithheld, dec(invoice.withholdingTotal))
      && near(computed, dec(invoice.total));
    if (!consistent) {
      throw domainError('WC_VALIDATION', { book: 'El libro no cuadra con los gastos aprobados' });
    }
    const groups = new Map<string, { base: Decimal; quota: Decimal }>();
    for (const line of lines) {
      const rate = money2(dec(line.vatRate));
      const current = groups.get(rate) ?? { base: new Decimal(0), quota: new Decimal(0) };
      current.base = current.base.plus(dec(line.lineBase));
      current.quota = current.quota.plus(dec(line.vatQuota));
      groups.set(rate, current);
    }
    const rates = [...groups.entries()].sort((left, right) => dec(left[0]).comparedTo(dec(right[0])));
    for (const [rate, amounts] of rates) {
      rows.push([
        String(period.year),
        periodo,
        spanishDate(invoice.issueDate),
        invoice.number,
        invoice.categoryName,
        invoice.taxId,
        invoice.supplierName,
        '01',
        amount(money2(amounts.base)),
        amount(rate),
        amount(money2(amounts.quota)),
        amount('0.00'),
        amount(invoice.total),
        amount(invoice.withholdingTotal),
      ].map(csv).join(';'));
      base = base.plus(amounts.base);
      quota = quota.plus(amounts.quota);
    }
    withholding = withholding.plus(dec(invoice.withholdingTotal));
    total = total.plus(dec(invoice.total));
  }

  const csvText = `\uFEFF${[HEADER.join(';'), ...rows].join('\r\n')}\r\n`;
  return {
    csv: csvText,
    totals: {
      invoices: invoices.length,
      base: money2(base),
      quota: money2(quota),
      withholding: money2(withholding),
      total: money2(total),
    },
  };
}

export async function exportReceivedBook(
  tx: Readable,
  input: { entityId: string; from: string; to: string },
): Promise<ReceivedBook> {
  const quarter = quarterOf(input.from, input.to);
  const invoices = await tx.read<{
    id: unknown;
    supplier_invoice_number: unknown;
    issue_date: unknown;
    accounting_date: unknown;
    subtotal: unknown;
    tax_total: unknown;
    withholding_total: unknown;
    total: unknown;
    tax_id: unknown;
    legal_name: unknown;
    category_name: unknown;
  }>(sql`
    SELECT i.id, i.supplier_invoice_number, i.issue_date, i.accounting_date,
           i.subtotal, i.tax_total, i.withholding_total, i.total,
           c.tax_id, c.legal_name, e.name_es AS category_name
    FROM purchasing.supplier_invoice i
    JOIN party.contact c ON c.id = i.supplier_id
    LEFT JOIN purchasing.expense_category e ON e.code = i.category_code
    WHERE i.legal_entity_id = CAST(${input.entityId} AS UUID)
      AND i.status = 'approved'
      AND i.accounting_date >= CAST(${input.from} AS DATE)
      AND i.accounting_date <= CAST(${input.to} AS DATE)
    ORDER BY i.accounting_date, i.supplier_invoice_number, i.id
  `);
  const ids = invoices.map((row) => String(row.id).toLowerCase());
  const lineRows = ids.length === 0 ? [] : await tx.read<{
    supplier_invoice_id: unknown;
    vat_rate: unknown;
    line_base: unknown;
    vat_quota: unknown;
    withholding_rate: unknown;
  }>(`
    SELECT supplier_invoice_id, vat_rate, line_base, vat_quota, withholding_rate
    FROM purchasing.supplier_invoice_line
    WHERE supplier_invoice_id IN (${ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})
    ORDER BY supplier_invoice_id, line_no
  `);
  const lines = new Map<string, (BookLine & { withholdingRate: string })[]>();
  for (const row of lineRows) {
    const id = String(row.supplier_invoice_id).toLowerCase();
    const list = lines.get(id) ?? [];
    list.push({
      vatRate: String(row.vat_rate),
      lineBase: String(row.line_base),
      vatQuota: String(row.vat_quota),
      withholdingRate: String(row.withholding_rate),
    });
    lines.set(id, list);
  }
  const books = invoices.map((row) => ({
    id: String(row.id).toLowerCase(),
    number: String(row.supplier_invoice_number),
    issueDate: String(row.issue_date).slice(0, 10),
    accountingDate: String(row.accounting_date).slice(0, 10),
    categoryName: row.category_name == null ? '' : String(row.category_name),
    taxId: row.tax_id == null ? '' : String(row.tax_id),
    supplierName: row.legal_name == null ? '' : String(row.legal_name),
    subtotal: String(row.subtotal),
    taxTotal: String(row.tax_total),
    withholdingTotal: String(row.withholding_total),
    total: String(row.total),
  }));
  return renderReceivedBook(quarter, books, lines);
}

function quarterOf(from: string, to: string): { year: number; quarter: number } {
  for (let index = 0; index < QUARTERS.length; index += 1) {
    const bounds = QUARTERS[index];
    if (!bounds) continue;
    const year = from.slice(0, 4);
    if (from === `${year}-${bounds.from}` && to === `${year}-${bounds.to}`) {
      return { year: Number(year), quarter: index + 1 };
    }
  }
  const year = Number(from.slice(0, 4));
  return { year: Number.isInteger(year) ? year : 0, quarter: 0 };
}
