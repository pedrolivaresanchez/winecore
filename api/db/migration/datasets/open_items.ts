import { Decimal } from 'decimal.js';
import type { KbClient } from '../../../src/core/db/client';
import { sql } from '../../../src/core/db/sql';
import { canonicalJson } from '../../../src/core/db/audit';
import { newId } from '../../../src/core/ids';
import type { WriteOp } from '../apply';
import {
  cleanText,
  daysBetween,
  fixedMoney,
  integerText,
  money,
  moneyOrZero,
  parseDate,
  yearOf,
} from '../money';
import { bump, positive, type MigrationReport, type MigrationSource } from '../report';
import type { HoldedTable } from '../xlsx';

export interface InvoiceExpected {
  subtotal: string;
  vat: string;
  vat2: string;
  withholding: string;
  total: string;
  pending: string;
  openAmount: string;
  openCount: number;
  invoices: number;
}

interface PreparedInvoice {
  id: string;
  number: string;
  rawNumber: string;
  issueDate: string;
  operationDate: string | null;
  accountingDate: string | null;
  dueDate: string | null;
  counterparty: string;
  contactId: string | null;
  description: string | null;
  tags: string | null;
  account: string | null;
  payment: string | null;
  subtotal: Decimal;
  vat: Decimal;
  vat2: Decimal | null;
  withholding: Decimal;
  surcharge: Decimal;
  total: Decimal;
  paid: Decimal;
  pending: Decimal;
  status: string;
  paidOn: string | null;
  face: string | null;
  anomaly: string | null;
  open: boolean;
  raw: Record<string, string>;
}

export function measureInvoices(table: HoldedTable): {
  rows: number;
  byYear: Record<string, { documents: number; subtotal: string; vat: string; vat_2: string; total: string; pending: string }>;
  openCount: number;
  openAmount: string;
} {
  const buckets = new Map<string, { documents: number; subtotal: Decimal; vat: Decimal; vat2: Decimal; total: Decimal; pending: Decimal }>();
  let openCount = 0;
  let openAmount = new Decimal(0);
  for (const row of table.rows) {
    const issue = parseDate(row.Fecha ?? row['Fecha emisión']);
    if (!issue || integerText(row.Num) === '') throw new Error('INVOICE_KEY');
    const year = String(yearOf(issue));
    const bucket = buckets.get(year) ?? { documents: 0, subtotal: new Decimal(0), vat: new Decimal(0), vat2: new Decimal(0), total: new Decimal(0), pending: new Decimal(0) };
    bucket.documents += 1;
    bucket.subtotal = bucket.subtotal.plus(moneyOrZero(row.Subtotal));
    bucket.vat = bucket.vat.plus(moneyOrZero(row.IVA));
    bucket.vat2 = bucket.vat2.plus(moneyOrZero(row.IVA_2));
    bucket.total = bucket.total.plus(moneyOrZero(row.Total));
    const pending = moneyOrZero(row.Pendiente);
    bucket.pending = bucket.pending.plus(pending);
    buckets.set(year, bucket);
    const status = cleanText(row.Estado);
    if (pending.gt(0) && status.toLowerCase() !== 'anulado') {
      openCount += 1;
      openAmount = openAmount.plus(pending);
    }
  }
  const byYear: Record<string, { documents: number; subtotal: string; vat: string; vat_2: string; total: string; pending: string }> = {};
  for (const [year, bucket] of buckets) {
    byYear[year] = {
      documents: bucket.documents,
      subtotal: fixedMoney(bucket.subtotal),
      vat: fixedMoney(bucket.vat),
      vat_2: fixedMoney(bucket.vat2),
      total: fixedMoney(bucket.total),
      pending: fixedMoney(bucket.pending),
    };
  }
  return { rows: table.rows.length, byYear, openCount, openAmount: fixedMoney(openAmount) };
}

