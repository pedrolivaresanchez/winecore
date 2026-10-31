import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { ORGANIC_PARCEL, ORGANIC_VARIETY, insertParcel, productBody, requestGet, requestJson } from './support';

const goldenPath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/synthetic/vineyard-notebook/cuaderno-2027.csv');

async function json(response: Response) {
  return response.json() as Promise<{ id: string }>;
}

describe('exportación del cuaderno', () => {
  it('genera el CSV de la campaña y coincide con el fichero golden', async () => {
    const ctx = await createTestApp({ now: () => new Date('2027-09-15T12:00:00.000Z') });
    try {
      await insertParcel(ctx, { id: ORGANIC_PARCEL, varietyId: ORGANIC_VARIETY, code: 'PSINT1', organic: true, parcelNo: 34 });
      await ctx.client.query(sql`
        INSERT INTO vineyard.harvest (id, parcel_id, vintage, harvested_on, variety, estimated_kg, notes)
        VALUES (
          '019a1100-0000-7000-8000-0000000000d1', CAST(${ORGANIC_PARCEL} AS UUID), 2027,
          DATE '2027-09-10', 'Bobal', 820.5, 'Vendimia sintetica'
        )
      `);
      await ctx.client.query(sql`
        INSERT INTO vineyard.field_task (id, parcel_id, done_on, kind, operator_name, hours, notes)
        VALUES (
          '019a1100-0000-7000-8000-0000000000d2', CAST(${ORGANIC_PARCEL} AS UUID),
          DATE '2027-02-01', 'pruning', 'Ana Sintética', 6.5, 'Poda de invierno'
        )
      `);
      const sulphur = await json(await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(true))));
      const compost = await json(await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(true, 'fertiliser'))));
      const phyto = await ctx.app.handle(requestJson('/v1/treatments', {
        parcel_ids: [ORGANIC_PARCEL],
        applied_on: '2027-09-01',
        product_id: sulphur.id,
        dose: '3.000',
        dose_unit: 'kg/ha',
        treated_area_ha: '1.0000',
        target: 'Oidio',
        operator_name: 'Ana Sintética',
        applicator_ropo: 'ROPO-SINT-1001',
        advisor_name: 'Asesor sintético',
        equipment_roma: 'ROMA-SINT-01',
        method: 'Pulverización',
        weather_notes: 'Cielo cubierto, sin viento',
        crop: 'Vid',
        variety: 'Bobal',
      }));
      expect(phyto.status).toBe(201);
      const fert = await ctx.app.handle(requestJson('/v1/treatments', {
        kind: 'fertiliser',
        parcel_ids: [ORGANIC_PARCEL],
        applied_on: '2027-03-02',
        product_id: compost.id,
        dose: '1500.000',
        dose_unit: 'kg/ha',
        treated_area_ha: '1.2500',
        operator_name: 'Ana Sintética',
        method: 'Reparto en superficie',
        application_timing: 'fondo',
        crop: 'Vid',
        variety: 'Bobal',
      }));
      expect(fert.status).toBe(201);
      const cleaning = await ctx.app.handle(requestJson('/v1/vineyard-notebook/operations', {
        parcel_id: ORGANIC_PARCEL,
        done_on: '2027-04-02',
        kind: 'cleaning',
        operator_name: 'Ana Sintética',
        product_name: 'Agua',
        active_substance: 'ninguna',
        quantity: '20.0000',
        quantity_unit: 'l',
        notes: 'Limpieza de la cuba de tratamiento',
      }));
      expect(cleaning.status).toBe(201);
      const pdf = await ctx.app.handle(requestGet('/v1/treatments/export?campaign=2027&format=pdf'));
      expect(pdf.status).toBe(422);
      const response = await ctx.app.handle(requestGet('/v1/treatments/export?campaign=2027'));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
      expect(response.headers.get('content-disposition')).toContain('cuaderno-explotacion-2027.csv');
      const bytes = Buffer.from(await response.arrayBuffer());
      const actual = bytes.toString('utf8');
      expect(bytes[0]).toBe(0xef);
      expect(actual).toContain('fitosanitarios');
      expect(actual).toContain('fertilizacion');
      expect(actual).toContain('SAFETY_INTERVAL');
      expect(actual).toContain('WineCore no lo envía');
      expect(actual.toLowerCase()).not.toContain('http');
      expect(bytes.equals(readFileSync(goldenPath))).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('la campaña AAAA/AAAA+1 va del 1 de agosto al 31 de julio', async () => {
    const ctx = await createTestApp();
    try {
      await insertParcel(ctx, { id: ORGANIC_PARCEL, varietyId: ORGANIC_VARIETY, code: 'PSINT1', organic: true, parcelNo: 34 });
      const product = await json(await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(true))));
      const inside = await ctx.app.handle(requestJson('/v1/treatments', {
        parcel_ids: [ORGANIC_PARCEL],
        applied_on: '2026-09-01',
        product_id: product.id,
        dose: '3.000',
        dose_unit: 'kg/ha',
        target: 'Oidio',
        operator_name: 'Ana Sintética',
        applicator_ropo: 'ROPO-SINT-1001',
        method: 'Pulverización',
        crop: 'Vid',
        variety: 'Bobal',
      }));
      expect(inside.status).toBe(201);
      const outside = await ctx.app.handle(requestJson('/v1/treatments', {
        parcel_ids: [ORGANIC_PARCEL],
        applied_on: '2026-07-01',
        product_id: product.id,
        dose: '3.000',
        dose_unit: 'kg/ha',
        target: 'Oidio',
        operator_name: 'Ana Sintética',
        applicator_ropo: 'ROPO-SINT-1001',
        method: 'Pulverización',
        crop: 'Vid',
        variety: 'Bobal',
      }));
      expect(outside.status).toBe(201);
      const response = await ctx.app.handle(requestGet('/v1/treatments/export?campaign=2026/2027'));
      const csv = await response.text();
      expect(csv).toContain('2026-09-01');
      expect(csv).not.toContain('2026-07-01');
    } finally {
      await ctx.close();
    }
  });
});
