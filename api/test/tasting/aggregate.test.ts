import { describe, expect, it } from 'bun:test';
import { aggregateSamples } from '../../src/core/tasting/aggregate';
import { parseDictation } from '../../src/core/tasting/parse-dictation';

describe('agregado de cata ciega', () => {
  it('calcula ratio de síes, media, consistencia entre días y la selección', () => {
    const rows = aggregateSamples([1, 2, 3], [
      { sample_no: 1, day_no: 1, taster_name: 'Catador Uno', vote: 'yes', score: 8 },
      { sample_no: 1, day_no: 1, taster_name: 'Catador Dos', vote: 'yes', score: 9 },
      { sample_no: 1, day_no: 2, taster_name: 'Catador Uno', vote: 'yes', score: 8 },
      { sample_no: 1, day_no: 2, taster_name: 'Catador Dos', vote: 'yes', score: 7 },
      { sample_no: 2, day_no: 1, taster_name: 'Catador Uno', vote: 'yes', score: 6 },
      { sample_no: 2, day_no: 1, taster_name: 'Catador Dos', vote: 'no', score: 4 },
      { sample_no: 2, day_no: 2, taster_name: 'Catador Uno', vote: 'no', score: 5 },
      { sample_no: 2, day_no: 2, taster_name: 'Catador Dos', vote: 'no', score: 4 },
      { sample_no: 3, day_no: 1, taster_name: 'Catador Uno', vote: 'yes', score: 9 },
    ]);
    expect(rows.map((row) => row.sample_no)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ yes_ratio: 1, mean_score: 8, consistency: 1, selected: true });
    expect(rows[1]).toMatchObject({
      yes: 1,
      no: 3,
      yes_ratio: 0.25,
      mean_score: 4.75,
      consistency: 0.5,
      selected: false,
    });
    expect(rows[1]?.days).toEqual([
      { day_no: 1, yes: 1, no: 1, yes_ratio: 0.5, mean_score: 5 },
      { day_no: 2, yes: 0, no: 2, yes_ratio: 0, mean_score: 4.5 },
    ]);
    expect(rows[2]).toMatchObject({ yes_ratio: 1, mean_score: 9, consistency: null, selected: true });
  });
});

describe('dictado', () => {
  it('reconoce plantilla, lote, puntuaciones, defecto y decisión', () => {
    const parsed = parseDictation(
      'Cata de mosto del lote REFA2026 visual 7 nariz 6,5 boca 7 conjunto 8 un poco reducido decisión seguir',
    );
    expect(parsed.template_code).toBe('MOSTO');
    expect(parsed.lot_code).toBe('REFA2026');
    expect(parsed.visual_score).toBe(7);
    expect(parsed.nose_score).toBe(6.5);
    expect(parsed.mouth_score).toBe(7);
    expect(parsed.overall_score).toBe(8);
    expect(parsed.defects).toEqual(['reduction']);
    expect(parsed.decision).toBe('seguir');
  });

  it('no marca defectos si el dictado dice que no los hay', () => {
    const parsed = parseDictation('Mosto del lote MOSTOS1 visual 7 sin defecto');
    expect(parsed.defects).toEqual([]);
  });
});
