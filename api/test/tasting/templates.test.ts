import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { newId } from '../../src/core/ids';
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

describe('plantillas de cata', () => {
  it('sirve las cinco fichas con los campos de la uva en orden', async () => {
    const listed = await call(ctx, 'GET', '/v1/tasting-templates');
    expect(listed.status).toBe(200);
    const items = listed.body.items as { code: string; subject: string; score_scale: string; fields: { field_key: string; min_value: number | null; max_value: number | null }[] }[];
    expect(items.map((item) => item.code).sort()).toEqual(['BOTELLA', 'CRIANZA', 'ENSAMBLAJE', 'MOSTO', 'UVA']);
    const uva = items.find((item) => item.code === 'UVA');
    const bottle = items.find((item) => item.code === 'BOTELLA');
    expect(uva?.subject).toBe('grape');
    expect(uva?.score_scale).toBe('0-10');
    expect(bottle?.score_scale).toBe('0-100');
    expect(uva?.fields.map((field) => field.field_key)).toEqual([
      'seed_colour',
      'seed_crunch',
      'skin_astringency',
      'skin_colour',
      'pulp_sweetness',
      'pulp_acidity',
      'phenolic_maturity',
      'estimated_days_to_harvest',
    ]);
    const maturity = uva?.fields.find((field) => field.field_key === 'phenolic_maturity');
    expect(maturity?.min_value).toBe(1);
    expect(maturity?.max_value).toBe(5);
  });

  it('rechaza una ficha de uva incompleta o con la madurez fuera de 1 a 5', async () => {
    const missing = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'UVA',
      tasted_at: '2026-09-01T08:00:00Z',
      taster_name: 'Catador Uno',
      parcel_id: world.parcelId,
      values: { ...grapeValues, phenolic_maturity: undefined },
    });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('WC_TASTING_TEMPLATE');
    const fields = missing.body.fields as Record<string, string>;
    expect(fields['values.phenolic_maturity']).toBeDefined();

    const high = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'UVA',
      tasted_at: '2026-09-01T08:00:00Z',
      taster_name: 'Catador Uno',
      parcel_id: world.parcelId,
      values: { ...grapeValues, phenolic_maturity: 9 },
    });
    expect(high.status).toBe(422);
    expect(high.body.code).toBe('WC_TASTING_TEMPLATE');
  });

  it('rechaza una puntuación fuera de la escala y acepta la ficha completa', async () => {
    const over = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'UVA',
      tasted_at: '2026-09-01T08:00:00Z',
      taster_name: 'Catador Uno',
      parcel_id: world.parcelId,
      overall_score: 11,
      values: grapeValues,
    });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('WC_TASTING_SCORE');

    const created = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'UVA',
      tasted_at: '2026-09-01T08:00:00Z',
      taster_name: 'Catador Uno',
      parcel_id: world.parcelId,
      visual_score: 7,
      nose_score: 6.5,
      mouth_score: 7,
      overall_score: 7,
      descriptors: ['vegetal'],
      descriptors_text: 'hoja verde',
      defects: [],
      decision: 'Esperar',
      notes: 'Pepita crujiente',
      voice_transcript: 'uva parcela P-SINT madurez 4 faltan 10 días',
      values: grapeValues,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.subject).toBe('grape');
    expect(created.body.parcel_id).toBe(world.parcelId);
    expect(created.body.nose_score).toBe(6.5);
    expect(created.body.voice_transcript).toContain('madurez');
    expect(created.body.values).toMatchObject({ phenolic_maturity: 4, estimated_days_to_harvest: 10 });
  });

  it('exige lote en el mosto y admite la escala 0-100 si la plantilla la usa', async () => {
    const withoutLot = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'MOSTO',
      tasted_at: '2026-09-02T08:00:00Z',
      taster_name: 'Catador Uno',
      values: {},
    });
    expect(withoutLot.status).toBe(422);
    expect(withoutLot.body.code).toBe('WC_TASTING_SUBJECT');

    const wide = await call(ctx, 'POST', '/v1/tasting-templates', {
      code: 'COPIA',
      name: 'Mosto en escala amplia',
      subject: 'must',
      score_scale: '0-100',
      fields: [],
    });
    expect(wide.status, JSON.stringify(wide.body)).toBe(201);
    const note = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'COPIA',
      tasted_at: '2026-09-02T08:00:00Z',
      taster_name: 'Catador Uno',
      lot_id: world.lotMust,
      overall_score: 80,
      values: {},
    });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    expect(note.body.score_scale).toBe('0-100');
    expect(note.body.overall_score).toBe(80);
  });

  it('deja que el propietario añada, reordene y exija un campo', async () => {
    const created = await call(ctx, 'POST', '/v1/tasting-templates', {
      code: 'LIBRE',
      name: 'Ficha libre',
      subject: 'wine_aging',
      score_scale: '0-10',
      fields: [
        { field_key: 'fruta', label: 'Fruta', kind: 'scale', required: false, position: 20, min_value: 1, max_value: 5 },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const templateId = String(created.body.id);
    const added = await call(ctx, 'POST', `/v1/tasting-templates/${templateId}/fields`, {
      field_key: 'impresion',
      label: 'Impresión',
      kind: 'text',
      required: true,
      position: 5,
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const fields = added.body.fields as { id: string; field_key: string; position: number }[];
    expect(fields.map((field) => field.field_key)).toEqual(['impresion', 'fruta']);
    const fruta = fields.find((field) => field.field_key === 'fruta');
    const moved = await call(ctx, 'PATCH', `/v1/tasting-templates/${templateId}/fields/${fruta?.id}`, {
      position: 1,
    });
    expect(moved.status).toBe(200);
    const reordered = moved.body.fields as { field_key: string }[];
    expect(reordered.map((field) => field.field_key)).toEqual(['fruta', 'impresion']);

    const rejected = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'LIBRE',
      tasted_at: '2026-09-03T08:00:00Z',
      taster_name: 'Catador Uno',
      lot_id: world.lotA2026,
      values: { fruta: 3 },
    });
    expect(rejected.status).toBe(422);
    expect(rejected.body.code).toBe('WC_TASTING_TEMPLATE');
  });

  it('usa la lista controlada de descriptores y guarda foto y audio', async () => {
    const unknown = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'MOSTO',
      tasted_at: '2026-09-04T08:00:00Z',
      taster_name: 'Catador Uno',
      lot_id: world.lotMust,
      descriptors: ['no_existe'],
      values: {},
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe('WC_VALIDATION');

    const notDefect = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'MOSTO',
      tasted_at: '2026-09-04T08:00:00Z',
      taster_name: 'Catador Uno',
      lot_id: world.lotMust,
      defects: ['ruby'],
      values: {},
    });
    expect(notDefect.status).toBe(422);

    const added = await call(ctx, 'POST', '/v1/tasting-descriptors', {
      code: 'synth_fruit',
      name_es: 'Fruta sintética',
      family: 'nose',
    });
    expect(added.status).toBe(201);

    const photo = await insertAttachment(ctx, 'cata.jpg', 'image/jpeg');
    const voice = await insertAttachment(ctx, 'nota.webm', 'audio/webm');
    const note = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'MOSTO',
      tasted_at: '2026-09-04T08:00:00Z',
      taster_name: 'Catador Uno',
      lot_id: world.lotMust,
      vessel_id: world.vesselA,
      descriptors: ['synth_fruit'],
      defects: ['volatile'],
      voice_transcript: 'un punto volátil',
      attachment_ids: [photo],
      voice_attachment_id: voice,
      values: { co2: true },
    });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    const attachments = note.body.attachments as { id: string; role: string }[];
    expect(attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: photo, role: 'photo' }),
      expect.objectContaining({ id: voice, role: 'other' }),
    ]));

    const retired = await call(ctx, 'PATCH', '/v1/tasting-descriptors/synth_fruit', { is_active: false });
    expect(retired.status).toBe(200);
    const blocked = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'MOSTO',
      tasted_at: '2026-09-05T08:00:00Z',
      taster_name: 'Catador Uno',
      lot_id: world.lotMust,
      descriptors: ['synth_fruit'],
      values: {},
    });
    expect(blocked.status).toBe(422);
  });

  it('guarda la nota de botella con lugar, copa, contexto y evolución', async () => {
    const note = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'BOTELLA',
      tasted_at: '2026-06-01T20:00:00Z',
      taster_name: 'Catador Dos',
      wine_id: world.wineA,
      vintage: 2024,
      overall_score: 88,
      values: {
        place: 'Feria sintética',
        glass: 'Copa borgoña',
        context: 'Cata de equipo',
        evolution: 'peak',
      },
    });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    expect(note.body.place).toBe('Feria sintética');
    expect(note.body.evolution).toBe('peak');
    expect(note.body.vintage).toBe(2024);
    expect(note.body.score_scale).toBe('0-100');
  });
});

async function insertAttachment(ctx: TestApp, filename: string, mime: string): Promise<string> {
  const id = newId();
  const sha = crypto.getRandomValues(new Uint8Array(32)).reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '');
  await ctx.writer.withWrite({ type: 'system', id: 'tasting-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO core.attachment (id, sha256, storage_backend, storage_key, filename, mime_type, size_bytes, created_by)
      VALUES (CAST(${id} AS UUID), ${sha}, ${'knowledge_base'}, ${sha}, ${filename}, ${mime}, 4, ${'tasting-test'})
    `);
  });
  return id;
}
