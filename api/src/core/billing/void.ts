import { can, type UserCtx } from '../auth/permissions';
import type { Actor, Tx } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { consumeApproval, reviewApproval } from './approval';
import { deliveryStatusPlan, writeDeliveryStatuses } from './delivery';
import { decimalOf, importeOf } from './format';
import { dispatchInvoiceVoided, type IssuedInvoice, type VoidedInvoice } from './issued';
import { countAllocations, loadInvoice, type InvoiceView } from './readModel';
import { assertWc080 } from './wc080';

export const VOID_REASONS = {
  duplicate: 'duplicada',
  wrong_entity: 'entidad equivocada',
  wrong_customer: 'cliente equivocado sin entrega',
} as const;

export type VoidReasonCode = keyof typeof VOID_REASONS;

export type VoidOutcome =
  | { status: 'pending'; approval_request_id: string; invoice_id: string }
  | {
    status: 'voided';
    id: string;
    number: string;
    void_reason: string;
    voided_at: string;
  };

export async function voidInvoice(
  tx: Tx,
  input: { invoiceId: string; reasonCode: string; reasonText: string | null; actor: Actor; user: UserCtx; now?: Date },
): Promise<VoidOutcome> {
  const now = input.now ?? new Date();
  const view = await loadInvoice(tx, input.invoiceId);
  if (!can(input.user, 'billing.void', view.header.legalEntityId)) throw domainError('WC_FORBIDDEN');
  if (view.header.status === 'voided') {
    return {
      status: 'voided',
      id: view.header.id,
      number: view.header.number ?? '',
      void_reason: view.header.voidReason ?? '',
      voided_at: view.header.voidedAt ?? now.toISOString(),
    };
  }
  if (view.header.status !== 'issued' || !view.header.number) {
    throw domainError('WC_VALIDATION', { status: 'Solo se anula una factura emitida' });
  }
  if (!isVoidReason(input.reasonCode)) throw domainError('WC_INV_REASON');
  const reasonText = input.reasonText?.trim() ?? '';
  if (reasonText.length > 300) throw domainError('WC_VALIDATION', { reason_text: 'El texto es demasiado largo' });
  if (decimalOf(view.header.amountPaid).gt(0) || await countAllocations(tx, view.header.id) > 0) {
    throw domainError('WC_INV_PAYMENTS');
  }
  const storedReason = reasonText.length > 0 ? `${input.reasonCode}: ${reasonText}` : input.reasonCode;
  const review = await reviewApproval(tx, {
    kind: 'invoice_void',
    legalEntityId: view.header.legalEntityId,
    subjectTable: 'billing.invoice',
    subjectId: view.header.id,
    summary: `Anular ${view.header.number} (${VOID_REASONS[input.reasonCode]})`.slice(0, 300),
    payload: {
      invoice_id: view.header.id,
      number: view.header.number,
      reason_code: input.reasonCode,
      reason_text: reasonText,
    },
    requestedBy: input.actor.id,
  }, now);
  if (!review.granted) {
    return { status: 'pending', approval_request_id: review.requestId, invoice_id: view.header.id };
  }
  assertWc080('issued', { status: 'issued' }, {
    status: 'voided',
    voided_at: now.toISOString(),
    void_reason: storedReason,
    updated_at: now.toISOString(),
  });
  const deliveries = await deliveryStatusPlan(tx, {
    invoiceId: view.header.id,
    coveredLineIds: view.lines.flatMap((line) => line.deliveryNoteLineId ? [line.deliveryNoteLineId] : []),
    countThisInvoice: false,
  });
  tx.write(sql`
    UPDATE billing.invoice
    SET status = 'voided', voided_at = ${now}, void_reason = ${storedReason}, updated_at = ${now}
    WHERE id = CAST(${view.header.id} AS UUID) AND status = 'issued'
  `);
  tx.audit({
    table: 'billing.invoice',
    rowId: view.header.id,
    action: 'UPDATE',
    before: { status: 'issued' },
    after: { status: 'voided', void_reason: storedReason },
  });
  writeDeliveryStatuses(tx, deliveries, now);
  if (view.header.salesOrderId) {
    const others = await tx.read(sql`
      SELECT id FROM billing.invoice
      WHERE sales_order_id = CAST(${view.header.salesOrderId} AS UUID)
        AND status = 'issued' AND id <> CAST(${view.header.id} AS UUID)
      LIMIT 1
    `);
    if (!others[0]) {
      tx.write(sql`
        UPDATE sales.sales_order
        SET invoicing_status = 'not_invoiced', updated_at = ${now}
        WHERE id = CAST(${view.header.salesOrderId} AS UUID)
      `);
    }
  }
  await consumeApproval(tx, review.requestId, now);
  const voidedAt = now.toISOString();
  await dispatchInvoiceVoided(tx, voidedPayload(view, storedReason, voidedAt), now);
  return {
    status: 'voided',
    id: view.header.id,
    number: view.header.number,
    void_reason: storedReason,
    voided_at: voidedAt,
  };
}

function isVoidReason(value: string): value is VoidReasonCode {
  return Object.prototype.hasOwnProperty.call(VOID_REASONS, value);
}

function voidedPayload(view: InvoiceView, voidReason: string, voidedAt: string): VoidedInvoice {
  const issued: IssuedInvoice = {
    id: view.header.id,
    legalEntityId: view.header.legalEntityId,
    entityCode: view.entity.code,
    personType: view.entity.personType,
    incomeTax: view.entity.incomeTax,
    seriesId: view.header.seriesId,
    number: view.header.number ?? '',
    invoiceType: view.header.invoiceType,
    rectificationKind: view.header.rectificationKind,
    issueDate: view.header.issueDate ?? '',
    operationDate: view.header.operationDate,
    customerId: view.header.customerId,
    currency: view.header.currency,
    subtotal: view.header.subtotal ?? '0.00',
    taxTotal: view.header.taxTotal ?? '0.00',
    surchargeTotal: view.header.surchargeTotal ?? '0.00',
    withholdingTotal: view.header.withholdingTotal ?? '0.00',
    importeTotal: importeOf(view.header.subtotal, view.header.taxTotal, view.header.surchargeTotal) ?? view.header.total ?? '0.00',
    total: view.header.total ?? '0.00',
    lines: view.lines.map((line) => {
      const product = line.productId ? view.products.get(line.productId) : undefined;
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
        lineBase: line.lineBase,
        taxCode: line.taxCode,
        deliveryNoteLineId: line.deliveryNoteLineId,
        orderLineId: line.orderLineId,
        requiresLot: product?.requiresLot ?? false,
        productKind: product?.kind ?? null,
      };
    }),
  };
  return { ...issued, voidReason, voidedAt };
}
