import { describe, expect, it } from 'bun:test';
import { evaluateFermentationAlerts, type ReadingPoint } from '../../src/core/winemaking/rules';

const start = Date.parse('2026-09-01T08:00:00Z');

function point(hours: number, density: number | null, temperatureC: number | null = 18): ReadingPoint {
  return { at: new Date(start + hours * 3_600_000).toISOString(), density, temperatureC };
}

describe('reglas de alerta de fermentación', () => {
  it('no avisa si la densidad baja 0,002 exactos en 48 h', () => {
    const hits = evaluateFermentationAlerts([
      point(0, 1.09),
      point(48, 1.088),
    ]);
    expect(hits.map((hit) => hit.rule)).toEqual([]);
  });

  it('avisa de parada si la bajada es menor que 0,002 y aún no llega a 0,995', () => {
    const hits = evaluateFermentationAlerts([
      point(0, 1.09),
      point(48, 1.0881),
    ]);
    expect(hits.map((hit) => hit.rule)).toEqual(['stuck']);
  });

  it('la densidad que no baja dispara parada y estancamiento; por debajo de 0,995 no', () => {
    const flat = evaluateFermentationAlerts([
      point(0, 1.04),
      point(48, 1.04),
    ]);
    expect(flat.map((hit) => hit.rule).sort()).toEqual(['density_stall', 'stuck']);

    const dry = evaluateFermentationAlerts([
      point(0, 0.996),
      point(48, 0.995),
    ]);
    expect(dry).toEqual([]);
  });

  it('la temperatura usa el intervalo cerrado [10, 30]', () => {
    expect(evaluateFermentationAlerts([point(0, 1.05, 10), point(48, 1.04, 30)])).toEqual([]);
    expect(evaluateFermentationAlerts([point(0, 1.05, 18), point(48, 1.04, 30.1)]).map((hit) => hit.rule)).toContain('temperature');
    expect(evaluateFermentationAlerts([point(0, 1.05, 18), point(48, 1.04, 9.9)]).map((hit) => hit.rule)).toContain('temperature');
  });

  it('sin 48 h de historia no hay alerta de densidad', () => {
    expect(evaluateFermentationAlerts([point(0, 1.1), point(24, 1.1)])).toEqual([]);
  });

  it('respeta una ventana distinta de 48 h', () => {
    const hits = evaluateFermentationAlerts(
      [point(0, 1.02), point(12, 1.02)],
      { minDensityDrop: 0.002, windowHours: 12, stallHours: 12, dryDensity: 0.995, tempMin: 10, tempMax: 30 },
    );
    expect(hits.map((hit) => hit.rule).sort()).toEqual(['density_stall', 'stuck']);
  });
});
