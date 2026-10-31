import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { call, seedWorld, type TastingWorld, type TestApp } from './fixture';

let ctx: TestApp;
let world: TastingWorld;

beforeAll(async () => {
  ctx = await createTestApp();
  world = await seedWorld(ctx);
  const notes = [
    {
      template_code: 'CRIANZA',
      tasted_at: '2024-10-02T11:00:00Z',
      taster_name: 'Catador Uno',
      lot_id: world.lotA2024,
      overall_score: 6,
      values: { fruit: 3 },
    },
    {
      template_code: 'CRIANZA',
      tasted_at: '2026-03-02T11:00:00Z',
      taster_name: 'Catador Uno',
      lot_id: world.lotA2026,
      overall_score: 8,
      defects: ['reduction'],
      decision: 'Seguir en depósito',
      values: { fruit: 4, oak: 2 },
    },
    {
      template_code: 'BOTELLA',
      tasted_at: '2026-06-01T20:00:00Z',
      taster_name: 'Catador Dos',
      wine_id: world.wineA,
      vintage: 2024,
      overall_score: 90,
      values: {
        place: 'Feria sintética',
        glass: 'Copa borgoña',
        context: 'Cata de equipo',
        evolution: 'improving',
      },
    },
  ];
  for (const note of notes) {
    const created = await call(ctx, 'POST', '/v1/tasting-notes', note);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  }
});

afterAll(async () => {
  await ctx.close();
});

describe('evolución', () => {
  it('une las catas del lote con sus analíticas, en orden', async () => {
    const view = await call(ctx, 'GET', `/v1/tasting-evolution?lot_id=${world.lotA2026}`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.scope).toMatchObject({ kind: 'lot', lot_id: world.lotA2026, lot_code: 'REFA2026', vintage: 2026, wine_code: 'REFA' });
    const points = view.body.points as { at: string; kind: string; analysis?: { results: { code: string; value: number }[] }; tasting?: { overall_score: number; defects: string[] } }[];
    expect(points.map((point) => point.kind)).toEqual(['analysis', 'tasting']);
    expect(points[0]?.at.startsWith('2026-03-01')).toBe(true);
    expect(points[0]?.analysis?.results).toEqual([expect.objectContaining({ code: 'volatile_acidity', value: 0.32 })]);
    expect(points[1]?.tasting?.overall_score).toBe(8);
    expect(points[1]?.tasting?.defects).toEqual(['reduction']);
    expect(JSON.stringify(points)).not.toContain(world.lotA2024);
  });

  it('sigue un vino a través de las añadas', async () => {
    const view = await call(ctx, 'GET', `/v1/tasting-evolution?wine_code=REFA`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const scope = view.body.scope as { kind: string; wine_name: string; vintages: number[] };
    expect(scope.kind).toBe('wine');
    expect(scope.wine_name).toBe('Referencia A');
    expect(scope.vintages).toEqual([2024, 2026]);
    const points = view.body.points as { at: string; kind: string; vintage: number | null; lot_code: string | null }[];
    expect(points.map((point) => point.at.slice(0, 10))).toEqual([
      '2024-10-01',
      '2024-10-02',
      '2026-03-01',
      '2026-03-02',
      '2026-06-01',
    ]);
    expect(points.map((point) => point.kind)).toEqual(['analysis', 'tasting', 'analysis', 'tasting', 'tasting']);
    expect(points.map((point) => point.vintage)).toEqual([2024, 2024, 2026, 2026, 2024]);
    expect(points[4]?.lot_code).toBeNull();
  });
});
