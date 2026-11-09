import { afterAll, describe, expect, it } from 'bun:test';
import { channelTariffLines } from '../../src/core/catalog/tariff-rules';
import { loadTariffs } from '../../src/core/catalog/load-tariffs';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const ctx = await createTestApp();

const EXPECTED = [
  { list: 'final', price: '32.000000' },
  { list: 'shop', price: '22.320000' },
  { list: 'custom-horeca', price: '24.000000' },
  { list: 'distributor', price: '18.000000' },
];

describe('tarifa ECLO 2026 en EE2024', () => {
  afterAll(async () => {
    await ctx.close();
  });

  it('inserta los precios de EE2024 en la versión vigente, sin actualizar filas referenciadas', async () => {
    const lines = channelTariffLines().filter((line) => line.wine === 'ECLO');
    expect(lines.map((line) => line.vintage)).toEqual([2024, 2024, 2024, 2024]);
    expect(lines.map((line) => line.lot)).toEqual(['EE2024', 'EE2024', 'EE2024', 'EE2024']);
    expect(lines.map((line) => line.pdfVintage)).toEqual([2022, 2022, 2022, 2022]);
    expect(lines.map((line) => `${line.list}:${line.price}`).sort()).toEqual([
      'custom-horeca:24.00',
      'distributor:18.00',
      'final:32.00',
      'shop:22.32',
    ]);

    const wine = newId();
    const soldOut = newId();
    const current = newId();
    const other = newId();
    const oldItem = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'eclo-tariff', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.wine (id, code, name, color, category, is_organic)
        VALUES (CAST(${wine} AS UUID), 'ECLO', 'ECLO', 'red', 'wine', TRUE)
      `);
      tx.write(sql`
        INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, unit, is_active, for_sale)
        VALUES
          (CAST(${soldOut} AS UUID), 'ECLO-2022', 'ECLO 2022', 'wine', CAST(${wine} AS UUID), 2022, 'ud', TRUE, TRUE),
          (CAST(${current} AS UUID), 'EE2024', 'Eclo 2024', 'wine', CAST(${wine} AS UUID), 2024, 'ud', TRUE, TRUE),
          (CAST(${other} AS UUID), 'EE2024-MAG', 'ECLO magnum 2024', 'wine', CAST(${wine} AS UUID), 2024, 'ud', TRUE, TRUE)
      `);
      for (const row of EXPECTED) {
        const list = newId();
        const version = newId();
        tx.write(sql`
          INSERT INTO catalog.price_list (id, code, name, currency, tax_included, is_active)
          VALUES (CAST(${list} AS UUID), ${row.list}, ${row.list}, 'EUR', ${row.list === 'final'}, TRUE)
        `);
        tx.write(sql`
          INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, notes, created_by)
          VALUES (
            CAST(${version} AS UUID), CAST(${list} AS UUID), 1, DATE '2026-01-01', 'active',
            'tarifa-pedro-2026', 'test'
          )
        `);
        tx.write(sql`
          INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
          VALUES (CAST(${newId()} AS UUID), CAST(${version} AS UUID), CAST(${soldOut} AS UUID), 1, 1.00)
        `);
      }
      tx.write(sql`
        INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
        SELECT CAST(${oldItem} AS UUID), v.id, CAST(${soldOut} AS UUID), 6, 1.50
        FROM catalog.price_list_version v
        JOIN catalog.price_list l ON l.id = v.price_list_id
        WHERE l.code = 'final'
      `);
    });

    const blocked = await ctx.writer.withWrite({ type: 'system', id: 'fk', requestId: newId() }, async (tx) => {
      try {
        tx.write(sql`UPDATE catalog.product SET wine_id = CAST(${wine} AS UUID) WHERE id = CAST(${soldOut} AS UUID)`);
        return false;
      } catch (error) {
        return error instanceof Error && /referenced|foreign key/i.test(error.message);
      }
    }).catch((error: unknown) => error instanceof Error && /referenced|foreign key/i.test(error.message));
    expect(blocked).toBe(true);

    const first = await loadTariffs(ctx.writer);
    const ecloMiss = first.unmatched.filter((row) => row.wine === 'ECLO' && row.vintage === '2024');
    expect(ecloMiss).toEqual([]);
    const added = first.loaded.filter((row) => EXPECTED.some((item) => item.list === row.list));
    expect(added.map((row) => row.prices).sort()).toEqual([1, 1, 1, 1]);

    const prices = await ctx.writer.read<{ list: string; sku: string; price: string; id: string }>(`
      SELECT l.code AS list, p.sku, i.unit_price::VARCHAR AS price, i.id::VARCHAR AS id
      FROM catalog.price_list_item i
      JOIN catalog.price_list_version v ON v.id = i.version_id
      JOIN catalog.price_list l ON l.id = v.price_list_id
      JOIN catalog.product p ON p.id = i.product_id
      WHERE p.sku IN ('EE2024', 'ECLO-2022', 'EE2024-MAG')
      ORDER BY l.code, p.sku, i.min_qty
    `);
    const ee = prices.filter((row) => row.sku === 'EE2024');
    expect(ee.map((row) => `${row.list}:${row.price}`).sort()).toEqual(
      EXPECTED.map((row) => `${row.list}:${row.price}`).sort(),
    );
    expect(prices.filter((row) => row.sku === 'EE2024-MAG')).toEqual([]);
    const sold = prices.filter((row) => row.sku === 'ECLO-2022');
    expect(sold.map((row) => row.price).sort()).toEqual(['1.000000', '1.000000', '1.000000', '1.000000', '1.500000']);
    const stored = await ctx.writer.read<{ sku: string; vintage: string }>(`
      SELECT sku, vintage::VARCHAR AS vintage FROM catalog.product WHERE sku IN ('ECLO-2022', 'EE2024')
    `);
    expect(stored.find((row) => row.sku === 'ECLO-2022')?.vintage).toBe('2022');
    expect(stored.find((row) => row.sku === 'EE2024')?.vintage).toBe('2024');

    const again = await loadTariffs(ctx.writer);
    expect(again.loaded.filter((row) => EXPECTED.some((item) => item.list === row.list)).every((row) => row.prices === 0)).toBe(true);
    const after = await ctx.writer.read<{ n: string }>(sql`
      SELECT count(*)::VARCHAR AS n
      FROM catalog.price_list_item i
      JOIN catalog.product p ON p.id = i.product_id
      WHERE p.sku = 'EE2024'
    `);
    expect(after[0]?.n).toBe('4');
    const oldStill = await ctx.writer.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM catalog.price_list_item WHERE id = CAST(${oldItem} AS UUID)
    `);
    expect(oldStill).toHaveLength(1);
  });
});
