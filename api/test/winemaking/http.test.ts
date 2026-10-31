import { describe, expect, it } from 'bun:test';
import { dispatchOutbox } from '../../src/core/events/dispatch';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { runFermentationAlerts } from '../../src/core/winemaking/service';
import { createTestApp } from '../helpers';
import { call, entityId, seedHolding, seedWarehouse, type TestApp } from '../cellar-api/fixtures';

const ACTOR = { type: 'system' as const, id: 'winemaking-test', requestId: 'req-elaboracion' };

async function place(ctx: TestApp): Promise<{
  entity: string;
  warehouse: string;
  location: string;
  vessel: string;
}> {
  const entity = await entityId(ctx);
  const warehouse = await seedWarehouse(ctx, entity);
  const location = newId();
  const vessel = newId();
  await ctx.writer.withWrite(ACTOR, async (tx) => {
    tx.write(sql`
      INSERT INTO inventory.location (
        id, code, name, kind, tax_warehouse_id, controlling_entity_id
      ) VALUES (
        CAST(${location} AS UUID), ${'BOD-ELAB'}, ${'Bodega sintética'}, ${'cellar'},
        CAST(${warehouse} AS UUID), CAST(${entity} AS UUID)
      )
    `);
    tx.write(sql`
      INSERT INTO cellar.vessel (
        id, code, name, kind, capacity_ml, material, location_id, status
      ) VALUES (
        CAST(${vessel} AS UUID), ${'INOX-EL1'}, ${'Depósito sintético'}, ${'tank_storage'},
        ${2000000}, ${'stainless_steel'}, CAST(${location} AS UUID), ${'in_service'}
      )
    `);
  });
  return { entity, warehouse, location, vessel };
}

