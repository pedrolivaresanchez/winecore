import { computeInvoice } from '../billing/compute';
import type { TaxCode } from '../billing/taxCodes';
import { canonicalJson } from '../db/audit';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { sha256Hex } from '../hash';
import { newId } from '../ids';
import { money } from '../money';
import { businessDate } from '../time';
import { addCivilDays, inclusiveOverlap, monthPeriod, settlementWatcher, type MonthPeriod, type WatcherStatus } from './calendar';
import { defaultPair, type EntityPair, type LegalEntityRow } from './entities';
import { listPoToCvpoTransfers } from './movements';
import { asDecimal, dateText, euros, price6, qty3, uuidText } from './numbers';
import { priceTransfers, readTaxCodes, type MissingLot, type MissingTariff, type PricedLine } from './priceLines';

export interface SettlementLineView {
  id: string;
  source_table: string;
  source_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  lot_id: string | null;
  lot_code: string | null;
  quantity: string;
  base_unit_price: string;
  discount_pct: string;
  unit_price: string;
  unit_cost: string | null;
  below_cost: boolean;
  cost_unknown: boolean;
  occurred_at: string;
  occurred_on: string;
  document_number: string | null;
  amount: string;
  liters: string | null;
}

export interface InvoiceLineView {
  line_no: number;
  product_id: string;
  sku: string;
  description: string;
  lot_id: string | null;
  lot_code: string | null;
  quantity: string;
  unit: string;
  unit_price: string;
  line_base: string;
  tax_code: string;
  unit_cost: string | null;
}

export interface InvoiceTaxView {
  tax_code: string;
  tax: string;
  regime_key: string;
  qualification: string | null;
  exemption: string | null;
  rate: string;
  base: string;
  quota: string;
  surcharge_rate: string;
  surcharge_quota: string;
  withholding_rate: string;
  withholding: string;
}

export interface InvoiceView {
  id: string;
  status: string;
  series_id: string;
  operation_date: string;
  issue_date: string | null;
  issuer_income_tax: 'IRPF' | 'IS';
  description: string;
  subtotal: string;
  tax_total: string;
  surcharge_total: string;
  withholding_total: string;
  importe_total: string;
  total_to_pay: string;
  approval_request_id: string | null;
  lines: InvoiceLineView[];
  taxes: InvoiceTaxView[];
  dues_preview: { due_date: string; amount: string; assumed_issue_date: string }[];
}

export interface BlockerView {
  code: string;
  product_id: string;
  product_name: string;
  occurred_on?: string;
  reason?: string;
  unit_price?: string;
  unit_cost?: string;
}

export interface SettlementView {
  id: string | null;
  seller_entity_id: string;
  buyer_entity_id: string;
  period: string;
  period_start: string;
  period_end: string;
  status: 'open' | 'closed' | 'invoiced' | 'cancelled';
  operation_date: string;
  issue_deadline: string;
  warn_from: string;
  watcher_status: WatcherStatus;
  pending_issue: boolean;
  watcher_message: string;
  tariff_id: string | null;
  lines: SettlementLineView[];
  totals: { units: string; liters: string | null; amount: string };
  blockers: BlockerView[];
  invoice: InvoiceView | null;
}

export interface CloseInput {
  period: string;
  today: string;
  actorId: string;
  now: Date;
  belowCostAcknowledged?: boolean;
}

interface StoredSettlement {
  id: string;
  status: 'open' | 'closed' | 'invoiced' | 'cancelled';
  tariffId: string | null;
  invoiceId: string | null;
  periodStart: string;
  periodEnd: string;
}

export async function readSettlement(tx: Tx, periodText: string, today: string): Promise<SettlementView> {
  assertToday(today);
  const period = monthPeriod(periodText);
  const pair = await defaultPair(tx);
  const existing = await findSettlement(tx, pair, period);
  if (existing && existing.status !== 'open') return loadFrozen(tx, existing, pair, period, today);
  return preview(tx, pair, period, today, existing?.id ?? null);
}

export async function ensureOpenSettlement(tx: Tx, input: CloseInput): Promise<SettlementView> {
  assertToday(input.today);
  const period = monthPeriod(input.period);
  const pair = await defaultPair(tx);
  const existing = await findSettlement(tx, pair, period);
  if (existing && existing.status !== 'open') return loadFrozen(tx, existing, pair, period, input.today);
  if (existing) return preview(tx, pair, period, input.today, existing.id);
  await assertNoPeriodOverlap(tx, pair, period, null);
  const id = newId();
  tx.write(sql`
    INSERT INTO billing.intercompany_settlement (
      id, seller_entity_id, buyer_entity_id, period_start, period_end, status, created_at
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${pair.seller.id} AS UUID),
      CAST(${pair.buyer.id} AS UUID),
      CAST(${period.periodStart} AS DATE),
      CAST(${period.periodEnd} AS DATE),
      'open',
      ${input.now}
    )
  `);
  tx.audit({
    table: 'billing.intercompany_settlement',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { status: 'open', period: period.period, seller_entity_id: pair.seller.id, buyer_entity_id: pair.buyer.id },
  });
  const view = await preview(tx, pair, period, input.today, id);
  return view;
}

