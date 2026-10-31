import type { Actor, Tx } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { money } from '../money';
import { takeNumber } from '../series';
import { approvalStillValid, readApproval } from './approval';
import type { ComputedInvoice } from './compute';
import { deliveryStatusPlan, writeDeliveryStatuses } from './delivery';
import { decimalOf, fixed, importeOf, instantOn, isUuid, seriesDocType } from './format';
import { raiseIssue } from './issues';
import { dispatchInvoiceIssued, type IssuedInvoice, type IssuedInvoiceLine } from './issued';
import { openIssuedDelivery } from './issue-document';
import {
  loadInvoice,
  type CustomerView,
  type InvoiceView,
  type TaxView,
} from './readModel';
import { validateInvoice } from './validate';

/**
 * Emisión en la escritura que ya abrió la ruta.
 * El número, el congelado, el desglose y los vencimientos entran en esa misma
 * petición: si algo falla después de `takeNumber`, no hay commit y no hay hueco.
 * Verifactu sigue apagado (P.O hasta el 30-06-2027, CVPO en Holded hasta M4):
 * no se crea registro ni QR.
 */
export interface IssueResult {
  id: string;
  number: string;
  issue_date: string;
  status: 'issued';
  totals: {
    subtotal: string;
    tax_total: string;
    surcharge_total: string;
    withholding_total: string;
    importe_total: string;
    total: string;
  };
  taxes: TaxView[];
  dues: { seq: number; due_date: string; amount: string }[];
  verifactu_record_id: null;
  qr_url: null;
  customer_snapshot: Record<string, unknown>;
}

let injected: (() => void) | null = null;

/** Un fallo de prueba justo después de tomar el número. Se consume una vez. */
export function injectAfterTakeNumber(fn: (() => void) | null): void {
  injected = fn;
}

