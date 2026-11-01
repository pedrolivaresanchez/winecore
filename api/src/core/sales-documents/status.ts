/**
 * Estado común de los documentos de venta de los dos libros (Holded y WineCore).
 * Cada libro traduce su estado a una base y el estado final se calcula igual para los dos;
 * las expresiones SQL de este módulo son la única implementación del mapeo.
 */

export type DocumentKind = 'invoice' | 'quote' | 'delivery_note';
export type Direction = 'sale' | 'purchase';

export const INVOICE_STATUSES = [
  'draft',
  'pending_approval',
  'issued',
  'pending',
  'partial',
  'overdue',
  'paid',
  'uncollectible',
  'void',
  'discarded',
] as const;

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'] as const;

export const DELIVERY_NOTE_STATUSES = [
  'draft',
  'issued',
  'shipped',
  'delivered',
  'partially_invoiced',
  'invoiced',
  'cancelled',
] as const;

const SALE_INVOICE_LABELS: Record<(typeof INVOICE_STATUSES)[number], string> = {
  draft: 'Borrador',
  pending_approval: 'Pendiente de aprobación',
  issued: 'Emitida',
  pending: 'Pendiente de cobro',
  partial: 'Cobro parcial',
  overdue: 'Vencida',
  paid: 'Cobrada',
  uncollectible: 'Incobrable',
  void: 'Anulada',
  discarded: 'Descartada',
};

const PURCHASE_INVOICE_LABELS: Record<(typeof INVOICE_STATUSES)[number], string> = {
  ...SALE_INVOICE_LABELS,
  issued: 'Registrada',
  pending: 'Pendiente de pago',
  partial: 'Pago parcial',
  paid: 'Pagada',
  uncollectible: 'Cerrada sin pagar',
};

const QUOTE_LABELS: Record<(typeof QUOTE_STATUSES)[number], string> = {
  draft: 'Borrador',
  sent: 'Enviado',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  expired: 'Caducado',
  converted: 'Convertido',
};

const DELIVERY_NOTE_LABELS: Record<(typeof DELIVERY_NOTE_STATUSES)[number], string> = {
  draft: 'Borrador',
  issued: 'Emitido',
  shipped: 'Expedido',
  delivered: 'Entregado',
  partially_invoiced: 'Facturado en parte',
  invoiced: 'Facturado',
  cancelled: 'Anulado',
};

export function statusesOf(kind: DocumentKind): readonly string[] {
  if (kind === 'invoice') return INVOICE_STATUSES;
  if (kind === 'quote') return QUOTE_STATUSES;
  return DELIVERY_NOTE_STATUSES;
}

export function statusLabel(kind: DocumentKind, status: string, direction: Direction = 'sale'): string {
  const labels: Record<string, string> = kind === 'invoice'
    ? direction === 'purchase' ? PURCHASE_INVOICE_LABELS : SALE_INVOICE_LABELS
    : kind === 'quote' ? QUOTE_LABELS : DELIVERY_NOTE_LABELS;
  return labels[status] ?? status;
}

/** Estados que no suman en el importe del listado salvo que se filtren expresamente. */
export const NOT_COUNTED: readonly string[] = ['void', 'discarded', 'cancelled'];

/** Estados con importe por cobrar (o por pagar). */
export const RECEIVABLE: readonly string[] = ['pending', 'partial', 'overdue'];

const HOLDED_VOID = "('anulado', 'anulada', 'voided', 'cancelled', 'cancelada', 'cancelado')";

function holded(expr: string): string {
  return `lower(trim(coalesce(${expr}, '')))`;
}

/**
 * Base de una factura de Holded. La partida abierta (`openItemStatus`, NULL si no hay) manda
 * sobre el estado del corte porque recoge lo cobrado después en WineCore.
 */
export function holdedInvoiceBase(statusHolded: string, openItemStatus: string): string {
  return `CASE
    WHEN ${holded(statusHolded)} IN ${HOLDED_VOID} THEN 'void'
    WHEN ${openItemStatus} = 'written_off' THEN 'uncollectible'
    WHEN ${openItemStatus} = 'paid' THEN 'paid'
    WHEN ${openItemStatus} IS NOT NULL THEN 'open'
    WHEN ${holded(statusHolded)} IN ('pagado', 'pagada', 'cobrado', 'cobrada') THEN 'paid'
    WHEN ${holded(statusHolded)} = 'borrador' THEN 'draft'
    ELSE 'open'
  END`;
}

