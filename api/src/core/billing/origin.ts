/**
 * Facturas que ya estaban emitidas cuando entraron en WineCore.
 *
 * `holded_import` (migración 0047) y `stripe_import` (POST /v1/invoices/import/stripe)
 * se guardan como expedidas, con su número original. No tienen registro Verifactu
 * ni envío: en los listados, el libro y el PDF no pueden figurar como pendientes.
 *
 * No se excluyen del libro de emitidas ni de los cobros. El histórico de Holded sí
 * se excluye de los cobros pendientes porque esa deuda ya vive en `legacy.open_item`;
 * una factura de Stripe no está duplicada ahí y sigue siendo ingreso de CVPO.
 */

export const HISTORICAL_INVOICE_ORIGINS = ['holded_import', 'stripe_import'] as const;

export type InvoiceOrigin = 'native' | (typeof HISTORICAL_INVOICE_ORIGINS)[number];

export function invoiceOrigin(value: unknown): InvoiceOrigin {
  if (value === 'holded_import' || value === 'stripe_import') return value;
  return 'native';
}

export function isHistoricalInvoiceOrigin(value: unknown): boolean {
  return value === 'holded_import' || value === 'stripe_import';
}

/** Lista SQL para `COALESCE(alias.origin, 'native') IN (...)`. */
export function historicalOriginSqlList(): string {
  return `('holded_import', 'stripe_import')`;
}
