import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { listRecipes, planFromRecipe } from '../../src/core/lot-design/mcp-tools';
import { call, countOps, edge, line, lot, openLab, operation, write, type Lab } from './fixture';

const BODEGA = 'bodega@winecore.test';
const OWNER = 'owner@winecore.test';

function design(lab: Lab, extra: Record<string, unknown> = {}) {
  return {
    destination_kind: 'reference',
    wine_id: lab.wineA,
    product_id: null,
    collection_name: null,
    vinification: 'tinto',
    destemmed: true,
    inoculation_kind: 'espontanea',
    yeast_product_id: null,
    yeast_lot_code: null,
    yeast_name: null,
    practices_applied: ['filtracion'],
    practices_not_applied: ['desfangado'],
    no_intervention: false,
    aging_method: 'barrica',
    aging_duration_days: 180,
    single_plot: false,
    parcel_id: null,
    label_number: 2,
    notes: null,
    ...extra,
  };
}

describe('receta, plan y desviaciones', () => {
  let lab: Lab;
  const child = newId();
  const target = newId();
  const parentA = newId();
  const parentB = newId();

  beforeAll(async () => {
    lab = await openLab();
    const blendOp = newId();
    const additionOp = newId();
    const rackingOp = newId();
    await write(lab.ctx, (tx) => {
      lot(tx, { id: parentA, entityId: lab.po, code: 'PADRE-A', kind: 'wine', vintage: 2026, origin: 'operation' });
      lot(tx, { id: parentB, entityId: lab.po, code: 'PADRE-B', kind: 'wine', vintage: 2026, origin: 'operation' });
      lot(tx, {
        id: child, entityId: lab.po, code: 'BLEND-1', kind: 'wine', vintage: 2026,
        wineId: lab.wineA, origin: 'operation', createdBy: blendOp,
      });
      lot(tx, {
        id: target, entityId: lab.po, code: 'BLEND-2', kind: 'wine', vintage: 2026,
        wineId: lab.wineA, origin: 'operation',
      });
      operation(tx, {
        id: blendOp, entityId: lab.po, ownerId: lab.ownerId, number: 'OB-BLEND',
        opType: 'blend', occurredAt: '2026-09-01T08:00:00.000Z',
      });
      line(tx, { operationId: blendOp, lotId: parentA, role: 'input', vesselId: lab.vesselId, state: 'wine', volumeMl: 6000 });
      line(tx, { operationId: blendOp, lotId: parentB, role: 'input', vesselId: lab.vesselId, state: 'wine', volumeMl: 4000 });
      line(tx, { operationId: blendOp, lotId: child, role: 'output', vesselId: lab.vesselId, state: 'wine', volumeMl: 10000 });
      edge(tx, { child, parent: parentA, operationId: blendOp, volumeMl: 6000 });
      edge(tx, { child, parent: parentB, operationId: blendOp, volumeMl: 4000 });
      operation(tx, {
        id: additionOp, entityId: lab.po, ownerId: lab.ownerId, number: 'OB-ADD',
        opType: 'addition', occurredAt: '2026-09-01T12:00:00.000Z',
      });
      tx.write(sql`
        INSERT INTO cellar.addition (
          id, operation_id, lot_id, additive_product_id, quantity, quantity_unit, dose, dose_unit, purpose
        ) VALUES (
          CAST(${newId()} AS UUID), CAST(${additionOp} AS UUID), CAST(${child} AS UUID), CAST(${lab.so2Id} AS UUID),
          20, 'g', 2, 'g/hl', 'sulphiting'
        )
      `);
      operation(tx, {
        id: rackingOp, entityId: lab.po, ownerId: lab.ownerId, number: 'OB-RACK',
        opType: 'racking', occurredAt: '2026-09-15T08:00:00.000Z',
        details: { temperature_c: 16, duration_hours: 6 },
      });
      line(tx, { operationId: rackingOp, lotId: child, vesselId: lab.vesselId, state: 'wine', volumeMl: 9800 });
    });
  });

  afterAll(async () => {
    await lab.ctx.close();
  });

  test('captura la elaboración, propone un plan y no crea operaciones', async () => {
    const saved = await call(lab.ctx, 'PUT', '/v1/lots/BLEND-1/design', design(lab), BODEGA);
    expect(saved.status).toBe(200);
    const before = await countOps(lab.ctx);
    const captured = await call(lab.ctx, 'POST', '/v1/lots/BLEND-1/recipe', {}, BODEGA);
    expect(captured.status).toBe(201);
    const versions = captured.body.versions as { steps: { op_type: string; offset_days: number; temperature_c: number | null; duration_hours: number | null; additions: { dose: number; product_name: string | null }[]; blend_proportions: { percent: number }[] }[] }[];
    const steps = versions[0]?.steps ?? [];
    expect(steps.map((item) => item.op_type)).toEqual(['blend', 'addition', 'racking']);
    expect(steps[0]?.blend_proportions.map((item) => item.percent).sort()).toEqual([40, 60]);
    expect(steps[1]?.additions[0]).toMatchObject({ dose: 2, product_name: 'Metabisulfito sintético' });
    expect(steps[2]).toMatchObject({ offset_days: 14, temperature_c: 16, duration_hours: 6 });
    const recipeId = String(captured.body.id);
    const owner = await lab.ctx.writer.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM core.app_user WHERE email = 'bodega@winecore.test'
    `);
    const plan = await planFromRecipe(lab.ctx.writer, {
      type: 'user',
      id: owner[0]?.id ?? lab.ownerId,
      requestId: newId(),
    }, {
      code: 'BLEND-2',
      recipe_id: recipeId,
      start_date: '2027-09-01',
    });
    expect(plan.creates_operations).toBe(false);
    expect(plan.steps.map((item) => item.status)).toEqual(['suggested', 'suggested', 'suggested']);
    expect(plan.steps.map((item) => item.target_date)).toEqual(['2027-09-01', '2027-09-01', '2027-09-15']);
    expect(await countOps(lab.ctx)).toBe(before);
    const listed = await listRecipes(lab.ctx.writer, {});
    expect(listed.items.some((item) => item.id === recipeId)).toBe(true);
    const httpPlan = await call(lab.ctx, 'GET', '/v1/lots/BLEND-2/plan', undefined, BODEGA);
    expect(httpPlan.status).toBe(200);
    expect((httpPlan.body as { creates_operations: boolean }).creates_operations).toBe(false);

    const deviantBlend = newId();
    const deviantRack = newId();
    const deviantFilter = newId();
    await write(lab.ctx, (tx) => {
      operation(tx, {
        id: deviantBlend, entityId: lab.po, ownerId: lab.ownerId, number: 'OB-BLEND-2',
        opType: 'blend', occurredAt: '2027-09-01T08:00:00.000Z',
      });
      line(tx, { operationId: deviantBlend, lotId: parentA, role: 'input', vesselId: lab.vesselId, state: 'wine', volumeMl: 5000 });
      line(tx, { operationId: deviantBlend, lotId: parentB, role: 'input', vesselId: lab.vesselId, state: 'wine', volumeMl: 5000 });
      line(tx, { operationId: deviantBlend, lotId: target, role: 'output', vesselId: lab.vesselId, state: 'wine', volumeMl: 10000 });
      operation(tx, {
        id: deviantRack, entityId: lab.po, ownerId: lab.ownerId, number: 'OB-RACK-2',
        opType: 'racking', occurredAt: '2027-09-15T08:00:00.000Z',
        details: { temperature_c: 20, duration_hours: 6 },
      });
      line(tx, { operationId: deviantRack, lotId: target, vesselId: lab.vesselId, state: 'wine', volumeMl: 9800 });
      operation(tx, {
        id: deviantFilter, entityId: lab.po, ownerId: lab.ownerId, number: 'OB-FILT',
        opType: 'filtration', occurredAt: '2027-09-16T08:00:00.000Z',
      });
      line(tx, { operationId: deviantFilter, lotId: target, vesselId: lab.vesselId, state: 'wine', volumeMl: 9700 });
    });
    const targetDesign = await call(lab.ctx, 'PUT', '/v1/lots/BLEND-2/design', design(lab, {
      aging_method: 'sin_crianza',
      aging_duration_days: null,
    }), BODEGA);
    expect(targetDesign.status).toBe(200);
    const report = await call(
      lab.ctx,
      'GET',
      `/v1/lots/BLEND-2/deviations?recipe_id=${recipeId}`,
      undefined,
      BODEGA,
    );
    expect(report.status).toBe(200);
    expect(report.body.matched).toBe(false);
    const deviations = report.body.deviations as { kind: string; field: string | null; op_type: string | null; expected: unknown; actual: unknown }[];
    expect(deviations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'parameter', field: 'blend_proportions' }),
      expect.objectContaining({ kind: 'missing_step', op_type: 'addition' }),
      expect.objectContaining({ kind: 'parameter', field: 'temperature_c', expected: 16, actual: 20 }),
      expect.objectContaining({ kind: 'extra_operation', op_type: 'filtration' }),
      expect.objectContaining({ kind: 'design', field: 'aging_method', expected: 'barrica', actual: 'sin_crianza' }),
    ]));

    const renamed = await call(lab.ctx, 'PATCH', `/v1/recipes/${recipeId}`, { name: 'Receta norte' }, BODEGA);
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Receta norte');
    const forbidden = await call(lab.ctx, 'POST', `/v1/recipes/${recipeId}/publish`, {}, BODEGA);
    expect(forbidden.status).toBe(403);
    const published = await call(lab.ctx, 'POST', `/v1/recipes/${recipeId}/publish`, {}, OWNER);
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('published');
    const locked = await call(lab.ctx, 'PATCH', `/v1/recipes/${recipeId}`, { name: 'Otra' }, OWNER);
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('WC_RECIPE_LOCKED');
    const next = await call(lab.ctx, 'POST', `/v1/recipes/${recipeId}/versions`, {}, BODEGA);
    expect(next.status).toBe(201);
    expect(next.body.latest_version_no).toBe(2);
    expect(next.body.latest_version_status).toBe('draft');
    expect(next.body.published_version_no).toBe(1);
    const chain = await lab.ctx.writer.verifyAuditChain();
    expect(chain.intact).toBe(true);
  });

  test('no captura un lote sin operaciones confirmadas', async () => {
    const empty = newId();
    await write(lab.ctx, (tx) => {
      lot(tx, { id: empty, entityId: lab.po, code: 'VACIO-1', kind: 'wine', vintage: 2026, origin: 'opening_count' });
    });
    const response = await call(lab.ctx, 'POST', '/v1/lots/VACIO-1/recipe', {}, BODEGA);
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('WC_LOT_NOT_FINISHED');
  });
});