export function nativeInvoiceBase(status: string, paymentStatus: string): string {
  return `CASE
    WHEN ${status} = 'draft' THEN 'draft'
    WHEN ${status} = 'pending_approval' THEN 'pending_approval'
    WHEN ${status} = 'discarded' THEN 'discarded'
    WHEN ${status} = 'voided' THEN 'void'
    WHEN ${paymentStatus} = 'paid' THEN 'paid'
    WHEN ${paymentStatus} = 'uncollectible' THEN 'uncollectible'
    ELSE 'open'
  END`;
}

/** Facturas recibidas en WineCore (gastos): captura, validación, aprobación y pago. */
export function supplierInvoiceBase(status: string, paymentStatus: string): string {
  return `CASE
    WHEN ${status} = 'captured' THEN 'draft'
    WHEN ${status} = 'validated' THEN 'pending_approval'
    WHEN ${status} IN ('rejected', 'duplicate') THEN 'void'
    WHEN ${paymentStatus} = 'paid' THEN 'paid'
    ELSE 'open'
  END`;
}

/**
 * Estado final de una factura. `flaggedOverdue` es el «Vencido» de Holded, que solo cuenta
 * si la factura no trae vencimiento.
 */
export function invoiceStatusSql(input: {
  base: string;
  pending: string;
  total: string;
  dueDate: string;
  flaggedOverdue: string;
  today: string;
}): string {
  return `CASE
    WHEN ${input.base} <> 'open' THEN ${input.base}
    WHEN ${input.pending} IS NULL OR ${input.pending} <= 0 THEN CASE WHEN ${input.total} > 0 THEN 'paid' ELSE 'issued' END
    WHEN ${input.dueDate} IS NOT NULL AND ${input.dueDate} < ${input.today} THEN 'overdue'
    WHEN ${input.dueDate} IS NULL AND ${input.flaggedOverdue} THEN 'overdue'
    WHEN ${input.pending} < ${input.total} THEN 'partial'
    ELSE 'pending'
  END`;
}

export function holdedQuoteBase(statusHolded: string, invoicedStatus: string): string {
  return `CASE
    WHEN ${holded(invoicedStatus)} = 'facturado' THEN 'converted'
    WHEN ${holded(statusHolded)} IN ('aceptado', 'aceptada') THEN 'accepted'
    WHEN ${holded(statusHolded)} IN ('rechazado', 'rechazada') OR ${holded(statusHolded)} IN ${HOLDED_VOID} THEN 'rejected'
    WHEN ${holded(statusHolded)} = 'borrador' THEN 'draft'
    WHEN ${holded(statusHolded)} IN ('caducado', 'caducada', 'vencido', 'vencida', 'expirado', 'expirada') THEN 'expired'
    ELSE 'sent'
  END`;
}

/** Un presupuesto enviado y sin respuesta caduca al pasar su validez. */
export function quoteStatusSql(input: { base: string; validUntil: string; today: string }): string {
  return `CASE
    WHEN ${input.base} = 'sent' AND ${input.validUntil} IS NOT NULL AND ${input.validUntil} < ${input.today} THEN 'expired'
    ELSE ${input.base}
  END`;
}

/** En Holded el albarán solo tiene estado de facturación: sin facturar queda como emitido. */
export function holdedDeliveryNoteStatus(invoicedStatus: string): string {
  return `CASE
    WHEN ${holded(invoicedStatus)} = 'facturado' THEN 'invoiced'
    WHEN ${holded(invoicedStatus)} LIKE 'parcial%' THEN 'partially_invoiced'
    WHEN ${holded(invoicedStatus)} IN ${HOLDED_VOID} THEN 'cancelled'
    ELSE 'issued'
  END`;
}

export function nativeDeliveryNoteStatus(status: string, invoicingStatus: string): string {
  return `CASE
    WHEN ${status} IN ('draft', 'cancelled') THEN ${status}
    WHEN ${invoicingStatus} = 'invoiced' THEN 'invoiced'
    WHEN ${invoicingStatus} = 'partially_invoiced' THEN 'partially_invoiced'
    ELSE ${status}
  END`;
}
