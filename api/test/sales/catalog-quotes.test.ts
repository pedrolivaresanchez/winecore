import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';
import { buildSalesFixture, call, json, type SalesFixture } from './fixture';

const ctx = await createTestApp();

describe('catálogo de ventas y presupuestos', () => {
  let fx: SalesFixture;
  const packaging = newId();

  beforeAll(async () => {
    fx = await buildSalesFixture(ctx);
    await ctx.writer.withWrite({ type: 'system', id: 'catalog-test', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, unit)
        VALUES (CAST(${packaging} AS UUID), 'TAPONX', 'Tapon sintetico', 'packaging_material', 'ud')
      `);
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('lista productos vendibles con formato y precio, y lotes con stock', async () => {
    const catalog = await json(ctx, 'GET', `/v1/sales/catalog?customer_id=${fx.customer}&channel=horeca&date=2026-10-31`);
    const products = catalog.products as {
      id: string;
      sku: string;
      format: { code: string; nominal_volume_ml: number } | null;
      price: { unit_price: string; currency: string } | null;
    }[];
    expect(products.some((item) => item.id === packaging)).toBe(false);
    const wine = products.find((item) => item.id === fx.product);
    expect(wine?.sku).toBe('TINTO2025B075');
    expect(wine?.format).toMatchObject({ code: 'B075', nominal_volume_ml: 750 });
    expect(wine?.price).toMatchObject({ currency: 'EUR', unit_price: '9.500000' });
    const lots = catalog.lots as { id: string; location_code: string; qty_units: string }[];
    const full = lots.find((lot) => lot.id === fx.lot);
    expect(full?.location_code).toBe('BOD');
    expect(Number(full?.qty_units)).toBe(10000);
    expect(lots.some((lot) => lot.id === fx.shortLot)).toBe(true);

    const forbidden = await call(ctx, 'GET', '/v1/sales/catalog', undefined, { 'x-dev-user': 'bodega@winecore.test' });
    expect(forbidden.status).toBe(403);
  });

  it('edita el borrador y acepta o rechaza', async () => {
    const created = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'horeca',
      notes: 'borrador',
      lines: [{ product_id: fx.product, quantity: '12' }],
    });
    expect(created.status).toBe('draft');
    expect(created.number).toBeNull();
    const lineId = (created.lines as { id: string }[])[0]?.id;

    const noted = await json(ctx, 'PATCH', `/v1/quotes/${String(created.id)}`, { notes: 'revisado', channel: 'direct' });
    expect(noted.notes).toBe('revisado');
    expect(noted.channel).toBe('direct');
    expect((noted.lines as { id: string }[])[0]?.id).not.toBe(lineId);

    const repriced = await json(ctx, 'PATCH', `/v1/quotes/${String(created.id)}`, {
      lines: [{ product_id: fx.product, quantity: '24' }],
    });
    expect((repriced.lines as { quantity: string; unit_price: string }[])[0]).toMatchObject({
      quantity: '24.000',
      unit_price: '9.000000',
    });
    expect(repriced.subtotal).toBe('216.00');

    const sent = await json(ctx, 'POST', `/v1/quotes/${String(created.id)}/send`, {});
    expect(sent.status).toBe('sent');
    expect(sent.number).not.toBeNull();
    const accepted = await json(ctx, 'POST', `/v1/quotes/${String(created.id)}/accept`, {});
    expect(accepted.status).toBe('accepted');
    expect(accepted.number).toBe(sent.number);
    const again = await json(ctx, 'POST', `/v1/quotes/${String(created.id)}/accept`, {});
    expect(again.status).toBe('accepted');

    const locked = await call(ctx, 'PATCH', `/v1/quotes/${String(created.id)}`, { notes: 'tarde' });
    expect(locked.status).toBe(422);
    const rejectedLate = await call(ctx, 'POST', `/v1/quotes/${String(created.id)}/reject`, { reason: 'ya aceptado' });
    expect(rejectedLate.status).toBe(422);

    const other = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: fx.customer,
      channel: 'direct',
      lines: [{ product_id: fx.product, quantity: '1' }],
    });
    const rejected = await json(ctx, 'POST', `/v1/quotes/${String(other.id)}/reject`, { reason: 'el cliente no sigue' });
    expect(rejected.status).toBe('rejected');
    expect(rejected.number).not.toBeNull();
    const repeat = await json(ctx, 'POST', `/v1/quotes/${String(other.id)}/reject`, {});
    expect(repeat.status).toBe('rejected');

    const missing = await call(ctx, 'POST', `/v1/quotes/${String(created.id)}/expire`, {});
    expect(missing.status).toBe(404);
  });
});
