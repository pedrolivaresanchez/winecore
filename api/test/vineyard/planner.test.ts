import { describe, expect, it } from 'bun:test';
import { suggestHarvestDate } from '../../src/core/vineyard/planner';

describe('sugerencia de vendimia', () => {
  it('sin riesgo elige el primer día con cuadrilla desde la madurez', () => {
    const crew = new Map([['2026-09-20', 4], ['2026-09-21', 8]]);
    const suggestion = suggestHarvestDate({
      ready: '2026-09-20',
      weather: 'none',
      crewNeeded: 6,
      crew,
    });
    expect(suggestion.earliest_on).toBe('2026-09-17');
    expect(suggestion.latest_on).toBe('2026-09-27');
    expect(suggestion.suggested_on).toBe('2026-09-21');
    expect(suggestion.pull_days).toBe(0);
    expect(suggestion.rationale).toContain('21-09-2026');
  });

  it('la tormenta adelanta la búsqueda y explica el motivo en español', () => {
    const crew = new Map([['2026-09-16', 8], ['2026-09-20', 8]]);
    const suggestion = suggestHarvestDate({
      ready: '2026-09-20',
      weather: 'storm',
      crewNeeded: 6,
      crew,
    });
    expect(suggestion.pull_days).toBe(4);
    expect(suggestion.suggested_on).toBe('2026-09-20');
    expect(suggestion.rationale).toContain('tormenta');
    expect(suggestion.rationale).toContain('4 días');
  });
});
