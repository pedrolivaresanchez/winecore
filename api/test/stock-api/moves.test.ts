import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { call, insertFiscalMove, insertStockMove, jsonOf, seedCellar } from './fixture';

const SRC = '019a1000-0000-7000-8000-0000000000d0';

describe('movimientos', () => {
  it('lista el libro con filtros, cursor y CSV, y marca el periodo cerrado', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      const rows = [
        ['019a1000-0000-7000-8000-0000000000d1', '2027-01-15T10:00:00Z', 'cellar_in', 1_000],
        ['019a1000-0000-7000-8000-0000000000d2', '2027-02-02T10:00:00Z', 'delivery_out', -200],
        ['019a1000-0000-7000-8000-0000000000d3', '2027-02-03T10:00:00Z', 'cellar_in', 50],
      ] as const;
      for (const [id, occurredAt, moveType, volumeMl] of rows) {
        await insertStockMove(ctx.client, {
          id,
          occurredAt,
          moveType,
          locationId: cellar.bod,
          vesselId: cellar.tankPo,
          ownerId: cellar.po,
          lotId: cellar.lotPo,
          productId: null,
          productState: 'wine',
          qtyUnits: 0,
          volumeMl,
          sourceId: SRC,
        });
      }
      await insertFiscalMove(ctx.client, {
        id: '019a1000-0000-7000-8000-0000000000d4',
        warehouseId: cellar.warehouse,
        fiscalDate: '2027-02-02',
        moveType: 'loss',
        productClass: 'bulk',
        volumeMl: -200,
        lotId: cellar.lotPo,
        sourceId: SRC,
      });
      await ctx.client.query(`
        INSERT INTO inventory.period_lock (ledger, locked_until, locked_by, reason)
        VALUES ('physical', DATE '2027-01-31', 'test', 'cierre de enero')
      `);

      const page = await jsonOf<MovePage>(await ctx.app.handle(call(
        'GET',
        '/v1/stock/moves?book=physical&from=2027-02-01&to=2027-02-28&lot_id=' + cellar.lotPo + '&limit=1',
      )));
      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.move_type).toBe('cellar_in');
      expect(page.items[0]?.period_closed).toBe(false);
      expect(page.next_cursor).toBeTruthy();

      const rest = await jsonOf<MovePage>(await ctx.app.handle(call(
        'GET',
        '/v1/stock/moves?book=physical&from=2027-02-01&to=2027-02-28&lot_id=' + cellar.lotPo + '&limit=1&cursor=' + encodeURIComponent(page.next_cursor ?? ''),
      )));
      expect(rest.items).toHaveLength(1);
      expect(rest.items[0]?.move_type).toBe('delivery_out');
      expect(rest.next_cursor).toBeNull();

      const january = await jsonOf<MovePage>(await ctx.app.handle(call(
        'GET',
        '/v1/stock/moves?book=physical&from=2027-01-01&to=2027-01-31&move_type=cellar_in&source=' + SRC,
      )));
      expect(january.total).toBe(1);
      expect(january.items[0]?.period_closed).toBe(true);
      expect(january.items[0]?.volume_ml).toBe(1_000);

      const fiscal = await jsonOf<MovePage>(await ctx.app.handle(call(
        'GET',
        '/v1/stock/moves?book=fiscal&lot_id=' + cellar.lotPo + '&move_type=loss',
      )));
      expect(fiscal.total).toBe(1);
      expect(fiscal.items[0]?.volume_ml).toBe(-200);
      expect(fiscal.items[0]?.product_class).toBe('bulk');

      const csv = await ctx.app.handle(call('GET', '/v1/stock/moves?book=physical&format=csv&lot_id=' + cellar.lotPo));
      expect(csv.headers.get('content-type')).toContain('text/csv');
      const text = await csv.text();
      expect(text).toContain('delivery_out');
      expect(text).toContain('occurred_at');

      const missing = await ctx.app.handle(call('GET', '/v1/stock/moves'));
      expect(missing.status).toBe(422);
      expect((await jsonOf<{ code: string }>(missing)).code).toBe('WC_VALIDATION');
    } finally {
      await ctx.close();
    }
  });
});

interface MovePage {
  items: { move_type?: string; volume_ml?: number; period_closed?: boolean; product_class?: string }[];
  next_cursor: string | null;
  total: number;
}
