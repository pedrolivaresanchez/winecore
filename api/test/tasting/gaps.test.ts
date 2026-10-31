import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { listSessionSamples } from '../../src/core/tasting/mcp-tools';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, grapeValues, seedWorld, type TastingWorld, type TestApp } from './fixture';

let ctx: TestApp;
let world: TastingWorld;

beforeAll(async () => {
  ctx = await createTestApp();
  world = await seedWorld(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('huecos de cata', () => {
  it('oculta votos, notas e identidad hasta revelar, en cada lectura', async () => {
    const created = await call(ctx, 'POST', '/v1/tasting-sessions', {
      title: 'Cata reservada',
      target: 'Referencia A',
      started_on: '2026-10-08',
      days: 2,
    });
    expect(created.status).toBe(201);
    const sessionId = String(created.body.id);
    const added = await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/samples`, { lot_id: world.lotA2026 });
    expect(added.status).toBe(201);

    const organiserVote = await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/votes`, {
      sample_no: 1,
      day_no: 1,
      taster_name: 'Organizador',
      vote: 'yes',
      score: 11,
      comment: 'secreto-organizador',
    });
    expect(organiserVote.status).toBe(200);
    const cellarVote = await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/votes`, {
      sample_no: 1,
      day_no: 1,
      taster_name: 'Bodega',
      vote: 'no',
      score: 22,
      comment: 'secreto-bodega',
    }, 'bodega@winecore.test');
    expect(cellarVote.status).toBe(200);
    expect(JSON.stringify(cellarVote.body)).not.toContain('secreto-organizador');

    const organiser = await call(ctx, 'GET', `/v1/tasting-sessions/${sessionId}`);
    expect(organiser.status).toBe(200);
    expect(organiser.body.votes).toEqual([]);
    expect(organiser.body.aggregate).toBeNull();
    const progress = organiser.body.progress as { taster_name: string }[];
    expect(progress.map((row) => row.taster_name).sort()).toEqual(['Bodega', 'Organizador']);
    expect(hidden(organiser.body)).toBe(true);

    const cellar = await call(ctx, 'GET', `/v1/tasting-sessions/${sessionId}`, undefined, 'bodega@winecore.test');
    expect(cellar.body.progress).toBeNull();
    const own = cellar.body.votes as { comment: string; score: number; taster_name: string }[];
    expect(own).toEqual([expect.objectContaining({ comment: 'secreto-bodega', score: 22, taster_name: 'Bodega' })]);
    expect(hidden(cellar.body)).toBe(true);
    expect(JSON.stringify(cellar.body)).not.toContain('secreto-organizador');

    const reader = await call(ctx, 'GET', `/v1/tasting-sessions/${sessionId}`, undefined, 'asesor@winecore.test');
    expect(reader.body.votes).toEqual([]);
    expect(reader.body.progress).toBeNull();
    expect(hidden(reader.body)).toBe(true);

    const listed = await call(ctx, 'GET', '/v1/tasting-sessions', undefined, 'asesor@winecore.test');
    const row = (listed.body.items as { id: string }[]).find((item) => item.id === sessionId);
    expect(row).toBeDefined();
    expect(hidden(row)).toBe(true);

    const selection = await call(ctx, 'GET', `/v1/tasting-sessions/${sessionId}/selection`, undefined, 'asesor@winecore.test');
    expect(selection.status).toBe(409);
    expect(selection.body.code).toBe('WC_TASTING_HIDDEN');

    const mcpHidden = await listSessionSamples(ctx.writer, { session_id: sessionId });
    expect(mcpHidden.samples).toEqual([{ sample_no: 1 }]);
    expect(JSON.stringify(mcpHidden)).not.toContain('secreto-bodega');
    expect(JSON.stringify(mcpHidden)).not.toContain(world.lotA2026);

    const auditHidden = await call(ctx, 'GET', '/v1/audit?table=tasting.blind_vote&limit=100', undefined, 'asesor@winecore.test');
    expect(auditHidden.status).toBe(200);
    expect(JSON.stringify(auditHidden.body)).not.toContain('secreto-organizador');
    expect(JSON.stringify(auditHidden.body)).not.toContain('secreto-bodega');
    const sampleAudit = await call(ctx, 'GET', '/v1/audit?table=tasting.blind_sample&limit=100', undefined, 'asesor@winecore.test');
    expect(JSON.stringify(sampleAudit.body)).not.toContain(world.lotA2026);

    const revealed = await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/reveal`);
    expect(revealed.status).toBe(200);
    const open = await call(ctx, 'GET', `/v1/tasting-sessions/${sessionId}`, undefined, 'asesor@winecore.test');
    expect(JSON.stringify(open.body)).toContain('secreto-organizador');
    expect(JSON.stringify(open.body)).toContain('secreto-bodega');
    expect(JSON.stringify(open.body)).toContain('REFA2026');
    expect(JSON.stringify(open.body)).toContain(world.lotA2026);
    const mcpOpen = await listSessionSamples(ctx.writer, { session_id: sessionId });
    expect(mcpOpen.samples[0]).toMatchObject({ sample_no: 1, lot_id: world.lotA2026, lot_code: 'REFA2026' });
    const auditOpen = await call(ctx, 'GET', '/v1/audit?table=tasting.blind_vote&limit=100', undefined, 'asesor@winecore.test');
    expect(JSON.stringify(auditOpen.body)).toContain('secreto-bodega');
  });

  it('acepta el código de parcela, devuelve códigos de lote y vino, y borra borradores', async () => {
    const byCode = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'UVA',
      tasted_at: '2026-09-12T08:00:00Z',
      taster_name: 'Catador Uno',
      parcel_id: 'p-sint',
      values: grapeValues,
    });
    expect(byCode.status, JSON.stringify(byCode.body)).toBe(201);
    expect(byCode.body.parcel_id).toBe(world.parcelId);
    expect(byCode.body.lot_code).toBeNull();
    expect(byCode.body.wine_code).toBeNull();

    const missingParcel = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'UVA',
      tasted_at: '2026-09-12T08:30:00Z',
      taster_name: 'Catador Uno',
      parcel_code: 'NO-HAY',
      values: grapeValues,
    });
    expect(missingParcel.status).toBe(422);

    const must = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'MOSTO',
      tasted_at: '2026-09-12T09:00:00Z',
      taster_name: 'Catador Uno',
      lot_id: world.lotA2026,
      decision: 'seguir',
      values: {},
    });
    expect(must.status, JSON.stringify(must.body)).toBe(201);
    expect(must.body.lot_code).toBe('REFA2026');
    expect(must.body.wine_code).toBe('REFA');

    const draft = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'MOSTO',
      tasted_at: '2026-09-12T10:00:00Z',
      taster_name: 'Catador Uno',
      lot_id: world.lotMust,
      values: {},
    });
    expect(draft.status).toBe(201);
    const removed = await call(ctx, 'DELETE', `/v1/tasting-notes/${String(draft.body.id)}`);
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(true);
    const gone = await call(ctx, 'GET', `/v1/tasting-notes/${String(draft.body.id)}`);
    expect(gone.status).toBe(404);
    const kept = await call(ctx, 'DELETE', `/v1/tasting-notes/${String(must.body.id)}`);
    expect(kept.status).toBe(409);
    expect(String((kept.body.fields as Record<string, string>).id)).toContain('borrador');

    const session = await call(ctx, 'POST', '/v1/tasting-sessions', {
      title: 'Sin empezar',
      target: 'Referencia B',
      started_on: '2026-10-20',
      days: 2,
    });
    const sessionId = String(session.body.id);
    await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/samples`, { lot_id: world.lotB2026 });
    const deleted = await call(ctx, 'DELETE', `/v1/tasting-sessions/${sessionId}`);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect((await call(ctx, 'GET', `/v1/tasting-sessions/${sessionId}`)).status).toBe(404);
    const audit = await ctx.writer.read<{ n: string }>(sql`
      SELECT count(*)::VARCHAR AS n FROM audit.audit_log
      WHERE table_name = 'tasting.blind_session' AND action = 'DELETE' AND row_id = ${sessionId}
    `);
    expect(Number(audit[0]?.n)).toBe(1);

    const started = await call(ctx, 'POST', '/v1/tasting-sessions', {
      title: 'Empezada',
      target: 'Referencia B',
      started_on: '2026-10-21',
      days: 2,
    });
    const startedId = String(started.body.id);
    await call(ctx, 'POST', `/v1/tasting-sessions/${startedId}/samples`, { lot_id: world.lotB2026 });
    await call(ctx, 'POST', `/v1/tasting-sessions/${startedId}/votes`, {
      sample_no: 1,
      day_no: 1,
      taster_name: 'Catador Uno',
      vote: 'yes',
    });
    const blocked = await call(ctx, 'DELETE', `/v1/tasting-sessions/${startedId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('WC_TASTING_CLOSED');
  });
});

function hidden(body: unknown): boolean {
  const text = JSON.stringify(body);
  return !text.includes('secreto-organizador')
    && !text.includes('REFA2026')
    && !text.includes(world.lotA2026);
}
