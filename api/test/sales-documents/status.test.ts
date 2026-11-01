import { afterAll, describe, expect, it } from 'bun:test';
import { createLocalClient } from '../../src/core/db/local';
import { sql } from '../../src/core/db/sql';
import {
  DELIVERY_NOTE_STATUSES,
  holdedDeliveryNoteStatus,
  holdedInvoiceBase,
  holdedQuoteBase,
  INVOICE_STATUSES,
  invoiceStatusSql,
  nativeDeliveryNoteStatus,
  nativeInvoiceBase,
  QUOTE_STATUSES,
  quoteStatusSql,
  statusLabel,
  supplierInvoiceBase,
} from '../../src/core/sales-documents/status';

const client = await createLocalClient(':memory:');
const TODAY = "CAST('2026-10-31' AS DATE)";

async function value(expression: string): Promise<string> {
  const rows = await client.query<{ value: unknown }>(`SELECT ${expression} AS value`);
  return String(rows[0]?.value);
}

function invoice(base: string, pending: string | null, total: string, due: string | null, flagged = false): string {
  return invoiceStatusSql({
    base: sql`${base}`,
    pending: pending == null ? 'CAST(NULL AS DECIMAL(14,2))' : `CAST(${pending} AS DECIMAL(14,2))`,
    total: `CAST(${total} AS DECIMAL(14,2))`,
    dueDate: due == null ? 'CAST(NULL AS DATE)' : sql`CAST(${due} AS DATE)`,
    flaggedOverdue: flagged ? 'TRUE' : 'FALSE',
    today: TODAY,
  });
}

