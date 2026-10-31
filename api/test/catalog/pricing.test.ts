import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Decimal } from 'decimal.js';
import { activateVersion, priceFor, rangesOverlap } from '../../src/core/catalog/pricing';
import { guards } from '../../src/core/db/guards/registry';
import { sql } from '../../src/core/db/sql';
import type { Actor } from '../../src/core/db/writer';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const actor: Actor = { type: 'user', id: 'pricing-test', requestId: 'pricing-test', reason: 'test' };

describe('vigencias', () => {
  it('trata el fin como exclusivo', () => {
    const open = { valid_from: '2026-01-01', valid_to: null };
    const next = { valid_from: '2027-03-01', valid_to: null };
    const closed = { valid_from: '2026-01-01', valid_to: '2027-03-01' };
    expect(rangesOverlap(open, next)).toBe(true);
    expect(rangesOverlap(closed, next)).toBe(false);
    expect(rangesOverlap(closed, { valid_from: '2027-02-01', valid_to: '2027-04-01' })).toBe(true);
    expect(rangesOverlap(next, next)).toBe(true);
  });

  it('marca la guarda de solape como implementada', () => {
    const guard = guards.find((item) => item.id === 'UQ:catalog.price_list_version(price_list_id,valid_from,valid_to)');
    expect(guard?.implemented).toBe(true);
    expect(guards.find((item) => item.id === 'WC050')?.implemented).toBe(true);
  });
});

