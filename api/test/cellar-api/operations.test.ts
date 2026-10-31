import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { call, counts, entityId, seedHolding, seedSeries, seedWarehouse } from './fixtures';

interface World {
  po: string;
  warehouse: string;
  locationId: string;
  tankId: string;
  barrelId: string;
  lotId: string;
}

async function world(ctx: Awaited<ReturnType<typeof createTestApp>>, withSeries = true): Promise<World> {
  const po = await entityId(ctx);
  const warehouse = await seedWarehouse(ctx, po);
  if (withSeries) await seedSeries(ctx, po);
  const location = await call(ctx, 'POST', '/v1/locations', {
    code: 'BOD',
    name: 'Bodega',
    kind: 'cellar',
    controlling_entity_id: po,
    tax_warehouse_id: warehouse,
  });
  const tank = await call(ctx, 'POST', '/v1/vessels', {
    code: 'INOX-01',
    name: 'Depósito',
    kind: 'tank_storage',
    capacity_ml: 8_000_000,
    material: 'stainless_steel',
    location_id: String(location.body.id),
    zone: 'Nave 1',
  });
  const barrel = await call(ctx, 'POST', '/v1/vessels', {
    code: 'BAR-001',
    name: 'Barrica',
    kind: 'barrel',
    capacity_ml: 225_000,
    material: 'oak',
    location_id: String(location.body.id),
    zone: 'Crianza',
  });
  const lotId = await seedHolding(ctx, {
    entityId: po,
    warehouseId: warehouse,
    locationId: String(location.body.id),
    vesselId: String(tank.body.id),
    code: 'L25T01',
    volumeMl: 1_000_000,
  });
  return {
    po,
    warehouse,
    locationId: String(location.body.id),
    tankId: String(tank.body.id),
    barrelId: String(barrel.body.id),
    lotId,
  };
}

function transfer(cellar: World, outputMl: number, lossMl: number) {
  const input = outputMl + lossMl;
  return {
    op_type: 'racking',
    legal_entity_id: cellar.po,
    occurred_at: '2026-06-15T08:00:00Z',
    fiscal_date: '2026-06-15',
    performed_by: 'Operario sintético',
    lines: [
      { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: input, product_state: 'wine' },
      { role: 'output', lot_id: cellar.lotId, vessel_id: cellar.barrelId, volume_ml: outputMl, product_state: 'wine' },
      ...(lossMl > 0
        ? [{
          role: 'loss',
          lot_id: cellar.lotId,
          vessel_id: cellar.tankId,
          volume_ml: lossMl,
          loss_kind: 'authorized',
          product_state: 'wine',
        }]
        : []),
    ],
  };
}

