import { describe, expect, test } from 'bun:test';
import { addCivilDays, civilDaysBetween } from '../../src/core/lot-design/dates';
import { compareStepSequences, type Deviation } from '../../src/core/lot-design/deviations';
import type { RecipeStep } from '../../src/core/lot-design/history';

function step(opType: string, extra?: {
  temp?: number | null;
  hours?: number | null;
  blend?: number[];
  dose?: number | null;
}): RecipeStep {
  return {
    position: 1,
    op_type: opType,
    offset_days: 0,
    duration_hours: extra?.hours ?? null,
    temperature_c: extra?.temp ?? null,
    additions: extra?.dose == null ? [] : [{
      product_id: '00000000-0000-4000-8000-000000000001',
      product_name: 'Metabisulfito sintético',
      quantity: 20,
      quantity_unit: 'g',
      dose: extra.dose,
      dose_unit: 'g/hl',
      dose_g_per_hl: extra.dose,
      purpose: 'sulphiting',
    }],
    blend_proportions: (extra?.blend ?? []).map((percent) => ({
      lot_id: '00000000-0000-4000-8000-000000000002',
      lot_code: 'PADRE',
      volume_ml: percent,
      mass_g: 0,
      percent,
    })),
    parameters: {},
    source_operation_id: null,
  };
}

function kinds(deviations: Deviation[]): string[] {
  return deviations.map((item) => `${item.kind}:${item.field ?? item.op_type}`);
}

describe('comparación de receta', () => {
  test('suma días civiles sin depender de la zona horaria', () => {
    expect(addCivilDays('2027-09-01', 14)).toBe('2027-09-15');
    expect(addCivilDays('2027-01-31', 1)).toBe('2027-02-01');
    expect(civilDaysBetween('2026-09-01', '2026-09-15')).toBe(14);
  });

  test('detecta proporción, paso que falta, temperatura y operación de más', () => {
    const deviations = compareStepSequences(
      [
        step('blend', { blend: [60, 40] }),
        step('addition', { dose: 2 }),
        step('racking', { temp: 16, hours: 6 }),
      ].map(comparable),
      [
        step('blend', { blend: [50, 50] }),
        step('racking', { temp: 20, hours: 6 }),
        step('filtration'),
      ].map(comparable),
    );
    expect(kinds(deviations)).toEqual([
      'parameter:blend_proportions',
      'missing_step:addition',
      'parameter:temperature_c',
      'extra_operation:filtration',
    ]);
    const temperature = deviations.find((item) => item.field === 'temperature_c');
    expect(temperature).toMatchObject({ expected: 16, actual: 20 });
  });

  test('señala una dosis distinta en el mismo paso', () => {
    const deviations = compareStepSequences(
      [step('addition', { dose: 2 })].map(comparable),
      [step('addition', { dose: 4 })].map(comparable),
    );
    expect(deviations).toEqual([
      expect.objectContaining({ kind: 'parameter', field: 'dose_g_per_hl', expected: 2, actual: 4 }),
    ]);
  });
});

function comparable(stepValue: RecipeStep) {
  return {
    op_type: stepValue.op_type,
    duration_hours: stepValue.duration_hours,
    temperature_c: stepValue.temperature_c,
    additions: stepValue.additions.map((item) => ({
      product_id: item.product_id,
      product_name: item.product_name,
      dose_g_per_hl: item.dose_g_per_hl,
    })),
    blend_percents: stepValue.blend_proportions.map((item) => item.percent),
  };
}