export async function closeSettlement(tx: Tx, input: CloseInput): Promise<SettlementView> {
  assertToday(input.today);
  const period = monthPeriod(input.period);
  const pair = await defaultPair(tx);
  const existing = await findSettlement(tx, pair, period);
  if (existing && existing.status !== 'open') return loadFrozen(tx, existing, pair, period, input.today);
  await assertNoPeriodOverlap(tx, pair, period, existing?.id ?? null);
  const transfers = await listPoToCvpoTransfers(tx, {
    sellerEntityId: pair.seller.id,
    buyerEntityId: pair.buyer.id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  });
  if (transfers.length === 0) {
    const id = existing?.id ?? newId();
    writeClosedHeader(tx, id, pair, period, null, input, existing !== null);
    return shellView(pair, period, input.today, id, 'closed', null, [], [], null);
  }
  const priced = await priceTransfers(tx, pair, transfers);
  assertPriced(priced, input.belowCostAcknowledged === true);
  const customer = await requireCustomer(tx, pair.buyer);
  const seriesId = await requireSeries(tx, pair.seller.id, period.year);
  const tariffId = sharedTariff(priced.lines);
  const settlementId = existing?.id ?? newId();
  const invoiceId = newId();
  const lineIds = priced.lines.map(() => newId());
  const built = buildInvoice(priced.lines, period, pair.seller, customer.paymentTermsDays);
  writeClosedHeader(tx, settlementId, pair, period, tariffId, input, existing !== null);
  writeInvoiceHeader(tx, invoiceId, settlementId, pair.seller, customer.id, seriesId, period, built, input);
  writeSettlementLines(tx, settlementId, priced.lines, lineIds);
  // Invoice lines are inserted when the draft is sent for approval. DuckDB cannot
  // update an invoice once those lines reference it, even in the same transaction.
  return shellView(pair, period, input.today, settlementId, 'closed', tariffId, lineViews(priced.lines, lineIds), [], {
    id: invoiceId,
    status: 'draft',
    series_id: seriesId,
    operation_date: period.periodEnd,
    issue_date: null,
    issuer_income_tax: pair.seller.incomeTax,
    description: built.description,
    subtotal: euros(built.computed.subtotal),
    tax_total: euros(built.computed.taxTotal),
    surcharge_total: euros(built.computed.surchargeTotal),
    withholding_total: euros(built.computed.withholdingTotal),
    importe_total: euros(built.computed.importeTotal),
    total_to_pay: euros(built.computed.totalToPay),
    approval_request_id: null,
    lines: built.groups,
    taxes: taxViews(built),
    dues_preview: built.computed.dues.map((due) => ({
      due_date: due.dueDate,
      amount: euros(due.amount),
      assumed_issue_date: period.issueDeadline,
    })),
  });
}

export async function closeSettlementById(
  tx: Tx,
  settlementId: string,
  input: Omit<CloseInput, 'period'>,
): Promise<SettlementView> {
  const pair = await defaultPair(tx);
  const stored = await requireStored(tx, settlementId, pair);
  return closeSettlement(tx, { ...input, period: periodKey(stored.periodStart) });
}

export async function requestIntercompanyInvoice(
  tx: Tx,
  settlementId: string,
  actorId: string,
  now: Date,
  today: string,
): Promise<SettlementView> {
  assertToday(today);
  const pair = await defaultPair(tx);
  const stored = await requireStored(tx, settlementId, pair);
  const period = monthPeriod(periodKey(stored.periodStart));
  if (stored.status === 'open') {
    throw domainError('WC_VALIDATION', { status: 'Cierra el periodo antes de pedir la factura' });
  }
  const frozen = await loadFrozen(tx, stored, pair, period, today);
  if (!frozen.invoice) {
    throw domainError('WC_VALIDATION', { period: frozen.watcher_message });
  }
  if (frozen.invoice.approval_request_id || frozen.invoice.status === 'pending_approval' || frozen.invoice.status === 'issued') {
    return frozen;
  }
  const approvalId = newId();
  const hash = invoiceHash(frozen.invoice);
  const below = frozen.lines.some((line) => line.below_cost);
  const summary = approvalSummary(period.period, frozen.invoice.total_to_pay, below);
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  // The invoice has no lines yet, so this update is not blocked by a child FK.
  // Lines are inserted afterwards and the row is not updated again.
  tx.write(sql`
    UPDATE billing.invoice
    SET status = 'pending_approval', approval_request_id = CAST(${approvalId} AS UUID)
    WHERE id = CAST(${frozen.invoice.id} AS UUID) AND status = 'draft'
  `);
  rewriteInvoiceChildren(tx, frozen.invoice);
  tx.write(sql`
    INSERT INTO ops.approval_request (
      id, kind, legal_entity_id, subject_table, subject_id, payload_sha256, summary, details,
      status, requested_by, requested_at, expires_at
    ) VALUES (
      CAST(${approvalId} AS UUID),
      'intercompany_invoice_issue',
      CAST(${pair.seller.id} AS UUID),
      'billing.invoice',
      CAST(${frozen.invoice.id} AS UUID),
      ${hash},
      ${summary},
      ${sql.json({
        period: period.period,
        operation_date: period.periodEnd,
        total_to_pay: frozen.invoice.total_to_pay,
        importe_total: frozen.invoice.importe_total,
        below_cost: below,
        issuer_income_tax: pair.seller.incomeTax,
      })},
      'pending',
      ${actorId},
      ${now},
      ${expires}
    )
  `);
  tx.audit({
    table: 'billing.invoice',
    rowId: frozen.invoice.id,
    action: 'UPDATE',
    before: { status: 'draft', approval_request_id: null },
    after: { status: 'pending_approval', approval_request_id: approvalId },
  });
  tx.audit({
    table: 'ops.approval_request',
    rowId: approvalId,
    action: 'INSERT',
    before: null,
    after: { kind: 'intercompany_invoice_issue', payload_sha256: hash, summary },
  });
  return {
    ...frozen,
    invoice: { ...frozen.invoice, status: 'pending_approval', approval_request_id: approvalId },
  };
}

