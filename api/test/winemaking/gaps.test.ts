import { describe, expect, it } from 'bun:test';
import { planOperation } from '../../src/core/cellar/engine';
import type { SamplingRequest } from '../../src/core/cellar/types';
import { assertElaborationBalance } from '../../src/core/winemaking/balance';
import { MAX_ATTACHMENT_BYTES } from '../../src/core/attachments/mime';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { asOk, header, holding, idSource, lot, stateOf, vessel } from '../cellar/helpers';
import { call, entityId, seedHolding, seedWarehouse, type TestApp } from '../cellar-api/fixtures';
import { createTestApp } from '../helpers';

const ACTOR = { type: 'system' as const, id: 'gaps-test', requestId: 'req-huecos' };
const wineLot = lot({ id: 'lot-muestra', code: 'MUESTRA26', kind: 'wine' });

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const HEIC = (() => {
  const bytes = new Uint8Array(24);
  new DataView(bytes.buffer).setUint32(0, 24);
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 4);
  return bytes;
})();

async function place(ctx: TestApp, vesselCode = 'INOX-GAP') {
  const entity = await entityId(ctx);
  const warehouse = await seedWarehouse(ctx, entity);
  const location = newId();
  const tank = newId();
  await ctx.writer.withWrite(ACTOR, async (tx) => {
    tx.write(sql`
      INSERT INTO inventory.location (id, code, name, kind, tax_warehouse_id, controlling_entity_id)
      VALUES (
        CAST(${location} AS UUID), ${`BOD-${vesselCode}`}, ${'Bodega sintética'}, ${'cellar'},
        CAST(${warehouse} AS UUID), CAST(${entity} AS UUID)
      )
    `);
    tx.write(sql`
      INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, material, location_id, status)
      VALUES (
        CAST(${tank} AS UUID), ${vesselCode}, ${'Depósito sintético'}, ${'tank_storage'},
        ${2000000}, ${'stainless_steel'}, CAST(${location} AS UUID), ${'in_service'}
      )
    `);
  });
  return { entity, warehouse, location, vessel: tank };
}

async function contact(ctx: TestApp, name: string, supplier: boolean): Promise<string> {
  const id = newId();
  await ctx.writer.withWrite(ACTOR, async (tx) => {
    tx.write(sql`
      INSERT INTO party.contact (id, kind, legal_name, is_supplier, created_by)
      VALUES (CAST(${id} AS UUID), ${'company'}, ${name}, ${supplier}, ${'gaps-test'})
    `);
  });
  return id;
}

async function volumeOf(ctx: TestApp, vesselId: string): Promise<number> {
  const rows = await ctx.writer.read<{ volume_ml: string }>(sql`
    SELECT coalesce(sum(volume_ml), 0)::VARCHAR AS volume_ml
    FROM inventory.stock_move
    WHERE vessel_id = CAST(${vesselId} AS UUID)
  `);
  return Number(rows[0]?.volume_ml ?? 0);
}

function upload(
  ctx: TestApp,
  analysisId: string,
  bytes: Uint8Array,
  name: string,
  user = 'bodega@winecore.test',
) {
  const form = new FormData();
  form.set('file', new File([bytes], name, { type: 'application/octet-stream' }));
  return ctx.app.handle(new Request(`http://localhost/v1/analyses/${analysisId}/report`, {
    method: 'POST',
    headers: { 'x-dev-user': user },
    body: form,
  }));
}

