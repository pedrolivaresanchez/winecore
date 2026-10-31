import { describe, expect, it } from 'bun:test';
import { planOperation } from '../../src/core/cellar/engine';
import type { BleedingRequest, DelestageRequest, PressingOffRequest, TemperatureControlRequest } from '../../src/core/cellar/types';
import { assertElaborationBalance, SILICIE_Q040 } from '../../src/core/winemaking/balance';
import { coldStabilisationTargetC } from '../../src/core/winemaking/yields';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { asOk, header, holding, idSource, lot, stateOf, vessel } from '../cellar/helpers';
import { call, entityId, seedHolding, seedWarehouse, type TestApp } from '../cellar-api/fixtures';
import { createTestApp } from '../helpers';

const must = lot({ id: 'lot-m', code: 'MOSTO26', kind: 'must', excise_product_key: 'GRANEL-TINTO', abv_pct: null });
const ACTOR = { type: 'system' as const, id: 'meeting-test', requestId: 'req-reunion' };

describe('sangrado, descube y operaciones sin volumen', () => {
  it('el sangrado crea un lote hijo, conserva el volumen y no anota SILICIE', () => {
    const source = holding('inox-a', must, 500_000, 'must');
    const dest = vessel({ id: 'inox-b' });
    const request: BleedingRequest = {
      ...header({ id: 'op-sangrado' }),
      op_type: 'bleeding',
      new_lot: { code: 'SANGR-26' },
      lines: [
        { role: 'input', lot: must, vessel_id: 'inox-a', volume_ml: 200_000, product_state: 'must', loss_kind: null },
        { role: 'output', lot: must, vessel_id: 'inox-b', volume_ml: 180_000, product_state: 'must', loss_kind: null },
        { role: 'loss', lot: must, vessel_id: 'inox-a', volume_ml: 20_000, product_state: 'must', loss_kind: 'authorized' },
      ],
    };
    const plan = asOk(planOperation(request, stateOf([source, dest]), idSource()));
    expect(plan.fiscalMoves).toEqual([]);
    expect(plan.notes).toEqual([SILICIE_Q040]);
    expect(plan.newLots.map((row) => row.code)).toEqual(['SANGR-26']);
    expect(plan.lotEdges[0]?.volume_ml).toBe(180_000);
    expect(plan.vesselsAfter.find((row) => row.id === 'inox-a')?.volume_ml).toBe(300_000);
    expect(plan.vesselsAfter.find((row) => row.id === 'inox-b')?.lot_id).toBe(plan.newLots[0]?.id);
    const broken = assertElaborationBalance('bleeding', [
      { role: 'input', volume_ml: 100 },
      { role: 'output', volume_ml: 90 },
    ]);
    expect(broken?.code).toBe('WC020');
  });

  it('el descube separa yema y prensa y trata orujos como merma', () => {
    const tank = holding('inox-a', must, 400_000, 'must');
    const yema = vessel({ id: 'inox-b' });
    const prensa = vessel({ id: 'inox-c' });
    const request: PressingOffRequest = {
      ...header({ id: 'op-descube' }),
      op_type: 'pressing_off',
      lines: [
        { role: 'input', lot: must, vessel_id: 'inox-a', volume_ml: 400_000, product_state: 'must', loss_kind: null, new_lot_code: null },
        { role: 'output', lot: must, vessel_id: 'inox-b', volume_ml: 250_000, product_state: 'must', loss_kind: null, new_lot_code: null },
        { role: 'output', lot: must, vessel_id: 'inox-c', volume_ml: 120_000, product_state: 'must', loss_kind: null, new_lot_code: 'PRENSA26' },
        { role: 'loss', lot: must, vessel_id: 'inox-a', volume_ml: 30_000, product_state: 'must', loss_kind: 'authorized', new_lot_code: null },
      ],
    };
    const plan = asOk(planOperation(request, stateOf([tank, yema, prensa]), idSource()));
    expect(plan.fiscalMoves).toEqual([]);
    expect(plan.notes).toEqual([SILICIE_Q040]);
    expect(plan.newLots.map((row) => row.code)).toEqual(['PRENSA26']);
    expect(plan.lotEdges[0]?.volume_ml).toBe(120_000);
    expect(plan.stockMoves.reduce((total, row) => total + row.volume_ml, 0)).toBe(-30_000);
  });

  it('el délestage y la temperatura no mueven volumen', () => {
    expect(assertElaborationBalance('delestage', [{ role: 'input', volume_ml: 1 }])?.code).toBe('WC020');
    expect(assertElaborationBalance('temperature_control', [{ role: 'output', volume_ml: 1 }])?.code).toBe('WC020');
    const tank = holding('inox-a', must, 100_000, 'must');
    const delestage = asOk(planOperation({
      ...header({ id: 'op-delestage' }),
      op_type: 'delestage',
      vessel_id: 'inox-a',
      lot: must,
      started_at: '2026-10-01T08:00:00Z',
      ended_at: '2026-10-01T09:00:00Z',
      notes: 'vuelta al mismo depósito',
    } satisfies DelestageRequest, stateOf([tank]), idSource()));
    expect(delestage.stockMoves).toEqual([]);
    const temperature = asOk(planOperation({
      ...header({ id: 'op-temp', reason: 'bajar la consigna' }),
      op_type: 'temperature_control',
      vessel_id: 'inox-a',
      lot: must,
      previous_setpoint_c: '22',
      new_setpoint_c: '18',
    } satisfies TemperatureControlRequest, stateOf([tank]), idSource()));
    expect(temperature.stockMoves).toEqual([]);
    expect(coldStabilisationTargetC('13')).toBe('-7.5');
  });
});

