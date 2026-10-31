import { sql } from '../db/sql';
import type { Tx } from '../db/writer';

/**
 * Punto de extensión al emitir.
 *
 * Regla de dos stocks (D2): el stock físico sale con el albarán; el fiscal sale
 * con la factura de la entidad que tiene CAE (P.O, persona física en IRPF).
 * CVPO no tiene CAE y no genera salida fiscal. El integrador de inventario
 * registra aquí el movimiento `exit_*` con `fiscal_date = issueDate`.
 * Este módulo no escribe el libro fiscal.
 *
 * El evento `billing.invoice.issued` entra en el outbox en la misma escritura.
 * `tx.read` no ve las escrituras de esta operación: usa el argumento `invoice`.
 */
export interface IssuedInvoiceLine {
  id: string;
  lineNo: number;
  productId: string | null;
  sku: string | null;
  description: string;
  lotId: string | null;
  lotCode: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
  lineBase: string;
  taxCode: string;
  deliveryNoteLineId: string | null;
  orderLineId: string | null;
  requiresLot: boolean;
  productKind: string | null;
}

export interface IssuedInvoice {
  id: string;
  legalEntityId: string;
  entityCode: string;
  personType: string;
  incomeTax: string;
  seriesId: string;
  number: string;
  invoiceType: string;
  rectificationKind: string | null;
  issueDate: string;
  operationDate: string | null;
  customerId: string | null;
  currency: string;
  subtotal: string;
  taxTotal: string;
  surchargeTotal: string;
  withholdingTotal: string;
  importeTotal: string;
  total: string;
  lines: IssuedInvoiceLine[];
}

export interface VoidedInvoice extends IssuedInvoice {
  voidReason: string;
  voidedAt: string;
}

export type InvoiceIssuedHook = (tx: Tx, invoice: IssuedInvoice) => Promise<void> | void;
export type InvoiceVoidedHook = (tx: Tx, invoice: VoidedInvoice) => Promise<void> | void;

const issuedHooks: InvoiceIssuedHook[] = [];
const voidedHooks: InvoiceVoidedHook[] = [];

export function onInvoiceIssued(hook: InvoiceIssuedHook): () => void {
  issuedHooks.push(hook);
  return () => {
    const index = issuedHooks.indexOf(hook);
    if (index >= 0) issuedHooks.splice(index, 1);
  };
}

/** El integrador publica aquí el `reversal` fiscal de una anulación. */
export function onInvoiceVoided(hook: InvoiceVoidedHook): () => void {
  voidedHooks.push(hook);
  return () => {
    const index = voidedHooks.indexOf(hook);
    if (index >= 0) voidedHooks.splice(index, 1);
  };
}

export async function dispatchInvoiceIssued(tx: Tx, invoice: IssuedInvoice, now: Date): Promise<void> {
  for (const hook of [...issuedHooks]) await hook(tx, invoice);
  writeEvent(tx, 'billing.invoice.issued', invoice, now);
}

export async function dispatchInvoiceVoided(tx: Tx, invoice: VoidedInvoice, now: Date): Promise<void> {
  for (const hook of [...voidedHooks]) await hook(tx, invoice);
  writeEvent(tx, 'billing.invoice.voided', invoice, now);
}

function writeEvent(tx: Tx, eventType: string, invoice: IssuedInvoice, now: Date): void {
  tx.write(sql`
    INSERT INTO ops.outbox_event (
      event_type, aggregate_table, aggregate_id, legal_entity_id, payload, occurred_at
    ) VALUES (
      ${eventType},
      'billing.invoice',
      CAST(${invoice.id} AS UUID),
      CAST(${invoice.legalEntityId} AS UUID),
      ${sql.json({
        invoice_id: invoice.id,
        number: invoice.number,
        legal_entity_id: invoice.legalEntityId,
        entity_code: invoice.entityCode,
        person_type: invoice.personType,
        customer_id: invoice.customerId,
        invoice_type: invoice.invoiceType,
        issue_date: invoice.issueDate,
        subtotal: invoice.subtotal,
        tax_total: invoice.taxTotal,
        surcharge_total: invoice.surchargeTotal,
        withholding_total: invoice.withholdingTotal,
        importe_total: invoice.importeTotal,
        total: invoice.total,
      })},
      ${now}
    )
  `);
}
