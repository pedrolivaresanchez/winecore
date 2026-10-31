import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { approveSet, buildSalesFixture, call, companyCif, json, req, type SalesFixture } from './fixture';

const ctx = await createTestApp();
let fx: SalesFixture;

beforeAll(async () => {
  fx = await buildSalesFixture(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('ventas', () => {
  it('resuelve D3 por cliente, luego canal y luego defecto', async () => {
    const customer = await call(ctx, 'GET', `/v1/billing-rules/resolve?customer_id=${fx.customer}&channel=direct`);
    expect(customer.status).toBe(200);
    expect(customer.body?.matched_scope).toBe('customer');
    expect(customer.body?.entity_id).toBe(fx.po);
    expect(String(customer.body?.label)).toContain('Cliente Ejemplo');

    const channel = await call(ctx, 'GET', `/v1/billing-rules/resolve?customer_id=${fx.other}&channel=horeca`);
    expect(channel.body?.matched_scope).toBe('channel');
    expect(channel.body?.entity_id).toBe(fx.po);

    const fallback = await call(ctx, 'GET', `/v1/billing-rules/resolve?customer_id=${fx.other}&channel=direct`);
    expect(fallback.body?.matched_scope).toBe('default');
    expect(fallback.body?.entity_id).toBe(fx.cvpo);
  });

  it('rechaza dos reglas del mismo ámbito (WC070) y no edita un conjunto activo', async () => {
    const draft = await json(ctx, 'POST', '/v1/billing-rules/sets', {});
    const duplicated = await call(ctx, 'PUT', `/v1/billing-rules/sets/${String(draft.id)}/rules`, {
      rules: [
        { scope: 'default', issuing_entity_id: fx.cvpo },
        { scope: 'default', issuing_entity_id: fx.po },
      ],
    });
    expect(duplicated.status).toBe(409);
    expect(duplicated.body?.code).toBe('WC070');

    const sets = await json(ctx, 'GET', '/v1/billing-rules/sets');
    const active = (sets.items as { id: string; status: string }[]).find((item) => item.status === 'active');
    const locked = await call(ctx, 'PUT', `/v1/billing-rules/sets/${active?.id}/rules`, {
      rules: [{ scope: 'default', issuing_entity_id: fx.po }],
    });
    expect(locked.status).toBe(409);
    expect(locked.body?.code).toBe('WC070');
  });

  it('toma el precio de la tarifa según la cantidad', async () => {
    const small = await json(ctx, 'GET', `/v1/price-quote?customer_id=${fx.customer}&product_id=${fx.product}&qty=12`);
    expect(small.unit_price).toBe('9.500000');
    const large = await json(ctx, 'GET', `/v1/price-quote?customer_id=${fx.customer}&product_id=${fx.product}&qty=24`);
    expect(large.unit_price).toBe('9.000000');
  });

  it('convierte presupuesto en pedido y albarán sin efectos fiscales en la proforma', async () => {
    const fiscalBefore = await count(ctx, 'inventory.fiscal_move');
    const verifactuBefore = await count(ctx, 'regulatory.verifactu_record');
    const quoteMovesBefore = await ctx.writer.read<{ n: number }>(
      `SELECT count(*)::INTEGER AS n FROM inventory.stock_move WHERE source_table = 'sales.quote'`,
    );
    const created = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'export',
      language: 'en',
      is_proforma: true,
      incoterm: 'FCA',
      lines: [{ product_id: fx.product, quantity: '12' }],
    });
    expect(created.is_proforma).toBe(true);
    expect(created.number).toBeNull();
    const pdf = await ctx.app.handle(req('GET', `/v1/quotes/${String(created.id)}/pdf`));
    expect(pdf.status).toBe(200);
    const text = await pdf.text();
    expect(text).toContain('Proforma');
    expect(text).toContain('FCA');
    expect(text).not.toContain('Factura');
    expect(text).not.toContain('QR');
    expect(text).not.toContain('Verifactu');
    expect(await count(ctx, 'inventory.fiscal_move')).toBe(fiscalBefore);
    expect(await count(ctx, 'regulatory.verifactu_record')).toBe(verifactuBefore);
    expect(Number(quoteMovesBefore[0]?.n ?? 0)).toBe(0);

    const orderResult = await call(ctx, 'POST', `/v1/quotes/${String(created.id)}/to-order`);
    expect(orderResult.status).toBe(201);
    const orderId = String(orderResult.body?.id);
    expect(orderResult.body?.status).toBe('draft');
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${orderId}/confirm`);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.legal_entity_id).toBe(fx.po);
    expect(String(confirmed.rule_label)).toContain('Cliente Ejemplo');
    expect(confirmed.number).toBeTruthy();
    const lines = confirmed.lines as { id: string; quantity: string; unit_price: string }[];
    expect(lines[0]?.unit_price).toBe('9.500000');
    expect(confirmed.subtotal).toBe('114.00');

    const half = await json(ctx, 'POST', `/v1/sales-orders/${orderId}/delivery-notes`, {
      from_location_id: fx.bod,
      lines: [{ order_line_id: lines[0]?.id, quantity: '6', lot_id: fx.lot }],
    });
    const issued = await json(ctx, 'POST', `/v1/delivery-notes/${String(half.id)}/issue`);
    expect(issued.status).toBe('issued');
    expect(String(issued.number)).toMatch(/^A\d{2}-0001$/);
    const partial = await json(ctx, 'GET', `/v1/sales-orders/${orderId}`);
    expect(partial.status).toBe('partially_delivered');
    const moves = await ctx.writer.read<{ move_type: string; qty_units: number; volume_ml: number }>(sql`
      SELECT move_type, qty_units, volume_ml FROM inventory.stock_move
      WHERE source_id = CAST(${String(half.id)} AS UUID)
    `);
    expect(moves.map((row) => String(row.move_type))).toEqual(['delivery_out']);
    expect(Number(moves[0]?.qty_units)).toBe(-6);
    expect(Number(moves[0]?.volume_ml)).toBe(-6 * 750);
    expect(await count(ctx, 'inventory.fiscal_move')).toBe(fiscalBefore);

    const rest = await json(ctx, 'POST', `/v1/sales-orders/${orderId}/delivery-notes`, {
      from_location_id: fx.bod,
      lines: [{ order_line_id: lines[0]?.id, quantity: '6', lot_id: fx.lot }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(rest.id)}/issue`);
    const done = await json(ctx, 'GET', `/v1/sales-orders/${orderId}`);
    expect(done.status).toBe('delivered');
  });

  it('no escribe nada si el saldo queda negativo y exige lote', async () => {
    const order = await makeOrder(fx.customer, '2');
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${order.id}/confirm`);
    const lineId = (confirmed.lines as { id: string }[])[0]?.id;
    const missing = await call(ctx, 'POST', `/v1/sales-orders/${order.id}/delivery-notes`, {
      from_location_id: fx.bod,
      lines: [{ order_line_id: lineId, quantity: '1' }],
    });
    const noteId = String(missing.body?.id);
    const noLot = await call(ctx, 'POST', `/v1/delivery-notes/${noteId}/issue`);
    expect(noLot.status).toBe(422);
    expect(noLot.text).toContain('Indica el lote de la línea 1');

    const seriesBefore = await nextValue(fx.po);
    const shortOrder = await makeOrder(fx.customer, '5');
    const shortConfirmed = await json(ctx, 'POST', `/v1/sales-orders/${shortOrder.id}/confirm`);
    const shortLine = (shortConfirmed.lines as { id: string }[])[0]?.id;
    const draft = await json(ctx, 'POST', `/v1/sales-orders/${shortOrder.id}/delivery-notes`, {
      from_location_id: fx.bod,
      lines: [{ order_line_id: shortLine, quantity: '5', lot_id: fx.shortLot }],
    });
    const denied = await call(ctx, 'POST', `/v1/delivery-notes/${String(draft.id)}/issue`);
    expect(denied.status).toBe(422);
    expect(denied.body?.code).toBe('WC024');
    expect(String(denied.body?.message)).toContain('LSHORT01');
    expect(String(denied.body?.message)).toContain('BOD');
    const still = await json(ctx, 'GET', `/v1/delivery-notes/${String(draft.id)}`);
    expect(still.status).toBe('draft');
    expect(still.number).toBeNull();
    expect(await nextValue(fx.po)).toBe(seriesBefore);
    const written = await ctx.writer.read<{ n: number }>(sql`
      SELECT count(*)::INTEGER AS n FROM inventory.stock_move WHERE source_id = CAST(${String(draft.id)} AS UUID)
    `);
    expect(Number(written[0]?.n ?? 0)).toBe(0);
  });

  it('anula con reversión, traspasa, consigna y devuelve dentro y fuera del perímetro', async () => {
    const fiscalBefore = await count(ctx, 'inventory.fiscal_move');
    const order = await makeOrder(fx.customer, '10');
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${order.id}/confirm`);
    const lineId = (confirmed.lines as { id: string }[])[0]?.id;
    const note = await json(ctx, 'POST', `/v1/sales-orders/${order.id}/delivery-notes`, {
      from_location_id: fx.bod,
      lines: [{ order_line_id: lineId, quantity: '4', lot_id: fx.lot }],
    });
    const issued = await json(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/issue`);
    const locked = await call(ctx, 'PATCH', `/v1/delivery-notes/${String(note.id)}`, {
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot }],
    });
    expect(locked.status).toBe(409);
    expect(locked.body?.code).toBe('WC060');
    const shipped = await call(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/void`, { reason: 'tarde' });
    expect(shipped.status).toBe(200);
    const sum = await ctx.writer.read<{ qty: number; volume: number }>(sql`
      SELECT coalesce(sum(qty_units), 0) AS qty, coalesce(sum(volume_ml), 0) AS volume
      FROM inventory.stock_move WHERE source_id = CAST(${String(note.id)} AS UUID)
    `);
    expect(Number(sum[0]?.qty)).toBe(0);
    expect(Number(sum[0]?.volume)).toBe(0);
    expect(issued.status).toBe('issued');

    const abroad = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'sale',
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      channel: 'export',
      from_location_id: fx.bod,
      ship_to: { country_code: 'GB' },
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot, unit_price: '9.5', tax_code: 'IVA21' }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(abroad.id)}/issue`);
    const ead = await call(ctx, 'POST', `/v1/delivery-notes/${String(abroad.id)}/dispatch`, {});
    expect(ead.status).toBe(409);
    expect(ead.body?.code).toBe('WC_REG_EAD_REQUIRED');

    const local = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'sale',
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      from_location_id: fx.bod,
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot, unit_price: '9.5', tax_code: 'IVA21' }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(local.id)}/issue`);
    const dispatched = await json(ctx, 'POST', `/v1/delivery-notes/${String(local.id)}/dispatch`, { tracking_ref: 'SEG-1' });
    expect(dispatched.status).toBe('shipped');
    const adminVoid = await call(ctx, 'POST', `/v1/delivery-notes/${String(local.id)}/void`, { reason: 'no' }, {
      'X-Dev-User': 'admin@winecore.test',
    });
    expect(adminVoid.status).toBe(403);

    const transfer = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'transfer',
      legal_entity_id: fx.po,
      from_location_id: fx.bod,
      to_location_id: fx.vlc,
      lines: [{ product_id: fx.product, quantity: '3', lot_id: fx.lot }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(transfer.id)}/issue`);
    const transferMoves = await ctx.writer.read<{ move_type: string; qty_units: number; location_id: string }>(sql`
      SELECT move_type, qty_units, location_id FROM inventory.stock_move
      WHERE source_id = CAST(${String(transfer.id)} AS UUID) ORDER BY move_type
    `);
    expect(transferMoves.map((row) => String(row.move_type)).sort()).toEqual(['delivery_out', 'transfer_in']);
    const transferSum = transferMoves.reduce((acc, row) => acc + Number(row.qty_units), 0);
    expect(transferSum).toBe(0);

    const consignment = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'consignment',
      legal_entity_id: fx.po,
      customer_id: fx.customer,
      from_location_id: fx.bod,
      to_location_id: fx.tfrp,
      lines: [{ product_id: fx.product, quantity: '5', lot_id: fx.lot, unit_price: '9.5', tax_code: 'IVA21' }],
    });
    const consigned = await json(ctx, 'POST', `/v1/delivery-notes/${String(consignment.id)}/issue`);
    expect(consigned.invoicing_status).toBe('not_invoiced');
    const pending = await json(ctx, 'GET', '/v1/delivery-notes/uninvoiced-lines');
    const pendingIds = (pending.items as { delivery_note_id: string }[]).map((item) => item.delivery_note_id);
    expect(pendingIds).toContain(String(consignment.id));
    expect(await count(ctx, 'inventory.fiscal_move')).toBe(fiscalBefore);

    const sale = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'sale',
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      from_location_id: fx.bod,
      lines: [{ product_id: fx.product, quantity: '2', lot_id: fx.lot, unit_price: '9.5', tax_code: 'IVA21' }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(sale.id)}/issue`);
    const saleLines = (await json(ctx, 'GET', `/v1/delivery-notes/${String(sale.id)}`)).lines as { id: string }[];
    const outside = await json(ctx, 'POST', `/v1/delivery-notes/${String(sale.id)}/return`, {
      to_location_id: fx.dev,
      lines: [{ line_id: saleLines[0]?.id, quantity: '1' }],
    });
    const outsideIssued = await json(ctx, 'POST', `/v1/delivery-notes/${String(outside.id)}/issue`);
    expect(outsideIssued.status).toBe('issued');
    const outsideMoves = await ctx.writer.read<{ move_type: string; location_id: string }>(sql`
      SELECT move_type, location_id FROM inventory.stock_move WHERE source_id = CAST(${String(outside.id)} AS UUID)
    `);
    expect(outsideMoves.map((row) => String(row.move_type))).toEqual(['return_in']);
    expect(String(outsideMoves[0]?.location_id).toLowerCase()).toBe(fx.dev);
    expect(await count(ctx, 'inventory.fiscal_move')).toBe(fiscalBefore);

    const inside = await json(ctx, 'POST', `/v1/delivery-notes/${String(sale.id)}/return`, {
      to_location_id: fx.bod,
      lines: [{ line_id: saleLines[0]?.id, quantity: '1' }],
    });
    const insideIssued = await json(ctx, 'POST', `/v1/delivery-notes/${String(inside.id)}/issue`);
    expect(insideIssued.status).toBe('issued');
    expect(await count(ctx, 'inventory.fiscal_move')).toBe(fiscalBefore);

    await invoiceLine(fx, saleLines[0]?.id ?? '', String(sale.id));
    const blocked = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'sale',
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      from_location_id: fx.bod,
      lines: [{ product_id: fx.product, quantity: '1', lot_id: fx.lot, unit_price: '9.5', tax_code: 'IVA21' }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(blocked.id)}/issue`);
    const blockedLines = (await json(ctx, 'GET', `/v1/delivery-notes/${String(blocked.id)}`)).lines as { id: string }[];
    await invoiceLine(fx, blockedLines[0]?.id ?? '', String(blocked.id));
    const back = await json(ctx, 'POST', `/v1/delivery-notes/${String(blocked.id)}/return`, {
      to_location_id: fx.bod,
      lines: [{ line_id: blockedLines[0]?.id, quantity: '1' }],
    });
    const movesBefore = await count(ctx, 'inventory.stock_move');
    const refused = await call(ctx, 'POST', `/v1/delivery-notes/${String(back.id)}/issue`);
    expect(refused.status).toBe(422);
    expect(refused.text).toContain('impuesto devengado');
    expect(await count(ctx, 'inventory.stock_move')).toBe(movesBefore);
    expect(await count(ctx, 'inventory.fiscal_move')).toBe(fiscalBefore);
  });

  it('cambia el propietario cuando CVPO vende stock de P.O y registra la liquidación', async () => {
    await ctx.writer.withWrite({ type: 'system', id: 'sales-tariff', requestId: 'sales-tariff' }, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.intercompany_tariff (
          id, seller_entity_id, buyer_entity_id, base_price_list_id, discount_pct,
          valid_from, status, advisor_validation, created_by
        ) VALUES (
          CAST(${crypto.randomUUID()} AS UUID), CAST(${fx.po} AS UUID), CAST(${fx.cvpo} AS UUID),
          CAST(${fx.priceList} AS UUID), 60, DATE '2026-01-01', 'active', 'validación asesor ejemplo', 'fixture'
        )
      `);
    });
    const order = await makeOrder(fx.cvpoBuyer, '8');
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${order.id}/confirm`);
    expect(confirmed.legal_entity_id).toBe(fx.cvpo);
    const lineId = (confirmed.lines as { id: string }[])[0]?.id;
    const note = await json(ctx, 'POST', `/v1/sales-orders/${order.id}/delivery-notes`, {
      from_location_id: fx.bod,
      lines: [{ order_line_id: lineId, quantity: '8', lot_id: fx.lot }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/issue`);
    const moves = await ctx.writer.read<{ move_type: string; owner_entity_id: string; qty_units: number }>(sql`
      SELECT move_type, owner_entity_id, qty_units FROM inventory.stock_move
      WHERE source_id = CAST(${String(note.id)} AS UUID)
      ORDER BY move_type
    `);
    expect(moves.map((row) => String(row.move_type)).sort()).toEqual(['delivery_out', 'ownership_in', 'ownership_out']);
    const out = moves.find((row) => String(row.move_type) === 'ownership_out');
    const inn = moves.find((row) => String(row.move_type) === 'ownership_in');
    const sold = moves.find((row) => String(row.move_type) === 'delivery_out');
    expect(String(out?.owner_entity_id).toLowerCase()).toBe(fx.po);
    expect(String(inn?.owner_entity_id).toLowerCase()).toBe(fx.cvpo);
    expect(String(sold?.owner_entity_id).toLowerCase()).toBe(fx.cvpo);
    expect(Number(sold?.qty_units)).toBe(-8);
    const settlement = await ctx.writer.read<{ unit_price: string; quantity: string }>(sql`
      SELECT unit_price, quantity FROM billing.intercompany_settlement_line
      WHERE source_id = CAST(${lineId} AS UUID) OR source_table = 'sales.delivery_note_line'
    `);
    expect(settlement.length).toBeGreaterThan(0);
    expect(await count(ctx, 'inventory.fiscal_move')).toBe(0);
  });

  it('propone la merma de una rotura y no la crea hasta confirmarla', async () => {
    const note = await json(ctx, 'POST', '/v1/delivery-notes', {
      kind: 'sale',
      customer_id: fx.customer,
      legal_entity_id: fx.po,
      from_location_id: fx.bod,
      lines: [{ product_id: fx.product, quantity: '2', lot_id: fx.lot, unit_price: '9.5', tax_code: 'IVA21' }],
    });
    await json(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/issue`);
    const before = await countWhere(`source_table = 'sales.shipping_incident'`);
    const incident = await json(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/incidents`, {
      kind: 'breakage',
      description: 'Rotura de dos botellas en el transporte',
      units_affected: 2,
      carrier_claim_ref: 'CLM-100',
    });
    expect(incident.claim_deadline).toBeTruthy();
    const deadline = String(incident.claim_deadline);
    const notice = String(incident.notice_on);
    expect(shift(deadline, -3)).toBe(notice);
    const proposal = incident.proposed_shrinkage as { created: boolean; qty_units: number };
    expect(proposal.created).toBe(false);
    expect(proposal.qty_units).toBe(-2);
    expect(await countWhere(`source_table = 'sales.shipping_incident'`)).toBe(before);
    const confirmed = await json(ctx, 'POST', `/v1/delivery-notes/${String(note.id)}/incidents/${String(incident.id)}/confirm-loss`);
    expect(confirmed.created).toBe(true);
    expect(await countWhere(`source_table = 'sales.shipping_incident'`)).toBe(before + 1);
  });

  it('no confirma un pedido de El Corte Inglés sin departamento y exige permiso para la excepción', async () => {
    const denied = await call(ctx, 'POST', '/v1/sales-orders', orderBody(fx.eci, '1'), {
      'X-Dev-User': 'bodega@winecore.test',
      'Idempotency-Key': `eci-denegado-${companyCif()}`,
    });
    expect(denied.status).toBe(403);
    const order = await makeOrder(fx.eci, '1', 'eci_edi');
    const blocked = await call(ctx, 'POST', `/v1/sales-orders/${order.id}/confirm`);
    expect(blocked.status).toBe(422);
    expect(blocked.text).toContain('departamento');
    const admin = await call(ctx, 'POST', `/v1/sales-orders/${order.id}/entity-exception`, {
      legal_entity_id: fx.cvpo,
      reason: 'excepción de entidad de prueba',
    }, { 'X-Dev-User': 'admin@winecore.test' });
    expect(admin.status).toBe(403);
    await json(ctx, 'PATCH', `/v1/sales-orders/${order.id}`, {
      ...orderBody(fx.eci, '1', 'eci_edi'),
      customer_department: 'DEP-1',
      customer_cost_center: 'CC-9',
    });
    await json(ctx, 'POST', `/v1/sales-orders/${order.id}/entity-exception`, {
      legal_entity_id: fx.cvpo,
      reason: 'excepción de entidad de prueba',
    });
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${order.id}/confirm`);
    expect(confirmed.legal_entity_id).toBe(fx.cvpo);
    expect(confirmed.billing_rule_id).toBeTruthy();
  });

  it('no reasigna los pedidos ya confirmados al activar reglas nuevas', async () => {
    const order = await makeOrder(fx.customer, '1');
    const confirmed = await json(ctx, 'POST', `/v1/sales-orders/${order.id}/confirm`);
    expect(confirmed.legal_entity_id).toBe(fx.po);
    const ruleId = String(confirmed.billing_rule_id);
    const draft = await json(ctx, 'POST', '/v1/billing-rules/sets', {});
    await json(ctx, 'PUT', `/v1/billing-rules/sets/${String(draft.id)}/rules`, {
      rules: [
        { scope: 'customer', customer_id: fx.customer, issuing_entity_id: fx.cvpo },
        { scope: 'default', issuing_entity_id: fx.cvpo },
      ],
    });
    const impact = await json(ctx, 'GET', `/v1/billing-rules/sets/${String(draft.id)}/impact?days=90`);
    expect(Number(impact.would_change)).toBeGreaterThan(0);
    await approveSet(ctx, String(draft.id));
    const kept = await json(ctx, 'GET', `/v1/sales-orders/${order.id}`);
    expect(kept.legal_entity_id).toBe(fx.po);
    expect(kept.billing_rule_id).toBe(ruleId);
  });
});

function orderBody(customerId: string, quantity: string, channel = 'horeca') {
  return {
    customer_id: customerId,
    channel,
    source: 'manual',
    lines: [{ product_id: fx.product, quantity }],
  };
}

async function makeOrder(customerId: string, quantity: string, channel = 'horeca') {
  return json(ctx, 'POST', '/v1/sales-orders', orderBody(customerId, quantity, channel), {
    'Idempotency-Key': `pedido-${companyCif()}-${quantity}`,
  });
}

async function count(app: typeof ctx, table: string): Promise<number> {
  const rows = await app.writer.read<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}

async function countWhere(where: string): Promise<number> {
  const rows = await ctx.writer.read<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM inventory.stock_move WHERE ${where}`);
  return Number(rows[0]?.n ?? 0);
}

