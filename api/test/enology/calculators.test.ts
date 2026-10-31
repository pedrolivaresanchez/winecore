import { describe, expect, it } from 'bun:test';
import {
  calculateBlend,
  calculateCold,
  calculateProbableAlcohol,
  calculateSo2,
} from '../../src/core/enology/calculators';
import { templateSettings } from '../../src/core/enology/defaults';
import type { SettingsView } from '../../src/core/enology/types';
import { createTestApp } from '../helpers';
import { call, entityId, seedHolding, seedWarehouse } from '../cellar-api/fixtures';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';

const settings = templateSettings();

function so2(body: Record<string, unknown>, view: SettingsView = settings) {
  return calculateSo2({
    free_so2_mg_l: '0',
    volume_l: '100',
    wine_type: 'tinto',
    product: { kind: 'potassium_metabisulfite' },
    ...body,
  }, view);
}

describe('calculadora de SO2', () => {
  it('fija el libre necesario en varios pH (objetivo 0,5 mg/L, pendiente de confirmar)', () => {
    const points: Record<string, string> = {
      '3.0': '8.24',
      '3.2': '12.77',
      '3.4': '19.95',
      '3.6': '31.33',
      '3.8': '49.36',
    };
    for (const [ph, needed] of Object.entries(points)) {
      const result = so2({ ph });
      expect(result.free_so2_needed_mg_l).toBe(needed);
      expect(result.molecular_target.value).toBe('0.5');
      expect(result.molecular_target.status_label).toBe('pendiente de confirmar');
      expect(result.pka.value).toBe('1.81');
      expect(result.pka.basis).toBe('hecho');
    }
  });

  it('cuadra casos exactos del pKa y la dosis de metabisulfito', () => {
    expect(so2({ ph: '1.81' }).free_so2_needed_mg_l).toBe('1.00');
    expect(so2({ ph: '2.81' }).free_so2_needed_mg_l).toBe('5.50');
    expect(so2({ ph: '3.81' }).free_so2_needed_mg_l).toBe('50.50');
    const dose = so2({ ph: '2.81', free_so2_mg_l: '0.5', volume_l: '100' });
    expect(dose.free_so2_to_add_mg_l).toBe('5.00');
    expect(dose.product.quantity).toBe('0.868');
    expect(dose.product.unit).toBe('g');
    expect(dose.product.so2_percent).toBe('57.6');
    const solution = calculateSo2({
      ph: '2.81',
      free_so2_mg_l: '0.5',
      volume_l: '100',
      wine_type: 'tinto',
      product: { kind: 'solution', so2_percent: '6' },
    }, settings);
    expect(solution.product.unit).toBe('ml');
    expect(solution.product.quantity).toBe('8.333');
    expect(so2({ ph: '2.81', free_so2_mg_l: '10' }).free_so2_to_add_mg_l).toBe('0.00');
  });

  it('usa 0,8 mg/L en blanco y rosado y respeta un objetivo indicado', () => {
    expect(so2({ ph: '3.2', wine_type: 'blanco' }).free_so2_needed_mg_l).toBe('20.44');
    expect(so2({ ph: '3.2', wine_type: 'rosado' }).molecular_target.value).toBe('0.8');
    const custom = templateSettings();
    const row = custom.parameters.find((item) => item.code === 'molecular_so2_tinto_mg_l');
    if (!row) throw new Error('falta el objetivo');
    row.value = '1';
    expect(so2({ ph: '1.81' }, custom).free_so2_needed_mg_l).toBe('2.00');
    expect(so2({ ph: '1.81', molecular_target_mg_l: '1' }).molecular_target.overridden).toBe(true);
  });

  it('no dosifica un lote sin sulfitos añadidos y avisa', () => {
    const result = so2({ ph: '3.2', free_so2_mg_l: '5', no_added_sulfites: true, total_so2_mg_l: '20' });
    expect(result.dose_withheld).toBe(true);
    expect(result.free_so2_to_add_mg_l).toBe('0.00');
    expect(result.product.quantity).toBe('0.000');
    expect(result.free_so2_needed_mg_l).toBe('12.77');
    expect(result.warnings.some((item) => item.code === 'ENO_NO_ADDED_SULFITES')).toBe(true);
    expect(result.warnings.some((item) => item.code === 'ENO_SULFITE_ALLERGEN')).toBe(true);
  });

  it('avisa si el total supera el límite ecológico y deja el legal en null', () => {
    const over = so2({
      ph: '3.81',
      total_so2_mg_l: '60',
      residual_sugar_g_l: '1',
    });
    expect(over.resulting_total_so2_mg_l).toBe('110.50');
    expect(over.limits.organic.limit_mg_l).toBe('100');
    expect(over.limits.organic.status_label).toBe('hecho');
    expect(over.limits.legal.limit_mg_l).toBeNull();
    expect(over.warnings.some((item) => item.code === 'ENO_SO2_ORGANIC_OVER')).toBe(true);
    expect(over.warnings.some((item) => item.message.includes('Sin cifra legal'))).toBe(true);

    const mid = calculateSo2({
      ph: '2.81',
      free_so2_mg_l: '0',
      volume_l: '100',
      wine_type: 'blanco',
      total_so2_mg_l: '165',
      residual_sugar_g_l: '3',
      product: { kind: 'potassium_metabisulfite' },
    }, settings);
    expect(mid.limits.organic.limit_mg_l).toBe('170');
    expect(mid.limits.organic.status_label).toBe('pendiente de confirmar');
    const organic = mid.warnings.find((item) => item.code === 'ENO_SO2_ORGANIC_OVER');
    expect(organic?.message).toContain('pendiente de confirmar');

    const high = so2({ ph: '2.81', total_so2_mg_l: '10', residual_sugar_g_l: '8' });
    expect(high.limits.organic.limit_mg_l).toBeNull();
    expect(high.warnings.some((item) => item.message.includes('Sin cifra en la documentación'))).toBe(true);
  });
});

