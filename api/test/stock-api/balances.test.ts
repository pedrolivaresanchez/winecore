import { describe, expect, it } from 'bun:test';
import { businessDate } from '../../src/core/inventory/periods';
import { createTestApp } from '../helpers';
import { call, insertFiscalMove, insertStockMove, jsonOf, seedCellar, type Cellar } from './fixture';

const SRC = '019a1000-0000-7000-8000-0000000000aa';

describe('saldos e informe', () => {
  it('el saldo a una fecha es la suma de los movimientos y admite los filtros', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      await insertStockMove(ctx.client, bulk(cellar, '019a1000-0000-7000-8000-0000000000a1', '2027-03-15T10:00:00Z', 1_000));
      await insertStockMove(ctx.client, bulk(cellar, '019a1000-0000-7000-8000-0000000000a2', '2027-03-15T23:30:00Z', 400));
      await insertStockMove(ctx.client, bulk(cellar, '019a1000-0000-7000-8000-0000000000a3', '2027-03-16T12:00:00Z', 50));
      await insertStockMove(ctx.client, {
        id: '019a1000-0000-7000-8000-0000000000a4',
        occurredAt: '2027-03-16T12:00:00Z',
        moveType: 'cellar_in',
        locationId: cellar.vlc,
        vesselId: cellar.tankVlc,
        ownerId: cellar.cvpo,
        lotId: cellar.lotVlc,
        productId: null,
        productState: 'wine',
        qtyUnits: 0,
        volumeMl: 2_500,
        sourceId: SRC,
      });
      await insertStockMove(ctx.client, {
        id: '019a1000-0000-7000-8000-0000000000a5',
        occurredAt: '2027-03-16T12:00:00Z',
        moveType: 'cellar_in',
        locationId: cellar.bod,
        vesselId: null,
        ownerId: cellar.po,
        lotId: cellar.lotPack,
        productId: cellar.product,
        productState: 'packaged_labeled',
        qtyUnits: 10,
        volumeMl: 7_500,
        sourceId: SRC,
      });

      const day = await jsonOf<Page>(await ctx.app.handle(call('GET', '/v1/stock/balances?at=2027-03-15&lot_id=' + cellar.lotPo)));
      expect(day.total).toBe(1);
      expect(day.items[0]?.volume_ml).toBe(1_000);
      expect(day.notice).toBeNull();

      const nextDay = await jsonOf<Page>(await ctx.app.handle(call('GET', '/v1/stock/balances?at=2027-03-16&lot_id=' + cellar.lotPo)));
      expect(nextDay.items[0]?.volume_ml).toBe(1_450);

      const instant = await jsonOf<Page>(await ctx.app.handle(call('GET', '/v1/stock/balances?at=2027-03-15T23:30:00Z&lot_id=' + cellar.lotPo)));
      expect(instant.items[0]?.volume_ml).toBe(1_400);
      const included = [1_000, 400].reduce((sum, volume) => sum + volume, 0);
      expect(instant.items[0]?.volume_ml).toBe(included);
      expect(businessDate('2027-03-15T23:30:00Z')).toBe('2027-03-16');

      const owner = await jsonOf<Page>(await ctx.app.handle(call('GET', '/v1/stock/balances?at=2027-03-16&owner=P.O&location_id=' + cellar.vlc)));
      expect(owner.total).toBe(0);
      const cvpo = await jsonOf<Page>(await ctx.app.handle(call('GET', '/v1/stock/balances?at=2027-03-16&owner=CVPO&vessel_id=' + cellar.tankVlc)));
      expect(cvpo.total).toBe(1);
      expect(cvpo.items[0]?.volume_ml).toBe(2_500);
      expect(cvpo.items[0]?.owner_entity_id).toBe(cellar.cvpo);

      const product = await jsonOf<Page>(await ctx.app.handle(call('GET', '/v1/stock/balances?at=2027-03-16&product_id=' + cellar.product + '&state=packaged_labeled')));
      expect(product.total).toBe(1);
      expect(product.items[0]?.qty_units).toBe(10);
      expect(product.items[0]?.volume_ml).toBe(7_500);

      const beforeStart = await jsonOf<Page>(await ctx.app.handle(call('GET', '/v1/stock/balances?at=2026-06-01')));
      expect(beforeStart.total).toBe(0);
      expect(beforeStart.notice).toBe('WineCore no tiene datos antes del aforo de arranque');

      const bad = await ctx.app.handle(call('GET', '/v1/stock/balances?at=ayer'));
      expect(bad.status).toBe(422);
      expect((await jsonOf<{ code: string }>(bad)).code).toBe('WC_VALIDATION');
    } finally {
      await ctx.close();
    }
  });

  it('el saldo fiscal a una fecha es la suma de los movimientos fiscales', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      await insertFiscalMove(ctx.client, {
        id: '019a1000-0000-7000-8000-0000000000b1',
        warehouseId: cellar.warehouse,
        fiscalDate: '2027-03-01',
        moveType: 'opening',
        productClass: 'bulk',
        volumeMl: 5_000,
        sourceId: SRC,
      });
      await insertFiscalMove(ctx.client, {
        id: '019a1000-0000-7000-8000-0000000000b2',
        warehouseId: cellar.warehouse,
        fiscalDate: '2027-03-20',
        moveType: 'loss',
        productClass: 'bulk',
        volumeMl: -500,
        sourceId: SRC,
      });
      const early = await jsonOf<Page>(await ctx.app.handle(call('GET', '/v1/stock/fiscal-balances?at=2027-03-10&tax_warehouse_id=' + cellar.warehouse)));
      expect(early.total).toBe(1);
      expect(early.items[0]?.volume_ml).toBe(5_000);
      expect(early.items[0]?.product_class).toBe('bulk');
      const late = await jsonOf<Page>(await ctx.app.handle(call('GET', '/v1/stock/fiscal-balances?at=2027-03-31&product_id=')));
      expect(late.items.find((row) => row.product_class === 'bulk')?.volume_ml).toBe(4_500);
    } finally {
      await ctx.close();
    }
  });

  it('el informe de inspección devuelve JSON con hash, HTML imprimible y CSV', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      await insertStockMove(ctx.client, bulk(cellar, '019a1000-0000-7000-8000-0000000000c1', '2027-04-01T10:00:00Z', 4_800_000));
      const report = await jsonOf<{ hash: string; total: number; items: { litres: string; lot_code: string | null; vintage: number | null }[] }>(
        await ctx.app.handle(call('GET', '/v1/stock/inspection-report?at=2027-04-02')),
      );
      expect(report.total).toBe(1);
      expect(report.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(report.items[0]?.litres).toBe('4800.000');
      expect(report.items[0]?.lot_code).toBe('L25-T01');
      expect(report.items[0]?.vintage).toBe(2025);

      const html = await ctx.app.handle(call('GET', '/v1/stock/inspection-report?at=2027-04-02&format=html'));
      expect(html.headers.get('content-type')).toContain('text/html');
      const page = await html.text();
      expect(page).toContain(report.hash);
      expect(page).toContain('SHA-256');
      expect(page).toContain('4800.000');
      expect(page).toContain('L25-T01');

      const csv = await ctx.app.handle(call('GET', '/v1/stock/inspection-report?at=2027-04-02&format=csv'));
      expect(csv.headers.get('content-type')).toContain('text/csv');
      const text = await csv.text();
      expect(text.split('\n')[0]).toContain('volume_ml');
      expect(text).toContain('4800000');
    } finally {
      await ctx.close();
    }
  });
});

interface Page {
  items: { volume_ml?: number; qty_units?: number; owner_entity_id?: string; product_class?: string }[];
  next_cursor: string | null;
  total: number;
  notice: string | null;
}

function bulk(cellar: Cellar, id: string, occurredAt: string, volumeMl: number) {
  return {
    id,
    occurredAt,
    moveType: 'cellar_in',
    locationId: cellar.bod,
    vesselId: cellar.tankPo,
    ownerId: cellar.po,
    lotId: cellar.lotPo,
    productId: null,
    productState: 'wine',
    qtyUnits: 0,
    volumeMl,
    sourceId: SRC,
  };
}