describe('huecos de elaboración', () => {
  it('la toma de muestras no mueve volumen', () => {
    expect(assertElaborationBalance('sampling', [{ role: 'input', volume_ml: 1 }])?.code).toBe('WC020');
    const tank = holding('inox-a', wineLot, 80_000, 'wine');
    const request: SamplingRequest = {
      ...header({ id: 'op-muestra' }),
      op_type: 'sampling',
      vessel_id: 'inox-a',
      lot: wineLot,
      sampled_at: '2026-10-15T09:00:00Z',
      sample_code: 'M-SINT-01',
      destination: 'internal',
      lab_contact_id: null,
    };
    const plan = asOk(planOperation(request, stateOf([tank]), idSource()));
    expect(plan.stockMoves).toEqual([]);
    expect(plan.fiscalMoves).toEqual([]);
    expect(plan.vesselsAfter).toEqual([]);
    const missed = planOperation(request, stateOf([vessel({ id: 'inox-a' })]), idSource());
    expect(missed.ok).toBe(false);
  });

  it('confirma la muestra, no cambia el volumen y el lote la lista', async () => {
    const ctx = await createTestApp();
    try {
      const placed = await place(ctx);
      const lotId = await seedHolding(ctx, {
        entityId: placed.entity,
        warehouseId: placed.warehouse,
        locationId: placed.location,
        vesselId: placed.vessel,
        code: 'L-MUESTRA-26',
        volumeMl: 80_000,
      });
      const lab = await contact(ctx, 'Laboratorio Sintético', true);
      const customer = await contact(ctx, 'Cliente Sintético', false);
      const before = await volumeOf(ctx, placed.vessel);
      const lines = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'sampling',
        legal_entity_id: placed.entity,
        occurred_at: '2026-10-15T09:00:00Z',
        performed_by: 'operario-sintetico',
        vessel_id: placed.vessel,
        lot_id: lotId,
        sampled_at: '2026-10-15T09:00:00Z',
        sample_code: 'm-sint-01',
        destination: 'internal',
        lines: [{ role: 'input', lot_id: lotId, vessel_id: placed.vessel, product_state: 'wine', volume_ml: 100 }],
      }, 'bodega@winecore.test');
      expect(lines.status).toBe(422);
      expect(lines.body.code).toBe('WC020');

      const missing = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'sampling',
        legal_entity_id: placed.entity,
        occurred_at: '2026-10-15T09:00:00Z',
        performed_by: 'operario-sintetico',
        vessel_id: placed.vessel,
        lot_id: lotId,
        sampled_at: '2026-10-15T09:00:00Z',
        sample_code: 'M-SINT-01',
        destination: newId(),
      }, 'bodega@winecore.test');
      expect(missing.status).toBe(422);

      const buyer = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'sampling',
        legal_entity_id: placed.entity,
        occurred_at: '2026-10-15T09:00:00Z',
        performed_by: 'operario-sintetico',
        vessel_id: placed.vessel,
        lot_id: lotId,
        sampled_at: '2026-10-15T09:00:00Z',
        sample_code: 'M-SINT-01',
        destination: customer,
      }, 'bodega@winecore.test');
      expect(buyer.status).toBe(422);
      expect(buyer.body.fields).toMatchObject({ destination: 'El laboratorio tiene que ser un proveedor' });

      const denied = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'sampling',
        legal_entity_id: placed.entity,
        occurred_at: '2026-10-15T09:00:00Z',
        performed_by: 'operario-sintetico',
        vessel_id: placed.vessel,
        lot_id: lotId,
        sampled_at: '2026-10-15T09:00:00Z',
        sample_code: 'M-SINT-01',
        destination: 'internal',
      }, 'asesor@winecore.test');
      expect(denied.status).toBe(403);

      const created = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'sampling',
        legal_entity_id: placed.entity,
        occurred_at: '2026-10-15T09:00:00Z',
        performed_by: 'operario-sintetico',
        vessel_id: placed.vessel,
        lot_id: lotId,
        sampled_at: '2026-10-15T09:30:00Z',
        sample_code: 'm-sint-01',
        destination: 'internal',
      }, 'bodega@winecore.test');
      expect(created.status).toBe(201);
      expect(created.body.op_type).toBe('sampling');
      const sampleId = String(created.body.id);
      const preview = await call(ctx, 'POST', `/v1/cellar-operations/${sampleId}/preview`, undefined, 'bodega@winecore.test');
      expect(preview.status).toBe(200);
      expect(preview.body.stock_moves).toEqual([]);
      expect(preview.body.fiscal_moves).toEqual([]);
      const confirmed = await call(ctx, 'POST', `/v1/cellar-operations/${sampleId}/confirm`, undefined, 'bodega@winecore.test');
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.op_type).toBe('sampling');
      expect(await volumeOf(ctx, placed.vessel)).toBe(before);

      const external = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'sampling',
        legal_entity_id: placed.entity,
        occurred_at: '2026-10-16T09:00:00Z',
        performed_by: 'operario-sintetico',
        vessel_id: placed.vessel,
        lot_id: lotId,
        sampled_at: '2026-10-16T09:00:00Z',
        sample_code: 'M-LAB-02',
        destination: lab,
      }, 'bodega@winecore.test');
      expect(external.status).toBe(201);
      expect((await call(ctx, 'POST', `/v1/cellar-operations/${external.body.id}/confirm`, undefined, 'bodega@winecore.test')).status).toBe(200);

      const samples = await call(ctx, 'GET', '/v1/lots/L-MUESTRA-26/samples', undefined, 'asesor@winecore.test');
      expect(samples.status).toBe(200);
      expect(samples.body.total).toBe(2);
      const items = samples.body.items as Record<string, unknown>[];
      expect(items[0]).toMatchObject({
        sample_code: 'M-LAB-02',
        destination: lab,
        lab_contact_id: lab,
        lot_id: lotId,
        vessel_id: placed.vessel,
        status: 'confirmed',
      });
      expect(items[1]).toMatchObject({ sample_code: 'M-SINT-01', destination: 'internal', lab_contact_id: null });

      const linked = await call(ctx, 'POST', '/v1/lots/L-MUESTRA-26/analyses', {
        at: '2026-10-16T12:00:00Z',
        lab: 'external',
        lab_name: 'Laboratorio Sintético',
        lab_contact_id: lab,
        sample_operation_id: String(external.body.id),
        results: [{ parameter: 'ph', value: 3.4, unit: 'pH' }],
      }, 'bodega@winecore.test');
      expect(linked.status).toBe(201);
      expect(linked.body.sample_operation_id).toBe(external.body.id);
      const other = await call(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'temperature_control',
        legal_entity_id: placed.entity,
        occurred_at: '2026-10-16T11:00:00Z',
        performed_by: 'operario-sintetico',
        reason: 'bajar la consigna',
        vessel_id: placed.vessel,
        lot_id: lotId,
        previous_setpoint_c: '20',
        new_setpoint_c: '18',
      }, 'bodega@winecore.test');
      const rejected = await call(ctx, 'POST', '/v1/lots/L-MUESTRA-26/analyses', {
        at: '2026-10-16T13:00:00Z',
        lab: 'internal',
        sample_operation_id: String(other.body.id),
        results: [{ parameter: 'ph', value: 3.4, unit: 'pH' }],
      }, 'bodega@winecore.test');
      expect(rejected.status).toBe(422);
    } finally {
      await ctx.close();
    }
  });

  it('lista las analíticas de la parcela y guarda el contacto del laboratorio', async () => {
    const ctx = await createTestApp();
    try {
      const parcel = newId();
      const lab = await contact(ctx, 'Laboratorio de Campo', false);
      await ctx.writer.withWrite(ACTOR, async (tx) => {
        tx.write(sql`
          INSERT INTO vineyard.parcel (
            id, code, name, ownership, sigpac_province, sigpac_municipality, sigpac_polygon, sigpac_parcel, area_ha
          ) VALUES (
            CAST(${parcel} AS UUID), ${'P-GAP'}, ${'Parcela sintética'}, ${'own'},
            46, 2, 1, 1, ${1.2}
          )
        `);
      });
      const empty = await call(ctx, 'GET', '/v1/parcels/P-GAP', undefined, 'asesor@winecore.test');
      expect(empty.status).toBe(200);
      expect(empty.body.latest_analysis).toBeNull();
      const missing = await call(ctx, 'POST', '/v1/parcels/P-GAP/analyses', {
        at: '2026-08-01T08:00:00Z',
        lab: 'external',
        lab_contact_id: newId(),
        results: [{ parameter: 'ph', value: 3.3, unit: 'pH' }],
      }, 'bodega@winecore.test');
      expect(missing.status).toBe(422);
      expect(missing.body.fields).toMatchObject({ lab_contact_id: 'El contacto del laboratorio no existe' });
      const older = await call(ctx, 'POST', '/v1/parcels/P-GAP/analyses', {
        at: '2026-08-01T08:00:00Z',
        lab: 'external',
        lab_name: 'Laboratorio de Campo',
        lab_contact_id: lab,
        results: [{ parameter: 'ph', value: 3.2, unit: 'pH' }],
      }, 'bodega@winecore.test');
      expect(older.status).toBe(201);
      expect(older.body.lab_contact_id).toBe(lab);
      expect(older.body.lot_id).toBeNull();
      const newer = await call(ctx, 'POST', '/v1/parcels/P-GAP/analyses', {
        at: '2026-08-20T08:00:00Z',
        lab: 'internal',
        results: [
          { parameter: 'volatile_acidity', value: 0.7, unit: 'g/L' },
          { parameter: 'glucose_fructose', value: 1, unit: 'g/L' },
        ],
      }, 'bodega@winecore.test');
      expect(newer.status).toBe(201);
      expect(newer.body.out_of_spec).toBe(false);
      expect(newer.body.flags).toMatchObject({ volatile_alert: true, dry: true, fml_done: false, fa_fml_overlap: false });

      const list = await call(ctx, 'GET', '/v1/parcels/P-GAP/analyses', undefined, 'asesor@winecore.test');
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(2);
      const items = list.body.items as Record<string, unknown>[];
      expect(items[0]?.id).toBe(newer.body.id);
      expect(items[1]?.id).toBe(older.body.id);
      const firstResults = items[0]?.results as { parameter: string; unit: string; name_es: string }[];
      expect(firstResults.find((row) => row.parameter === 'volatile_acidity')?.unit).toBe('g/L');
      expect(items[1]?.lab_contact_id).toBe(lab);
      const detail = await call(ctx, 'GET', '/v1/parcels/P-GAP', undefined, 'asesor@winecore.test');
      expect((detail.body.latest_analysis as { id: string }).id).toBe(newer.body.id);
      expect((await call(ctx, 'GET', '/v1/parcels/NO-EXISTE/analyses', undefined, 'asesor@winecore.test')).status).toBe(404);
      expect((await call(ctx, 'POST', '/v1/parcels/P-GAP/analyses', {
        at: '2026-08-21T08:00:00Z',
        lab: 'internal',
        results: [{ parameter: 'ph', value: 3.3, unit: 'pH' }],
      }, 'admin@winecore.test')).status).toBe(403);
    } finally {
      await ctx.close();
    }
  });

  it('separa el fuera de rango de las marcas de interpretación', async () => {
    const ctx = await createTestApp();
    try {
      const placed = await place(ctx, 'INOX-FLAG');
      const lotId = await seedHolding(ctx, {
        entityId: placed.entity,
        warehouseId: placed.warehouse,
        locationId: placed.location,
        vesselId: placed.vessel,
        code: 'L-FLAG-26',
        volumeMl: 50_000,
      });
      const wine = newId();
      await ctx.writer.withWrite(ACTOR, async (tx) => {
        tx.write(sql`
          INSERT INTO catalog.wine (id, code, name, color, category)
          VALUES (CAST(${wine} AS UUID), ${'FLAG'}, ${'Tinto sintético'}, ${'red'}, ${'wine'})
        `);
        tx.write(sql`
          UPDATE inventory.lot SET wine_id = CAST(${wine} AS UUID), is_organic = TRUE
          WHERE id = CAST(${lotId} AS UUID)
        `);
        tx.write(sql`
          INSERT INTO enology.parameter (
            entity_key, legal_entity_id, code, value_num, unit, basis, source_ref, valid_from
          ) VALUES (
            ${placed.entity},
            CAST(${placed.entity} AS UUID),
            ${'volatile_acidity_legal_max_g_l'},
            ${0.4},
            ${'g/L'},
            ${'supuesto'},
            ${'Límite sintético para la prueba.'},
            DATE '2026-01-01'
          )
        `);
      });
      const both = await call(ctx, 'POST', '/v1/lots/L-FLAG-26/analyses', {
        at: '2026-10-02T10:00:00Z',
        lab: 'internal',
        results: [
          { parameter: 'total_so2', value: 110, unit: 'mg/L' },
          { parameter: 'glucose_fructose', value: 1.5, unit: 'g/L' },
          { parameter: 'volatile_acidity', value: 0.5, unit: 'g/L' },
          { parameter: 'ph', value: 3.5, unit: 'pH' },
        ],
      }, 'bodega@winecore.test');
      expect(both.status).toBe(201);
      expect(both.body.out_of_spec).toBe(true);
      expect(both.body.flags).toEqual({
        volatile_alert: false,
        dry: true,
        fml_done: false,
        fa_fml_overlap: false,
      });
      const results = both.body.results as { parameter: string; out_of_spec: boolean }[];
      expect(results.find((row) => row.parameter === 'total_so2')?.out_of_spec).toBe(true);
      expect(results.find((row) => row.parameter === 'volatile_acidity')?.out_of_spec).toBe(true);
      expect(results.find((row) => row.parameter === 'glucose_fructose')?.out_of_spec).toBe(false);
      expect(results.find((row) => row.parameter === 'ph')?.out_of_spec).toBe(false);
      const rows = both.body.flag_rows as { category: string; parameter_code: string }[];
      expect(rows.some((row) => row.category === 'enology_parameter' && row.parameter_code === 'volatile_acidity')).toBe(true);
      expect(rows.some((row) => row.category === 'assumption_ok_dry')).toBe(true);

      const alert = await call(ctx, 'POST', '/v1/lots/L-FLAG-26/analyses', {
        at: '2026-10-03T10:00:00Z',
        lab: 'internal',
        results: [{ parameter: 'volatile_acidity', value: 0.7, unit: 'g/L' }],
      }, 'bodega@winecore.test');
      expect(alert.body.out_of_spec).toBe(true);
      expect(alert.body.flags).toMatchObject({ volatile_alert: true });

      const onlyDry = await call(ctx, 'POST', '/v1/lots/L-FLAG-26/analyses', {
        at: '2026-10-04T10:00:00Z',
        lab: 'internal',
        results: [{ parameter: 'glucose_fructose', value: 1, unit: 'g/L' }],
      }, 'bodega@winecore.test');
      expect(onlyDry.body.out_of_spec).toBe(false);
      expect(onlyDry.body.flags).toMatchObject({ dry: true, volatile_alert: false });
      expect(onlyDry.body).toHaveProperty('marks');
      expect(onlyDry.body).toHaveProperty('flag_rows');
    } finally {
      await ctx.close();
    }
  });

  it('guarda el informe de laboratorio y solo lo descarga quien puede leer bodega', async () => {
    const ctx = await createTestApp();
    try {
      const placed = await place(ctx, 'INOX-PDF');
      await seedHolding(ctx, {
        entityId: placed.entity,
        warehouseId: placed.warehouse,
        locationId: placed.location,
        vesselId: placed.vessel,
        code: 'L-PDF-26',
        volumeMl: 40_000,
      });
      const stranger = newId();
      await ctx.writer.withWrite(ACTOR, async (tx) => {
        tx.write(sql`
          INSERT INTO core.app_user (id, email, display_name, locale, status)
          VALUES (CAST(${stranger} AS UUID), ${'sinrol@winecore.test'}, ${'Sin rol'}, ${'es-ES'}, ${'active'})
        `);
      });
      const parcel = newId();
      await ctx.writer.withWrite(ACTOR, async (tx) => {
        tx.write(sql`
          INSERT INTO vineyard.parcel (
            id, code, name, ownership, sigpac_province, sigpac_municipality, sigpac_polygon, sigpac_parcel, area_ha
          ) VALUES (
            CAST(${parcel} AS UUID), ${'P-PDF'}, ${'Parcela del informe'}, ${'own'},
            46, 3, 1, 1, ${0.8}
          )
        `);
      });
      const analysis = await call(ctx, 'POST', '/v1/lots/L-PDF-26/analyses', {
        at: '2026-10-10T10:00:00Z',
        lab: 'external',
        lab_name: 'Laboratorio Sintético',
        results: [{ parameter: 'ph', value: 3.4, unit: 'pH' }],
      }, 'bodega@winecore.test');
      expect(analysis.status).toBe(201);
      const analysisId = String(analysis.body.id);
      const plain = await upload(ctx, analysisId, new TextEncoder().encode('nota de bodega\n'), 'nota.txt');
      expect(plain.status).toBe(422);
      const heic = await upload(ctx, analysisId, HEIC, 'foto.heic');
      expect(heic.status).toBe(422);
      const huge = await upload(ctx, analysisId, new Uint8Array(MAX_ATTACHMENT_BYTES + 1), 'grande.pdf');
      expect(huge.status).toBe(422);
      const forbidden = await upload(ctx, analysisId, PDF, 'informe.pdf', 'admin@winecore.test');
      expect(forbidden.status).toBe(403);

      const pdf = await upload(ctx, analysisId, PDF, 'informe.pdf');
      expect(pdf.status).toBe(201);
      const stored = await pdf.json() as Record<string, unknown>;
      expect(stored.mime_type).toBe('application/pdf');
      expect(stored.report_attachment_id).toBeTruthy();
      const jpeg = await upload(ctx, analysisId, JPEG, 'foto.jpg');
      expect(jpeg.status).toBe(201);
      const replaced = await jpeg.json() as { report_attachment_id: string; mime_type: string };
      expect(replaced.mime_type).toBe('image/jpeg');

      const latest = await call(ctx, 'GET', '/v1/lots/L-PDF-26/analyses/latest', undefined, 'asesor@winecore.test');
      expect(latest.body.report_attachment_id).toBe(replaced.report_attachment_id);
      const file = await ctx.app.handle(new Request(`http://localhost/v1/analyses/${analysisId}/report`, {
        headers: { 'x-dev-user': 'asesor@winecore.test' },
      }));
      expect(file.status).toBe(200);
      expect(file.headers.get('content-type')).toBe('image/jpeg');
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(JPEG);
      const blocked = await ctx.app.handle(new Request(`http://localhost/v1/analyses/${analysisId}/report`, {
        headers: { 'x-dev-user': 'sinrol@winecore.test' },
      }));
      expect(blocked.status).toBe(403);

      const grape = await call(ctx, 'POST', '/v1/parcels/P-PDF/analyses', {
        at: '2026-08-02T08:00:00Z',
        lab: 'internal',
        results: [{ parameter: 'ph', value: 3.1, unit: 'pH' }],
      }, 'bodega@winecore.test');
      const picture = await upload(ctx, String(grape.body.id), PNG, 'maduracion.png');
      expect(picture.status).toBe(201);
      const pictureBody = await picture.json() as { report_attachment_id: string };
      const listed = await call(ctx, 'GET', '/v1/parcels/P-PDF/analyses', undefined, 'bodega@winecore.test');
      const listedItems = listed.body.items as { report_attachment_id: string; results: { parameter: string }[] }[];
      expect(listedItems[0]?.report_attachment_id).toBe(pictureBody.report_attachment_id);
      expect(listedItems[0]?.results.map((row) => row.parameter)).toContain('ph');
      const png = await ctx.app.handle(new Request(`http://localhost/v1/analyses/${grape.body.id}/report`, {
        headers: { 'x-dev-user': 'bodega@winecore.test' },
      }));
      expect(png.status).toBe(200);
      expect(png.headers.get('content-type')).toBe('image/png');
      expect((await call(ctx, 'GET', `/v1/analyses/${newId()}/report`, undefined, 'bodega@winecore.test')).status).toBe(404);
    } finally {
      await ctx.close();
    }
  });
});