export async function issueInvoice(
  tx: Tx,
  input: { invoiceId: string; actor: Actor; fromBatch?: boolean; fromIntercompany?: boolean; now?: Date },
): Promise<IssueResult> {
  const now = input.now ?? new Date();
  const view = await loadInvoice(tx, input.invoiceId);
  if (view.header.status === 'issued') return resultFromView(view);
  if (view.header.status === 'voided' || view.header.status === 'discarded') throw domainError('WC080');
  if (view.header.status === 'pending_approval') {
    if (input.fromIntercompany) await assertIntercompanyApproval(tx, view, now);
    else if (input.fromBatch) await assertBatchApproval(tx, view, now);
    else throw domainError('WC_INV_APPROVAL_REQUIRED');
  } else if (view.header.status !== 'draft') {
    throw domainError('WC_INV_NOT_DRAFT');
  }
  if (!isUuid(input.actor.id)) throw domainError('WC_VALIDATION', { actor: 'El emisor no es un usuario' });

  const validation = await validateInvoice(tx, view.header.id, now);
  const first = validation.errors[0];
  if (first) raiseIssue(first);
  const computed = validation.computed;
  if (!computed) raiseIssue({ code: 'WC_INV_LINES_REQUIRED', message: 'La factura necesita al menos una línea', field: 'lines' });
  const issueDate = validation.issueDate;
  const customer = view.customer;
  if (!customer) throw domainError('WC_INV_TAX_ID_REQUIRED');

  const costs = await standardCosts(tx, view, issueDate);
  const deliveries = await deliveryStatusPlan(tx, {
    invoiceId: view.header.id,
    coveredLineIds: view.lines.flatMap((line) => line.deliveryNoteLineId ? [line.deliveryNoteLineId] : []),
    countThisInvoice: true,
  });
  const otherOrder = view.header.salesOrderId
    ? await tx.read(sql`
      SELECT id FROM billing.invoice
      WHERE sales_order_id = CAST(${view.header.salesOrderId} AS UUID)
        AND status = 'issued' AND id <> CAST(${view.header.id} AS UUID)
      LIMIT 1
    `)
    : [];

  const number = await takeNumber(tx, {
    legalEntityId: view.header.legalEntityId,
    docType: seriesDocType(view.header.invoiceType),
    date: instantOn(issueDate),
    seriesId: view.header.seriesId,
  });
  const blow = injected;
  injected = null;
  if (blow) blow();

  const clash = await tx.read(sql`
    SELECT id FROM billing.invoice
    WHERE legal_entity_id = CAST(${view.header.legalEntityId} AS UUID)
      AND number = ${number}
      AND id <> CAST(${view.header.id} AS UUID)
    LIMIT 1
  `);
  if (clash[0]) throw domainError('WC_VALIDATION', { number: 'Ya existe una factura con este número' });

  const snapshot = customerSnapshot(customer);
  const taxes = taxRows(computed);
  const dues = computed.dues.map((due, index) => ({
    seq: index + 1,
    dueDate: due.dueDate,
    amount: money.toString(due.amount),
  }));
  const totals = {
    subtotal: money.toString(computed.subtotal),
    tax_total: money.toString(computed.taxTotal),
    surcharge_total: money.toString(computed.surchargeTotal),
    withholding_total: money.toString(computed.withholdingTotal),
    importe_total: money.toString(computed.importeTotal),
    total: money.toString(computed.totalToPay),
  };

  computed.lines.forEach((line, index) => {
    const current = view.lines[index];
    if (!current) return;
    const cost = current.productId ? costs.get(current.productId) ?? null : null;
    tx.write(sql`
      UPDATE billing.invoice_line
      SET line_base = ${line.lineBase}, unit_cost_snapshot = ${cost == null ? null : decimalOf(cost)}
      WHERE id = CAST(${current.id} AS UUID)
    `);
  });
  for (const tax of taxes) {
    tx.write(sql`
      INSERT INTO billing.invoice_tax (
        id, invoice_id, tax_code, tax, regime_key, qualification, exemption, rate, base, quota,
        surcharge_rate, surcharge_quota, withholding_rate, withholding
      ) VALUES (
        CAST(${newId()} AS UUID),
        CAST(${view.header.id} AS UUID),
        ${tax.taxCode},
        ${tax.tax},
        ${tax.regimeKey},
        ${tax.qualification},
        ${tax.exemption},
        ${decimalOf(tax.rate)},
        ${decimalOf(tax.base)},
        ${decimalOf(tax.quota)},
        ${decimalOf(tax.surchargeRate)},
        ${decimalOf(tax.surchargeQuota)},
        ${decimalOf(tax.withholdingRate)},
        ${decimalOf(tax.withholding)}
      )
    `);
  }
  for (const due of dues) {
    tx.write(sql`
      INSERT INTO billing.invoice_due (id, invoice_id, seq, due_date, amount)
      VALUES (
        CAST(${newId()} AS UUID),
        CAST(${view.header.id} AS UUID),
        ${due.seq},
        CAST(${due.dueDate} AS DATE),
        ${decimalOf(due.amount)}
      )
    `);
  }
  tx.write(sql`
    UPDATE billing.invoice SET
      number = ${number},
      status = 'issued',
      issue_date = CAST(${issueDate} AS DATE),
      customer_snapshot = ${sql.json(snapshot)},
      subtotal = ${decimalOf(totals.subtotal)},
      tax_total = ${decimalOf(totals.tax_total)},
      surcharge_total = ${decimalOf(totals.surcharge_total)},
      withholding_total = ${decimalOf(totals.withholding_total)},
      total = ${decimalOf(totals.total)},
      issued_by = CAST(${input.actor.id} AS UUID),
      issued_at = ${now},
      updated_at = ${now}
    WHERE id = CAST(${view.header.id} AS UUID)
  `);
  tx.audit({
    table: 'billing.invoice',
    rowId: view.header.id,
    action: 'UPDATE',
    before: { status: view.header.status, number: null },
    after: { status: 'issued', number, issue_date: issueDate, total: totals.total },
  });
  writeDeliveryStatuses(tx, deliveries, now);
  if (view.header.salesOrderId && !otherOrder[0]) {
    tx.write(sql`
      UPDATE sales.sales_order
      SET invoicing_status = 'invoiced', updated_at = ${now}
      WHERE id = CAST(${view.header.salesOrderId} AS UUID)
    `);
  }
  const issued = issuedPayload(view, number, issueDate, totals, computed);
  await dispatchInvoiceIssued(tx, issued, now);
  await openIssuedDelivery(tx, view, number, issueDate, totals, taxes, computed, now);
  return {
    id: view.header.id,
    number,
    issue_date: issueDate,
    status: 'issued',
    totals,
    taxes,
    dues: dues.map((due) => ({ seq: due.seq, due_date: due.dueDate, amount: due.amount })),
    verifactu_record_id: null,
    qr_url: null,
    customer_snapshot: snapshot,
  };
}

async function assertIntercompanyApproval(tx: Tx, view: InvoiceView, now: Date): Promise<void> {
  const requestId = view.header.approvalRequestId;
  if (!requestId) throw domainError('WC_INV_APPROVAL_REQUIRED');
  const approval = await readApproval(tx, requestId);
  if (!approval || approval.status !== 'approved' || approval.kind !== 'intercompany_invoice_issue') {
    throw domainError('WC_INV_APPROVAL_REQUIRED');
  }
  if (!approvalStillValid(approval.expiresAt, now)) throw domainError('WC043');
}

async function assertBatchApproval(tx: Tx, view: InvoiceView, now: Date): Promise<void> {
  const requestId = view.header.approvalRequestId;
  if (!requestId) throw domainError('WC_INV_APPROVAL_REQUIRED');
  const approval = await readApproval(tx, requestId);
  if (!approval || (approval.status !== 'approved' && approval.status !== 'consumed')) {
    throw domainError('WC_INV_APPROVAL_REQUIRED');
  }
  if (approval.status === 'approved' && !approvalStillValid(approval.expiresAt, now)) throw domainError('WC043');
  const invoices = approval.payload.invoices;
  if (!Array.isArray(invoices) || !invoices.some((item) => item && typeof item === 'object' && (item as { id?: string }).id === view.header.id)) {
    throw domainError('WC_INV_APPROVAL_REQUIRED');
  }
}