describe('fases, evolución y analíticas de la reunión', () => {
  it('abre fases, hereda la FA del motor y marca volátil, seco, málico y solape', async () => {
    const ctx = await createTestApp();
    try {
      const placed = await cellar(ctx);
      const lot = await seedHolding(ctx, {
        entityId: placed.entity,
        warehouseId: placed.warehouse,
        locationId: placed.location,
        vesselId: placed.vessel,
        code: 'L-REU-26',
        volumeMl: 400_000,
      });
      const soak = await call(ctx, 'POST', '/v1/lots/L-REU-26/phases', {
        phase: 'skin_maceration',
        vessel_id: placed.vessel,
        started_at: '2026-09-01T08:00:00Z',
        white_as_red: true,
      }, 'bodega@winecore.test');
      expect(soak.status).toBe(201);
      expect(soak.body.observations).toBe('blanca vinificada en tinto');
      const ended = await call(ctx, 'POST', `/v1/lots/L-REU-26/phases/${soak.body.id}/end`, {
        ended_at: '2026-09-05T08:00:00Z',
      }, 'bodega@winecore.test');
      expect(ended.status).toBe(200);
      expect(ended.body.status).toBe('completed');

      const degree = await call(ctx, 'POST', '/v1/lots/L-REU-26/analyses', {
        at: '2026-09-10T08:00:00Z',
        result_at: '2026-09-11T08:00:00Z',
        lab: 'internal',
        results: [{ parameter: 'abv', value: 13, unit: '% vol' }],
      }, 'bodega@winecore.test');
      expect(degree.status).toBe(201);
      const early = await call(ctx, 'POST', '/v1/lots/L-REU-26/analyses', {
        at: '2026-09-12T08:00:00Z',
        result_at: '2026-09-11T08:00:00Z',
        lab: 'internal',
        results: [{ parameter: 'ph', value: 3.4, unit: 'pH' }],
      }, 'bodega@winecore.test');
      expect(early.status).toBe(422);

      const cold = await call(ctx, 'POST', '/v1/lots/L-REU-26/phases', {
        phase: 'forced_cold_stabilisation',
        vessel_id: placed.vessel,
        started_at: '2026-12-01T08:00:00Z',
      }, 'bodega@winecore.test');
      expect(cold.status).toBe(201);
      expect(cold.body.target_temp_c).toBe('-7.5');
      expect((await call(ctx, 'POST', `/v1/lots/L-REU-26/phases/${cold.body.id}/stop`, {
        ended_at: '2026-12-02T08:00:00Z',
        observations: 'se retiran bitartratos',
      }, 'bodega@winecore.test')).body.status).toBe('stopped');

      await ctx.writer.withWrite(ACTOR, async (tx) => {
        tx.write(sql`
          UPDATE inventory.stock_move SET product_state = 'must'
          WHERE lot_id = CAST(${lot} AS UUID)
        `);
        tx.write(sql`UPDATE inventory.lot SET kind = 'must' WHERE id = CAST(${lot} AS UUID)`);
      });
      const started = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'fermentation_start',
        legal_entity_id: placed.entity,
        occurred_at: '2026-09-02T08:00:00Z',
        performed_by: 'operario-sintetico',
        vessel_id: placed.vessel,
        lot_id: lot,
        inoculation: 'spontaneous',
      }, 'bodega@winecore.test');
      expect(started.status).toBe(201);
      expect((await call(ctx, 'POST', `/v1/cellar-operations/${started.body.id}/confirm`, undefined, 'bodega@winecore.test')).status).toBe(200);
      const phases = await ctx.writer.read<{ phase: string; inoculation: string }>(sql`
        SELECT phase, inoculation FROM cellar.lot_phase
        WHERE lot_id = CAST(${lot} AS UUID) AND phase = 'alcoholic_fermentation' AND status = 'in_progress'
      `);
      expect(phases[0]?.inoculation).toBe('spontaneous');

      await call(ctx, 'POST', '/v1/lots/L-REU-26/phases', {
        phase: 'malolactic_fermentation',
        started_at: '2026-09-20T08:00:00Z',
        inoculation: 'spontaneous',
        observations: 'burbujeo y aroma a yogur',
      }, 'bodega@winecore.test');
      const low = await call(ctx, 'POST', '/v1/lots/L-REU-26/analyses', {
        at: '2026-09-21T08:00:00Z',
        lab: 'internal',
        results: [{ parameter: 'volatile_acidity', value: 0.4, unit: 'g/L' }],
      }, 'bodega@winecore.test');
      expect(low.status).toBe(201);
      const rising = await call(ctx, 'POST', '/v1/lots/L-REU-26/analyses', {
        at: '2026-09-22T08:00:00Z',
        lab: 'internal',
        results: [
          { parameter: 'volatile_acidity', value: 0.5, unit: 'g/L' },
          { parameter: 'glucose_fructose', value: 2, unit: 'g/L' },
          { parameter: 'malic_acid', value: 0.3, unit: 'g/L' },
        ],
      }, 'bodega@winecore.test');
      expect(rising.status).toBe(201);
      expect(rising.body.out_of_spec).toBe(true);
      expect(rising.body.marks).toMatchObject({
        volatile: false,
        volatile_overlap: true,
        dry: true,
        malolactic_finished: true,
        assumptions: true,
      });
      const hot = await call(ctx, 'POST', '/v1/lots/L-REU-26/analyses', {
        at: '2026-09-23T08:00:00Z',
        lab: 'internal',
        results: [{ parameter: 'volatile_acidity', value: 0.6, unit: 'g/L' }],
      }, 'bodega@winecore.test');
      expect((hot.body.marks as { volatile: boolean }).volatile).toBe(true);

      const evolution = await call(ctx, 'GET', '/v1/lots/L-REU-26/evolution', undefined, 'asesor@winecore.test');
      expect(evolution.status).toBe(200);
      expect((evolution.body.analyses as unknown[]).length).toBeGreaterThan(0);
      expect((evolution.body.phases as unknown[]).length).toBeGreaterThan(0);
      expect(evolution.body).not.toHaveProperty('tastings');

      const other = newId();
      await ctx.writer.withWrite(ACTOR, async (tx) => {
        tx.write(sql`
          INSERT INTO cellar.vessel (
            id, code, name, kind, capacity_ml, material, location_id, status
          ) VALUES (
            CAST(${other} AS UUID), ${'INOX-EL2'}, ${'Destino sintético'}, ${'tank_storage'},
            ${2000000}, ${'stainless_steel'}, CAST(${placed.location} AS UUID), ${'in_service'}
          )
        `);
      });
      const bleed = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'bleeding',
        legal_entity_id: placed.entity,
        occurred_at: '2026-09-04T08:00:00Z',
        performed_by: 'operario-sintetico',
        new_lot: { code: 'SANGR-26' },
        lines: [
          { role: 'input', lot_id: lot, vessel_id: placed.vessel, product_state: 'must', volume_ml: 100_000 },
          { role: 'output', vessel_id: other, product_state: 'must', volume_ml: 100_000, new_lot_code: 'SANGR-26' },
        ],
      }, 'bodega@winecore.test');
      expect(bleed.status).toBe(201);
      const bleedId = String(bleed.body.id);
      expect((await call(ctx, 'POST', `/v1/cellar-operations/${bleedId}/confirm`, undefined, 'bodega@winecore.test')).status).toBe(200);
      const edges = await ctx.writer.read<{ total: string }>(sql`
        SELECT count(*)::VARCHAR AS total FROM inventory.lot_edge WHERE operation_id = CAST(${bleedId} AS UUID)
      `);
      expect(Number(edges[0]?.total)).toBe(1);
      const fiscal = await ctx.writer.read<{ total: string }>(sql`
        SELECT count(*)::VARCHAR AS total FROM inventory.fiscal_move WHERE source_id = CAST(${bleedId} AS UUID)
      `);
      expect(Number(fiscal[0]?.total)).toBe(0);

      const lines = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'delestage',
        legal_entity_id: placed.entity,
        occurred_at: '2026-09-06T08:00:00Z',
        performed_by: 'operario-sintetico',
        vessel_id: placed.vessel,
        lot_id: lot,
        started_at: '2026-09-06T08:00:00Z',
        ended_at: '2026-09-06T09:00:00Z',
        lines: [{ role: 'input', lot_id: lot, vessel_id: placed.vessel, product_state: 'must', volume_ml: 1 }],
      }, 'bodega@winecore.test');
      expect(lines.status).toBe(422);
      expect(lines.body.code).toBe('WC020');
      const quiet = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'temperature_control',
        legal_entity_id: placed.entity,
        occurred_at: '2026-09-06T10:00:00Z',
        performed_by: 'operario-sintetico',
        reason: 'bajar la consigna',
        vessel_id: placed.vessel,
        lot_id: lot,
        previous_setpoint_c: '22',
        new_setpoint_c: '18',
      }, 'bodega@winecore.test');
      expect(quiet.status).toBe(201);
      expect((await call(ctx, 'POST', `/v1/cellar-operations/${quiet.body.id}/confirm`, undefined, 'bodega@winecore.test')).status).toBe(200);

      const parcel = newId();
      await ctx.writer.withWrite(ACTOR, async (tx) => {
        tx.write(sql`
          INSERT INTO vineyard.parcel (
            id, code, name, ownership, sigpac_province, sigpac_municipality, sigpac_polygon, sigpac_parcel, area_ha
          ) VALUES (
            CAST(${parcel} AS UUID), ${'P-SINT'}, ${'Parcela sintética'}, ${'own'},
            46, 1, 1, 1, ${1.5}
          )
        `);
      });
      const grape = await call(ctx, 'POST', '/v1/parcels/P-SINT/analyses', {
        at: '2026-08-20T08:00:00Z',
        lab: 'internal',
        results: [{ parameter: 'polymerization_index', value: 42, unit: '%' }],
      }, 'bodega@winecore.test');
      expect(grape.status).toBe(201);
      expect(grape.body.lot_id).toBeNull();
    } finally {
      await ctx.close();
    }
  });
});

async function cellar(ctx: TestApp) {
  const entity = await entityId(ctx);
  const warehouse = await seedWarehouse(ctx, entity);
  const location = newId();
  const vessel = newId();
  await ctx.writer.withWrite(ACTOR, async (tx) => {
    tx.write(sql`
      INSERT INTO inventory.location (id, code, name, kind, tax_warehouse_id, controlling_entity_id)
      VALUES (
        CAST(${location} AS UUID), ${'BOD-REU'}, ${'Bodega sintética'}, ${'cellar'},
        CAST(${warehouse} AS UUID), CAST(${entity} AS UUID)
      )
    `);
    tx.write(sql`
      INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, material, location_id, status)
      VALUES (
        CAST(${vessel} AS UUID), ${'INOX-REU'}, ${'Depósito sintético'}, ${'tank_storage'},
        ${2000000}, ${'stainless_steel'}, CAST(${location} AS UUID), ${'in_service'}
      )
    `);
  });
  return { entity, warehouse, location, vessel };
}
