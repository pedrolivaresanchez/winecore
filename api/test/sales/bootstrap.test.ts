import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { ensureDefaultSeries } from '../../src/core/series';
import { createTestApp } from '../helpers';
import { buildSalesFixture, call, json, type SalesFixture } from './fixture';

const ctx = await createTestApp();
let fx: SalesFixture;
let yy: string;

beforeAll(async () => {
  fx = await buildSalesFixture(ctx, { rules: false, series: false });
  yy = String(fx.year).slice(2);
});

afterAll(async () => {
  await ctx.close();
});

type Series = { legal_entity_id: string; doc_type: string; code: string; year: number; prefix: string; padding: number; is_default: boolean; is_active: boolean };

async function seriesOf(entityId: string, docType: string): Promise<Series[]> {
  const listed = await json(ctx, 'GET', `/v1/number-series?legal_entity_id=${entityId}&doc_type=${docType}`);
  return (listed.items as Series[]).filter((row) => row.year === fx.year);
}

async function audits(table: string): Promise<{ row_id: string; action: string; after_data: unknown }[]> {
  return ctx.writer.read(sql`SELECT row_id, action, after_data FROM audit.audit_log WHERE table_name = ${table} ORDER BY occurred_at`);
}

function issue(id: string) {
  return call(ctx, 'POST', `/v1/invoices/${id}/issue`, undefined, { 'Idempotency-Key': `emitir-${newId()}` });
}

function openSeries(entityId: string, docType: string, choice: 'fresh' | 'holded') {
  return call(ctx, 'POST', '/v1/number-series/open', { legal_entity_id: entityId, doc_type: docType, year: fx.year, choice });
}

function newOrder(body: Record<string, unknown>) {
  return call(ctx, 'POST', '/v1/sales-orders', body, { 'Idempotency-Key': `pedido-${newId()}` });
}