async function preview(
  tx: Tx,
  pair: EntityPair,
  period: MonthPeriod,
  today: string,
  id: string | null,
): Promise<SettlementView> {
  const transfers = await listPoToCvpoTransfers(tx, {
    sellerEntityId: pair.seller.id,
    buyerEntityId: pair.buyer.id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  });
  const priced = await priceTransfers(tx, pair, transfers);
  const blockers = blockersOf(priced.missingTariff, priced.missingLot, priced.lines, false);
  const lines = lineViews(priced.lines);
  return shellView(pair, period, today, id, 'open', null, lines, blockers, null, transfers.length);
}

function writeClosedHeader(
  tx: Tx,
  id: string,
  pair: EntityPair,
  period: MonthPeriod,
  tariffId: string | null,
  input: CloseInput,
  existed: boolean,
): void {
  if (existed) {
    tx.write(sql`
      UPDATE billing.intercompany_settlement
      SET status = 'closed',
          closed_at = ${input.now},
          tariff_id = CASE WHEN ${tariffId} IS NULL THEN NULL ELSE CAST(${tariffId} AS UUID) END
      WHERE id = CAST(${id} AS UUID) AND status = 'open'
    `);
    tx.audit({
      table: 'billing.intercompany_settlement',
      rowId: id,
      action: 'UPDATE',
      before: { status: 'open' },
      after: { status: 'closed', tariff_id: tariffId, period: period.period },
    });
    return;
  }
  tx.write(sql`
    INSERT INTO billing.intercompany_settlement (
      id, seller_entity_id, buyer_entity_id, period_start, period_end, status, tariff_id, closed_at, created_at
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${pair.seller.id} AS UUID),
      CAST(${pair.buyer.id} AS UUID),
      CAST(${period.periodStart} AS DATE),
      CAST(${period.periodEnd} AS DATE),
      'closed',
      CASE WHEN ${tariffId} IS NULL THEN NULL ELSE CAST(${tariffId} AS UUID) END,
      ${input.now},
      ${input.now}
    )
  `);
  tx.audit({
    table: 'billing.intercompany_settlement',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { status: 'closed', tariff_id: tariffId, period: period.period },
  });
}

interface BuiltInvoice {
  description: string;
  notes: string | null;
  paymentTermsDays: number;
  computed: ReturnType<typeof computeInvoice>;
  groups: InvoiceLineView[];
  persisted: PersistedLine[];
}

interface PersistedLine {
  id: string;
  lineNo: number;
  productId: string;
  sku: string;
  description: string;
  lotId: string | null;
  lotCode: string | null;
  quantity: ReturnType<typeof money.fromString>;
  unitPrice: ReturnType<typeof money.fromString>;
  lineBase: ReturnType<typeof money.fromString>;
  taxCode: string;
  unitCost: ReturnType<typeof money.fromString> | null;
  unit: string;
}