export async function planOpenItems(input: {
  client: KbClient;
  source: MigrationSource;
  entity: string;
  entityId: string;
  fileSha256: string;
  table: HoldedTable;
  actorId: string;
  now: Date;
  batchId: string;
}): Promise<{ ops: WriteOp[]; report: MigrationReport; expected: InvoiceExpected; batchId: string }> {
  const kind = input.table.headers.includes('Proveedor') || input.table.headers.includes('Pagado') ? 'purchase' : 'sale';
  const names = await contactNames(input.client, input.entityId, input.entity);
  const warnings: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const prepared = prepareRows(input.table, names, warnings, skipped);
  const expected = totalsOf(prepared);
  const ops: WriteOp[] = [];
  const surchargeContacts = new Set<string>();
  for (const row of prepared) {
    ops.push(invoiceInsert(row, input, kind));
    if (row.open) ops.push(openInsert(row, input, kind));
    if (row.contactId && row.surcharge.gt(0) && yearOf(row.issueDate) >= 2025 && yearOf(row.issueDate) <= 2026) {
      surchargeContacts.add(row.contactId);
    }
  }
  for (const contactId of surchargeContacts) {
    ops.push({
      sql: sql`
        UPDATE party.contact
        SET vat_regime = 'equivalence_surcharge', updated_at = ${input.now}
        WHERE id = CAST(${contactId} AS UUID) AND vat_regime = 'general'
      `,
      audit: {
        table: 'party.contact',
        rowId: contactId,
        action: 'UPDATE',
        before: null,
        after: { vat_regime: 'equivalence_surcharge' },
      },
    });
  }
  const aged = agedOpen(prepared, input.table.exportGeneratedAt);
  const report: MigrationReport = {
    source: input.source,
    entity: input.entity,
    dataset: 'open_items',
    file_sha256: input.fileSha256,
    rows_read: input.table.rows.length,
    created: expected.openCount,
    merged_duplicates: 0,
    proposals_pending: 0,
    nif_warnings: 0,
    skipped: positive(skipped),
    warnings: positive(warnings),
    totals: {
      subtotal: expected.subtotal,
      vat: expected.vat,
      vat_2: expected.vat2,
      withholding_abs: expected.withholding,
      total: expected.total,
      pending: expected.pending,
      open_amount: expected.openAmount,
      aged_open_amount: fixedMoney(aged.amount),
    },
    resulting: {
      invoices: expected.invoices,
      open_items: expected.openCount,
      aged_open: aged.count,
      surcharge_regime: surchargeContacts.size,
      direction: kind === 'sale' ? 1 : 0,
    },
  };
  return { ops, report, expected, batchId: input.batchId };
}

export async function assertInvoiceCuadre(client: KbClient, batchId: string, expected: InvoiceExpected): Promise<void> {
  const header = await client.query<Record<string, unknown>>(sql`
    SELECT
      COALESCE(SUM(subtotal), 0) AS subtotal,
      COALESCE(SUM(vat), 0) AS vat,
      COALESCE(SUM(vat_2), 0) AS vat_2,
      COALESCE(SUM(withholding), 0) AS withholding,
      COALESCE(SUM(total), 0) AS total,
      COALESCE(SUM(pending), 0) AS pending,
      COUNT(*) AS invoices
    FROM legacy.holded_invoice
    WHERE batch_id = CAST(${batchId} AS UUID)
  `);
  const open = await client.query<Record<string, unknown>>(sql`
    SELECT COALESCE(SUM(oi.amount), 0) AS amount, COUNT(*) AS n
    FROM legacy.open_item oi
    JOIN legacy.holded_invoice i ON i.id = oi.holded_invoice_id
    WHERE i.batch_id = CAST(${batchId} AS UUID)
  `);
  const row = header[0] ?? {};
  const openRow = open[0] ?? {};
  const checks: Array<[string, string, unknown]> = [
    ['subtotal', expected.subtotal, row.subtotal],
    ['vat', expected.vat, row.vat],
    ['vat_2', expected.vat2, row.vat_2],
    ['withholding', expected.withholding, row.withholding],
    ['total', expected.total, row.total],
    ['pending', expected.pending, row.pending],
    ['invoices', String(expected.invoices), row.invoices],
    ['open_amount', expected.openAmount, openRow.amount],
    ['open_count', String(expected.openCount), openRow.n],
  ];
  for (const [name, want, got] of checks) {
    if (!sameAmount(want, got)) throw new Error(`CUADRE ${name} expected=${want} actual=${asAmount(got)}`);
  }
}

