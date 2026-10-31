import { sql } from '../../src/core/db/sql';
import type { createTestApp } from '../helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

export const ORGANIC_PARCEL = '019a1100-0000-7000-8000-0000000000a1';
export const ORGANIC_VARIETY = '019a1100-0000-7000-8000-0000000000a2';
export const CONVENTIONAL_PARCEL = '019a1100-0000-7000-8000-0000000000b1';
export const CONVENTIONAL_VARIETY = '019a1100-0000-7000-8000-0000000000b2';

export function requestJson(path: string, body: unknown, email?: string, method = 'POST'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (email) headers['X-Dev-User'] = email;
  return new Request(`http://localhost${path}`, { method, headers, body: JSON.stringify(body) });
}

export function requestGet(path: string, email?: string): Request {
  const headers: Record<string, string> = {};
  if (email) headers['X-Dev-User'] = email;
  return new Request(`http://localhost${path}`, { headers });
}

export async function insertParcel(
  ctx: Ctx,
  input: { id: string; varietyId: string; code: string; organic: boolean; parcelNo: number },
): Promise<void> {
  await ctx.client.query(sql`
    INSERT INTO vineyard.parcel (
      id, code, name, ownership, sigpac_province, sigpac_municipality, sigpac_aggregate, sigpac_zone,
      sigpac_polygon, sigpac_parcel, sigpac_enclosure, area_ha, is_organic, organic_since
    ) VALUES (
      CAST(${input.id} AS UUID), ${input.code}, 'Pago sintético', 'own', 46, 250, 0, 0,
      12, ${input.parcelNo}, 1, CAST('1.2500' AS DECIMAL(8,4)), ${input.organic},
      CAST(${input.organic ? '2019-01-01' : null} AS DATE)
    )
  `);
  await ctx.client.query(sql`
    INSERT INTO vineyard.parcel_variety (id, parcel_id, variety, color, area_ha)
    VALUES (
      CAST(${input.varietyId} AS UUID), CAST(${input.id} AS UUID), 'Bobal', 'red', CAST('1.2500' AS DECIMAL(8,4))
    )
  `);
}

export function productBody(organic: boolean, kind: 'phytosanitary' | 'fertiliser' = 'phytosanitary') {
  if (kind === 'fertiliser') {
    return {
      commercial_name: organic ? 'Compost sintético' : 'Abono sintético no eco',
      registration_number: organic ? 'ENM-SINT-01' : 'ENM-SINT-99',
      active_substances: 'materia organica',
      is_organic_approved: organic,
      safety_interval_days: 0,
      max_dose: '2000.0000',
      max_dose_unit: 'kg/ha',
      product_kind: 'fertiliser',
      nutrient_npk: '2-1-2',
    };
  }
  return {
    commercial_name: organic ? 'Azufre mojable sintético' : 'Fungicida sintético no eco',
    registration_number: organic ? 'ES-SINT-0001' : 'ES-SINT-9999',
    active_substances: organic ? 'azufre' : 'sustancia-sintetica',
    is_organic_approved: organic,
    safety_interval_days: organic ? 21 : 14,
    max_dose: '4.0000',
    max_dose_unit: 'kg/ha',
    product_kind: 'phytosanitary',
  };
}

export function treatmentBody(parcelId: string, productId: string, extra: Record<string, unknown> = {}) {
  return {
    parcel_ids: [parcelId],
    applied_on: '2027-09-01',
    product_id: productId,
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
    ...extra,
  };
}

export async function countTreatments(ctx: Ctx): Promise<number> {
  const rows = await ctx.writer.read<{ n: number | bigint | string }>('SELECT COUNT(*) AS n FROM vineyard.treatment');
  return Number(rows[0]?.n ?? 0);
}
