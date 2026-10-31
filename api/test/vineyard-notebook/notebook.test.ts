import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import {
  CONVENTIONAL_PARCEL,
  CONVENTIONAL_VARIETY,
  ORGANIC_PARCEL,
  ORGANIC_VARIETY,
  countTreatments,
  insertParcel,
  productBody,
  requestGet,
  requestJson,
  treatmentBody,
} from './support';

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('cuaderno de tratamientos', () => {
  it('bloquea un producto no ecológico en una parcela ecológica', async () => {
    const ctx = await createTestApp();
    try {
      await insertParcel(ctx, { id: ORGANIC_PARCEL, varietyId: ORGANIC_VARIETY, code: 'PSINT1', organic: true, parcelNo: 34 });
      const product = await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(false)));
      expect(product.status).toBe(201);
      const productId = String((await json(product)).id);
      const response = await ctx.app.handle(requestJson('/v1/treatments', treatmentBody(ORGANIC_PARCEL, productId)));
      expect(response.status).toBe(422);
      expect((await json(response)).code).toBe('WC_VIN_ORGANIC');
      expect(await countTreatments(ctx)).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  it('admite el mismo producto en una parcela convencional', async () => {
    const ctx = await createTestApp();
    try {
      await insertParcel(ctx, {
        id: CONVENTIONAL_PARCEL,
        varietyId: CONVENTIONAL_VARIETY,
        code: 'PSINT2',
        organic: false,
        parcelNo: 35,
      });
      const product = await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(false)));
      const productId = String((await json(product)).id);
      const response = await ctx.app.handle(requestJson('/v1/treatments', treatmentBody(CONVENTIONAL_PARCEL, productId)));
      expect(response.status).toBe(201);
      const body = await json(response);
      const treatments = body.treatments as { is_organic_approved: boolean }[];
      expect(treatments[0]?.is_organic_approved).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  it('bloquea la dosis por encima del máximo y la superficie por encima de la parcela', async () => {
    const ctx = await createTestApp();
    try {
      await insertParcel(ctx, { id: ORGANIC_PARCEL, varietyId: ORGANIC_VARIETY, code: 'PSINT1', organic: true, parcelNo: 34 });
      const product = await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(true)));
      const productId = String((await json(product)).id);
      const dose = await ctx.app.handle(requestJson('/v1/treatments', treatmentBody(ORGANIC_PARCEL, productId, { dose: '4.001' })));
      expect(dose.status).toBe(422);
      expect((await json(dose)).code).toBe('WC_VIN_DOSE');
      const area = await ctx.app.handle(requestJson('/v1/treatments', treatmentBody(ORGANIC_PARCEL, productId, { treated_area_ha: '1.2501' })));
      expect(area.status).toBe(422);
      expect((await json(area)).code).toBe('WC_VIN_AREA');
      const exact = await ctx.app.handle(requestJson('/v1/treatments', treatmentBody(ORGANIC_PARCEL, productId, { dose: '4.000' })));
      expect(exact.status).toBe(201);
      expect(await countTreatments(ctx)).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('avisa si la vendimia registrada o prevista cae en el plazo de seguridad', async () => {
    const ctx = await createTestApp({ now: () => new Date('2027-09-15T12:00:00.000Z') });
    try {
      await insertParcel(ctx, { id: ORGANIC_PARCEL, varietyId: ORGANIC_VARIETY, code: 'PSINT1', organic: true, parcelNo: 34 });
      await ctx.client.query(sql`
        INSERT INTO vineyard.harvest (id, parcel_id, vintage, harvested_on, variety, estimated_kg, notes)
        VALUES (
          '019a1100-0000-7000-8000-0000000000c1', CAST(${ORGANIC_PARCEL} AS UUID), 2027,
          DATE '2027-09-10', 'Bobal', 820.5, 'Vendimia sintetica'
        )
      `);
      await ctx.client.query(sql`
        INSERT INTO vineyard.maturity_check (id, parcel_id, checked_at, author, estimated_days_to_harvest)
        VALUES (
          '019a1100-0000-7000-8000-0000000000c2', CAST(${ORGANIC_PARCEL} AS UUID),
          TIMESTAMPTZ '2027-09-01 12:00:00+00', 'Ana Sintetica', 5
        )
      `);
      const product = await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(true)));
      const productId = String((await json(product)).id);
      const response = await ctx.app.handle(requestJson('/v1/treatments', treatmentBody(ORGANIC_PARCEL, productId)));
      expect(response.status).toBe(201);
      const treatment = (await json(response)).treatments as { warnings: { code: string }[] }[];
      const codes = treatment[0]?.warnings.map((warning) => warning.code).sort();
      expect(codes).toEqual(['PLANNED_HARVEST', 'SAFETY_INTERVAL']);
    } finally {
      await ctx.close();
    }
  });

  it('no avisa si la vendimia es posterior al plazo', async () => {
    const ctx = await createTestApp();
    try {
      await insertParcel(ctx, { id: ORGANIC_PARCEL, varietyId: ORGANIC_VARIETY, code: 'PSINT1', organic: true, parcelNo: 34 });
      await ctx.client.query(sql`
        INSERT INTO vineyard.harvest (id, parcel_id, vintage, harvested_on, variety)
        VALUES (
          '019a1100-0000-7000-8000-0000000000c3', CAST(${ORGANIC_PARCEL} AS UUID), 2027, DATE '2027-10-15', 'Bobal'
        )
      `);
      const product = await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(true)));
      const productId = String((await json(product)).id);
      const response = await ctx.app.handle(requestJson('/v1/treatments', treatmentBody(ORGANIC_PARCEL, productId)));
      expect(response.status).toBe(201);
      const treatment = (await json(response)).treatments as { warnings: unknown[] }[];
      expect(treatment[0]?.warnings).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  it('exige equipo ROMA en fitosanitarios de 2027 y no antes', async () => {
    const ctx = await createTestApp();
    try {
      await insertParcel(ctx, { id: ORGANIC_PARCEL, varietyId: ORGANIC_VARIETY, code: 'PSINT1', organic: true, parcelNo: 34 });
      const product = await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(true)));
      const productId = String((await json(product)).id);
      const missing = await ctx.app.handle(requestJson('/v1/treatments', treatmentBody(ORGANIC_PARCEL, productId, { equipment_roma: undefined })));
      expect(missing.status).toBe(422);
      const early = await ctx.app.handle(requestJson('/v1/treatments', treatmentBody(ORGANIC_PARCEL, productId, {
        applied_on: '2026-05-01',
        equipment_roma: undefined,
      })));
      expect(early.status).toBe(201);
      const saved = (await json(early)).treatments as { cue: { required: boolean } }[];
      expect(saved[0]?.cue.required).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  it('separa permisos de lectura y de escritura', async () => {
    const ctx = await createTestApp();
    try {
      const advisor = await ctx.app.handle(requestJson('/v1/treatments', { parcel_ids: [ORGANIC_PARCEL] }, 'asesor@winecore.test'));
      expect(advisor.status).toBe(403);
      const admin = await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(true), 'admin@winecore.test'));
      expect(admin.status).toBe(403);
      const read = await ctx.app.handle(requestGet('/v1/treatments/export?campaign=2027', 'asesor@winecore.test'));
      expect(read.status).toBe(200);
      expect(read.headers.get('content-type')).toContain('text/csv');
    } finally {
      await ctx.close();
    }
  });

  it('avisa del CUE a los 20 días y no repite el aviso', async () => {
    const ctx = await createTestApp({ now: () => new Date('2027-09-21T12:00:00.000Z') });
    try {
      await insertParcel(ctx, { id: ORGANIC_PARCEL, varietyId: ORGANIC_VARIETY, code: 'PSINT1', organic: true, parcelNo: 34 });
      const product = await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(true)));
      const productId = String((await json(product)).id);
      const created = await ctx.app.handle(requestJson('/v1/treatments', treatmentBody(ORGANIC_PARCEL, productId)));
      expect(created.status).toBe(201);
      const treatment = (await json(created)).treatments as { id: string; cue: { status: string } }[];
      expect(treatment[0]?.cue.status).toBe('warn');
      const scan = await ctx.app.handle(requestJson('/v1/vineyard-notebook/cue-reminders', {}));
      expect(scan.status).toBe(200);
      expect(await json(scan)).toMatchObject({ pending: 1 });
      const again = await ctx.app.handle(requestJson('/v1/vineyard-notebook/cue-reminders', {}));
      expect(again.status).toBe(200);
      const notes = await ctx.app.handle(requestGet('/v1/notifications'));
      const items = (await json(notes)).items as { kind: string }[];
      expect(items.filter((item) => item.kind === 'vineyard.cue.pending')).toHaveLength(1);
    } finally {
      await ctx.close();
    }
  });

  it('registra la fertilización y una labor que el cuaderno pide', async () => {
    const ctx = await createTestApp();
    try {
      await insertParcel(ctx, { id: ORGANIC_PARCEL, varietyId: ORGANIC_VARIETY, code: 'PSINT1', organic: true, parcelNo: 34 });
      const blocked = await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(false, 'fertiliser')));
      const blockedId = String((await json(blocked)).id);
      const denied = await ctx.app.handle(requestJson('/v1/treatments', {
        kind: 'fertiliser',
        parcel_ids: [ORGANIC_PARCEL],
        applied_on: '2027-03-02',
        product_id: blockedId,
        dose: '1500.000',
        dose_unit: 'kg/ha',
        operator_name: 'Ana Sintética',
        method: 'Reparto en superficie',
        application_timing: 'fondo',
        crop: 'Vid',
        variety: 'Bobal',
      }));
      expect(denied.status).toBe(422);
      expect((await json(denied)).code).toBe('WC_VIN_ORGANIC');
      const product = await ctx.app.handle(requestJson('/v1/vineyard-notebook/products', productBody(true, 'fertiliser')));
      const productId = String((await json(product)).id);
      const created = await ctx.app.handle(requestJson('/v1/treatments', {
        kind: 'fertiliser',
        parcel_ids: [ORGANIC_PARCEL],
        applied_on: '2027-03-02',
        product_id: productId,
        dose: '1500.000',
        dose_unit: 'kg/ha',
        operator_name: 'Ana Sintética',
        method: 'Reparto en superficie',
        application_timing: 'fondo',
        crop: 'Vid',
        variety: 'Bobal',
      }));
      expect(created.status).toBe(201);
      const saved = (await json(created)).treatments as { kind: string; total_quantity: string; cue: { required: boolean }; nutrient_npk: string }[];
      expect(saved[0]).toMatchObject({ kind: 'fertiliser', total_quantity: '1875.0000', nutrient_npk: '2-1-2' });
      expect(saved[0]?.cue.required).toBe(false);
      const operation = await ctx.app.handle(requestJson('/v1/vineyard-notebook/operations', {
        parcel_id: ORGANIC_PARCEL,
        done_on: '2027-04-02',
        kind: 'cleaning',
        operator_name: 'Ana Sintética',
        product_name: 'Agua',
        notes: 'Limpieza de la cuba de tratamiento',
      }));
      expect(operation.status).toBe(201);
    } finally {
      await ctx.close();
    }
  });
});
