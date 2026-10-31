import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { DomainError, domainError } from '../errors';
import { money } from '../money';
import { decimalOf, day, flag, idOf, importeOf, isUuid, jsonObject, moneyText, text } from './format';

type Read = Pick<Tx, 'read'>;

export interface BookCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface BookRow {
  invoiceId: string;
  base: string;
  quota: string;
  surcharge: string;
}

/**
 * Cuadres del libro de emitidas. Si Verifactu está apagado, el tercer cuadre
 * no exige registros: el módulo no los genera (P.O hasta el 30-06-2027).
 */
export function reconcileBook(input: {
  invoices: { id: string; importeTotal: string; verifactuRecordId: string | null }[];
  rows: readonly BookRow[];
  model303: { base: string; quota: string; surcharge: string };
  verifactuEnabled: boolean;
}): BookCheck[] {
  const byInvoice = new Map<string, { base: ReturnType<typeof decimalOf>; quota: ReturnType<typeof decimalOf>; surcharge: ReturnType<typeof decimalOf> }>();
  for (const row of input.rows) {
    const current = byInvoice.get(row.invoiceId) ?? {
      base: decimalOf('0'),
      quota: decimalOf('0'),
      surcharge: decimalOf('0'),
    };
    current.base = money.add(current.base, decimalOf(row.base));
    current.quota = money.add(current.quota, decimalOf(row.quota));
    current.surcharge = money.add(current.surcharge, decimalOf(row.surcharge));
    byInvoice.set(row.invoiceId, current);
  }
  let invoiceSum = decimalOf('0');
  let rowSum = decimalOf('0');
  let missing = 0;
  const known = new Set(input.invoices.map((invoice) => invoice.id));
  for (const invoice of input.invoices) {
    invoiceSum = money.add(invoiceSum, decimalOf(invoice.importeTotal));
    const grouped = byInvoice.get(invoice.id);
    if (!grouped) {
      missing += 1;
      continue;
    }
    rowSum = money.add(rowSum, money.add(money.add(grouped.base, grouped.quota), grouped.surcharge));
  }
  let foreign = 0;
  for (const id of byInvoice.keys()) {
    if (!known.has(id)) foreign += 1;
  }
  const bookOk = missing === 0 && foreign === 0 && invoiceSum.eq(rowSum);
  let base = decimalOf('0');
  let quota = decimalOf('0');
  let surcharge = decimalOf('0');
  for (const row of input.rows) {
    base = money.add(base, decimalOf(row.base));
    quota = money.add(quota, decimalOf(row.quota));
    surcharge = money.add(surcharge, decimalOf(row.surcharge));
  }
  const modelOk = base.eq(decimalOf(input.model303.base))
    && quota.eq(decimalOf(input.model303.quota))
    && surcharge.eq(decimalOf(input.model303.surcharge));
  const recorded = input.invoices.filter((invoice) => invoice.verifactuRecordId != null).length;
  const verifactuOk = input.verifactuEnabled ? recorded === input.invoices.length : true;
  return [
    {
      name: 'libro_vs_facturas',
      ok: bookOk,
      detail: bookOk
        ? `Libro y facturas cuadran en ${money.toString(invoiceSum)}`
        : `El libro (${money.toString(rowSum)}) no suma las facturas (${money.toString(invoiceSum)})`,
    },
    {
      name: 'desglose_303',
      ok: modelOk,
      detail: modelOk
        ? 'El desglose del 303 suma lo mismo que el libro'
        : 'El desglose del 303 no suma lo mismo que el libro',
    },
    {
      name: 'verifactu',
      ok: verifactuOk,
      detail: input.verifactuEnabled
        ? (verifactuOk
          ? 'Cada factura del libro tiene registro Verifactu'
          : `Faltan registros Verifactu (${recorded} de ${input.invoices.length})`)
        : 'Verifactu está apagado: no hay registros que cuadrar',
    },
  ];
}

