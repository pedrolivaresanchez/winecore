import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';
import { buildSalesFixture, call, json, type SalesFixture } from './fixture';

const ctx = await createTestApp();
let fx: SalesFixture;

beforeAll(async () => {
  fx = await buildSalesFixture(ctx);
});

afterAll(async () => {
  await ctx.close();
});

function issue(id: string) {
  return call(ctx, 'POST', `/v1/invoices/${id}/issue`, undefined, { 'Idempotency-Key': `emitir-${newId()}` });
}

describe('conversión de presupuestos', () => {
  it('resume lo presupuestado, lo facturado y la diferencia por línea', async () => {
    const quote = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'horeca',
      lines: [{ product_id: fx.product, quantity: '12' }],
    });
    expect(quote.subtotal).toBe('114.00');
    expect(quote.total).toBe('137.94');
    const quoteId = String(quote.id);

    const rejected = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'horeca',
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    const closed = await call(ctx, 'POST', `/v1/quotes/${String(rejected.id)}/reject`, { reason: 'No sigue' });
    expect(closed.status).toBe(200);

    const other = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'horeca',
      legal_entity_id: fx.cvpo,
      lines: [{ product_id: fx.product, quantity: '1' }],
    });
    expect(other.legal_entity_id).toBe(fx.cvpo);

    const order = await call(ctx, 'POST', `/v1/quotes/${quoteId}/to-order`);
    expect(order.status).toBe(201);
    const orderId = String(order.body?.id);
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${orderId}/confirm`);
    const lineId = (confirmed.lines as { id: string }[])[0]?.id;
    const note = await json(ctx, 'POST', `/v1/sales-orders/${orderId}/delivery-notes`, {
      from_location_id: fx.bod,
      lines: [{ order_line_id: lineId, quantity: '6', lot_id: fx.lot }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/issue`);

    const links = await ctx.writer.read<{ n: number }>(sql`
      SELECT count(*)::INTEGER AS n FROM sales.quote_line_link WHERE quote_id = CAST(${quoteId} AS UUID)
    `);
    expect(Number(links[0]?.n)).toBe(1);

    const draft = await call(ctx, 'POST', '/v1/invoices', { invoice_type: 'F1', from_delivery_notes: [String(note.id)] });
    expect(draft.status).toBe(201);
    const pending = await json(ctx, 'GET', `/v1/quotes/conversion?origin=winecore&status=convertido&quote_id=${quoteId}`);
    expect(pending.summary).toMatchObject({
      quotes: 1,
      bottles_budgeted: '12',
      bottles_invoiced: '0',
      base_invoiced: '0.00',
      total_invoiced: '0.00',
    });
    const pendingQuote = pending.quote as { delivery_notes: unknown[]; invoices: unknown[]; partial: boolean };
    expect(pendingQuote.delivery_notes).toHaveLength(1);
    expect(pendingQuote.invoices).toEqual([]);
    expect(pendingQuote.partial).toBe(false);

    const opened = await call(ctx, 'POST', '/v1/number-series/open', {
      legal_entity_id: fx.po,
      doc_type: 'invoice',
      year: fx.year,
      choice: 'fresh',
    });
    expect(opened.status).toBe(201);
    const issued = await issue(String(draft.body?.id));
    expect(issued.status).toBe(200);

    const converted = await json(ctx, 'GET', '/v1/quotes/conversion?origin=winecore&status=convertido');
    expect(moneyFields(converted.summary as Record<string, unknown>)).toBe(true);
    expect(converted.summary).toEqual({
      quotes: 1,
      bottles_budgeted: '12',
      base_possible: '114.00',
      total_possible: '137.94',
      bottles_invoiced: '6',
      base_invoiced: '57.00',
      total_invoiced: '68.97',
      conversion_bottles_pct: '50.00',
      conversion_amount_pct: '50.00',
    });
    const reference = (converted.by_reference as {
      wine: string; vintage: number; lots: string[]; label: string;
      bottles_budgeted: string; bottles_invoiced: string;
      amount_budgeted: string; amount_invoiced: string;
      average_price: string; average_price_invoiced: string;
    }[])[0];
    expect(reference?.wine).toBe('Tinto Ejemplo');
    expect(reference?.vintage).toBe(2025);
    expect(reference?.lots).toEqual(['L25T01B1']);
    expect(reference?.label).toBe('Tinto Ejemplo · 2025 · L25T01B1');
    expect(reference?.bottles_budgeted).toBe('12');
    expect(reference?.bottles_invoiced).toBe('6');
    expect(reference?.amount_budgeted).toBe('114.00');
    expect(reference?.amount_invoiced).toBe('57.00');
    expect(reference?.average_price).toBe('9.50');
    expect(reference?.average_price_invoiced).toBe('9.50');

    const trace = await json(ctx, 'GET', `/v1/quotes/conversion?quote_id=${quoteId}`);
    const traced = trace.quote as {
      partial: boolean;
      linked: boolean;
      invoices: { total: string }[];
      lines: { difference_bottles: string; difference_amount: string; bottles_invoiced: string }[];
    };
    expect(traced.partial).toBe(true);
    expect(traced.linked).toBe(true);
    expect(traced.invoices[0]?.total).toBe('68.97');
    expect(traced.lines[0]).toMatchObject({
      bottles_budgeted: '12',
      bottles_invoiced: '6',
      difference_bottles: '6',
      amount_budgeted: '114.00',
      amount_invoiced: '57.00',
      difference_amount: '57.00',
    });

    const open = await json(ctx, 'GET', '/v1/quotes/conversion?origin=winecore&status=abierto');
    expect(open.summary).toMatchObject({ quotes: 1, bottles_budgeted: '1', bottles_invoiced: '0', total_possible: '11.50' });
    const refused = await json(ctx, 'GET', '/v1/quotes/conversion?origin=winecore&status=rechazado');
    expect(refused.summary).toMatchObject({ quotes: 1, bottles_budgeted: '6', bottles_invoiced: '0', total_invoiced: '0.00' });
    const cvpo = await json(ctx, 'GET', '/v1/quotes/conversion?origin=winecore&entity=CVPO');
    expect(cvpo.summary).toMatchObject({ quotes: 1, bottles_budgeted: '1', total_possible: '11.50' });

    const all = await json(ctx, 'GET', '/v1/quotes/conversion?origin=winecore');
    expect(all.summary).toEqual({
      quotes: 3,
      bottles_budgeted: '19',
      base_possible: '180.50',
      total_possible: '218.41',
      bottles_invoiced: '6',
      base_invoiced: '57.00',
      total_invoiced: '68.97',
      conversion_bottles_pct: '31.58',
      conversion_amount_pct: '31.58',
    });

    await ctx.writer.withWrite({ type: 'system', id: 'conversion-test', requestId: 'conversion-test' }, async (tx) => {
      tx.write(sql`DELETE FROM sales.quote_line_link WHERE quote_id = CAST(${quoteId} AS UUID)`);
    });
    const byLine = await json(ctx, 'GET', '/v1/quotes/conversion?origin=winecore&status=convertido');
    expect(byLine.summary).toMatchObject({ bottles_budgeted: '12', bottles_invoiced: '6', total_invoiced: '68.97' });

    const batch = newId();
    const holdedId = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'conversion-test', requestId: 'conversion-test' }, async (tx) => {
      tx.write(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (CAST(${batch} AS UUID), 'holded', CAST(${fx.po} AS UUID), 'quotes', 'presupuestos.csv', 'abc', 'load', 'test')
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_quote (
          id, batch_id, entity_id, number, issue_date, counterparty_name,
          subtotal, vat, total, invoiced_total, status_holded, invoiced_status, raw
        ) VALUES (
          CAST(${holdedId} AS UUID), CAST(${batch} AS UUID), CAST(${fx.po} AS UUID),
          'H-1', DATE '2026-06-01', 'Cliente Holded',
          100, 21, 121, 60.50, 'Pendiente', 'parcial', '{}'::JSON
        )
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_invoice_line (
          id, batch_id, entity_id, kind, document_number, document_date, line_seq, description, units, subtotal, raw
        ) VALUES (
          CAST(${newId()} AS UUID), CAST(${batch} AS UUID), CAST(${fx.po} AS UUID),
          'quote', 'H-1', DATE '2026-06-01', 1, 'Reserva Holded', 10, 100, '{}'::JSON
        )
      `);
    });

    const historic = await json(ctx, 'GET', '/v1/quotes/conversion?origin=holded');
    expect(historic.summary).toEqual({
      quotes: 1,
      bottles_budgeted: '10',
      base_possible: '100.00',
      total_possible: '121.00',
      bottles_invoiced: '5',
      base_invoiced: '50.00',
      total_invoiced: '60.50',
      conversion_bottles_pct: '50.00',
      conversion_amount_pct: '50.00',
    });
    const historicQuote = (await json(ctx, 'GET', `/v1/quotes/conversion?quote_id=${holdedId}`)).quote as {
      linked: boolean; partial: boolean; lines: { difference_bottles: string; difference_amount: string }[];
    };
    expect(historicQuote.linked).toBe(false);
    expect(historicQuote.partial).toBe(true);
    expect(historicQuote.lines[0]).toMatchObject({ difference_bottles: '5', difference_amount: '50.00' });

    const invalid = await call(ctx, 'GET', '/v1/quotes/conversion?status=pagado');
    expect(invalid.status).toBe(422);
  });
});

function moneyFields(summary: Record<string, unknown>): boolean {
  for (const key of ['base_possible', 'total_possible', 'base_invoiced', 'total_invoiced', 'conversion_bottles_pct', 'conversion_amount_pct']) {
    expect(summary[key]).toMatch(/^-?\d+\.\d{2}$/);
  }
  return true;
}
