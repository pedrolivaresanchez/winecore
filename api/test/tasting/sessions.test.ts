import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, seedWorld, type TastingWorld, type TestApp } from './fixture';

let ctx: TestApp;
let world: TastingWorld;

beforeAll(async () => {
  ctx = await createTestApp();
  world = await seedWorld(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('cata ciega', () => {
  it('oculta el lote hasta revelar, agrega los votos de cada día y expone la selección', async () => {
    const operationsBefore = await countOperations(ctx);
    const created = await call(ctx, 'POST', '/v1/tasting-sessions', {
      title: 'Ensayo de ensamblaje',
      target: 'Referencia A',
      started_on: '2026-10-01',
      days: 3,
      notes: 'Tres muestras, dos días con voto y un tercero vacío',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const sessionId = String(created.body.id);
    expect(created.body.revealed).toBe(false);
    expect(created.body.aggregate).toBeNull();

    const samples = [
      { lot_id: world.lotA2026, vessel_id: world.vesselA },
      { lot_id: world.lotB2026, vessel_id: world.vesselB },
      { lot_id: world.lotA2024 },
    ];
    const numbers: number[] = [];
    for (const sample of samples) {
      const added = await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/samples`, sample);
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      numbers.push(Number(added.body.sample_no));
    }
    expect(numbers).toEqual([1, 2, 3]);

    const hidden = await call(ctx, 'GET', `/v1/tasting-sessions/${sessionId}`);
    expect(hidden.status).toBe(200);
    const hiddenText = JSON.stringify(hidden.body);
    expect(hiddenText).not.toContain(world.lotA2026);
    expect(hiddenText).not.toContain(world.lotB2026);
    expect(hiddenText).not.toContain(world.lotA2024);
    expect(hiddenText).not.toContain('REFA2026');
    expect(hiddenText).not.toContain('REFB2026');
    const hiddenSamples = hidden.body.samples as Record<string, unknown>[];
    expect(hiddenSamples).toEqual([{ sample_no: 1 }, { sample_no: 2 }, { sample_no: 3 }]);
    const premature = await call(ctx, 'GET', `/v1/tasting-sessions/${sessionId}/selection`);
    expect(premature.status).toBe(409);
    expect(premature.body.code).toBe('WC_TASTING_HIDDEN');

    const ballots = [
      { sample_no: 1, day_no: 1, taster_name: 'Catador Uno', vote: 'yes', score: 8 },
      { sample_no: 1, day_no: 1, taster_name: 'Catador Dos', vote: 'yes', score: 9 },
      { sample_no: 1, day_no: 2, taster_name: 'Catador Uno', vote: 'yes', score: 8 },
      { sample_no: 1, day_no: 2, taster_name: 'Catador Dos', vote: 'yes', score: 7 },
      { sample_no: 2, day_no: 1, taster_name: 'Catador Uno', vote: 'yes', score: 6 },
      { sample_no: 2, day_no: 1, taster_name: 'Catador Dos', vote: 'no', score: 4 },
      { sample_no: 2, day_no: 2, taster_name: 'Catador Uno', vote: 'no', score: 5 },
      { sample_no: 2, day_no: 2, taster_name: 'Catador Dos', vote: 'no', score: 4 },
      { sample_no: 3, day_no: 1, taster_name: 'Catador Uno', vote: 'yes', score: 9 },
    ];
    for (const ballot of ballots) {
      const voted = await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/votes`, ballot);
      expect(voted.status, JSON.stringify(voted.body)).toBe(200);
    }
    const again = await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/votes`, {
      sample_no: 3,
      day_no: 1,
      taster_name: 'Catador Uno',
      vote: 'yes',
      score: 9,
    });
    expect(again.body.updated).toBe(true);
    const outOfRange = await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/votes`, {
      sample_no: 1,
      day_no: 4,
      taster_name: 'Catador Uno',
      vote: 'yes',
    });
    expect(outOfRange.status).toBe(422);
    expect(outOfRange.body.code).toBe('WC_TASTING_DAY');

    const revealed = await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/reveal`);
    expect(revealed.status, JSON.stringify(revealed.body)).toBe(200);
    expect(revealed.body.revealed).toBe(true);
    const openSamples = revealed.body.samples as { sample_no: number; lot_id: string; lot_code: string }[];
    expect(openSamples.map((sample) => sample.lot_code)).toEqual(['REFA2026', 'REFB2026', 'REFA2024']);
    const aggregate = revealed.body.aggregate as {
      sample_no: number;
      yes_ratio: number;
      mean_score: number | null;
      consistency: number | null;
      selected: boolean;
      lot_code: string;
    }[];
    expect(aggregate.map((row) => ({
      sample_no: row.sample_no,
      yes_ratio: row.yes_ratio,
      mean_score: row.mean_score,
      consistency: row.consistency,
      selected: row.selected,
      lot_code: row.lot_code,
    }))).toEqual([
      { sample_no: 1, yes_ratio: 1, mean_score: 8, consistency: 1, selected: true, lot_code: 'REFA2026' },
      { sample_no: 2, yes_ratio: 0.25, mean_score: 4.75, consistency: 0.5, selected: false, lot_code: 'REFB2026' },
      { sample_no: 3, yes_ratio: 1, mean_score: 9, consistency: null, selected: true, lot_code: 'REFA2024' },
    ]);

    const selection = await call(ctx, 'GET', `/v1/tasting-sessions/${sessionId}/selection`);
    expect(selection.status).toBe(200);
    expect(selection.body.target).toBe('Referencia A');
    const lots = selection.body.lots as { lot_code: string; yes_ratio: number }[];
    expect(lots.map((lot) => lot.lot_code)).toEqual(['REFA2026', 'REFA2024']);

    const override = await call(ctx, 'PATCH', `/v1/tasting-sessions/${sessionId}/selection`, {
      lot_ids: [world.lotB2026],
    });
    expect(override.status, JSON.stringify(override.body)).toBe(200);
    const chosen = override.body.lots as { lot_id: string; yes_ratio: number }[];
    expect(chosen).toEqual([{ lot_id: world.lotB2026, lot_code: 'REFB2026', vessel_id: world.vesselB, vessel_code: 'INOX-S2', sample_no: 2, yes_ratio: 0.25, mean_score: 4.75, consistency: 0.5 }].map((row) => row));
    expect(chosen[0]?.lot_id).toBe(world.lotB2026);
    expect(chosen[0]?.yes_ratio).toBe(0.25);

    const closed = await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/votes`, {
      sample_no: 1,
      day_no: 3,
      taster_name: 'Catador Uno',
      vote: 'no',
    });
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('WC_TASTING_CLOSED');
    expect(await countOperations(ctx)).toBe(operationsBefore);
  });
});

async function countOperations(ctx: TestApp): Promise<number> {
  const rows = await ctx.writer.read<{ n: string }>(sql`SELECT count(*)::VARCHAR AS n FROM cellar.operation`);
  return Number(rows[0]?.n ?? 0);
}