function prepareRows(
  table: HoldedTable,
  names: Map<string, string | 'ambiguous'>,
  warnings: Record<string, number>,
  skipped: Record<string, number>,
): PreparedInvoice[] {
  const kind = table.headers.includes('Proveedor') ? 'purchase' : 'sale';
  const parsed: Array<PreparedInvoice & { parsedYear: number | null; seq: number | null; series: string; suffix: boolean }> = [];
  const numberCount = new Map<string, number>();
  const seenKey = new Map<string, number>();
  for (const row of table.rows) {
    const issue = parseDate(row.Fecha ?? row['Fecha emisión']);
    const rawNumber = integerText(row.Num);
    if (!issue || rawNumber === '') throw new Error('INVOICE_KEY');
    numberCount.set(rawNumber, (numberCount.get(rawNumber) ?? 0) + 1);
    const identity = `${rawNumber}|${issue}`;
    const occurrence = (seenKey.get(identity) ?? 0) + 1;
    seenKey.set(identity, occurrence);
    const number = occurrence === 1 ? rawNumber : `${rawNumber}#${occurrence}`;
    const parsedNumber = parseInvoiceNumber(rawNumber);
    const counterparty = cleanText(kind === 'purchase' ? row.Proveedor : row.Cliente);
    const link = names.get(counterparty);
    let contactId: string | null = null;
    if (!link) bump(warnings, 'UNMATCHED_CONTACT');
    else if (link === 'ambiguous') bump(warnings, 'AMBIGUOUS_CONTACT');
    else contactId = link;
    const paidOn = parseDate(row['Fecha de cobro'] ?? row['Fecha de pago']);
    if (paidOn && table.exportGeneratedAt && paidOn > table.exportGeneratedAt.slice(0, 10)) bump(warnings, 'SUSPICIOUS_DATE');
    const status = cleanText(row.Estado) || 'Pendiente';
    const pending = moneyOrZero(row.Pendiente);
    const open = pending.gt(0) && status.toLowerCase() !== 'anulado';
    if (!open) {
      if (status.toLowerCase() === 'anulado') bump(skipped, 'cancelled');
      else if (pending.lt(0)) bump(skipped, 'negative_pending');
      else bump(skipped, 'zero_pending');
    }
    if (parsedNumber.suffix) bump(warnings, 'number_suffix');
    if (parsedNumber.year !== null && parsedNumber.year !== yearOf(issue)) bump(warnings, 'number_year_mismatch');
    const vat2raw = table.headers.includes('IVA_2') ? moneyOrZero(row.IVA_2) : null;
    parsed.push({
      id: newId(),
      number,
      rawNumber,
      issueDate: issue,
      operationDate: parseDate(row['Fecha operación']),
      accountingDate: parseDate(row['Fecha contable']),
      dueDate: parseDate(row.Vencimiento),
      counterparty: counterparty || 'Sin nombre',
      contactId,
      description: cleanText(row['Descripción']) || null,
      tags: cleanText(row.Tags) || null,
      account: cleanText(row.Cuenta) || null,
      payment: cleanText(row['F.Pago']) || null,
      subtotal: moneyOrZero(row.Subtotal),
      vat: moneyOrZero(row.IVA),
      vat2: vat2raw,
      withholding: moneyOrZero(row['Retención']).abs(),
      surcharge: moneyOrZero(row['Rec. de eq.']),
      total: moneyOrZero(row.Total),
      paid: moneyOrZero(row.Cobrado ?? row.Pagado),
      pending,
      status,
      paidOn,
      face: cleanText(row.FACe) || null,
      anomaly: null,
      open,
      raw: row,
      parsedYear: parsedNumber.year,
      seq: parsedNumber.seq,
      series: parsedNumber.series,
      suffix: parsedNumber.suffix,
    });
  }
  const bySeries = new Map<string, typeof parsed>();
  for (const row of parsed) {
    if (row.seq === null) continue;
    const list = bySeries.get(row.series) ?? [];
    list.push(row);
    bySeries.set(row.series, list);
  }
  for (const list of bySeries.values()) {
    const ordered = [...list].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (!previous || !current || previous.seq === null || current.seq === null) continue;
      if (current.seq - previous.seq > 1) {
        bump(warnings, 'number_gap');
        current.anomaly = current.anomaly ?? 'gap_before';
      }
    }
  }
  for (const row of parsed) {
    const duplicate = (numberCount.get(row.rawNumber) ?? 0) > 1 || row.number !== row.rawNumber;
    const yearMismatch = row.parsedYear !== null && row.parsedYear !== yearOf(row.issueDate);
    if (duplicate) {
      row.anomaly = 'duplicate';
      bump(warnings, 'number_duplicate');
    } else if (row.suffix) row.anomaly = 'suffix';
    else if (yearMismatch) row.anomaly = 'year_mismatch';
  }
  return parsed;
}