async function nextValue(entityId: string): Promise<number> {
  const rows = await ctx.writer.read<{ next_value: number }>(sql`
    SELECT next_value FROM core.number_series
    WHERE legal_entity_id = CAST(${entityId} AS UUID) AND doc_type = 'delivery_note' AND is_active
  `);
  return Number(rows[0]?.next_value ?? 0);
}

async function invoiceLine(current: SalesFixture, lineId: string, noteId: string): Promise<void> {
  const series = await ctx.writer.read<{ id: string }>(sql`
    SELECT id FROM core.number_series
    WHERE legal_entity_id = CAST(${current.po} AS UUID) AND doc_type = 'delivery_note' LIMIT 1
  `);
  const seriesId = String(series[0]?.id);
  const invoiceId = crypto.randomUUID();
  await ctx.writer.withWrite({ type: 'system', id: 'sales-invoice', requestId: `inv-${noteId}` }, async (tx) => {
    tx.write(sql`
      INSERT INTO billing.invoice (
        id, legal_entity_id, series_id, number, status, invoice_type, issue_date, customer_id,
        customer_snapshot, description, subtotal, tax_total, surcharge_total, withholding_total, total,
        issued_at, issued_by, created_by
      ) VALUES (
        CAST(${invoiceId} AS UUID), CAST(${current.po} AS UUID), CAST(${seriesId} AS UUID), ${`T-${noteId.slice(0, 8)}`},
        'issued', 'F1', CURRENT_DATE, CAST(${current.customer} AS UUID),
        ${sql.json({ name: 'Cliente Ejemplo' })}, 'Venta de vino',
        10, 2.10, 0, 0, 12.10, now(), CAST(${current.owner} AS UUID), ${current.owner}
      )
    `);
    tx.write(sql`
      INSERT INTO billing.invoice_line (
        id, invoice_id, line_no, product_id, description, quantity, unit_price, line_base, tax_code, delivery_note_line_id
      ) VALUES (
        CAST(${crypto.randomUUID()} AS UUID), CAST(${invoiceId} AS UUID), 1, CAST(${current.product} AS UUID),
        'Tinto Ejemplo', 1, 10, 10, 'IVA21', CAST(${lineId} AS UUID)
      )
    `);
  });
}

function shift(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}
