import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';
import { buildSalesFixture, call, companyCif, json, type SalesFixture } from './fixture';

const ctx = await createTestApp();

describe('catálogo de ventas y presupuestos', () => {
  let fx: SalesFixture;
  const packaging = newId();
  const finalList = newId();
  const finalVersion = newId();

  beforeAll(async () => {
    fx = await buildSalesFixture(ctx);
    await ctx.writer.withWrite({ type: 'system', id: 'catalog-test', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, unit)
        VALUES (CAST(${packaging} AS UUID), 'TAPONX', 'Tapon sintetico', 'packaging_material', 'ud')
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list (id, code, name)
        VALUES (CAST(${finalList} AS UUID), 'final', 'Tarifa general')
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by, activated_at)
        VALUES (CAST(${finalVersion} AS UUID), CAST(${finalList} AS UUID), 1, DATE '2026-01-01', 'active', 'test', now())
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
        VALUES (CAST(${newId()} AS UUID), CAST(${finalVersion} AS UUID), CAST(${fx.product} AS UUID), 1, 12)
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
      default_tax_code: string | null;
      format: { code: string; nominal_volume_ml: number } | null;
      price: { unit_price: string; currency: string } | null;
    }[];
    expect(products.some((item) => item.id === packaging)).toBe(false);
    const wine = products.find((item) => item.id === fx.product);
    expect(wine?.sku).toBe('TINTO2025B075');
    expect(wine?.default_tax_code).toBe('IVA21');
    expect(wine?.format).toMatchObject({ code: 'B075', nominal_volume_ml: 750 });
    expect(wine?.price).toMatchObject({ currency: 'EUR', unit_price: '9.500000' });
    const taxes = catalog.taxes as { code: string; rate: string; surcharge_rate: string }[];
    expect(taxes.find((tax) => tax.code === 'IVA21')).toEqual({ code: 'IVA21', rate: '21.00', surcharge_rate: '0.00' });
    const lots = catalog.lots as { id: string; location_code: string; qty_units: string }[];
    const full = lots.find((lot) => lot.id === fx.lot);
    expect(full?.location_code).toBe('BOD');
    expect(Number(full?.qty_units)).toBe(10000);
    expect(lots.some((lot) => lot.id === fx.shortLot)).toBe(true);

    const forbidden = await call(ctx, 'GET', '/v1/sales/catalog', undefined, { 'x-dev-user': 'bodega@winecore.test' });
    expect(forbidden.status).toBe(403);
  });

  it('sin cliente precio con la tarifa del canal y, si no existe, con la general', async () => {
    const bare = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'catalog-default', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, unit)
        VALUES (CAST(${bare} AS UUID), 'SINPRECIO', 'Sin precio sintetico', 'merchandise', 'ud')
      `);
    });

    const general = await json(ctx, 'GET', '/v1/sales/catalog?date=2026-10-31');
    expect(general.customer_id).toBeNull();
    expect(general.price_list_id).toBe(finalList);
    const priced = productsOf(general).find((item) => item.id === fx.product);
    expect(priced?.price).toMatchObject({ currency: 'EUR', unit_price: '12.000000', price_list_id: finalList });
    expect(productsOf(general).find((item) => item.id === bare)?.price).toBeNull();

    const horeca = await json(ctx, 'GET', '/v1/sales/catalog?channel=horeca&date=2026-10-31');
    expect(horeca.price_list_id).toBe(fx.priceList);
    expect(productsOf(horeca).find((item) => item.id === fx.product)?.price).toMatchObject({ unit_price: '9.500000' });
    const direct = await json(ctx, 'GET', '/v1/sales/catalog?channel=direct&date=2026-10-31');
    expect(direct.price_list_id).toBe(finalList);

    const edi = await json(ctx, 'GET', '/v1/sales/catalog?channel=eci_edi&date=2026-10-31');
    expect(edi.price_list_id).toBe(fx.priceList);
    expect(productsOf(edi).find((item) => item.id === fx.product)?.price).toMatchObject({ unit_price: '9.500000' });
    expect(productsOf(edi).find((item) => item.id === bare)?.price).toBeNull();
  });

  it('con el canal del documento, el precio por cantidad es el que guarda el presupuesto', async () => {
    const loose = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'catalog-channel', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO party.contact (
          id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, is_customer, created_by
        ) VALUES (
          CAST(${loose} AS UUID), 'company', 'Cliente Sin Tarifa', ${companyCif()}, 'nif', 'ES', 'ES', TRUE, 'test'
        )
      `);
    });
    const query = `/v1/price-quote?customer_id=${loose}&product_id=${fx.product}&qty=24&date=2026-10-31`;

    const general = await json(ctx, 'GET', query);
    expect(general).toMatchObject({ unit_price: '12.000000', price_list_id: finalList });

    const horeca = await json(ctx, 'GET', `${query}&channel=horeca`);
    expect(horeca).toMatchObject({ unit_price: '9.000000', min_qty: '24.000', price_list_id: fx.priceList });
    const created = await json(ctx, 'POST', '/v1/quotes', {
      customer_id: loose,
      channel: 'horeca',
      lines: [{ product_id: fx.product, quantity: '24' }],
    });
    expect((created.lines as { unit_price: string }[])[0]?.unit_price).toBe(horeca.unit_price);

    const shop = await call(ctx, 'GET', `${query}&channel=cellar_shop`);
    expect(shop.status).toBe(422);
    const unknown = await call(ctx, 'GET', `${query}&channel=marte`);
    expect(unknown.status).toBe(422);
  });

  it('sin canal en la petición, catálogo, precio y factura usan el canal del cliente con la tabla de ventas', async () => {
    const restaurant = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'catalog-customer-channel', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO party.contact (
          id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, is_customer, default_channel, created_by
        ) VALUES (
          CAST(${restaurant} AS UUID), 'company', 'Restaurante Ejemplo', ${companyCif()}, 'nif', 'ES', 'ES', TRUE, 'horeca', 'test'
        )
      `);
    });

    const catalog = await json(ctx, 'GET', `/v1/sales/catalog?customer_id=${restaurant}&date=2026-10-31`);
    expect(catalog.price_list_id).toBe(fx.priceList);
    const quote = await json(ctx, 'GET', `/v1/price-quote?customer_id=${restaurant}&product_id=${fx.product}&qty=24&date=2026-10-31`);
    expect(quote).toMatchObject({ unit_price: '9.000000', price_list_id: fx.priceList });

    const invoice = await json(ctx, 'POST', '/v1/invoices', {
      customer_id: restaurant,
      legal_entity_id: fx.po,
      invoice_type: 'F1',
      issue_date: '2026-10-31',
      lines: [{ product_id: fx.product, quantity: '24' }],
    });
    expect(invoice.channel).toBe('horeca');
    expect(Number((invoice.lines as { unit_price: string }[])[0]?.unit_price)).toBe(Number(quote.unit_price));
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

function productsOf(body: Record<string, unknown>) {
  return body.products as {
    id: string;
    price: { unit_price: string; currency: string; price_list_id: string } | null;
  }[];
}