describe('alta sin reglas ni series', () => {
  it('la vista previa de la entidad no falla sin conjunto activo', async () => {
    const preview = await call(ctx, 'GET', `/v1/billing-rules/resolve?customer_id=${fx.other}&channel=direct`);
    expect(preview.status).toBe(200);
    expect(preview.body).toBeNull();
    const sets = await json(ctx, 'GET', '/v1/billing-rules/sets');
    expect(sets.items).toEqual([]);
    expect((await json(ctx, 'GET', '/v1/billing-rules/state')).state).toBe('empty');
  });

  it('el primer presupuesto abre la v1 con la entidad elegida y respeta la elección', async () => {
    const created = await call(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.other,
      channel: 'direct',
      legal_entity_id: fx.po,
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    expect(created.status).toBe(201);
    expect(created.body?.legal_entity_id).toBe(fx.po);

    const sets = await json(ctx, 'GET', '/v1/billing-rules/sets');
    const items = sets.items as { version: number; status: string; created_at: string; rules: { scope: string; issuing_entity_id: string }[] }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.version).toBe(1);
    expect(items[0]?.status).toBe('active');
    expect(items[0]?.rules).toEqual([expect.objectContaining({ scope: 'default', issuing_entity_id: fx.po })]);
    expect((await audits('billing.billing_rule_set')).map((row) => row.action)).toEqual(['INSERT']);
    expect((await audits('billing.billing_rule')).map((row) => row.action)).toEqual(['INSERT']);
    expect((await json(ctx, 'GET', '/v1/billing-rules/state')).state).toBe('active');

    const preview = await json(ctx, 'GET', `/v1/billing-rules/resolve?customer_id=${fx.other}&channel=direct`);
    expect(preview.entity_id).toBe(fx.po);
    expect(preview.matched_scope).toBe('default');

    const other = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.other,
      channel: 'direct',
      legal_entity_id: fx.cvpo,
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    expect(other.legal_entity_id).toBe(fx.cvpo);
    const ruled = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.other,
      channel: 'direct',
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    expect(ruled.legal_entity_id).toBe(fx.po);
    expect((await json(ctx, 'GET', '/v1/billing-rules/sets')).items).toHaveLength(1);
  });

  it('rechaza una entidad que no existe', async () => {
    const missing = await call(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.other,
      channel: 'direct',
      legal_entity_id: newId(),
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    expect(missing.status).toBe(422);
    expect(missing.body?.fields).toHaveProperty('legal_entity_id');
  });

  it('numera el presupuesto y la proforma abriendo sus series', async () => {
    const quote = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.other,
      channel: 'direct',
      legal_entity_id: fx.cvpo,
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    const sent = await json(ctx, 'POST', `/v1/quotes/${String(quote.id)}/send`);
    expect(sent.number).toBe(`PR${yy}-0001`);
    const proforma = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.other,
      channel: 'export',
      legal_entity_id: fx.cvpo,
      is_proforma: true,
      incoterm: 'FCA',
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    const proSent = await json(ctx, 'POST', `/v1/quotes/${String(proforma.id)}/send`);
    expect(proSent.number).toBe(`PF${yy}-0001`);

    const quoteSeries = await seriesOf(fx.cvpo, 'quote');
    expect(quoteSeries).toEqual([expect.objectContaining({
      code: 'PR', prefix: `PR${yy}-`, padding: 4, is_default: true, is_active: true,
    })]);
    const inserted = (await audits('core.number_series')).filter((row) => row.action === 'INSERT');
    expect(inserted.length).toBeGreaterThanOrEqual(2);
  });

  it('el pedido de un presupuesto conserva su entidad como excepción y la usa al confirmar', async () => {
    const quote = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.other,
      channel: 'direct',
      legal_entity_id: fx.cvpo,
      lines: [{ product_id: fx.product, quantity: '12' }],
    });
    const converted = await call(ctx, 'POST', `/v1/quotes/${String(quote.id)}/to-order`);
    expect(converted.status).toBe(201);
    const trace = converted.body?.billing_rule_trace as { exception?: { legal_entity_id?: string } } | null;
    expect(trace?.exception?.legal_entity_id).toBe(fx.cvpo);

    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${String(converted.body?.id)}/confirm`);
    expect(confirmed.legal_entity_id).toBe(fx.cvpo);
    expect(confirmed.number).toBe(`PE${yy}-0001`);
    expect(confirmed.billing_rule_id).toBeTruthy();
    const kept = confirmed.billing_rule_trace as { exception?: { legal_entity_id?: string }; winner?: string };
    expect(kept.exception?.legal_entity_id).toBe(fx.cvpo);
    expect(kept.winner).toBe('default');
  });

  it('un pedido con la entidad de las reglas no guarda excepción', async () => {
    const created = await newOrder({
      customer_id: fx.other,
      channel: 'direct',
      legal_entity_id: fx.po,
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    expect(created.status).toBe(201);
    expect(created.body?.billing_rule_trace).toBeNull();
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${String(created.body?.id)}/confirm`);
    expect(confirmed.legal_entity_id).toBe(fx.po);
    expect(confirmed.number).toBe(`PE${yy}-0001`);
  });

  it('el albarán y la factura del albarán abren sus series y se emiten', async () => {
    const created = await newOrder({
      customer_id: fx.other,
      channel: 'direct',
      legal_entity_id: fx.po,
      lines: [{ product_id: fx.product, quantity: '6' }],
    });
    const orderId = String(created.body?.id);
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${orderId}/confirm`);
    const lines = confirmed.lines as { id: string }[];
    const note = await json(ctx, 'POST', `/v1/sales-orders/${orderId}/delivery-notes`, {
      from_location_id: fx.bod,
      lines: [{ order_line_id: lines[0]?.id, quantity: '6', lot_id: fx.lot }],
    });
    const issuedNote = await json(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/issue`);
    expect(issuedNote.number).toBe(`AL${yy}-0001`);

    const pending = await json(ctx, 'GET', `/v1/delivery-notes?customer_id=${fx.other}&invoiced=false`);
    expect((pending.items as { id: string }[]).map((item) => item.id)).toEqual([String(note.id)]);
    const none = await json(ctx, 'GET', `/v1/delivery-notes?customer_id=${fx.customer}&invoiced=false`);
    expect(none.items).toEqual([]);

    const draft = await call(ctx, 'POST', '/v1/invoices', { invoice_type: 'F1', from_delivery_notes: [String(note.id)] });
    expect(draft.status).toBe(201);
    expect(draft.body?.legal_entity_id).toBe(fx.po);
    expect(draft.body?.series_id).toBeNull();
    const blocked = await issue(String(draft.body?.id));
    expect(blocked.status).toBe(409);
    expect(blocked.body?.code).toBe('WC_INV_NUMBERING');
    expect(blocked.body?.message).toBe(`Primera factura de PO en ${fx.year}: elige la numeración`);
    expect(blocked.body?.details).toEqual({ legal_entity_id: fx.po, entity_code: 'PO', doc_type: 'invoice', year: fx.year });
    expect(await seriesOf(fx.po, 'invoice')).toEqual([]);

    const opened = await openSeries(fx.po, 'invoice', 'fresh');
    expect(opened.status).toBe(201);
    expect(opened.body).toEqual(expect.objectContaining({
      code: 'FA', prefix: `FA${yy}-`, padding: 4, next_value: 1, verifactu: true, is_default: true,
    }));
    const issued = await issue(String(draft.body?.id));
    expect(issued.status).toBe(200);
    expect(issued.body?.number).toBe(`FA${yy}-0001`);
    const stored = await json(ctx, 'GET', `/v1/invoices/${String(draft.body?.id)}`);
    expect(stored.series_id).toBe(opened.body?.id);
  });

  it('crea y emite una factura con líneas manuales y otra desde un pedido', async () => {
    const manual = await call(ctx, 'POST', '/v1/invoices', {
      customer_id: fx.other,
      legal_entity_id: fx.cvpo,
      invoice_type: 'F1',
      lines: [{ product_id: fx.product, quantity: '3', lot_id: fx.lot }],
    });
    expect(manual.status).toBe(201);
    expect(manual.body?.total).toBe('34.49');
    expect((await issue(String(manual.body?.id))).body?.code).toBe('WC_INV_NUMBERING');
    expect((await openSeries(fx.cvpo, 'invoice', 'fresh')).status).toBe(201);
    const issued = await issue(String(manual.body?.id));
    expect(issued.status).toBe(200);
    expect(issued.body?.number).toBe(`FA${yy}-0001`);

    const created = await newOrder({
      customer_id: fx.other,
      channel: 'direct',
      legal_entity_id: fx.cvpo,
      lines: [{ product_id: fx.product, quantity: '2' }],
    });
    const orderId = String(created.body?.id);
    await json(ctx, 'POST', `/v1/sales-orders/${orderId}/confirm`);
    const orders = await json(ctx, 'GET', `/v1/sales-orders?customer_id=${fx.other}&status=confirmed`);
    expect((orders.items as { id: string }[]).some((item) => item.id === orderId)).toBe(true);
    const fromOrder = await call(ctx, 'POST', '/v1/invoices', { invoice_type: 'F1', from_order: orderId });
    expect(fromOrder.status).toBe(201);
    expect(fromOrder.body?.legal_entity_id).toBe(fx.cvpo);
    const lineIds = (fromOrder.body?.lines as { id: string }[]).map((line) => line.id);
    expect(lineIds).toHaveLength(1);
  });

  it('la rectificativa pide su numeración al emitirla', async () => {
    const draft = await call(ctx, 'POST', '/v1/invoices', {
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      invoice_type: 'F1',
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot }],
    });
    const issued = await issue(String(draft.body?.id));
    expect(issued.status).toBe(200);
    expect(issued.body?.number).toBe(`FA${yy}-0002`);
    const credit = await call(ctx, 'POST', '/v1/invoices', {
      invoice_type: 'R1',
      rectification_kind: 'S',
      reason: 'Sustitución de la original',
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      rectifies: [{ invoice_id: String(draft.body?.id) }],
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot }],
    });
    expect(credit.status).toBe(201);
    expect(credit.body?.series_id).toBeNull();
    const blocked = await issue(String(credit.body?.id));
    expect(blocked.status).toBe(409);
    expect(blocked.body?.message).toBe(`Primera rectificativa de PO en ${fx.year}: elige la numeración`);
    expect(blocked.body?.details).toEqual(expect.objectContaining({ doc_type: 'credit_note' }));
    const holded = await openSeries(fx.po, 'credit_note', 'holded');
    expect(holded.status).toBe(422);
    expect((await openSeries(fx.po, 'credit_note', 'fresh')).body?.prefix).toBe(`RC${yy}-`);
    const issuedCredit = await issue(String(credit.body?.id));
    expect(issuedCredit.status).toBe(200);
    expect(issuedCredit.body?.number).toBe(`RC${yy}-0001`);
  });
});