function totalsOf(rows: readonly PreparedInvoice[]): InvoiceExpected {
  const sum = (pick: (row: PreparedInvoice) => Decimal) => fixedMoney(rows.reduce((acc, row) => acc.plus(pick(row)), new Decimal(0)));
  const openRows = rows.filter((row) => row.open);
  return {
    subtotal: sum((row) => row.subtotal),
    vat: sum((row) => row.vat),
    vat2: sum((row) => row.vat2 ?? new Decimal(0)),
    withholding: sum((row) => row.withholding),
    total: sum((row) => row.total),
    pending: sum((row) => row.pending),
    openAmount: fixedMoney(openRows.reduce((acc, row) => acc.plus(row.pending), new Decimal(0))),
    openCount: openRows.length,
    invoices: rows.length,
  };
}

function agedOpen(rows: readonly PreparedInvoice[], exportGeneratedAt: string | null): { count: number; amount: Decimal } {
  if (!exportGeneratedAt) return { count: 0, amount: new Decimal(0) };
  const cutoff = exportGeneratedAt.slice(0, 10);
  let count = 0;
  let amount = new Decimal(0);
  for (const row of rows) {
    if (!row.open) continue;
    if (daysBetween(cutoff, row.issueDate) > 365) {
      count += 1;
      amount = amount.plus(row.pending);
    }
  }
  return { count, amount };
}

function invoiceInsert(
  row: PreparedInvoice,
  input: { batchId: string; entityId: string },
  kind: 'sale' | 'purchase',
): WriteOp {
  return {
    sql: sql`
      INSERT INTO legacy.holded_invoice (
        id, batch_id, entity_id, kind, number, internal_number, issue_date, operation_date, accounting_date,
        due_date, counterparty_name, counterparty_contact_id, description, tags, account_label, payment_method,
        subtotal, vat, vat_2, withholding, surcharge, total, paid, pending, status_holded, paid_on, face_status,
        number_anomaly, raw
      ) VALUES (
        CAST(${row.id} AS UUID),
        CAST(${input.batchId} AS UUID),
        CAST(${input.entityId} AS UUID),
        ${kind},
        ${row.number},
        ${cleanText(row.raw['Num interno']) || null},
        CAST(${row.issueDate} AS DATE),
        CAST(${row.operationDate} AS DATE),
        CAST(${row.accountingDate} AS DATE),
        CAST(${row.dueDate} AS DATE),
        ${row.counterparty},
        CAST(${row.contactId} AS UUID),
        ${row.description},
        ${row.tags},
        ${row.account},
        ${row.payment},
        ${row.subtotal},
        ${row.vat},
        ${row.vat2},
        ${row.withholding},
        ${row.surcharge},
        ${row.total},
        ${row.paid},
        ${row.pending},
        ${row.status},
        CAST(${row.paidOn} AS DATE),
        ${row.face},
        ${row.anomaly},
        ${sql.json(row.raw)}
      )
    `,
    audit: {
      table: 'legacy.holded_invoice',
      rowId: row.id,
      action: 'INSERT',
      before: null,
      after: { kind, total: fixedMoney(row.total), pending: fixedMoney(row.pending), anomaly: row.anomaly },
    },
  };
}

