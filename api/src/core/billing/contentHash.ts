import { canonicalJson } from '../db/audit';
import { sha256Hex } from '../hash';
import type { InvoiceView } from './readModel';

/** Hash del contenido que aprueba un lote: cliente, líneas, totales y fecha. */
export function invoiceContentHash(view: InvoiceView, issueDate: string): string {
  return sha256Hex(canonicalJson({
    customer_id: view.header.customerId,
    legal_entity_id: view.header.legalEntityId,
    series_id: view.header.seriesId,
    invoice_type: view.header.invoiceType,
    rectification_kind: view.header.rectificationKind,
    description: view.header.description,
    payment_terms_days: view.header.paymentTermsDays,
    issue_date: issueDate,
    operation_date: view.header.operationDate,
    lines: view.lines.map((line) => ({
      line_no: line.lineNo,
      product_id: line.productId,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      discount_pct: line.discountPct,
      tax_code: line.taxCode,
      lot_id: line.lotId,
      lot_code: line.lotCode,
    })),
    rectifications: view.rectifications.map((row) => ({
      number: row.number,
      issue_date: row.issueDate,
      issuer_tax_id: row.issuerTaxId,
    })),
    subtotal: view.header.subtotal,
    tax_total: view.header.taxTotal,
    surcharge_total: view.header.surchargeTotal,
    withholding_total: view.header.withholdingTotal,
    total: view.header.total,
  }));
}