function buildInvoice(
  lines: readonly PricedLine[],
  period: MonthPeriod,
  seller: LegalEntityRow,
  paymentTermsDays: number,
): BuiltInvoice {
  const computed = computeInvoice({
    lines: lines.map((line) => ({
      qty: line.quantity,
      unitPrice: line.unitPrice,
      discountPct: money.fromString('0'),
      taxCode: line.tax,
    })),
    paymentTerms: { days: [paymentTermsDays] },
    issueDate: period.issueDeadline,
  });
  const groups = new Map<string, {
    productId: string;
    sku: string;
    name: string;
    unit: string;
    lotId: string | null;
    lotCode: string | null;
    unitPrice: PricedLine['unitPrice'];
    quantity: PricedLine['quantity'];
    lineBase: ReturnType<typeof money.fromString>;
    tax: TaxCode;
    unitCost: PricedLine['unitCost'];
    costMixed: boolean;
  }>();
  lines.forEach((line, index) => {
    const computedLine = computed.lines[index];
    if (!computedLine) throw domainError('WC_VALIDATION', { lines: 'No se ha podido calcular la factura' });
    const key = `${line.productId}|${line.lotId ?? ''}|${price6(line.unitPrice)}|${line.tax.code}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        productId: line.productId,
        sku: line.sku,
        name: line.productName,
        unit: line.unit,
        lotId: line.lotId,
        lotCode: line.lotCode,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineBase: computedLine.lineBase,
        tax: line.tax,
        unitCost: line.unitCost,
        costMixed: false,
      });
      return;
    }
    current.quantity = money.add(current.quantity, line.quantity);
    current.lineBase = money.add(current.lineBase, computedLine.lineBase);
    if (current.unitCost === null || line.unitCost === null || !current.unitCost.eq(line.unitCost)) {
      current.costMixed = true;
      current.unitCost = null;
    }
  });
  const ordered = [...groups.values()].sort((left, right) => {
    const sku = left.sku.localeCompare(right.sku);
    if (sku !== 0) return sku;
    return (left.lotCode ?? '').localeCompare(right.lotCode ?? '');
  });
  const persisted: PersistedLine[] = ordered.map((group, index) => {
    const description = (group.lotCode ? `${group.name} · ${group.lotCode}` : group.name).slice(0, 250);
    return {
      id: newId(),
      lineNo: index + 1,
      productId: group.productId,
      sku: group.sku,
      description,
      lotId: group.lotId,
      lotCode: group.lotCode,
      quantity: group.quantity,
      unitPrice: group.unitPrice,
      lineBase: group.lineBase,
      taxCode: group.tax.code,
      unitCost: group.costMixed ? null : group.unitCost,
      unit: group.unit,
    };
  });
  return {
    description: `Liquidación intercompañía ${period.period}`,
    notes: seller.incomeTax === 'IRPF'
      ? 'Emisor persona física (IRPF). La retención, si el código de impuesto la lleva, no forma parte del importe total.'
      : null,
    paymentTermsDays,
    computed,
    groups: persisted.map((line) => ({
      line_no: line.lineNo,
      product_id: line.productId,
      sku: line.sku,
      description: line.description,
      lot_id: line.lotId,
      lot_code: line.lotCode,
      quantity: qty3(line.quantity),
      unit: line.unit,
      unit_price: price6(line.unitPrice),
      line_base: euros(line.lineBase),
      tax_code: line.taxCode,
      unit_cost: line.unitCost ? price6(line.unitCost) : null,
    })),
    persisted,
  };
}

function taxViews(built: BuiltInvoice): InvoiceTaxView[] {
  return built.computed.taxes.map((tax) => ({
    tax_code: tax.taxCode.code,
    tax: tax.taxCode.tax,
    regime_key: tax.taxCode.regimeKey,
    qualification: tax.taxCode.qualification,
    exemption: tax.taxCode.exemption,
    rate: tax.taxCode.rate.toDecimalPlaces(2).toFixed(2),
    base: euros(tax.base),
    quota: euros(tax.quota),
    surcharge_rate: tax.taxCode.surchargeRate.toDecimalPlaces(2).toFixed(2),
    surcharge_quota: euros(tax.surchargeQuota),
    withholding_rate: tax.taxCode.withholdingRate.toDecimalPlaces(2).toFixed(2),
    withholding: euros(tax.withholding),
  }));
}

function writeInvoiceHeader(
  tx: Tx,
  invoiceId: string,
  settlementId: string,
  seller: LegalEntityRow,
  customerId: string,
  seriesId: string,
  period: MonthPeriod,
  built: BuiltInvoice,
  input: CloseInput,
): void {
  const totals = built.computed;
  tx.write(sql`
    INSERT INTO billing.invoice (
      id, legal_entity_id, series_id, status, invoice_type, operation_date, customer_id,
      channel, currency, language, description, notes, subtotal, tax_total, surcharge_total,
      withholding_total, total, payment_terms_days, is_intercompany, intercompany_settlement_id,
      created_by, created_at, updated_at
    ) VALUES (
      CAST(${invoiceId} AS UUID),
      CAST(${seller.id} AS UUID),
      CAST(${seriesId} AS UUID),
      'draft',
      'F1',
      CAST(${period.periodEnd} AS DATE),
      CAST(${customerId} AS UUID),
      'intercompany',
      'EUR',
      'es',
      ${built.description},
      ${built.notes},
      ${totals.subtotal},
      ${totals.taxTotal},
      ${totals.surchargeTotal},
      ${totals.withholdingTotal},
      ${totals.totalToPay},
      ${built.paymentTermsDays},
      TRUE,
      CAST(${settlementId} AS UUID),
      ${input.actorId},
      ${input.now},
      ${input.now}
    )
  `);
  tx.audit({
    table: 'billing.invoice',
    rowId: invoiceId,
    action: 'INSERT',
    before: null,
    after: {
      status: 'draft',
      operation_date: period.periodEnd,
      is_intercompany: true,
      issuer_income_tax: seller.incomeTax,
      subtotal: euros(totals.subtotal),
      tax_total: euros(totals.taxTotal),
      withholding_total: euros(totals.withholdingTotal),
      importe_total: euros(totals.importeTotal),
      total: euros(totals.totalToPay),
    },
  });
}

function writeSettlementLines(
  tx: Tx,
  settlementId: string,
  lines: readonly PricedLine[],
  ids: readonly string[],
): void {
  lines.forEach((line, index) => {
    const id = ids[index];
    if (!id) throw domainError('WC_VALIDATION', { lines: 'Falta el identificador de la línea' });
    tx.write(sql`
      INSERT INTO billing.intercompany_settlement_line (
        id, settlement_id, source_table, source_id, product_id, lot_id, quantity,
        base_unit_price, discount_pct, unit_price, unit_cost, below_cost, occurred_at
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${settlementId} AS UUID),
        ${line.sourceTable},
        CAST(${line.sourceId} AS UUID),
        CAST(${line.productId} AS UUID),
        CASE WHEN ${line.lotId} IS NULL THEN NULL ELSE CAST(${line.lotId} AS UUID) END,
        ${line.quantity},
        ${line.baseUnitPrice},
        ${line.discountPct},
        ${line.unitPrice},
        ${line.unitCost},
        ${line.belowCost},
        ${new Date(line.occurredAt)}
      )
    `);
    tx.audit({
      table: 'billing.intercompany_settlement_line',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: {
        source_table: line.sourceTable,
        source_id: line.sourceId,
        product_id: line.productId,
        quantity: qty3(line.quantity),
        unit_price: price6(line.unitPrice),
        below_cost: line.belowCost,
      },
    });
  });
}

function rewriteInvoiceChildren(tx: Tx, invoice: InvoiceView): void {
  for (const line of invoice.lines) {
    tx.write(sql`
      INSERT INTO billing.invoice_line (
        id, invoice_id, line_no, product_id, sku, description, lot_id, lot_code, quantity, unit,
        unit_price, discount_pct, line_base, tax_code, unit_cost_snapshot
      ) VALUES (
        CAST(${newId()} AS UUID),
        CAST(${invoice.id} AS UUID),
        ${line.line_no},
        CAST(${line.product_id} AS UUID),
        ${line.sku},
        ${line.description},
        CASE WHEN ${line.lot_id} IS NULL THEN NULL ELSE CAST(${line.lot_id} AS UUID) END,
        ${line.lot_code},
        ${money.fromString(line.quantity)},
        ${line.unit},
        ${money.fromString(line.unit_price)},
        ${money.fromString('0')},
        ${money.fromString(line.line_base)},
        ${line.tax_code},
        ${line.unit_cost === null ? null : money.fromString(line.unit_cost)}
      )
    `);
  }
  for (const tax of invoice.taxes) {
    tx.write(sql`
      INSERT INTO billing.invoice_tax (
        id, invoice_id, tax_code, tax, regime_key, qualification, exemption, rate, base, quota,
        surcharge_rate, surcharge_quota, withholding_rate, withholding
      ) VALUES (
        CAST(${newId()} AS UUID),
        CAST(${invoice.id} AS UUID),
        ${tax.tax_code},
        ${tax.tax},
        ${tax.regime_key},
        ${tax.qualification},
        ${tax.exemption},
        ${money.fromString(tax.rate)},
        ${money.fromString(tax.base)},
        ${money.fromString(tax.quota)},
        ${money.fromString(tax.surcharge_rate)},
        ${money.fromString(tax.surcharge_quota)},
        ${money.fromString(tax.withholding_rate)},
        ${money.fromString(tax.withholding)}
      )
    `);
  }
}

async function loadFrozen(
  tx: Tx,
  stored: StoredSettlement,
  pair: EntityPair,
  period: MonthPeriod,
  today: string,
): Promise<SettlementView> {
  const rows = await tx.read<{
    id: string;
    source_table: string;
    source_id: string;
    product_id: string;
    name: string;
    sku: string;
    lot_id: string | null;
    lot_code: string | null;
    quantity: string;
    base_unit_price: string;
    discount_pct: string;
    unit_price: string;
    unit_cost: string | null;
    below_cost: boolean;
    occurred_at: string;
    nominal_volume_ml: number | null;
    unit: string;
    default_tax_code: string | null;
  }>(sql`
    SELECT l.id, l.source_table, l.source_id, l.product_id, p.name, p.sku, p.unit, p.default_tax_code,
           l.lot_id, lot.code AS lot_code,
           l.quantity, l.base_unit_price, l.discount_pct, l.unit_price, l.unit_cost, l.below_cost, l.occurred_at,
           f.nominal_volume_ml
    FROM billing.intercompany_settlement_line l
    JOIN catalog.product p ON p.id = l.product_id
    LEFT JOIN catalog.format f ON f.id = p.format_id
    LEFT JOIN inventory.lot lot ON lot.id = l.lot_id
    WHERE l.settlement_id = CAST(${stored.id} AS UUID)
    ORDER BY l.occurred_at, l.id
  `);
  const numbers = await documentNumbers(tx, rows.filter((row) => row.source_table === 'sales.delivery_note_line').map((row) => uuidText(row.source_id)));
  const lines: SettlementLineView[] = rows.map((row) => {
    const quantity = asDecimal(row.quantity);
    const unitPrice = asDecimal(row.unit_price);
    const occurredAt = new Date(row.occurred_at);
    const ml = row.nominal_volume_ml == null ? null : Number(row.nominal_volume_ml);
    return {
      id: uuidText(row.id),
      source_table: row.source_table,
      source_id: uuidText(row.source_id),
      product_id: uuidText(row.product_id),
      product_name: row.name,
      sku: row.sku,
      lot_id: row.lot_id == null ? null : uuidText(row.lot_id),
      lot_code: row.lot_code,
      quantity: qty3(quantity),
      base_unit_price: price6(asDecimal(row.base_unit_price)),
      discount_pct: asDecimal(row.discount_pct).toDecimalPlaces(2).toFixed(2),
      unit_price: price6(unitPrice),
      unit_cost: row.unit_cost == null ? null : price6(asDecimal(row.unit_cost)),
      below_cost: row.below_cost === true,
      cost_unknown: row.unit_cost == null,
      occurred_at: occurredAt.toISOString(),
      occurred_on: businessDate(occurredAt),
      document_number: numbers.get(uuidText(row.source_id)) ?? null,
      amount: euros(money.round2(money.mul(quantity, unitPrice))),
      liters: ml == null ? null : qty3(money.mul(quantity, money.mul(money.fromString(String(ml)), money.fromString('0.001')))),
    };
  });
  let invoice = await loadInvoiceView(tx, stored.id, pair.seller.incomeTax, period);
  if (invoice && invoice.lines.length === 0 && rows.length > 0) {
    invoice = { ...invoice, ...(await draftFromStored(tx, rows, period, pair.seller)) };
  }
  return shellView(
    pair,
    period,
    today,
    stored.id,
    stored.status === 'open' ? 'closed' : stored.status,
    stored.tariffId,
    lines,
    [],
    invoice,
  );
}

async function draftFromStored(
  tx: Tx,
  rows: readonly {
    id: string;
    source_table: string;
    source_id: string;
    product_id: string;
    name: string;
    sku: string;
    unit: string;
    default_tax_code: string | null;
    lot_id: string | null;
    lot_code: string | null;
    quantity: string;
    base_unit_price: string;
    discount_pct: string;
    unit_price: string;
    unit_cost: string | null;
    below_cost: boolean;
    occurred_at: string;
  }[],
  period: MonthPeriod,
  seller: LegalEntityRow,
): Promise<{ lines: InvoiceLineView[]; taxes: InvoiceTaxView[] }> {
  const codes = rows.map((row) => row.default_tax_code ?? 'IVA21');
  const taxes = await readTaxCodes(tx, codes);
  const priced: PricedLine[] = rows.map((row) => {
    const code = row.default_tax_code ?? 'IVA21';
    const tax = taxes.get(code);
    if (!tax) throw domainError('WC_VALIDATION', { tax_code: 'Código de impuesto desconocido' });
    return {
      sourceTable: row.source_table === 'sales.delivery_note_line' ? 'sales.delivery_note_line' : 'inventory.stock_move',
      sourceId: uuidText(row.source_id),
      productId: uuidText(row.product_id),
      productName: row.name,
      sku: row.sku,
      unit: row.unit,
      requiresLot: false,
      lotId: row.lot_id == null ? null : uuidText(row.lot_id),
      lotCode: row.lot_code,
      nominalVolumeMl: null,
      quantity: asDecimal(row.quantity),
      baseUnitPrice: asDecimal(row.base_unit_price),
      discountPct: asDecimal(row.discount_pct),
      unitPrice: asDecimal(row.unit_price),
      unitCost: row.unit_cost == null ? null : asDecimal(row.unit_cost),
      belowCost: row.below_cost === true,
      costUnknown: row.unit_cost == null,
      occurredAt: String(row.occurred_at),
      occurredOn: businessDate(new Date(row.occurred_at)),
      documentNumber: null,
      tariffId: uuidText(row.id),
      tax,
    };
  });
  const built = buildInvoice(priced, period, seller, 30);
  return { lines: built.groups, taxes: taxViews(built) };
}

async function loadInvoiceView(
  tx: Tx,
  settlementId: string,
  incomeTax: 'IRPF' | 'IS',
  period: MonthPeriod,
): Promise<InvoiceView | null> {
  const headers = await tx.read<{
    id: string;
    status: string;
    series_id: string;
    operation_date: string | null;
    issue_date: string | null;
    description: string;
    subtotal: string | null;
    tax_total: string | null;
    surcharge_total: string | null;
    withholding_total: string | null;
    total: string | null;
    payment_terms_days: number | null;
    approval_request_id: string | null;
  }>(sql`
    SELECT id, status, series_id, operation_date, issue_date, description, subtotal, tax_total,
           surcharge_total, withholding_total, total, payment_terms_days, approval_request_id
    FROM billing.invoice
    WHERE intercompany_settlement_id = CAST(${settlementId} AS UUID)
    ORDER BY created_at
    LIMIT 1
  `);
  const header = headers[0];
  if (!header) return null;
  const invoiceId = uuidText(header.id);
  const lineRows = await tx.read<{
    line_no: number;
    product_id: string | null;
    sku: string | null;
    description: string;
    lot_id: string | null;
    lot_code: string | null;
    quantity: string;
    unit: string;
    unit_price: string;
    line_base: string;
    tax_code: string;
    unit_cost_snapshot: string | null;
  }>(sql`
    SELECT line_no, product_id, sku, description, lot_id, lot_code, quantity, unit, unit_price, line_base,
           tax_code, unit_cost_snapshot
    FROM billing.invoice_line
    WHERE invoice_id = CAST(${invoiceId} AS UUID)
    ORDER BY line_no
  `);
  const taxRows = await tx.read<{
    tax_code: string;
    tax: string;
    regime_key: string;
    qualification: string | null;
    exemption: string | null;
    rate: string;
    base: string;
    quota: string;
    surcharge_rate: string;
    surcharge_quota: string;
    withholding_rate: string;
    withholding: string;
  }>(sql`
    SELECT tax_code, tax, regime_key, qualification, exemption, rate, base, quota,
           surcharge_rate, surcharge_quota, withholding_rate, withholding
    FROM billing.invoice_tax
    WHERE invoice_id = CAST(${invoiceId} AS UUID)
    ORDER BY tax_code
  `);
  const subtotal = asDecimal(header.subtotal ?? '0');
  const taxTotal = asDecimal(header.tax_total ?? '0');
  const surcharge = asDecimal(header.surcharge_total ?? '0');
  const withholding = asDecimal(header.withholding_total ?? '0');
  const total = asDecimal(header.total ?? '0');
  const importe = money.sub(money.add(money.add(subtotal, taxTotal), surcharge), money.fromString('0'));
  const terms = header.payment_terms_days == null ? 30 : Number(header.payment_terms_days);
  return {
    id: invoiceId,
    status: header.status,
    series_id: uuidText(header.series_id),
    operation_date: header.operation_date ? dateText(header.operation_date) : period.periodEnd,
    issue_date: header.issue_date ? dateText(header.issue_date) : null,
    issuer_income_tax: incomeTax,
    description: header.description,
    subtotal: euros(subtotal),
    tax_total: euros(taxTotal),
    surcharge_total: euros(surcharge),
    withholding_total: euros(withholding),
    importe_total: euros(importe),
    total_to_pay: euros(total),
    approval_request_id: header.approval_request_id ? uuidText(header.approval_request_id) : null,
    lines: lineRows.map((line) => ({
      line_no: Number(line.line_no),
      product_id: line.product_id ? uuidText(line.product_id) : '',
      sku: line.sku ?? '',
      description: line.description,
      lot_id: line.lot_id ? uuidText(line.lot_id) : null,
      lot_code: line.lot_code,
      quantity: qty3(asDecimal(line.quantity)),
      unit: line.unit,
      unit_price: price6(asDecimal(line.unit_price)),
      line_base: euros(asDecimal(line.line_base)),
      tax_code: line.tax_code,
      unit_cost: line.unit_cost_snapshot == null ? null : price6(asDecimal(line.unit_cost_snapshot)),
    })),
    taxes: taxRows.map((tax) => ({
      tax_code: tax.tax_code,
      tax: tax.tax,
      regime_key: tax.regime_key,
      qualification: tax.qualification,
      exemption: tax.exemption,
      rate: asDecimal(tax.rate).toDecimalPlaces(2).toFixed(2),
      base: euros(asDecimal(tax.base)),
      quota: euros(asDecimal(tax.quota)),
      surcharge_rate: asDecimal(tax.surcharge_rate).toDecimalPlaces(2).toFixed(2),
      surcharge_quota: euros(asDecimal(tax.surcharge_quota)),
      withholding_rate: asDecimal(tax.withholding_rate).toDecimalPlaces(2).toFixed(2),
      withholding: euros(asDecimal(tax.withholding)),
    })),
    dues_preview: [{
      due_date: addCivilDays(period.issueDeadline, terms),
      amount: euros(total),
      assumed_issue_date: period.issueDeadline,
    }],
  };
}

async function documentNumbers(tx: Tx, lineIds: readonly string[]): Promise<Map<string, string>> {
  if (lineIds.length === 0) return new Map();
  const rows = await tx.read<{ id: string; number: string | null }>(`
    SELECT dnl.id, dn.number
    FROM sales.delivery_note_line dnl
    JOIN sales.delivery_note dn ON dn.id = dnl.delivery_note_id
    WHERE ${lineIds.map((id) => `dnl.id = CAST('${uuidText(id)}' AS UUID)`).join(' OR ')}
  `);
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.number) map.set(uuidText(row.id), row.number);
  }
  return map;
}

async function findSettlement(tx: Tx, pair: EntityPair, period: MonthPeriod): Promise<StoredSettlement | null> {
  const rows = await tx.read<{
    id: string;
    status: string;
    tariff_id: string | null;
    invoice_id: string | null;
    period_start: string;
    period_end: string;
  }>(sql`
    SELECT id, status, tariff_id, invoice_id, period_start, period_end
    FROM billing.intercompany_settlement
    WHERE seller_entity_id = CAST(${pair.seller.id} AS UUID)
      AND buyer_entity_id = CAST(${pair.buyer.id} AS UUID)
      AND period_start = CAST(${period.periodStart} AS DATE)
      AND period_end = CAST(${period.periodEnd} AS DATE)
      AND status <> 'cancelled'
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return mapStored(row);
}

async function requireStored(tx: Tx, id: string, pair: EntityPair): Promise<StoredSettlement> {
  const rows = await tx.read<{
    id: string;
    status: string;
    tariff_id: string | null;
    invoice_id: string | null;
    period_start: string;
    period_end: string;
    seller_entity_id: string;
    buyer_entity_id: string;
  }>(sql`
    SELECT id, status, tariff_id, invoice_id, period_start, period_end, seller_entity_id, buyer_entity_id
    FROM billing.intercompany_settlement
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  if (uuidText(row.seller_entity_id) !== pair.seller.id || uuidText(row.buyer_entity_id) !== pair.buyer.id) {
    throw domainError('WC_NOT_FOUND');
  }
  return mapStored(row);
}

async function assertNoPeriodOverlap(tx: Tx, pair: EntityPair, period: MonthPeriod, exceptId: string | null): Promise<void> {
  const rows = await tx.read<{ id: string; period_start: string; period_end: string }>(sql`
    SELECT id, period_start, period_end
    FROM billing.intercompany_settlement
    WHERE seller_entity_id = CAST(${pair.seller.id} AS UUID)
      AND buyer_entity_id = CAST(${pair.buyer.id} AS UUID)
      AND status <> 'cancelled'
  `);
  const clash = rows.find((row) => {
    if (exceptId && uuidText(row.id) === exceptId) return false;
    return inclusiveOverlap(period.periodStart, period.periodEnd, dateText(row.period_start), dateText(row.period_end));
  });
  if (clash && dateText(clash.period_start) === period.periodStart && dateText(clash.period_end) === period.periodEnd) return;
  if (clash) throw domainError('WC_IC_PERIOD_OVERLAP');
}

async function requireCustomer(tx: Tx, buyer: LegalEntityRow): Promise<{ id: string; paymentTermsDays: number }> {
  const rows = await tx.read<{ id: string; payment_terms_days: number }>(sql`
    SELECT id, payment_terms_days
    FROM party.contact
    WHERE tax_id = ${buyer.taxId} AND archived_at IS NULL AND merged_into_id IS NULL
    ORDER BY is_customer DESC, created_at
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_IC_CUSTOMER_MISSING', undefined, { tax_id: buyer.taxId });
  const terms = Number(row.payment_terms_days);
  return { id: uuidText(row.id), paymentTermsDays: Number.isInteger(terms) ? terms : 30 };
}

async function requireSeries(tx: Tx, sellerId: string, year: number): Promise<string> {
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id
    FROM core.number_series
    WHERE legal_entity_id = CAST(${sellerId} AS UUID)
      AND doc_type = 'intercompany_invoice'
      AND year = ${year}
      AND is_active
    ORDER BY is_default DESC, code
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw domainError('WC010');
  return uuidText(row.id);
}

function assertPriced(
  priced: { lines: PricedLine[]; missingTariff: MissingTariff[]; missingLot: MissingLot[] },
  acknowledged: boolean,
): void {
  if (priced.missingTariff.length > 0) {
    throw domainError('WC_IC_TARIFF_MISSING', undefined, {
      products: uniqueBy(priced.missingTariff, (row) => row.productId).map((row) => ({
        id: row.productId,
        name: row.productName,
        reason: row.reason,
      })),
    });
  }
  if (priced.missingLot.length > 0) {
    throw domainError('WC_INV_LOT_REQUIRED', undefined, {
      products: uniqueBy(priced.missingLot, (row) => row.productId).map((row) => ({
        id: row.productId,
        name: row.productName,
      })),
    });
  }
  const below = priced.lines.filter((line) => line.belowCost);
  if (below.length > 0 && !acknowledged) {
    throw domainError('WC_IC_BELOW_COST', undefined, {
      products: uniqueBy(below, (line) => line.productId).map((line) => ({
        id: line.productId,
        name: line.productName,
        unit_price: price6(line.unitPrice),
        unit_cost: line.unitCost ? price6(line.unitCost) : null,
      })),
    });
  }
}

function blockersOf(
  missingTariff: readonly MissingTariff[],
  missingLot: readonly MissingLot[],
  lines: readonly PricedLine[],
  acknowledged: boolean,
): BlockerView[] {
  const blockers: BlockerView[] = missingTariff.map((row) => ({
    code: 'WC_IC_TARIFF_MISSING',
    product_id: row.productId,
    product_name: row.productName,
    occurred_on: row.occurredOn,
    reason: row.reason,
  }));
  for (const row of missingLot) {
    blockers.push({ code: 'WC_INV_LOT_REQUIRED', product_id: row.productId, product_name: row.productName });
  }
  if (!acknowledged) {
    for (const line of lines.filter((row) => row.belowCost)) {
      blockers.push({
        code: 'WC_IC_BELOW_COST',
        product_id: line.productId,
        product_name: line.productName,
        unit_price: price6(line.unitPrice),
        unit_cost: line.unitCost ? price6(line.unitCost) : undefined,
      });
    }
  }
  return blockers;
}

function lineViews(lines: readonly PricedLine[], ids?: readonly string[]): SettlementLineView[] {
  return lines.map((line, index) => ({
    id: ids?.[index] ?? line.sourceId,
    source_table: line.sourceTable,
    source_id: line.sourceId,
    product_id: line.productId,
    product_name: line.productName,
    sku: line.sku,
    lot_id: line.lotId,
    lot_code: line.lotCode,
    quantity: qty3(line.quantity),
    base_unit_price: price6(line.baseUnitPrice),
    discount_pct: line.discountPct.toDecimalPlaces(2).toFixed(2),
    unit_price: price6(line.unitPrice),
    unit_cost: line.unitCost ? price6(line.unitCost) : null,
    below_cost: line.belowCost,
    cost_unknown: line.costUnknown,
    occurred_at: line.occurredAt,
    occurred_on: line.occurredOn,
    document_number: line.documentNumber,
    amount: euros(money.round2(money.mul(line.quantity, line.unitPrice))),
    liters: line.nominalVolumeMl == null
      ? null
      : qty3(money.mul(line.quantity, money.mul(money.fromString(String(line.nominalVolumeMl)), money.fromString('0.001')))),
  }));
}

function shellView(
  pair: EntityPair,
  period: MonthPeriod,
  today: string,
  id: string | null,
  status: SettlementView['status'],
  tariffId: string | null,
  lines: SettlementLineView[],
  blockers: BlockerView[],
  invoice: InvoiceView | null,
  activityCount = lines.length,
): SettlementView {
  const watcher = settlementWatcher({
    period,
    lineCount: activityCount,
    invoiceIssued: invoice?.status === 'issued',
    closed: status === 'closed' || status === 'invoiced',
    today,
  });
  return {
    id,
    seller_entity_id: pair.seller.id,
    buyer_entity_id: pair.buyer.id,
    period: period.period,
    period_start: period.periodStart,
    period_end: period.periodEnd,
    status,
    operation_date: period.periodEnd,
    issue_deadline: period.issueDeadline,
    warn_from: period.warnFrom,
    watcher_status: watcher.status,
    pending_issue: watcher.pendingIssue,
    watcher_message: watcher.message,
    tariff_id: tariffId,
    lines,
    totals: {
      units: qty3(lines.reduce((sum, line) => money.add(sum, money.fromString(line.quantity)), money.fromString('0'))),
      liters: litersOf(lines),
      amount: euros(lines.reduce((sum, line) => money.add(sum, money.fromString(line.amount)), money.fromString('0'))),
    },
    blockers,
    invoice,
  };
}

function litersOf(lines: readonly SettlementLineView[]): string | null {
  if (lines.length === 0) return '0.000';
  if (lines.some((line) => line.liters == null)) return null;
  return qty3(lines.reduce((sum, line) => money.add(sum, money.fromString(line.liters ?? '0')), money.fromString('0')));
}

function sharedTariff(lines: readonly PricedLine[]): string | null {
  const ids = new Set(lines.map((line) => line.tariffId));
  if (ids.size !== 1) return null;
  return [...ids][0] ?? null;
}

function mapStored(row: {
  id: string;
  status: string;
  tariff_id: string | null;
  invoice_id: string | null;
  period_start: string;
  period_end: string;
}): StoredSettlement {
  if (row.status !== 'open' && row.status !== 'closed' && row.status !== 'invoiced' && row.status !== 'cancelled') {
    throw domainError('WC_VALIDATION', { status: 'Estado de liquidación desconocido' });
  }
  return {
    id: uuidText(row.id),
    status: row.status,
    tariffId: row.tariff_id ? uuidText(row.tariff_id) : null,
    invoiceId: row.invoice_id ? uuidText(row.invoice_id) : null,
    periodStart: dateText(row.period_start),
    periodEnd: dateText(row.period_end),
  };
}

function periodKey(periodStart: string): string {
  return periodStart.slice(0, 7);
}

function invoiceHash(invoice: InvoiceView): string {
  return sha256Hex(canonicalJson({
    operation_date: invoice.operation_date,
    lines: invoice.lines.map((line) => ({
      product_id: line.product_id,
      lot_id: line.lot_id,
      quantity: line.quantity,
      unit_price: line.unit_price,
      line_base: line.line_base,
      tax_code: line.tax_code,
    })),
    subtotal: invoice.subtotal,
    tax_total: invoice.tax_total,
    surcharge_total: invoice.surcharge_total,
    withholding_total: invoice.withholding_total,
    total: invoice.total_to_pay,
  }));
}

function approvalSummary(period: string, total: string, belowCost: boolean): string {
  const text = `Factura intercompañía ${period} · ${total} EUR${belowCost ? ' · bajo coste' : ''}`;
  return text.slice(0, 300);
}

function assertToday(today: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw domainError('WC_VALIDATION', { today: 'Usa una fecha AAAA-MM-DD' });
  }
}

function uniqueBy<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const id = key(row);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}
