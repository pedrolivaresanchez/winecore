import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { castVote, createTastingNoteFromDictation, listSessionSamples } from '../../src/core/tasting/mcp-tools';
import { revealSession } from '../../src/core/tasting/sessions';
import { DomainError } from '../../src/core/errors';
import { createTestApp } from '../helpers';
import { call, seedWorld, type TastingWorld, type TestApp } from './fixture';

let ctx: TestApp;
let world: TastingWorld;
const actor = { type: 'user' as const, id: '', requestId: 'mcp-tasting-1' };

beforeAll(async () => {
  ctx = await createTestApp();
  world = await seedWorld(ctx);
  actor.id = world.ownerId;
});

afterAll(async () => {
  await ctx.close();
});

describe('manejadores MCP de cata', () => {
  it('crea una nota a partir del dictado', async () => {
    const note = await createTastingNoteFromDictation(ctx.writer, actor, {
      dictated_text: 'Cata de mosto del lote MOSTOS1 visual 7 nariz 6,5 boca 7 conjunto 8 un poco reducido decisión seguir',
      tasted_at: '2026-09-10T09:00:00Z',
      taster_name: 'Catador Uno',
    });
    expect(note.template_code).toBe('MOSTO');
    expect(note.subject).toBe('must');
    expect(note.lot_id).toBe(world.lotMust);
    expect(note.visual_score).toBe(7);
    expect(note.nose_score).toBe(6.5);
    expect(note.overall_score).toBe(8);
    expect(note.defects).toEqual(['reduction']);
    expect(note.decision).toBe('seguir');
    expect(note.voice_transcript).toContain('lote MOSTOS1');
  });

  it('lista las muestras sin el lote y deja votar', async () => {
    const created = await call(ctx, 'POST', '/v1/tasting-sessions', {
      title: 'Cata para el asistente',
      target: 'nueva colección',
      started_on: '2026-10-04',
      days: 2,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const sessionId = String(created.body.id);
    await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/samples`, { lot_id: world.lotA2026, vessel_id: world.vesselA });
    await call(ctx, 'POST', `/v1/tasting-sessions/${sessionId}/samples`, { lot_id: world.lotB2026 });

    const hidden = await listSessionSamples(ctx.writer, { session_id: sessionId });
    expect(hidden.revealed).toBe(false);
    expect(hidden.target).toBe('nueva colección');
    expect(hidden.samples).toEqual([{ sample_no: 1 }, { sample_no: 2 }]);
    expect(JSON.stringify(hidden)).not.toContain(world.lotA2026);

    const vote = await castVote(ctx.writer, actor, {
      session_id: sessionId,
      sample_no: 1,
      day_no: 1,
      vote: 'yes',
      score: 8,
      comment: 'Encaja',
      taster_name: 'Catador Uno',
    });
    expect(vote.vote).toBe('yes');
    expect(vote.updated).toBe(false);
    expect(vote.sample_no).toBe(1);

    const bad = castVote(ctx.writer, actor, { session_id: sessionId, sample_no: 1, day_no: 1, vote: 'maybe' });
    await expect(bad).rejects.toBeInstanceOf(DomainError);

    await revealSession(ctx.writer, actor, { session_id: sessionId });
    const open = await listSessionSamples(ctx.writer, { session_id: sessionId });
    expect(open.revealed).toBe(true);
    expect(open.samples[0]).toMatchObject({ sample_no: 1, lot_id: world.lotA2026, lot_code: 'REFA2026', vessel_code: 'INOX-S1' });
    expect(open.samples[1]).toMatchObject({ sample_no: 2, lot_id: world.lotB2026, lot_code: 'REFB2026' });
  });
});