describe('elaboración HTTP', () => {
  it('confirma el prensado y el fin de fermentación con rendimiento y asientos', async () => {
    const ctx = await createTestApp();
    try {
      const { entity, warehouse, location, vessel } = await place(ctx);
      const lot = newId();
      const stock = newId();
      await ctx.writer.withWrite(ACTOR, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.lot (id, producer_entity_id, code, kind, vintage, is_organic, status, origin)
          VALUES (
            CAST(${lot} AS UUID), CAST(${entity} AS UUID), ${'UVA-SINT-26'}, ${'grape'},
            2026, TRUE, ${'active'}, ${'opening_count'}
          )
        `);
        tx.write(sql`
          INSERT INTO inventory.stock_move (
            id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_state,
            qty_units, volume_ml, mass_g, source_table, source_id, created_by
          ) VALUES (
            CAST(${stock} AS UUID),
            CAST(${'2026-09-01T06:00:00Z'} AS TIMESTAMPTZ),
            ${'opening'},
            CAST(${location} AS UUID),
            CAST(${entity} AS UUID),
            CAST(${lot} AS UUID),
            ${'grape'},
            0, 0, ${1000000},
            ${'inventory.inventory_count'},
            CAST(${stock} AS UUID),
            ${'winemaking-test'}
          )
        `);
      });
      const pressing = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'crushing_pressing',
        legal_entity_id: entity,
        occurred_at: '2026-09-02T08:00:00Z',
        performed_by: 'operario-sintetico',
        lines: [
          { role: 'input', lot_id: lot, location_id: location, product_state: 'grape', mass_g: 1_000_000, volume_ml: 0 },
          { role: 'output', lot_id: lot, vessel_id: vessel, product_state: 'must', volume_ml: 750_000, mass_g: 0 },
          { role: 'loss', lot_id: lot, location_id: location, product_state: 'grape', mass_g: 220_000, volume_ml: 0, loss_kind: 'authorized' },
        ],
      }, 'bodega@winecore.test');
      expect(pressing.status).toBe(201);
      const pressingId = String(pressing.body.id);
      const preview = await call(ctx, 'POST', `/v1/cellar-operations/${pressingId}/preview`, undefined, 'bodega@winecore.test');
      expect(preview.status).toBe(200);
      expect(preview.body.pressing_yield).toMatchObject({ must_yield: '75.000', pomace_yield: '0.220' });
      const silicie = preview.body.silicie_entries as { kind: string }[];
      expect(silicie.map((row) => row.kind)).toEqual(['A14']);
      const confirmed = await call(ctx, 'POST', `/v1/cellar-operations/${pressingId}/confirm`, undefined, 'bodega@winecore.test');
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.op_type).toBe('crushing_pressing');
      const kind = await ctx.writer.read<{ kind: string }>(sql`
        SELECT kind FROM inventory.lot WHERE id = CAST(${lot} AS UUID)
      `);
      expect(kind[0]?.kind).toBe('must');

      const start = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'fermentation_start',
        legal_entity_id: entity,
        occurred_at: '2026-09-03T08:00:00Z',
        performed_by: 'operario-sintetico',
        vessel_id: vessel,
        lot_id: lot,
      }, 'bodega@winecore.test');
      expect(start.status).toBe(201);
      const startId = String(start.body.id);
      expect((await call(ctx, 'POST', `/v1/cellar-operations/${startId}/confirm`, undefined, 'bodega@winecore.test')).status).toBe(200);
      expect(start.body.op_type).toBe('fermentation_start');

      const end = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'fermentation_end',
        legal_entity_id: entity,
        occurred_at: '2026-09-18T08:00:00Z',
        performed_by: 'operario-sintetico',
        abv_pct: '12.50',
        excise_product_key: 'GRANEL-TINTO',
        lines: [
          { role: 'input', lot_id: lot, vessel_id: vessel, product_state: 'must', volume_ml: 750_000 },
          { role: 'output', lot_id: lot, vessel_id: vessel, product_state: 'wine', volume_ml: 720_000 },
          { role: 'loss', lot_id: lot, vessel_id: vessel, product_state: 'must', volume_ml: 30_000, loss_kind: 'authorized' },
        ],
      }, 'bodega@winecore.test');
      expect(end.status).toBe(201);
      const endId = String(end.body.id);
      const endPreview = await call(ctx, 'POST', `/v1/cellar-operations/${endId}/preview`, undefined, 'bodega@winecore.test');
      expect((endPreview.body.silicie_entries as { kind: string }[]).map((row) => row.kind).sort()).toEqual(['A15', 'A32']);
      expect((await call(ctx, 'POST', `/v1/cellar-operations/${endId}/confirm`, undefined, 'bodega@winecore.test')).status).toBe(200);
      const wineKind = await ctx.writer.read<{ kind: string }>(sql`SELECT kind FROM inventory.lot WHERE id = CAST(${lot} AS UUID)`);
      expect(wineKind[0]?.kind).toBe('wine');
      const fiscal = await ctx.writer.read<{ move_type: string; volume_ml: string }>(sql`
        SELECT move_type, volume_ml::VARCHAR AS volume_ml FROM inventory.fiscal_move WHERE lot_id = CAST(${lot} AS UUID)
      `);
      expect(fiscal.map((row) => [row.move_type, Number(row.volume_ml)])).toEqual([['production', 720_000]]);
      expect(warehouse).toBeTruthy();
    } finally {
      await ctx.close();
    }
  });

  it('rechaza un pH imposible, marca el SO₂ ecológico y guarda la última analítica', async () => {
    const ctx = await createTestApp();
    try {
      const { entity, warehouse, location, vessel } = await place(ctx);
      const wine = newId();
      const lot = await seedHolding(ctx, {
        entityId: entity,
        warehouseId: warehouse,
        locationId: location,
        vesselId: vessel,
        code: 'L-SINT-26',
        volumeMl: 100_000,
      });
      await ctx.writer.withWrite(ACTOR, async (tx) => {
        tx.write(sql`
          INSERT INTO catalog.wine (id, code, name, color, category)
          VALUES (CAST(${wine} AS UUID), ${'SINT'}, ${'Tinto sintético'}, ${'red'}, ${'wine'})
        `);
        tx.write(sql`UPDATE inventory.lot SET wine_id = CAST(${wine} AS UUID), is_organic = TRUE WHERE id = CAST(${lot} AS UUID)`);
      });
      const highPh = await call(ctx, 'POST', '/v1/lots/L-SINT-26/analyses', {
        at: '2026-10-01T10:00:00Z',
        lab: 'Laboratorio Sintético',
        results: [{ parameter: 'ph', value: 5.1, unit: 'pH' }],
      }, 'bodega@winecore.test');
      expect(highPh.status).toBe(422);
      expect(highPh.body.code).toBe('WC_ANALYSIS_RANGE');

      const flagged = await call(ctx, 'POST', '/v1/lots/L-SINT-26/analyses', {
        at: '2026-10-02T10:00:00Z',
        lab: 'external',
        lab_name: 'Laboratorio Sintético',
        vessel_id: vessel,
        results: [
          { parameter: 'ph', value: 3.6, unit: 'pH' },
          { parameter: 'total_so2', value: 110, unit: 'mg/L' },
          { parameter: 'glucose_fructose', value: 1.5, unit: 'g/L' },
          { parameter: 'volatile_acidity', value: 0.5, unit: 'g/L' },
        ],
      }, 'bodega@winecore.test');
      expect(flagged.status).toBe(201);
      const results = flagged.body.results as { parameter: string; out_of_spec: boolean }[];
      expect(results.find((row) => row.parameter === 'total_so2')?.out_of_spec).toBe(true);
      expect(results.find((row) => row.parameter === 'ph')?.out_of_spec).toBe(false);
      expect(flagged.body.out_of_spec).toBe(true);

      const clean = await call(ctx, 'POST', '/v1/lots/L-SINT-26/analyses', {
        at: '2026-10-03T10:00:00Z',
        lab: 'internal',
        results: [
          { parameter: 'total_so2', value: 80, unit: 'mg/L' },
          { parameter: 'glucose_fructose', value: 1.2, unit: 'g/L' },
        ],
      }, 'bodega@winecore.test');
      expect(clean.status).toBe(201);
      expect(clean.body.out_of_spec).toBe(false);

      const latest = await call(ctx, 'GET', '/v1/lots/L-SINT-26/analyses/latest', undefined, 'asesor@winecore.test');
      expect(latest.status).toBe(200);
      expect(latest.body.id).toBe(clean.body.id);
      const history = await call(ctx, 'GET', '/v1/lots/L-SINT-26/analyses', undefined, 'asesor@winecore.test');
      expect(history.body.total).toBe(2);

      const tasting = await call(ctx, 'POST', '/v1/lots/L-SINT-26/tastings', {
        at: '2026-10-04T11:00:00Z',
        author: 'catador-sintetico',
        notes: 'Fruta roja, tanino fino, seguir en depósito.',
        decision: 'seguir',
      }, 'bodega@winecore.test');
      expect(tasting.status).toBe(201);
      const notes = await call(ctx, 'GET', '/v1/lots/L-SINT-26/tastings', undefined, 'bodega@winecore.test');
      expect(notes.body.total).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('bodega registra lecturas; asesor y administración no operan', async () => {
    const ctx = await createTestApp();
    try {
      const { entity, warehouse, location, vessel } = await place(ctx);
      const lot = await seedHolding(ctx, {
        entityId: entity,
        warehouseId: warehouse,
        locationId: location,
        vesselId: vessel,
        code: 'L-PERM-26',
        volumeMl: 50_000,
      });
      const body = {
        lotId: lot,
        vesselId: vessel,
        density: 1.05,
        temperatureC: 18,
        sugar: 12,
        at: '2026-10-01T08:00:00Z',
      };
      const denied = await call(ctx, 'POST', '/v1/fermentation-readings', body, 'asesor@winecore.test');
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('WC_FORBIDDEN');
      const admin = await call(ctx, 'POST', '/v1/fermentation-readings', body, 'admin@winecore.test');
      expect(admin.status).toBe(403);
      const created = await call(ctx, 'POST', '/v1/fermentation-readings', body, 'bodega@winecore.test');
      expect(created.status).toBe(201);
      expect(created.body.residual_sugar_gl).toBe('12.000');
      const curve = await call(ctx, 'GET', '/v1/lots/L-PERM-26/fermentation-curve', undefined, 'asesor@winecore.test');
      expect(curve.status).toBe(200);
      expect((curve.body.points as unknown[]).length).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('una fermentación parada avisa una sola vez por episodio', async () => {
    const ctx = await createTestApp();
    try {
      const { entity, warehouse, location, vessel } = await place(ctx);
      const lot = await seedHolding(ctx, {
        entityId: entity,
        warehouseId: warehouse,
        locationId: location,
        vesselId: vessel,
        code: 'L-FERM-26',
        volumeMl: 80_000,
      });
      const first = await call(ctx, 'POST', '/v1/fermentation-readings', {
        lotId: lot, vesselId: vessel, density: 1.04, temperatureC: 20, at: '2026-10-01T08:00:00Z',
      }, 'bodega@winecore.test');
      expect(first.status).toBe(201);
      const second = await call(ctx, 'POST', '/v1/fermentation-readings', {
        lotId: lot, vesselId: vessel, density: 1.04, temperatureC: 20, at: '2026-10-03T09:00:00Z',
      }, 'bodega@winecore.test');
      expect(second.status).toBe(201);
      const opened = await runFermentationAlerts(ctx.writer, new Date('2026-10-03T10:00:00Z'));
      expect(opened.opened).toBe(2);
      const again = await runFermentationAlerts(ctx.writer, new Date('2026-10-03T11:00:00Z'));
      expect(again.opened).toBe(0);
      await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => new Date(Date.now() + 60_000), log: () => undefined });
      const panel = await call(ctx, 'GET', '/v1/notifications?unread=true', undefined, 'bodega@winecore.test');
      const items = panel.body.items as { kind: string }[];
      expect(items.filter((item) => item.kind === 'cellar.fermentation.alert')).toHaveLength(2);
      const third = await call(ctx, 'POST', '/v1/fermentation-readings', {
        lotId: lot, vesselId: vessel, density: 0.99, temperatureC: 20, at: '2026-10-05T09:00:00Z',
      }, 'bodega@winecore.test');
      expect(third.status).toBe(201);
      const closed = await runFermentationAlerts(ctx.writer, new Date('2026-10-05T10:00:00Z'));
      expect(closed.opened).toBe(0);
      expect(closed.closed).toBe(2);
      const events = await ctx.writer.read<{ total: string }>(sql`
        SELECT count(*)::VARCHAR AS total FROM ops.outbox_event WHERE event_type = 'cellar.fermentation.alert'
      `);
      expect(Number(events[0]?.total)).toBe(2);
    } finally {
      await ctx.close();
    }
  });
});