describe('operaciones de bodega', () => {
  it('trasiega de depósito a barrica con merma y mueve el libro fiscal', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const denied = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 220_000, 5_000), 'asesor@winecore.test');
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('WC_FORBIDDEN');

      const created = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 220_000, 5_000), 'bodega@winecore.test');
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        number: 'OB26-0001',
        op_type: 'racking',
        status: 'confirmed',
        silicie_relevant: true,
      });
      const fiscal = created.body.fiscal_moves as { move_type: string; product_class: string; volume_ml: number; excise_product_key: string }[];
      expect(fiscal.map((row) => [row.move_type, row.product_class, row.volume_ml, row.excise_product_key])).toEqual([
        ['ledger_change_out', 'bulk', -220_000, 'GRANEL-TINTO'],
        ['ledger_change_in', 'bulk_wood', 220_000, 'CRIANZA-TINTO'],
        ['loss', 'bulk', -5_000, 'GRANEL-TINTO'],
      ]);
      const stock = created.body.stock_moves as { move_type: string; vessel_id: string; volume_ml: number; loss_kind: string | null }[];
      expect(stock.map((row) => [row.move_type, row.vessel_id, row.volume_ml, row.loss_kind])).toEqual([
        ['cellar_out', cellar.tankId, -220_000, null],
        ['loss', cellar.tankId, -5_000, 'authorized'],
        ['cellar_in', cellar.barrelId, 220_000, null],
      ]);

      const vessels = await call(ctx, 'GET', '/v1/vessels', undefined, 'asesor@winecore.test');
      const items = vessels.body.items as { code: string; volume_ml: number; state: string; fill_pct: string; lot_code: string }[];
      expect(items.find((item) => item.code === 'INOX-01')).toMatchObject({
        volume_ml: 775_000,
        lot_code: 'L25T01',
        state: 'wine',
        fill_pct: '9.7',
      });
      expect(items.find((item) => item.code === 'BAR-001')).toMatchObject({
        volume_ml: 220_000,
        lot_code: 'L25T01',
        state: 'aging',
        fill_pct: '97.8',
      });

      const detail = await call(ctx, 'GET', `/v1/cellar-operations/${created.body.id}`, undefined, 'asesor@winecore.test');
      expect(detail.status).toBe(200);
      expect(detail.body.number).toBe('OB26-0001');
      const list = await call(ctx, 'GET', '/v1/cellar-operations');
      expect(list.body.total).toBe(1);
      expect((list.body.items as { number: string }[])[0]?.number).toBe('OB26-0001');

      const history = await call(ctx, 'GET', '/v1/vessels/INOX-01/history');
      expect(history.body.total).toBe(1);
      expect((history.body.items as { op_type: string; lines: unknown[] }[])[0]?.op_type).toBe('racking');

      const immutable = await call(ctx, 'PATCH', `/v1/cellar-operations/${created.body.id}`, { reason: 'corrección' });
      expect(immutable.status).toBe(409);
      expect(immutable.body.code).toBe('WC032');
      const still = await call(ctx, 'GET', `/v1/cellar-operations/${created.body.id}`);
      expect(still.body.reason).toBeNull();

      const where = await call(ctx, 'GET', '/v1/lots/L25T01');
      const positions = where.body.positions as { vessel_code: string; volume_ml: number }[];
      expect(positions.map((row) => [row.vessel_code, row.volume_ml])).toEqual([
        ['BAR-001', 220_000],
        ['INOX-01', 775_000],
      ]);

      const chain = await call(ctx, 'POST', '/v1/audit/verify');
      expect(chain.body.intact).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('el ensamblaje crea un lote con genealogía', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const second = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-02',
        name: 'Depósito 2',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: cellar.locationId,
      });
      const third = await call(ctx, 'POST', '/v1/vessels', {
        code: 'INOX-03',
        name: 'Depósito 3',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: cellar.locationId,
      });
      const other = await seedHolding(ctx, {
        entityId: cellar.po,
        warehouseId: cellar.warehouse,
        locationId: cellar.locationId,
        vesselId: String(second.body.id),
        code: 'L25T02',
        volumeMl: 600_000,
      });
      const created = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'blend',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-16T08:00:00Z',
        fiscal_date: '2026-06-16',
        performed_by: 'Operario sintético',
        new_lot: { code: 'L25ENS1' },
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 400_000, product_state: 'wine' },
          { role: 'input', lot_id: other, vessel_id: String(second.body.id), volume_ml: 600_000, product_state: 'wine' },
          { role: 'output', vessel_id: String(third.body.id), volume_ml: 1_000_000, product_state: 'wine' },
        ],
      });
      expect(created.status).toBe(201);
      expect(created.body.number).toBe('OB26-0001');
      const edges = created.body.lot_edges as { volume_ml: number }[];
      expect(edges.map((edge) => edge.volume_ml).sort((a, b) => a - b)).toEqual([400_000, 600_000]);

      const child = await call(ctx, 'GET', '/v1/lots/L25ENS1', undefined, 'asesor@winecore.test');
      expect(child.status).toBe(200);
      expect(child.body.kind).toBe('wine');
      expect(child.body.vintage).toBe(2025);
      const ancestors = child.body.ancestors as { code: string; depth: number }[];
      expect(ancestors.map((row) => row.code).sort()).toEqual(['L25T01', 'L25T02']);
      expect(ancestors.every((row) => row.depth === 1)).toBe(true);
      const composition = child.body.composition as { parent_code: string; volume_ml: number }[];
      expect(composition.map((row) => [row.parent_code, row.volume_ml]).sort()).toEqual([
        ['L25T01', 400_000],
        ['L25T02', 600_000],
      ]);
      expect(child.body.positions).toEqual([
        expect.objectContaining({ vessel_code: 'INOX-03', volume_ml: 1_000_000, product_state: 'wine' }),
      ]);

      const parent = await call(ctx, 'GET', '/v1/lots/L25T02');
      expect(parent.body.descendants).toEqual([
        expect.objectContaining({ code: 'L25ENS1', depth: 1 }),
      ]);
      const missing = await call(ctx, 'GET', '/v1/lots/NOEXISTE');
      expect(missing.status).toBe(404);
    } finally {
      await ctx.close();
    }
  });

  it('capacidad y conservación no dejan rastro', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const before = await counts(ctx);
      const conserved = await call(ctx, 'POST', '/v1/cellar-operations', {
        ...transfer(cellar, 900, 0),
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 1_000, product_state: 'wine' },
          { role: 'output', lot_id: cellar.lotId, vessel_id: cellar.barrelId, volume_ml: 900, product_state: 'wine' },
        ],
      });
      expect(conserved.status).toBe(422);
      expect(conserved.body.code).toBe('WC020');
      expect(String(conserved.body.message)).toContain('no cuadra');

      const capacity = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 300_000, 0));
      expect(capacity.status).toBe(422);
      expect(capacity.body.code).toBe('WC025');
      expect(await counts(ctx)).toEqual(before);

      const vessels = await call(ctx, 'GET', '/v1/vessels/INOX-01');
      expect(vessels.body.volume_ml).toBe(1_000_000);
      const series = await ctx.writer.read<{ next_value: number }>(`
        SELECT next_value FROM core.number_series WHERE doc_type = 'cellar_operation'
      `);
      expect(series[0]?.next_value).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza un periodo cerrado sin escribir', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const before = await counts(ctx);
      await ctx.writer.withWrite({ type: 'system', id: 'cellar-test', requestId: 'lock' }, async (tx) => {
        tx.write(`
          INSERT INTO inventory.period_lock (ledger, locked_until, locked_by, reason)
          VALUES ('physical', DATE '2026-10-31', 'asesor', 'cierre de prueba')
        `);
      });
      const closed = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 220_000, 5_000), 'bodega@winecore.test');
      expect(closed.status).toBe(409);
      expect(closed.body.code).toBe('WC021');
      expect(String(closed.body.message)).toContain('cerrado');
      expect(await counts(ctx)).toEqual(before);
    } finally {
      await ctx.close();
    }
  });

  it('la destrucción y la merma por incidencia no se registran sin el módulo de aprobaciones', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx);
      const before = await counts(ctx);
      const destruction = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'destruction',
        legal_entity_id: cellar.po,
        occurred_at: '2026-06-15T08:00:00Z',
        fiscal_date: '2026-06-15',
        performed_by: 'Operario sintético',
        reason: 'producto defectuoso',
        approval_request_id: '019a0000-0000-7000-8000-00000000aa01',
        lines: [{
          role: 'loss',
          lot_id: cellar.lotId,
          vessel_id: cellar.tankId,
          volume_ml: 1_000,
          loss_kind: 'incident',
          product_state: 'wine',
        }],
      });
      expect(destruction.status).toBe(409);
      expect(destruction.body.code).toBe('WC_NOT_APPROVED');

      const incident = await call(ctx, 'POST', '/v1/cellar-operations', {
        ...transfer(cellar, 220_000, 5_000),
        lines: [
          { role: 'input', lot_id: cellar.lotId, vessel_id: cellar.tankId, volume_ml: 225_000, product_state: 'wine' },
          { role: 'output', lot_id: cellar.lotId, vessel_id: cellar.barrelId, volume_ml: 220_000, product_state: 'wine' },
          {
            role: 'loss',
            lot_id: cellar.lotId,
            vessel_id: cellar.tankId,
            volume_ml: 5_000,
            loss_kind: 'incident',
            product_state: 'wine',
          },
        ],
        reason: 'derrame',
        approval_request_id: '019a0000-0000-7000-8000-00000000aa01',
      });
      expect(incident.status).toBe(409);
      expect(incident.body.code).toBe('WC_NOT_APPROVED');
      expect(await counts(ctx)).toEqual(before);
    } finally {
      await ctx.close();
    }
  });

  it('sin serie de numeración responde WC010 y no escribe', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await world(ctx, false);
      const before = await counts(ctx);
      const missing = await call(ctx, 'POST', '/v1/cellar-operations', transfer(cellar, 220_000, 5_000));
      expect(missing.status).toBe(409);
      expect(missing.body.code).toBe('WC010');
      expect(await counts(ctx)).toEqual(before);
    } finally {
      await ctx.close();
    }
  });
});