describe('estabilización por frío y grado probable', () => {
  it('13 % vol da -7,5 °C', () => {
    expect(calculateCold({ alcohol_pct: '13' })).toMatchObject({
      temperature_c: '-7.5',
      basis: 'hecho',
      alcohol_pct: '13',
    });
    expect(calculateCold({ alcohol_pct: '12' }).temperature_c).toBe('-7.0');
    expect(calculateCold({ alcohol_pct: '10.5' }).temperature_c).toBe('-6.25');
  });

  it('225 g/L dan 13,37 % vol y la densidad usa el factor 7,5 pendiente', () => {
    const sugars = calculateProbableAlcohol({ sugars_g_l: '225' }, settings);
    expect(sugars.from_sugars?.alcohol_pct).toBe('13.37');
    expect(sugars.from_sugars?.factor).toBe('16.83');
    expect(calculateProbableAlcohol({ sugars_g_l: '168.3' }, settings).from_sugars?.alcohol_pct).toBe('10.00');
    const density = calculateProbableAlcohol({ density_g_l: '1090' }, settings);
    expect(density.from_density?.alcohol_pct).toBe('12.00');
    expect(density.from_density?.factor_status_label).toBe('pendiente de confirmar');
    expect(calculateProbableAlcohol({ density_g_l: '1100' }, settings).from_density?.alcohol_pct).toBe('13.33');
  });
});

