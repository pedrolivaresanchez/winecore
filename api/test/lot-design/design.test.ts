import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { getLotDesign } from '../../src/core/lot-design/mcp-tools';
import { call, edge, lot, openLab, operation, write, type Lab } from './fixture';

const BODEGA = 'bodega@winecore.test';
const ASESOR = 'asesor@winecore.test';

function body(lab: Lab, extra: Record<string, unknown> = {}) {
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

describe('diseño de lote', () => {
  let lab: Lab;
  const single = newId();
  const blend = newId();

  beforeAll(async () => {
    lab = await openLab();
    const grapeA = newId();
    const grapeB = newId();
    const receptionA = newId();
    const receptionB = newId();
    const edgeA = newId();
    const edgeB = newId();
    await write(lab.ctx, (tx) => {
      operation(tx, {
        id: receptionA, entityId: lab.po, ownerId: lab.ownerId, number: 'R-A',
        opType: 'reception', occurredAt: '2025-09-10T08:00:00.000Z',
      });
      operation(tx, {
        id: receptionB, entityId: lab.po, ownerId: lab.ownerId, number: 'R-B',
        opType: 'reception', occurredAt: '2025-09-12T08:00:00.000Z',
      });
      lot(tx, {
        id: grapeA, entityId: lab.po, code: 'UVA-A', kind: 'grape', vintage: 2025,
        origin: 'reception', createdBy: receptionA,
      });
      lot(tx, {
        id: grapeB, entityId: lab.po, code: 'UVA-B', kind: 'grape', vintage: 2025,
        origin: 'reception', createdBy: receptionB,
      });
      lot(tx, {
        id: single, entityId: lab.po, code: 'LOTE-A', kind: 'wine', vintage: 2025,
        wineId: lab.wineA, origin: 'operation',
      });
      lot(tx, {
        id: blend, entityId: lab.po, code: 'LOTE-AB', kind: 'wine', vintage: 2025,
        wineId: lab.wineA, origin: 'operation',
      });
      edge(tx, { child: single, parent: grapeA, operationId: edgeA, volumeMl: 1000 });
      edge(tx, { child: blend, parent: grapeA, operationId: edgeB, volumeMl: 600 });
      edge(tx, { child: blend, parent: grapeB, operationId: edgeB, massG: 0, volumeMl: 400 });
      tx.write(sql`
        INSERT INTO vineyard.harvest (id, parcel_id, vintage, harvested_on, variety, estimated_kg, reception_operation_id, notes)
        VALUES
          (CAST(${newId()} AS UUID), CAST(${lab.parcelA} AS UUID), 2025, DATE '2025-09-10', 'Variedad A', 1000, CAST(${receptionA} AS UUID), 'sana'),
          (CAST(${newId()} AS UUID), CAST(${lab.parcelB} AS UUID), 2025, DATE '2025-09-12', 'Variedad B', 800, CAST(${receptionB} AS UUID), 'sana')
      `);
    });
  });

  afterAll(async () => {
    await lab.ctx.close();
  });

  test('acepta parcela única cuando la genealogía llega a una sola parcela', async () => {
    const response = await call(lab.ctx, 'PUT', '/v1/lots/LOTE-A/design', body(lab, {
      single_plot: true,
      parcel_id: lab.parcelA,
      label_number: 1,
    }), BODEGA);
    expect(response.status).toBe(200);
    const design = response.body.design as { single_plot: boolean; parcel_id: string; label_number: number };
    expect(design.single_plot).toBe(true);
    expect(design.parcel_id).toBe(lab.parcelA);
    expect(design.label_number).toBe(1);
    expect(response.body.single_plot_allowed).toBe(true);
    expect(response.body.origin_parcels).toHaveLength(1);
    const sheet = await call(lab.ctx, 'GET', '/v1/lots/LOTE-A', undefined, ASESOR);
    expect(sheet.status).toBe(200);
    const audit = await lab.ctx.writer.read<{ n: unknown }>(sql`
      SELECT count(*)::VARCHAR AS n FROM audit.audit_log WHERE table_name = 'cellar.lot_design'
    `);
    expect(Number(audit[0]?.n ?? 0)).toBeGreaterThan(0);
    const chain = await lab.ctx.writer.verifyAuditChain();
    expect(chain.intact).toBe(true);
    const mcp = await getLotDesign(lab.ctx.writer, { code: 'LOTE-A' });
    expect(mcp.design?.single_plot).toBe(true);
  });

  test('rechaza otra parcela y un ensamblaje de dos parcelas', async () => {
    const wrong = await call(lab.ctx, 'PUT', '/v1/lots/LOTE-A/design', body(lab, {
      single_plot: true,
      parcel_id: lab.parcelB,
      label_number: 1,
    }), BODEGA);
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('WC_LOT_SINGLE_PLOT');
    expect(wrong.body.alias).toBe('WC141');
    expect(String((wrong.body.fields as Record<string, string>).parcel_id).length).toBeGreaterThan(0);
    const mixed = await call(lab.ctx, 'PUT', '/v1/lots/LOTE-AB/design', body(lab, {
      single_plot: true,
      parcel_id: lab.parcelA,
      label_number: 1,
    }), BODEGA);
    expect(mixed.status).toBe(422);
    expect(mixed.body.code).toBe('WC_LOT_SINGLE_PLOT');
    const origins = (mixed.body.details as { origin_parcels: { code: string }[] }).origin_parcels;
    expect(origins.map((parcel) => parcel.code).sort()).toEqual(['PARC-A', 'PARC-B']);
  });

  test('reserva el número de etiqueta 1 a la parcela única y cierra sin intervención', async () => {
    const label = await call(lab.ctx, 'PUT', '/v1/lots/LOTE-AB/design', body(lab, { label_number: 1 }), BODEGA);
    expect(label.status).toBe(422);
    expect(label.body.code).toBe('WC_VALIDATION');
    const blocked = await call(lab.ctx, 'PUT', '/v1/lots/LOTE-AB/design', body(lab, {
      no_intervention: true,
      practices_applied: ['sin_intervencion', 'filtracion'],
      practices_not_applied: ['desfangado'],
    }), BODEGA);
    expect(blocked.status).toBe(422);
    const clean = await call(lab.ctx, 'PUT', '/v1/lots/LOTE-AB/design', body(lab, {
      no_intervention: true,
      practices_applied: ['sin_intervencion', 'sin_sulfitos_anadidos'],
      practices_not_applied: ['desfangado', 'filtracion', 'clarificacion', 'centrifugado', 'estabilizacion_proteica'],
      destination_kind: 'new_collection',
      wine_id: null,
      collection_name: 'Colección norte',
      aging_method: 'sin_crianza',
      aging_duration_days: null,
    }), BODEGA);
    expect(clean.status).toBe(200);
    expect((clean.body.design as { collection_name: string }).collection_name).toBe('Colección norte');
    const pending = await call(lab.ctx, 'PUT', '/v1/lots/LOTE-AB/design', body(lab, {
      destination_kind: 'pending',
      wine_id: null,
    }), BODEGA);
    expect(pending.status).toBe(200);
    expect((pending.body.design as { destination_kind: string }).destination_kind).toBe('pending');
    const yeast = await call(lab.ctx, 'PUT', '/v1/lots/LOTE-AB/design', body(lab, {
      inoculation_kind: 'comercial',
      yeast_product_id: lab.yeastId,
      yeast_lot_code: 'LEV-001',
    }), BODEGA);
    expect(yeast.status).toBe(200);
    expect((yeast.body.design as { yeast_lot_code: string }).yeast_lot_code).toBe('LEV-001');
  });

  test('el asesor lee y bodega edita', async () => {
    const denied = await call(lab.ctx, 'PUT', '/v1/lots/LOTE-A/design', body(lab, {
      single_plot: true,
      parcel_id: lab.parcelA,
      label_number: 1,
    }), ASESOR);
    expect(denied.status).toBe(403);
    const read = await call(lab.ctx, 'GET', '/v1/lots/LOTE-A/design', undefined, ASESOR);
    expect(read.status).toBe(200);
    expect(read.body.lot_code).toBe('LOTE-A');
  });
});