function resultFromView(view: InvoiceView): IssueResult {
  const header = view.header;
  if (!header.number || !header.issueDate || !header.customerSnapshot || header.total == null || header.subtotal == null || header.taxTotal == null || header.surchargeTotal == null || header.withholdingTotal == null) {
    throw domainError('WC080');
  }
  return {
    id: header.id,
    number: header.number,
    issue_date: header.issueDate,
    status: 'issued',
    totals: {
      subtotal: header.subtotal,
      tax_total: header.taxTotal,
      surcharge_total: header.surchargeTotal,
      withholding_total: header.withholdingTotal,
      importe_total: importeOf(header.subtotal, header.taxTotal, header.surchargeTotal) ?? header.total,
      total: header.total,
    },
    taxes: view.taxes,
    dues: view.dues.map((due) => ({ seq: due.seq, due_date: due.dueDate, amount: due.amount })),
    verifactu_record_id: null,
    qr_url: null,
    customer_snapshot: header.customerSnapshot,
  };
}

function customerSnapshot(customer: CustomerView): Record<string, unknown> {
  return {
    legal_name: customer.legalName,
    name: customer.legalName,
    trade_name: customer.tradeName,
    tax_id: customer.taxId,
    tax_id_type: customer.taxIdType,
    tax_id_country: customer.taxIdCountry,
    country: customer.country,
    language: customer.language,
    vat_id_validated_at: customer.vatValidatedAt,
    address: customer.address ? {
      line1: customer.address.line1,
      line2: customer.address.line2,
      postal_code: customer.address.postalCode,
      city: customer.address.city,
      province: customer.address.province,
      country_code: customer.address.countryCode,
    } : null,
  };
}

function taxRows(computed: ComputedInvoice): TaxView[] {
  return computed.taxes.map((tax) => ({
    taxCode: tax.taxCode.code,
    tax: tax.taxCode.tax,
    regimeKey: tax.taxCode.regimeKey,
    qualification: tax.taxCode.qualification,
    exemption: tax.taxCode.exemption,
    rate: fixed(tax.rate, 2),
    base: money.toString(tax.base),
    quota: money.toString(tax.quota),
    surchargeRate: fixed(tax.surchargeRate, 2),
    surchargeQuota: money.toString(tax.surchargeQuota),
    withholdingRate: fixed(tax.withholdingRate, 2),
    withholding: money.toString(tax.withholding),
  }));
}

async function standardCosts(tx: Tx, view: InvoiceView, issueDate: string): Promise<Map<string, string>> {
  const costs = new Map<string, string>();
  for (const line of view.lines) {
    if (!line.productId || costs.has(line.productId)) continue;
    const rows = await tx.read<{ unit_cost: unknown }>(sql`
      SELECT unit_cost FROM catalog.standard_cost
      WHERE product_id = CAST(${line.productId} AS UUID)
        AND valid_from <= CAST(${issueDate} AS DATE)
      ORDER BY valid_from DESC
      LIMIT 1
    `);
    const row = rows[0];
    if (row) costs.set(line.productId, fixed(row.unit_cost, 6));
  }
  return costs;
}

function issuedPayload(
  view: InvoiceView,
  number: string,
  issueDate: string,
  totals: IssueResult['totals'],
  computed: ComputedInvoice,
): IssuedInvoice {
  const lines: IssuedInvoiceLine[] = view.lines.map((line, index) => {
    const product = line.productId ? view.products.get(line.productId) : undefined;
    const base = computed.lines[index]?.lineBase;
    return {
      id: line.id,
      lineNo: line.lineNo,
      productId: line.productId,
      sku: line.sku,
      description: line.description,
      lotId: line.lotId,
      lotCode: line.lotCode,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      discountPct: line.discountPct,
      lineBase: base ? money.toString(base) : line.lineBase,
      taxCode: line.taxCode,
      deliveryNoteLineId: line.deliveryNoteLineId,
      orderLineId: line.orderLineId,
      requiresLot: product?.requiresLot ?? false,
      productKind: product?.kind ?? null,
    };
  });
  return {
    id: view.header.id,
    legalEntityId: view.header.legalEntityId,
    entityCode: view.entity.code,
    personType: view.entity.personType,
    incomeTax: view.entity.incomeTax,
    seriesId: view.header.seriesId,
    number,
    invoiceType: view.header.invoiceType,
    rectificationKind: view.header.rectificationKind,
    issueDate,
    operationDate: view.header.operationDate,
    customerId: view.header.customerId,
    currency: view.header.currency,
    subtotal: totals.subtotal,
    taxTotal: totals.tax_total,
    surchargeTotal: totals.surcharge_total,
    withholdingTotal: totals.withholding_total,
    importeTotal: totals.importe_total,
    total: totals.total,
    lines,
  };
}