describe('ensamblaje de pipeta', () => {
  it('reparte litros y ajusta el redondeo para sumar el objetivo', () => {
    const even = calculateBlend([
      { label: 'A', volume_ml: '30', vessel_id: null, lot_id: null, available_ml: null },
      { label: 'B', volume_ml: '70', vessel_id: null, lot_id: null, available_ml: null },
    ], '1000');
    expect(even.components.map((row) => row.volume_l)).toEqual(['300.000', '700.000']);
    expect(even.components.map((row) => row.percent)).toEqual(['30.00', '70.00']);

    const thirds = calculateBlend([
      { label: 'A', volume_ml: '1', vessel_id: null, lot_id: null, available_ml: '100' },
      { label: 'B', volume_ml: '1', vessel_id: null, lot_id: null, available_ml: '1000' },
      { label: 'C', volume_ml: '1', vessel_id: null, lot_id: null, available_ml: null },
    ], '1');
    expect(thirds.target_volume_ml).toBe('1000');
    expect(thirds.components.map((row) => row.volume_ml)).toEqual(['334', '333', '333']);
    expect(thirds.components.map((row) => row.percent)).toEqual(['33.34', '33.33', '33.33']);
    expect(thirds.components[0]?.sufficient).toBe(false);
    expect(thirds.components[1]?.sufficient).toBe(true);
    expect(thirds.components[2]?.sufficient).toBeNull();
    expect(thirds.warnings.some((item) => item.code === 'ENO_BLEND_SHORT')).toBe(true);
  });
});

describe('calculadoras por HTTP', () => {
  it('calcula el SO2 con cellar.read y lee el saldo del ensamblaje', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const denied = await call(ctx, 'POST', '/v1/enology/calculators/so2', {
        ph: '3.2',
        free_so2_mg_l: '0',
        volume_l: '100',
        wine_type: 'tinto',
        product: { kind: 'potassium_metabisulfite' },
      }, 'nadie@winecore.test');
      expect(denied.status).toBe(403);

      const result = await call(ctx, 'POST', '/v1/enology/calculators/so2', {
        legal_entity_id: po,
        ph: '3.2',
        free_so2_mg_l: '10',
        volume_l: '1000',
        wine_type: 'tinto',
        product: { kind: 'potassium_metabisulfite' },
      }, 'bodega@winecore.test');
      expect(result.status).toBe(200);
      expect(result.body.free_so2_needed_mg_l).toBe('12.77');
      expect(result.body.free_so2_to_add_mg_l).toBe('2.77');

      const cold = await call(ctx, 'POST', '/v1/enology/calculators/cold_stabilisation', {
        alcohol_pct: '13',
      }, 'bodega@winecore.test');
      expect(cold.status).toBe(200);
      expect(cold.body.temperature_c).toBe('-7.5');

      const alcohol = await call(ctx, 'POST', '/v1/enology/calculators/probable_alcohol', {
        sugars_g_l: '225',
      }, 'bodega@winecore.test');
      expect(alcohol.status).toBe(200);
      expect((alcohol.body.from_sugars as { alcohol_pct: string }).alcohol_pct).toBe('13.37');

      const warehouse = await seedWarehouse(ctx, po);
      const location = newId();
      const vessel = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'enology-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id, tax_warehouse_id)
          VALUES (
            CAST(${location} AS UUID), ${'BODPIP'}, ${'Bodega sintetica'}, ${'cellar'},
            CAST(${po} AS UUID), CAST(${warehouse} AS UUID)
          )
        `);
        tx.write(sql`
          INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, material, location_id)
          VALUES (
            CAST(${vessel} AS UUID), ${'INOX-ENO'}, ${'Deposito sintetico'}, ${'tank_storage'},
            8000000, ${'stainless_steel'}, CAST(${location} AS UUID)
          )
        `);
      });
      await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId: location,
        vesselId: vessel,
        code: 'LOTE-PIP',
        volumeMl: 100_000,
      });
      const blend = await call(ctx, 'POST', '/v1/enology/calculators/blend', {
        target_volume_l: '1000',
        components: [
          { label: 'Cuba', volume_ml: '1', vessel_id: vessel },
          { label: 'Resto', volume_ml: '1' },
        ],
      }, 'bodega@winecore.test');
      expect(blend.status).toBe(200);
      const components = blend.body.components as { sufficient: boolean | null; volume_ml: string }[];
      expect(components[0]?.volume_ml).toBe('500000');
      expect(components[0]?.sufficient).toBe(false);
      expect(components[1]?.sufficient).toBeNull();
    } finally {
      await ctx.close();
    }
  });
});