describe('estado común de los documentos de venta', () => {
  afterAll(async () => {
    await client.close?.();
  });

  it('traduce el estado de Holded y deja mandar a la partida abierta', async () => {
    const base = (status: string, open: string | null) => holdedInvoiceBase(sql`${status}`, open == null ? 'CAST(NULL AS VARCHAR)' : sql`${open}`);
    expect(await value(base('Anulado', null))).toBe('void');
    expect(await value(base(' anulada ', 'open'))).toBe('void');
    expect(await value(base('Pagado', null))).toBe('paid');
    expect(await value(base('Cobrado', null))).toBe('paid');
    expect(await value(base('Pendiente', null))).toBe('open');
    expect(await value(base('Vencido', null))).toBe('open');
    expect(await value(base('Borrador', null))).toBe('draft');
    expect(await value(base('Pendiente', 'paid'))).toBe('paid');
    expect(await value(base('Pendiente', 'written_off'))).toBe('uncollectible');
    expect(await value(base('Pendiente', 'partially_paid'))).toBe('open');
  });

  it('traduce el estado de las facturas emitidas y recibidas de WineCore', async () => {
    const native = (status: string, payment: string) => nativeInvoiceBase(sql`${status}`, sql`${payment}`);
    expect(await value(native('draft', 'unpaid'))).toBe('draft');
    expect(await value(native('pending_approval', 'unpaid'))).toBe('pending_approval');
    expect(await value(native('discarded', 'unpaid'))).toBe('discarded');
    expect(await value(native('voided', 'paid'))).toBe('void');
    expect(await value(native('issued', 'paid'))).toBe('paid');
    expect(await value(native('issued', 'uncollectible'))).toBe('uncollectible');
    expect(await value(native('issued', 'partially_paid'))).toBe('open');
    const supplier = (status: string, payment: string) => supplierInvoiceBase(sql`${status}`, sql`${payment}`);
    expect(await value(supplier('captured', 'unpaid'))).toBe('draft');
    expect(await value(supplier('validated', 'unpaid'))).toBe('pending_approval');
    expect(await value(supplier('rejected', 'unpaid'))).toBe('void');
    expect(await value(supplier('duplicate', 'unpaid'))).toBe('void');
    expect(await value(supplier('approved', 'paid'))).toBe('paid');
    expect(await value(supplier('approved', 'unpaid'))).toBe('open');
  });

  it('calcula pendiente, cobro parcial y vencida con la fecha del día', async () => {
    expect(await value(invoice('open', '100.00', '100.00', '2026-11-30'))).toBe('pending');
    expect(await value(invoice('open', '40.00', '100.00', '2026-11-30'))).toBe('partial');
    expect(await value(invoice('open', '40.00', '100.00', '2026-10-30'))).toBe('overdue');
    expect(await value(invoice('open', '100.00', '100.00', '2026-10-31'))).toBe('pending');
    expect(await value(invoice('open', '100.00', '100.00', null))).toBe('pending');
    expect(await value(invoice('open', '100.00', '100.00', null, true))).toBe('overdue');
    expect(await value(invoice('open', '100.00', '100.00', '2026-12-01', true))).toBe('pending');
    expect(await value(invoice('open', '0.00', '100.00', '2026-10-01'))).toBe('paid');
    expect(await value(invoice('open', '-2.00', '2.00', null))).toBe('paid');
    expect(await value(invoice('open', null, '-4.84', null))).toBe('issued');
    expect(await value(invoice('open', '-4.84', '-4.84', '2026-01-01'))).toBe('issued');
    expect(await value(invoice('void', '0.00', '10.00', '2026-01-01'))).toBe('void');
    expect(await value(invoice('paid', '0.00', '10.00', '2026-01-01'))).toBe('paid');
    expect(await value(invoice('draft', null, '10.00', null))).toBe('draft');
  });

  it('caduca los presupuestos enviados al pasar la validez', async () => {
    const holded = (status: string, invoiced: string | null) => holdedQuoteBase(sql`${status}`, invoiced == null ? 'CAST(NULL AS VARCHAR)' : sql`${invoiced}`);
    expect(await value(holded('Aceptado', 'Facturado'))).toBe('converted');
    expect(await value(holded('Aceptado', null))).toBe('accepted');
    expect(await value(holded('Rechazado', null))).toBe('rejected');
    expect(await value(holded('Anulado', null))).toBe('rejected');
    expect(await value(holded('Borrador', null))).toBe('draft');
    expect(await value(holded('Caducado', null))).toBe('expired');
    expect(await value(holded('Pendiente', null))).toBe('sent');
    const quote = (base: string, validUntil: string | null) => quoteStatusSql({
      base: sql`${base}`,
      validUntil: validUntil == null ? 'CAST(NULL AS DATE)' : sql`CAST(${validUntil} AS DATE)`,
      today: TODAY,
    });
    expect(await value(quote('sent', '2026-10-30'))).toBe('expired');
    expect(await value(quote('sent', '2026-10-31'))).toBe('sent');
    expect(await value(quote('sent', null))).toBe('sent');
    expect(await value(quote('accepted', '2026-01-01'))).toBe('accepted');
    expect(await value(quote('draft', '2026-01-01'))).toBe('draft');
  });

  it('une el estado logístico y el de facturación de los albaranes', async () => {
    const holded = (status: string) => holdedDeliveryNoteStatus(sql`${status}`);
    expect(await value(holded('Pendiente'))).toBe('issued');
    expect(await value(holded('Facturado'))).toBe('invoiced');
    expect(await value(holded('Parcialmente'))).toBe('partially_invoiced');
    expect(await value(holded('Anulado'))).toBe('cancelled');
    const native = (status: string, invoicing: string) => nativeDeliveryNoteStatus(sql`${status}`, sql`${invoicing}`);
    expect(await value(native('draft', 'not_invoiced'))).toBe('draft');
    expect(await value(native('cancelled', 'invoiced'))).toBe('cancelled');
    expect(await value(native('delivered', 'invoiced'))).toBe('invoiced');
    expect(await value(native('shipped', 'partially_invoiced'))).toBe('partially_invoiced');
    expect(await value(native('shipped', 'not_invoiced'))).toBe('shipped');
    expect(await value(native('issued', 'not_invoiceable'))).toBe('issued');
  });

  it('tiene etiqueta en español para cada estado', () => {
    for (const status of INVOICE_STATUSES) expect(statusLabel('invoice', status)).not.toBe(status);
    for (const status of QUOTE_STATUSES) expect(statusLabel('quote', status)).not.toBe(status);
    for (const status of DELIVERY_NOTE_STATUSES) expect(statusLabel('delivery_note', status)).not.toBe(status);
    expect(statusLabel('invoice', 'pending')).toBe('Pendiente de cobro');
    expect(statusLabel('invoice', 'pending', 'purchase')).toBe('Pendiente de pago');
    expect(statusLabel('invoice', 'paid', 'purchase')).toBe('Pagada');
    expect(statusLabel('quote', 'expired')).toBe('Caducado');
    expect(statusLabel('delivery_note', 'invoiced')).toBe('Facturado');
  });
});