export async function exportIssuedBook(
  db: Read,
  input: { entityId: string; from: string; to: string },
): Promise<{ csv: string; checks: BookCheck[] }> {
  if (!isUuid(input.entityId)) throw domainError('WC_VALIDATION', { entity: 'Identificador no válido' });
  const invoices = await db.read(sql`
    SELECT i.id, i.number, i.issue_date, i.operation_date, i.invoice_type, i.status,
           i.subtotal, i.tax_total, i.surcharge_total, i.withholding_total, i.total,
           i.customer_snapshot, i.verifactu_record_id, c.legal_name, c.tax_id
    FROM billing.invoice i
    LEFT JOIN party.contact c ON c.id = i.customer_id
    WHERE i.legal_entity_id = CAST(${input.entityId} AS UUID)
      AND i.status IN ('issued', 'voided')
      AND i.issue_date >= CAST(${input.from} AS DATE)
      AND i.issue_date <= CAST(${input.to} AS DATE)
    ORDER BY i.issue_date, i.number
  `);
  const ids = invoices.map((row) => idOf(row.id));
  const taxes = ids.length === 0 ? [] : await db.read(`
    SELECT invoice_id, tax_code, regime_key, rate, base, quota, surcharge_rate, surcharge_quota,
           exemption, qualification, withholding
    FROM billing.invoice_tax
    WHERE invoice_id IN (${ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})
    ORDER BY tax_code
  `);
  const rects = ids.length === 0 ? [] : await db.read(`
    SELECT rectifying_invoice_id, rectified_number, rectified_issue_date
    FROM billing.invoice_rectification
    WHERE rectifying_invoice_id IN (${ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ')})
    ORDER BY rectified_issue_date, rectified_number
  `);
  const enabled = await db.read<{ enabled: unknown }>(sql`
    SELECT enabled FROM core.module_state WHERE module_key = 'verifactu'
  `);
  const verifactuEnabled = flag(enabled[0]?.enabled);
  const rows: BookRow[] = [];
  const lines: string[][] = [];
  let modelBase = decimalOf('0');
  let modelQuota = decimalOf('0');
  let modelSurcharge = decimalOf('0');
  const bookInvoices: { id: string; importeTotal: string; verifactuRecordId: string | null }[] = [];
  for (const invoice of invoices) {
    const id = idOf(invoice.id);
    const importe = importeOf(moneyText(invoice.subtotal), moneyText(invoice.tax_total), moneyText(invoice.surcharge_total))
      ?? moneyText(invoice.total)
      ?? '0.00';
    bookInvoices.push({
      id,
      importeTotal: importe,
      verifactuRecordId: invoice.verifactu_record_id == null ? null : idOf(invoice.verifactu_record_id),
    });
    const ownTaxes = taxes.filter((row) => idOf(row.invoice_id) === id);
    const ownRects = rects.filter((row) => idOf(row.rectifying_invoice_id) === id);
    const snapshot = jsonObject(invoice.customer_snapshot);
    const taxId = text(snapshot?.tax_id) ?? text(invoice.tax_id) ?? '';
    const name = text(snapshot?.name) ?? text(invoice.legal_name) ?? '';
    const rectified = ownRects
      .map((row) => `${String(row.rectified_number)} (${day(row.rectified_issue_date) ?? ''})`)
      .join(' | ');
    const ejercicio = (day(invoice.issue_date) ?? input.from).slice(0, 4);
    const periodo = periodLabel(day(invoice.issue_date) ?? input.from, input.from, input.to);
    if (ownTaxes.length === 0) {
      rows.push({ invoiceId: id, base: '0.00', quota: '0.00', surcharge: '0.00' });
      lines.push(csvLine({
        ejercicio, periodo, invoice, name, taxId, rectified, importe,
        withholding: moneyText(invoice.withholding_total) ?? '0.00',
        first: true,
        tax: null,
      }));
      continue;
    }
    ownTaxes.forEach((tax, index) => {
      const base = moneyText(tax.base) ?? '0.00';
      const quota = moneyText(tax.quota) ?? '0.00';
      const surcharge = moneyText(tax.surcharge_quota) ?? '0.00';
      rows.push({ invoiceId: id, base, quota, surcharge });
      modelBase = money.add(modelBase, decimalOf(base));
      modelQuota = money.add(modelQuota, decimalOf(quota));
      modelSurcharge = money.add(modelSurcharge, decimalOf(surcharge));
      lines.push(csvLine({
        ejercicio, periodo, invoice, name, taxId, rectified, importe,
        withholding: moneyText(invoice.withholding_total) ?? '0.00',
        first: index === 0,
        tax,
      }));
    });
  }
  const checks = reconcileBook({
    invoices: bookInvoices,
    rows,
    model303: {
      base: money.toString(modelBase),
      quota: money.toString(modelQuota),
      surcharge: money.toString(modelSurcharge),
    },
    verifactuEnabled,
  });
  if (checks.some((check) => !check.ok)) {
    const error = domainError('WC_INV_BOOK');
    throw new DomainError(error.code, error.httpStatus, error.message, undefined, {
      checks: checks.map((check) => ({ name: check.name, ok: check.ok, detail: check.detail })),
    });
  }
  const header = [
    'Ejercicio', 'Periodo', 'Fecha expedición', 'Fecha operación', 'Número', 'Tipo', 'Estado',
    'Facturas rectificadas', 'NIF', 'Nombre', 'Clave régimen', 'Base', 'Tipo impositivo', 'Cuota',
    'Tipo recargo', 'Cuota recargo', 'Exención', 'Calificación', 'Total factura', 'Retención',
    'Cobro', 'CSV Verifactu',
  ];
  const csv = `\uFEFF${[header, ...lines].map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`;
  return { csv, checks };
}

