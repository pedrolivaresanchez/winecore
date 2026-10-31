import { afterAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const ctx = await createTestApp();

describe('índice de liquidaciones y ficha de tarifa', () => {
  const priceList = newId();
  const tariff = newId();
  const closed = newId();
  const open = newId();
  const line = newId();
  const product = newId();

  afterAll(async () => {
    await ctx.close();
  });

  it('lista los meses sin periodo y devuelve la tarifa', async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id, code FROM core.legal_entity`);
    const po = entities.find((row) => row.code === 'PO')?.id;
    const cvpo = entities.find((row) => row.code === 'CVPO')?.id;
    if (!po || !cvpo) throw new Error('Faltan las entidades');
    await ctx.writer.withWrite({ type: 'system', id: 'ic-index', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO catalog.price_list (id, code, name)
        VALUES (CAST(${priceList} AS UUID), 'custom-panel', 'Tarifa de prueba')
      `);
      tx.write(sql`
        INSERT INTO catalog.intercompany_tariff (
          id, seller_entity_id, buyer_entity_id, base_price_list_id, discount_pct, valid_from,
          status, advisor_validation, created_by
        ) VALUES (
          CAST(${tariff} AS UUID), CAST(${po} AS UUID), CAST(${cvpo} AS UUID), CAST(${priceList} AS UUID),
          15.00, CAST('2026-01-01' AS DATE), 'active', 'nota del asesor', 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO billing.intercompany_settlement (
          id, seller_entity_id, buyer_entity_id, period_start, period_end, status, tariff_id
        ) VALUES
          (CAST(${closed} AS UUID), CAST(${po} AS UUID), CAST(${cvpo} AS UUID),
           CAST('2026-05-01' AS DATE), CAST('2026-05-31' AS DATE), 'closed', CAST(${tariff} AS UUID)),
          (CAST(${open} AS UUID), CAST(${po} AS UUID), CAST(${cvpo} AS UUID),
           CAST('2026-03-01' AS DATE), CAST('2026-03-31' AS DATE), 'open', NULL)
      `);
      tx.write(sql`
        INSERT INTO billing.intercompany_settlement_line (
          id, settlement_id, source_table, source_id, product_id, quantity,
          base_unit_price, discount_pct, unit_price, occurred_at
        ) VALUES (
          CAST(${line} AS UUID), CAST(${closed} AS UUID), 'inventory.stock_move', CAST(${newId()} AS UUID),
          CAST(${product} AS UUID), 2, 5, 0, 5, TIMESTAMPTZ '2026-05-10 10:00:00+00'
        )
      `);
    });

    const index = await json('/v1/intercompany/settlements');
    const items = index.items as {
      id: string;
      period: string;
      status: string;
      totals: { units: string; amount: string; liters: string | null };
      deadline: string;
    }[];
    expect(items.map((item) => item.period)).toEqual(['2026-05', '2026-03']);
    expect(items[0]).toMatchObject({
      id: closed,
      status: 'closed',
      deadline: '2026-06-15',
      totals: { units: '2.000', amount: '10.00', liters: null },
    });
    expect(items[1]).toMatchObject({
      id: open,
      status: 'open',
      deadline: '2026-04-15',
      totals: { units: '0.000', amount: '0.00', liters: null },
    });

    const detail = await json('/v1/intercompany/settlements?period=2026-05');
    expect(detail.period).toBe('2026-05');
    expect(Array.isArray(detail.lines)).toBe(true);

    const card = await json(`/v1/intercompany/tariffs/${tariff}`);
    expect(card).toMatchObject({
      id: tariff,
      discount_pct: '15.00',
      status: 'active',
      seller_entity_id: po,
      buyer_entity_id: cvpo,
    });
    const missing = await call(`/v1/intercompany/tariffs/${newId()}`);
    expect(missing.status).toBe(404);
    const forbidden = await call('/v1/intercompany/settlements', 'bodega@winecore.test');
    expect(forbidden.status).toBe(403);
  });

  async function call(path: string, user?: string) {
    const headers = new Headers();
    if (user) headers.set('x-dev-user', user);
    const response = await ctx.app.handle(new Request(`http://localhost${path}`, { headers }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  async function json(path: string) {
    const result = await call(path);
    if (result.status !== 200) throw new Error(`${path} -> ${result.status} ${JSON.stringify(result.body)}`);
    return result.body;
  }
});