describe('priceFor', () => {
  const ctxPromise = createTestApp();

  afterAll(async () => {
    const ctx = await ctxPromise;
    await ctx.close();
  });

  async function setup() {
    const ctx = await ctxPromise;
    const wine = newId();
    const format = newId();
    const product = newId();
    const finalList = newId();
    const distributor = newId();
    const shop = newId();
    const custom = newId();
    await ctx.writer.withWrite(actor, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.wine (id, code, name, color)
        VALUES (CAST(${wine} AS UUID), 'PRECIO', 'Precio Ejemplo', 'red')
      `);
      tx.write(sql`
        INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml)
        VALUES (CAST(${format} AS UUID), 'P075', '0,75', 'bottle', 750)
      `);
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, format_id, requires_lot)
        VALUES (
          CAST(${product} AS UUID), 'PRECIO075', 'Precio Ejemplo 2024', 'wine',
          CAST(${wine} AS UUID), 2024, CAST(${format} AS UUID), TRUE
        )
      `);
      for (const [id, code, name] of [
        [finalList, 'final', 'Final'],
        [distributor, 'distributor', 'Distribuidor'],
        [shop, 'shop', 'Tienda'],
        [custom, 'custom-cliente', 'Cliente'],
      ] as const) {
        tx.write(sql`
          INSERT INTO catalog.price_list (id, code, name, currency)
          VALUES (CAST(${id} AS UUID), ${code}, ${name}, 'EUR')
        `);
      }
    });

    async function version(listId: string, versionNo: number, from: string, to: string | null, price: string, tiers?: [string, string][]) {
      const versionId = newId();
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          INSERT INTO catalog.price_list_version (
            id, price_list_id, version, valid_from, valid_to, status, created_by
          ) VALUES (
            CAST(${versionId} AS UUID), CAST(${listId} AS UUID), ${versionNo},
            CAST(${from} AS DATE), CAST(${to} AS DATE), 'draft', 'pricing-test'
          )
        `);
        const lines = tiers ?? [['1', price] as [string, string]];
        for (const [minQty, unitPrice] of lines) {
          tx.write(sql`
            INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
            VALUES (
              CAST(${newId()} AS UUID), CAST(${versionId} AS UUID), CAST(${product} AS UUID),
              ${new Decimal(minQty)}, ${new Decimal(unitPrice)}
            )
          `);
        }
      });
      await ctx.writer.withWrite(actor, (tx) => activateVersion(tx, versionId));
      return versionId;
    }

    return { ctx, product, finalList, distributor, shop, custom, version };
  }

  it('prioriza cliente, luego canal y luego tarifa general, con escalones y fecha', async () => {
    const { ctx, product, finalList, distributor, shop, custom, version } = await setup();
    const finalV1 = await version(finalList, 1, '2026-01-01', '2027-03-01', '12.0000');
    const finalV2 = await version(finalList, 2, '2027-03-01', null, '15.0000');
    await version(distributor, 1, '2026-01-01', null, '8.0000', [['1', '8.0000'], ['6', '7.5000'], ['12', '7.0000']]);
    await version(shop, 1, '2026-01-01', null, '9.0000');
    await version(custom, 1, '2026-01-01', null, '10.0000');

    async function contact(channel: string | null, listId: string | null) {
      const id = newId();
      await ctx.client.query(sql`
        INSERT INTO party.contact (id, kind, legal_name, is_customer, default_channel, default_price_list_id, created_by)
        VALUES (
          CAST(${id} AS UUID), 'company', 'Cliente Ejemplo', TRUE, ${channel},
          CAST(${listId} AS UUID), 'pricing-test'
        )
      `);
      return id;
    }

    const customCustomer = await contact('distributor', custom);
    const channelCustomer = await contact('distributor', null);
    const generalCustomer = await contact(null, null);
    const shopCustomer = await contact('web', null);

    const customPrice = await priceFor(ctx.writer, {
      customerId: customCustomer,
      productId: product,
      qty: new Decimal('1'),
      date: '2026-06-01',
    });
    expect(customPrice.unitPrice).toBeInstanceOf(Decimal);
    expect(customPrice.unitPrice.toFixed(4)).toBe('10.0000');
    expect(customPrice.priceListCode).toBe('custom-cliente');

    const tier = await priceFor(ctx.writer, {
      customerId: channelCustomer,
      productId: product,
      qty: new Decimal('6'),
      date: '2026-06-01',
    });
    expect(tier.unitPrice.toFixed(4)).toBe('7.5000');
    expect(tier.minQty.toFixed(3)).toBe('6.000');
    const below = await priceFor(ctx.writer, {
      customerId: channelCustomer,
      productId: product,
      qty: new Decimal('5'),
      date: '2026-06-01',
    });
    expect(below.unitPrice.toFixed(4)).toBe('8.0000');
    const dozen = await priceFor(ctx.writer, {
      customerId: channelCustomer,
      productId: product,
      qty: new Decimal('12'),
      date: '2026-06-01',
    });
    expect(dozen.unitPrice.toFixed(4)).toBe('7.0000');

    const general = await priceFor(ctx.writer, {
      customerId: generalCustomer,
      productId: product,
      qty: new Decimal('1'),
      date: '2027-02-28',
    });
    expect(general.unitPrice.toFixed(4)).toBe('12.0000');
    expect(general.priceListVersionId).toBe(finalV1);
    const later = await priceFor(ctx.writer, {
      customerId: generalCustomer,
      productId: product,
      qty: new Decimal('1'),
      date: '2027-03-01',
    });
    expect(later.unitPrice.toFixed(4)).toBe('15.0000');
    expect(later.priceListVersionId).toBe(finalV2);

    const shopPrice = await priceFor(ctx.writer, {
      customerId: shopCustomer,
      productId: product,
      qty: new Decimal('1'),
      date: '2026-06-01',
    });
    expect(shopPrice.unitPrice.toFixed(4)).toBe('9.0000');
    expect(shopPrice.priceListCode).toBe('shop');

    const quote = await ctx.app.handle(new Request(
      `http://localhost/v1/price-quote?customer_id=${customCustomer}&product_id=${product}&qty=1.5&date=2026-06-01`,
    ));
    expect(quote.status).toBe(200);
    const raw = await quote.text();
    expect(raw).toContain('"unit_price":"10.0000"');
    const body = JSON.parse(raw) as { unit_price: string; min_qty: string };
    expect(typeof body.unit_price).toBe('string');
    expect(body.min_qty).toBe('1.000');

    const cellar = await ctx.app.handle(new Request(
      `http://localhost/v1/price-quote?customer_id=${customCustomer}&product_id=${product}&qty=1&date=2026-06-01`,
      { headers: { 'x-dev-user': 'bodega@winecore.test' } },
    ));
    expect(cellar.status).toBe(200);
    const denied = await ctx.app.handle(new Request('http://localhost/v1/price-lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-user': 'asesor@winecore.test' },
      body: JSON.stringify({ code: 'custom-asesor', name: 'No' }),
    }));
    expect(denied.status).toBe(403);
  });

  it('cierra la vigencia abierta anterior y rechaza un solape real', async () => {
    const ctx = await ctxPromise;
    const listId = newId();
    const openId = newId();
    const nextId = newId();
    const clashId = newId();
    await ctx.writer.withWrite(actor, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.price_list (id, code, name) VALUES (CAST(${listId} AS UUID), 'custom-solape', 'Solape')
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by)
        VALUES (CAST(${openId} AS UUID), CAST(${listId} AS UUID), 1, DATE '2026-01-01', 'draft', 'pricing-test')
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, created_by)
        VALUES (CAST(${nextId} AS UUID), CAST(${listId} AS UUID), 2, DATE '2027-03-01', 'draft', 'pricing-test')
      `);
      tx.write(sql`
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, valid_to, status, created_by)
        VALUES (
          CAST(${clashId} AS UUID), CAST(${listId} AS UUID), 3, DATE '2026-06-01', DATE '2026-12-01', 'draft', 'pricing-test'
        )
      `);
    });
    await ctx.writer.withWrite(actor, (tx) => activateVersion(tx, openId));
    await ctx.writer.withWrite(actor, (tx) => activateVersion(tx, nextId));
    const rows = await ctx.writer.read<{ version: number; valid_to: string | null }>(sql`
      SELECT version, CAST(valid_to AS VARCHAR) AS valid_to
      FROM catalog.price_list_version
      WHERE id = CAST(${openId} AS UUID)
    `);
    expect(rows[0]?.valid_to).toBe('2027-03-01');
    await expect(ctx.writer.withWrite(actor, (tx) => activateVersion(tx, clashId))).rejects.toMatchObject({
      code: 'WC_VALIDATION',
    });
    const clash = await ctx.writer.read<{ status: string }>(sql`
      SELECT status FROM catalog.price_list_version WHERE id = CAST(${clashId} AS UUID)
    `);
    expect(clash[0]?.status).toBe('draft');
  });
});