function openInsert(row: PreparedInvoice, input: { entityId: string }, kind: 'sale' | 'purchase'): WriteOp {
  const id = newId();
  return {
    sql: sql`
      INSERT INTO legacy.open_item (
        id, entity_id, direction, holded_invoice_id, counterparty_contact_id, document_number, document_date,
        due_date, amount, amount_paid, status
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${input.entityId} AS UUID),
        ${kind === 'purchase' ? 'payable' : 'receivable'},
        CAST(${row.id} AS UUID),
        CAST(${row.contactId} AS UUID),
        ${row.number},
        CAST(${row.issueDate} AS DATE),
        CAST(${row.dueDate} AS DATE),
        ${row.pending},
        0,
        'open'
      )
    `,
    audit: {
      table: 'legacy.open_item',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { amount: fixedMoney(row.pending), status: 'open' },
    },
  };
}

async function contactNames(client: KbClient, entityId: string, entity: string): Promise<Map<string, string | 'ambiguous'>> {
  const path = entity === 'CVPO' ? '$.holded_cvpo' : '$.holded_po';
  const rows = await client.query<{ id: string; legal_name: string }>(sql`
    SELECT c.id, c.legal_name
    FROM party.contact c
    LEFT JOIN party.contact_entity_terms t
      ON t.contact_id = c.id AND t.legal_entity_id = CAST(${entityId} AS UUID)
    WHERE c.merged_into_id IS NULL
      AND c.archived_at IS NULL
      AND (
        t.contact_id IS NOT NULL
        OR json_extract_string(c.legacy_refs, ${path}) IS NOT NULL
      )
  `);
  const map = new Map<string, string | 'ambiguous'>();
  for (const row of rows) {
    const name = cleanText(row.legal_name);
    const current = map.get(name);
    if (current === undefined) map.set(name, row.id);
    else if (current !== row.id) map.set(name, 'ambiguous');
  }
  return map;
}

function parseInvoiceNumber(raw: string): { suffix: boolean; year: number | null; seq: number | null; series: string } {
  const suffix = /-\d+$/.test(raw);
  const core = raw.replace(/-\d+$/, '');
  const prefixed = /^([A-Za-z]+)(\d{2})(\d+)$/.exec(core);
  if (prefixed?.[1] && prefixed[2] && prefixed[3]) {
    const yy = Number(prefixed[2]);
    return {
      suffix,
      year: yy >= 80 ? 1900 + yy : 2000 + yy,
      seq: Number(prefixed[3]),
      series: `${prefixed[1].toUpperCase()}${prefixed[2]}`,
    };
  }
  if (/^20\d{2}\d+$/.test(core)) {
    return { suffix, year: Number(core.slice(0, 4)), seq: Number(core.slice(4)), series: core.slice(0, 4) };
  }
  return { suffix, year: null, seq: null, series: core };
}

function sameAmount(want: string, got: unknown): boolean {
  return asAmount(want) === asAmount(got);
}

function asAmount(value: unknown): string {
  if (value == null) return '0.00';
  const parsed = money(String(value));
  if (parsed) return fixedMoney(parsed);
  const count = Number(value);
  if (Number.isInteger(count)) return String(count);
  return String(value);
}