describe('confirmar sin reglas ni entidad elegida', () => {
  it('abre la v1 hacia la primera entidad activa por código', async () => {
    const fresh = await createTestApp();
    try {
      const fy = await buildSalesFixture(fresh, { rules: false, series: false });
      const created = await call(fresh, 'POST', '/v1/sales-orders', {
        customer_id: fy.other,
        channel: 'direct',
        lines: [{ product_id: fy.product, quantity: '6' }],
      }, { 'Idempotency-Key': `pedido-${newId()}` });
      expect(created.status).toBe(201);
      expect(created.body?.issuing_preview).toBeNull();
      const confirmed = await json(fresh, 'POST', `/v1/sales-orders/${String(created.body?.id)}/confirm`);
      expect(confirmed.entity_code).toBe('CVPO');
      expect(confirmed.number).toBe(`PE${String(fy.year).slice(2)}-0001`);
      const sets = await json(fresh, 'GET', '/v1/billing-rules/sets');
      expect(sets.items).toEqual([expect.objectContaining({ version: 1, status: 'active' })]);
    } finally {
      await fresh.close();
    }
  });
});

describe('ensureDefaultSeries', () => {
  const actor = { type: 'system' as const, id: 'series-test', requestId: 'series-test' };

  it('no abre otra serie si la entidad ya tiene una del tipo y año, aunque esté de baja', async () => {
    await ctx.writer.withWrite(actor, async (tx) => {
      tx.write(sql`
        INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, "year", prefix, padding, is_default, is_active)
        VALUES (CAST(${newId()} AS UUID), CAST(${fx.cvpo} AS UUID), 'delivery_note', 'AX', ${fx.year}, ${`AX${yy}-`}, 4, FALSE, FALSE)
      `);
    });
    const result = await ctx.writer.withWrite(actor, (tx) => ensureDefaultSeries(tx, fx.cvpo, 'delivery_note', fx.year));
    expect(result).toBeNull();
    expect(await seriesOf(fx.cvpo, 'delivery_note')).toHaveLength(1);
  });

  it('evita un prefijo ya usado en la entidad y repite la misma serie dentro de la escritura', async () => {
    await ctx.writer.withWrite(actor, async (tx) => {
      tx.write(sql`
        INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, "year", prefix, padding, is_default, is_active)
        VALUES (CAST(${newId()} AS UUID), CAST(${fx.po} AS UUID), 'proforma', 'X', ${fx.year}, ${`PR${yy}-`}, 4, TRUE, TRUE)
      `);
    });
    const [first, second] = await ctx.writer.withWrite(actor, async (tx) => [
      await ensureDefaultSeries(tx, fx.po, 'quote', fx.year),
      await ensureDefaultSeries(tx, fx.po, 'quote', fx.year),
    ]);
    expect(first?.prefix).toBe(`PR${yy}B-`);
    expect(second?.id).toBe(first?.id ?? '');
    expect(await seriesOf(fx.po, 'quote')).toEqual([expect.objectContaining({ code: 'PR', prefix: `PR${yy}B-` })]);
  });

  it('no abre series fiscales ni de tipos sin serie automática', async () => {
    const results = await ctx.writer.withWrite(actor, async (tx) => [
      await ensureDefaultSeries(tx, fx.po, 'invoice', fx.year + 1),
      await ensureDefaultSeries(tx, fx.po, 'credit_note', fx.year + 1),
      await ensureDefaultSeries(tx, fx.po, 'simplified_invoice', fx.year + 1),
      await ensureDefaultSeries(tx, fx.po, 'cellar_operation', fx.year + 1),
    ]);
    expect(results).toEqual([null, null, null, null]);
  });
});
