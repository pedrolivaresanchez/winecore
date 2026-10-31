import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { edge, line, lot, openLab, operation, write, type Lab } from './fixture';

interface Metrics {
  vintage: number;
  harvest_date: string | null;
  kg: number | null;
  yield_kg_ha: number | null;
  intake_sanitary_notes: string | null;
  analyses: { abv: number | null } | null;
  tasting_score: number | null;
  weather_notes: string | null;
  ripeness: { probable_abv: number | null }[];
}

interface ParcelBlock {
  code: string;
  vintages: Metrics[];
}

interface WineBlock {
  code: string;
  name: string;
  vintages: Metrics[];
}

describe('comparación de añadas', () => {
  let lab: Lab;

  beforeAll(async () => {
    lab = await openLab();
    const grape24 = newId();
    const grape25 = newId();
    const grapeB = newId();
    const wine24 = newId();
    const wine25 = newId();
    const wineB = newId();
    const reception24 = newId();
    const reception25 = newId();
    const receptionB = newId();
    await write(lab.ctx, (tx) => {
      operation(tx, {
        id: reception24, entityId: lab.po, ownerId: lab.ownerId, number: 'R-24',
        opType: 'reception', occurredAt: '2024-09-10T08:00:00.000Z',
      });
      operation(tx, {
        id: reception25, entityId: lab.po, ownerId: lab.ownerId, number: 'R-25',
        opType: 'reception', occurredAt: '2025-09-18T08:00:00.000Z',
        details: { sanitary_notes: 'entrada limpia' },
      });
      operation(tx, {
        id: receptionB, entityId: lab.po, ownerId: lab.ownerId, number: 'R-B25',
        opType: 'reception', occurredAt: '2025-09-05T08:00:00.000Z',
      });
      lot(tx, { id: grape24, entityId: lab.po, code: 'UVA-24', kind: 'grape', vintage: 2024, origin: 'reception', createdBy: reception24 });
      lot(tx, { id: grape25, entityId: lab.po, code: 'UVA-25', kind: 'grape', vintage: 2025, origin: 'reception', createdBy: reception25 });
      lot(tx, { id: grapeB, entityId: lab.po, code: 'UVA-B', kind: 'grape', vintage: 2025, origin: 'reception', createdBy: receptionB });
      lot(tx, { id: wine24, entityId: lab.po, code: 'VINO-24', kind: 'wine', vintage: 2024, wineId: lab.wineA, origin: 'operation' });
      lot(tx, { id: wine25, entityId: lab.po, code: 'VINO-25', kind: 'wine', vintage: 2025, wineId: lab.wineA, origin: 'operation' });
      lot(tx, { id: wineB, entityId: lab.po, code: 'VINO-B', kind: 'wine', vintage: 2025, wineId: lab.wineB, origin: 'operation' });
      edge(tx, { child: wine24, parent: grape24, operationId: reception24, massG: 1 });
      edge(tx, { child: wine25, parent: grape25, operationId: reception25, massG: 1 });
      edge(tx, { child: wineB, parent: grapeB, operationId: receptionB, massG: 1 });
      line(tx, { operationId: reception25, lotId: grape25, state: 'grape', massG: 3_500_000 });
      tx.write(sql`
        INSERT INTO vineyard.harvest (
          id, parcel_id, vintage, harvested_on, variety, estimated_kg, reception_operation_id, notes
        ) VALUES
          (CAST(${newId()} AS UUID), CAST(${lab.parcelA} AS UUID), 2024, DATE '2024-09-10', 'Variedad A', 3000, CAST(${reception24} AS UUID), 'uva sana 2024'),
          (CAST(${newId()} AS UUID), CAST(${lab.parcelA} AS UUID), 2025, DATE '2025-09-18', 'Variedad A', 3600, CAST(${reception25} AS UUID), 'ligera pasificación'),
          (CAST(${newId()} AS UUID), CAST(${lab.parcelB} AS UUID), 2025, DATE '2025-09-05', 'Variedad B', 1500, CAST(${receptionB} AS UUID), 'botrytis leve')
      `);
      tx.write(sql`
        INSERT INTO vineyard.maturity_check (
          id, parcel_id, checked_at, author, probable_abv, total_acidity, sanitary_status, weather_snapshot
        ) VALUES
          (CAST(${newId()} AS UUID), CAST(${lab.parcelA} AS UUID), CAST(${'2024-08-20T08:00:00.000Z'} AS TIMESTAMPTZ), 'Equipo sintético', 12.8, 6.2, 'good', ${sql.json({ note: 'semana seca' })}),
          (CAST(${newId()} AS UUID), CAST(${lab.parcelA} AS UUID), CAST(${'2025-08-28T08:00:00.000Z'} AS TIMESTAMPTZ), 'Equipo sintético', 13.4, 5.4, 'good', ${sql.json({ note: 'viento de poniente' })})
      `);
      const analysis24 = newId();
      const analysis25 = newId();
      const analysisB = newId();
      for (const [id, lotId, at] of [
        [analysis24, wine24, '2024-10-01T08:00:00.000Z'],
        [analysis25, wine25, '2025-10-02T08:00:00.000Z'],
        [analysisB, wineB, '2025-10-03T08:00:00.000Z'],
      ] as const) {
        tx.write(sql`
          INSERT INTO cellar.analysis (id, lot_id, kind, sampled_at, lab, created_by)
          VALUES (CAST(${id} AS UUID), CAST(${lotId} AS UUID), 'control', CAST(${at} AS TIMESTAMPTZ), 'internal', 'lot-design-test')
        `);
      }
      const results: [string, string, number][] = [
        [analysis24, 'abv', 13.1], [analysis24, 'total_acidity', 5.6], [analysis24, 'ph', 3.4],
        [analysis24, 'free_so2', 18], [analysis24, 'total_so2', 45], [analysis24, 'volatile_acidity', 0.28],
        [analysis24, 'total_polyphenol_index', 48],
        [analysis25, 'abv', 14], [analysis25, 'total_acidity', 5.1], [analysis25, 'ph', 3.55],
        [analysis25, 'free_so2', 22], [analysis25, 'total_so2', 50], [analysis25, 'volatile_acidity', 0.31],
        [analysis25, 'total_polyphenol_index', 62],
        [analysisB, 'abv', 12.2],
      ];
      for (const [analysisId, parameter, value] of results) {
        tx.write(sql`
          INSERT INTO cellar.analysis_result (id, analysis_id, parameter_code, value)
          VALUES (CAST(${newId()} AS UUID), CAST(${analysisId} AS UUID), ${parameter}, ${value})
        `);
      }
      tx.write(sql`
        INSERT INTO knowledge.tasting_note (id, wine_id, vintage, lot_id, tasted_on, score, notes, author)
        VALUES
          (CAST(${newId()} AS UUID), CAST(${lab.wineA} AS UUID), 2024, CAST(${wine24} AS UUID), DATE '2025-03-01', 86, 'Nota sintética', 'Cata sintética'),
          (CAST(${newId()} AS UUID), CAST(${lab.wineA} AS UUID), 2025, CAST(${wine25} AS UUID), DATE '2026-03-01', 91, 'Nota sintética', 'Cata sintética'),
          (CAST(${newId()} AS UUID), CAST(${lab.wineB} AS UUID), 2025, CAST(${wineB} AS UUID), DATE '2026-03-02', 78, 'Nota sintética', 'Cata sintética')
      `);
    });
  });

  afterAll(async () => {
    await lab.ctx.close();
  });

  test('devuelve JSON y CSV por parcela y por referencia', async () => {
    const response = await lab.ctx.app.handle(new Request('http://localhost/v1/vintage-comparison', {
      headers: { 'x-dev-user': 'asesor@winecore.test' },
    }));
    expect(response.status).toBe(200);
    const report = await response.json() as {
      missing: string[];
      by_parcel: ParcelBlock[];
      by_wine: WineBlock[];
    };
    expect(report.missing).not.toContain('tasting.score');
    const parcelA = report.by_parcel.find((parcel) => parcel.code === 'PARC-A');
    const year24 = parcelA?.vintages.find((item) => item.vintage === 2024);
    const year25 = parcelA?.vintages.find((item) => item.vintage === 2025);
    expect(year24).toMatchObject({
      harvest_date: '2024-09-10',
      kg: 3000,
      yield_kg_ha: 1500,
      tasting_score: 86,
      weather_notes: 'semana seca',
    });
    expect(year24?.intake_sanitary_notes).toContain('uva sana 2024');
    expect(year24?.ripeness[0]?.probable_abv).toBe(12.8);
    expect(year24?.analyses?.abv).toBe(13.1);
    expect(year25).toMatchObject({ kg: 3500, yield_kg_ha: 1750, tasting_score: 91 });
    expect(year25?.intake_sanitary_notes).toContain('ligera pasificación');
    expect(year25?.intake_sanitary_notes).toContain('entrada limpia');
    expect(year25?.analyses?.abv).toBe(14);
    expect(year25?.weather_notes).toBe('viento de poniente');
    const parcelB = report.by_parcel.find((parcel) => parcel.code === 'PARC-B');
    expect(parcelB?.vintages[0]).toMatchObject({ vintage: 2025, kg: 1500, yield_kg_ha: 1500 });
    const refA = report.by_wine.find((wine) => wine.name === 'Referencia A');
    const refB = report.by_wine.find((wine) => wine.name === 'Referencia B');
    expect(refA?.vintages.map((item) => item.vintage)).toEqual([2024, 2025]);
    expect(refB?.vintages).toHaveLength(1);
    expect(refA?.code).toBe('REFA');

    const csvResponse = await lab.ctx.app.handle(new Request('http://localhost/v1/vintage-comparison.csv', {
      headers: { 'x-dev-user': 'bodega@winecore.test' },
    }));
    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers.get('content-type')).toContain('text/csv');
    const csv = await csvResponse.text();
    expect(csv).toContain('parcela;PARC-A');
    expect(csv).toContain('referencia;REFA;Referencia A');
    expect(csv).toContain('3500');
    expect(csv).toContain('13.1');

    const filtered = await lab.ctx.app.handle(new Request(`http://localhost/v1/vintage-comparison?wine_id=${lab.wineA}`, {
      headers: { 'x-dev-user': 'asesor@winecore.test' },
    }));
    const onlyA = await filtered.json() as { by_wine: WineBlock[]; by_parcel: ParcelBlock[] };
    expect(onlyA.by_wine.map((wine) => wine.name)).toEqual(['Referencia A']);
    expect(onlyA.by_parcel.map((parcel) => parcel.code)).toEqual(['PARC-A']);
  });

  test('tolera la ausencia de catas y de analíticas', async () => {
    await lab.ctx.client.query('DROP TABLE knowledge.tasting_note');
    await lab.ctx.client.query('DROP TABLE tasting.note');
    const withoutScores = await lab.ctx.app.handle(new Request('http://localhost/v1/vintage-comparison', {
      headers: { 'x-dev-user': 'asesor@winecore.test' },
    }));
    const droppedScores = await withoutScores.json() as { missing: string[]; by_parcel: ParcelBlock[] };
    expect(droppedScores.missing).toContain('tasting.score');
    const year25 = droppedScores.by_parcel.find((parcel) => parcel.code === 'PARC-A')?.vintages.find((item) => item.vintage === 2025);
    expect(year25?.tasting_score).toBeNull();
    expect(year25?.analyses?.abv).toBe(14);
    expect(year25?.kg).toBe(3500);

    await lab.ctx.client.query('DROP TABLE cellar.analysis_flag');
    await lab.ctx.client.query('DROP TABLE cellar.analysis_extra');
    await lab.ctx.client.query('DROP TABLE cellar.lot_phase');
    await lab.ctx.client.query('DROP TABLE cellar.analysis_result');
    await lab.ctx.client.query('DROP TABLE cellar.analysis');
    const withoutAnalyses = await lab.ctx.app.handle(new Request('http://localhost/v1/vintage-comparison', {
      headers: { 'x-dev-user': 'asesor@winecore.test' },
    }));
    const droppedAnalyses = await withoutAnalyses.json() as { missing: string[]; by_parcel: ParcelBlock[] };
    expect(droppedAnalyses.missing).toContain('cellar.analysis');
    const still = droppedAnalyses.by_parcel.find((parcel) => parcel.code === 'PARC-A')?.vintages.find((item) => item.vintage === 2025);
    expect(still?.analyses).toBeNull();
    expect(still?.kg).toBe(3500);
  });
});