function csvLine(input: {
  ejercicio: string;
  periodo: string;
  invoice: Record<string, unknown>;
  name: string;
  taxId: string;
  rectified: string;
  importe: string;
  withholding: string;
  first: boolean;
  tax: Record<string, unknown> | null;
}): string[] {
  return [
    input.ejercicio,
    input.periodo,
    day(input.invoice.issue_date) ?? '',
    day(input.invoice.operation_date) ?? '',
    text(input.invoice.number) ?? '',
    String(input.invoice.invoice_type),
    String(input.invoice.status),
    input.rectified,
    input.taxId,
    input.name,
    input.tax ? String(input.tax.regime_key) : '',
    input.tax ? moneyText(input.tax.base) ?? '' : '',
    input.tax ? moneyText(input.tax.rate) ?? '' : '',
    input.tax ? moneyText(input.tax.quota) ?? '' : '',
    input.tax ? moneyText(input.tax.surcharge_rate) ?? '' : '',
    input.tax ? moneyText(input.tax.surcharge_quota) ?? '' : '',
    input.tax ? text(input.tax.exemption) ?? '' : '',
    input.tax ? text(input.tax.qualification) ?? '' : '',
    input.first ? input.importe : '',
    input.first ? input.withholding : '',
    '',
    '',
  ];
}

function periodLabel(issueDate: string, from: string, to: string): string {
  const quarter = quarterOf(from, to);
  if (quarter) return quarter;
  return String(Number(issueDate.slice(5, 7)));
}

function quarterOf(from: string, to: string): string | null {
  const start = /^(\d{4})-(\d{2})-01$/.exec(from);
  const end = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!start || !end || start[1] !== end[1]) return null;
  const month = Number(start[2]);
  const endMonth = Number(end[2]);
  if (endMonth !== month + 2) return null;
  if (month === 1) return '1T';
  if (month === 4) return '2T';
  if (month === 7) return '3T';
  if (month === 10) return '4T';
  return null;
}

function csvCell(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function periodBounds(period: string): { from: string; to: string; ejercicio: string; periodo: string } | null {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period);
  if (quarter?.[1] && quarter[2]) {
    const year = Number(quarter[1]);
    const q = Number(quarter[2]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      from: `${quarter[1]}-${pad(startMonth)}-01`,
      to: `${quarter[1]}-${pad(endMonth)}-${daysInMonth(year, endMonth)}`,
      ejercicio: quarter[1],
      periodo: `${q}T`,
    };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month?.[1] && month[2]) {
    const year = Number(month[1]);
    const value = Number(month[2]);
    if (value < 1 || value > 12) return null;
    return {
      from: `${month[1]}-${month[2]}-01`,
      to: `${month[1]}-${month[2]}-${daysInMonth(year, value)}`,
      ejercicio: month[1],
      periodo: String(value),
    };
  }
  return null;
}

function pad(month: number): string {
  return String(month).padStart(2, '0');
}

function daysInMonth(year: number, month: number): string {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return String(days[month - 1] ?? 30);
}
