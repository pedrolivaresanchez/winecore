import type { Tx, Writer } from '../db/writer';
import type { Actor } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { isMadridCivilDate } from '../time';
import { addAreas, areaExceeds, formatArea, parseArea } from './quantity';
import { dayOf, flag, idOf, instantOf, integerOrNull, objectOf, text, textOrNull } from './rows';
import { formatSigpac, parseSigpac, type SigpacRef } from './sigpac';
import { latestParcelAnalysis } from '../winemaking/service';
import { activeVariety } from './varieties';

const CODE = /^[A-Z0-9-]{2,20}$/;
const OWNERSHIP = ['own', 'leased', 'supplier'] as const;
const ORGANIC = ['organic', 'in_conversion', 'conventional'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ParcelVariety {
  id: string;
  variety: string;
  color: string;
  area_ha: string;
  planting_year: number | null;
  rootstock: string | null;
}

export interface ParcelDetail extends Parcel {
  latest_analysis: Record<string, unknown> | null;
}

export interface Parcel {
  id: string;
  code: string;
  name: string;
  ownership: string;
  supplier_contact_id: string | null;
  sigpac: string;
  area_ha: string;
  vineyard_register_ref: string | null;
  organic_status: string;
  is_organic: boolean;
  organic_since: string | null;
  conversion_started_on: string | null;
  appellation: string | null;
  altitude_m: number | null;
  soil: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  varieties: ParcelVariety[];
}

interface ParcelState {
  code: string;
  name: string;
  ownership: (typeof OWNERSHIP)[number];
  supplier_contact_id: string | null;
  sigpac: SigpacRef;
  area_ha: string;
  vineyard_register_ref: string | null;
  organic_status: (typeof ORGANIC)[number];
  organic_since: string | null;
  conversion_started_on: string | null;
  appellation: string | null;
  altitude_m: number | null;
  soil: string | null;
  notes: string | null;
  is_active: boolean;
  varieties: VarietyInput[];
}

interface VarietyInput {
  variety: string;
  color: string;
  area_ha: string;
  planting_year: number | null;
  rootstock: string | null;
}

export interface ParcelOption {
  id: string;
  code: string;
  name: string;
  area: string;
  area_ha: string;
  organic_status: string;
}

/** Selector ligero para catas, diseño de lote y el cuaderno. Solo parcelas activas. */
export async function listParcelOptions(writer: Writer): Promise<{ items: ParcelOption[] }> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, code, name, area_ha::VARCHAR AS area_ha, organic_status, is_organic
    FROM vineyard.parcel
    WHERE is_active
    ORDER BY code
  `);
  return {
    items: rows.map((row) => {
      const area = formatArea(text(row.area_ha));
      const organic = textOrNull(row.organic_status) ?? (flag(row.is_organic) ? 'organic' : 'conventional');
      return {
        id: idOf(row.id),
        code: text(row.code),
        name: text(row.name),
        area,
        area_ha: area,
        organic_status: organic,
      };
    }),
  };
}

export async function parcelSummary(writer: Writer) {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT COALESCE(sum(area_ha), 0)::VARCHAR AS area_ha, count(*)::VARCHAR AS parcels
    FROM vineyard.parcel
  `);
  const settings = await writer.read<Record<string, unknown>>(sql`
    SELECT value FROM core.setting WHERE key = 'vineyard.simplified_notebook_max_ha'
  `);
  const value = objectOf(settings[0]?.value) ?? {};
  const maxHa = typeof value.max_ha === 'number' ? value.max_ha : Number(value.max_ha ?? 2);
  const total = formatArea(text(rows[0]?.area_ha ?? '0'));
  return {
    total_area_ha: total,
    parcel_count: integerOrNull(rows[0]?.parcels) ?? 0,
    simplified_notebook_max_ha: Number.isFinite(maxHa) ? maxHa : 2,
    simplified_notebook_confirmed: value.confirmed === true,
    question: typeof value.question === 'string' ? value.question : 'Q-038',
    within_threshold: Number(total) <= (Number.isFinite(maxHa) ? maxHa : 2),
  };
}

export async function listParcels(writer: Writer): Promise<{ items: Parcel[]; total: number }> {
  const rows = await writer.read(`
    SELECT id::VARCHAR AS id, code, name, ownership, supplier_contact_id::VARCHAR AS supplier_contact_id,
           sigpac_province, sigpac_municipality, sigpac_aggregate, sigpac_zone, sigpac_polygon,
           sigpac_parcel, sigpac_enclosure, area_ha::VARCHAR AS area_ha, vineyard_register_ref,
           is_organic, organic_since::VARCHAR AS organic_since, organic_status,
           conversion_started_on::VARCHAR AS conversion_started_on, appellation, altitude_m, soil, notes,
           is_active, created_at
    FROM vineyard.parcel
    ORDER BY code
  `);
  const varieties = await loadVarieties(writer, rows.map((row) => idOf(row.id)));
  const items = rows.map((row) => toParcel(row, varieties.get(idOf(row.id)) ?? []));
  return { items, total: items.length };
}

export async function getParcel(writer: Writer, code: string): Promise<ParcelDetail> {
  const parcel = await requireParcel(writer, code);
  return { ...parcel, latest_analysis: await latestParcelAnalysis(writer, parcel.id) };
}

export async function createParcel(writer: Writer, actor: Actor, body: Record<string, unknown>): Promise<Parcel> {
  const state = parseParcel(body, null);
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    await assertUnique(tx, state, null);
    await assertSupplier(tx, state.supplier_contact_id);
    await assertVarieties(tx, state);
    insertParcel(tx, id, state, actor.id);
    insertVarieties(tx, id, state.varieties);
  });
  return requireParcel(writer, state.code);
}

export async function updateParcel(
  writer: Writer,
  actor: Actor,
  code: string,
  body: Record<string, unknown>,
): Promise<Parcel> {
  const current = await requireParcel(writer, code);
  const state = parseParcel({ ...parcelToBody(current), ...body, code: current.code }, current);
  if (body.sigpac === undefined) state.sigpac = parseRequiredSigpac(current.sigpac);
  // DuckDB rewrites an UPDATE touching the SIGPAC unique columns as delete+insert, which the
  // foreign keys from parcel_variety (every parcel has one) reject.
  if (formatSigpac(state.sigpac) !== current.sigpac) {
    throw domainError('WC_VALIDATION', {
      sigpac: 'La referencia SIGPAC no se puede cambiar en una parcela ya creada: da de alta la parcela nueva y desactiva esta',
    });
  }
  await writer.withWrite(actor, async (tx) => {
    await assertUnique(tx, state, current.id);
    await assertSupplier(tx, state.supplier_contact_id);
    await assertVarieties(tx, state);
    tx.write(sql`
      UPDATE vineyard.parcel SET
        name = ${state.name},
        ownership = ${state.ownership},
        supplier_contact_id = CAST(${state.supplier_contact_id} AS UUID),
        area_ha = CAST(${state.area_ha} AS DECIMAL(8,4)),
        vineyard_register_ref = ${state.vineyard_register_ref},
        is_organic = ${state.organic_status === 'organic'},
        organic_since = CAST(${state.organic_since} AS DATE),
        organic_status = ${state.organic_status},
        conversion_started_on = CAST(${state.conversion_started_on} AS DATE),
        appellation = ${state.appellation},
        altitude_m = ${state.altitude_m},
        soil = ${state.soil},
        notes = ${state.notes},
        is_active = ${state.is_active}
      WHERE id = CAST(${current.id} AS UUID)
    `);
    tx.audit({
      table: 'vineyard.parcel',
      rowId: current.id,
      action: 'UPDATE',
      before: current,
      after: { ...current, code: state.code },
    });
    if (Array.isArray(body.varieties)) {
      tx.write(sql`DELETE FROM vineyard.parcel_variety WHERE parcel_id = CAST(${current.id} AS UUID)`);
      tx.audit({
        table: 'vineyard.parcel_variety',
        rowId: current.id,
        action: 'DELETE',
        before: { varieties: current.varieties },
        after: null,
      });
      insertVarieties(tx, current.id, state.varieties);
    }
  });
  return requireParcel(writer, current.code);
}

export async function requireParcel(writer: Writer, code: string): Promise<Parcel> {
  const normalized = code.trim().toUpperCase();
  if (!CODE.test(normalized)) throw domainError('WC_NOT_FOUND');
  const rows = await writer.read(sql`
    SELECT id::VARCHAR AS id, code, name, ownership, supplier_contact_id::VARCHAR AS supplier_contact_id,
           sigpac_province, sigpac_municipality, sigpac_aggregate, sigpac_zone, sigpac_polygon,
           sigpac_parcel, sigpac_enclosure, area_ha::VARCHAR AS area_ha, vineyard_register_ref,
           is_organic, organic_since::VARCHAR AS organic_since, organic_status,
           conversion_started_on::VARCHAR AS conversion_started_on, appellation, altitude_m, soil, notes,
           is_active, created_at
    FROM vineyard.parcel
    WHERE code = ${normalized}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const varieties = await loadVarieties(writer, [idOf(row.id)]);
  return toParcel(row, varieties.get(idOf(row.id)) ?? []);
}

async function loadVarieties(reader: { read<T>(statement: string): Promise<T[]> }, ids: string[]): Promise<Map<string, ParcelVariety[]>> {
  const map = new Map<string, ParcelVariety[]>();
  if (ids.length === 0) return map;
  const list = ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ');
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, parcel_id::VARCHAR AS parcel_id, variety, color,
           area_ha::VARCHAR AS area_ha, planting_year, rootstock
    FROM vineyard.parcel_variety
    WHERE parcel_id IN (${list})
    ORDER BY variety
  `);
  for (const row of rows) {
    const parcelId = idOf(row.parcel_id);
    const items = map.get(parcelId) ?? [];
    items.push({
      id: idOf(row.id),
      variety: text(row.variety),
      color: text(row.color),
      area_ha: formatArea(text(row.area_ha)),
      planting_year: integerOrNull(row.planting_year),
      rootstock: textOrNull(row.rootstock),
    });
    map.set(parcelId, items);
  }
  return map;
}

function insertParcel(tx: Tx, id: string, state: ParcelState, _actorId: string): void {
  tx.write(sql`
    INSERT INTO vineyard.parcel (
      id, code, name, ownership, supplier_contact_id,
      sigpac_province, sigpac_municipality, sigpac_aggregate, sigpac_zone,
      sigpac_polygon, sigpac_parcel, sigpac_enclosure,
      area_ha, vineyard_register_ref, is_organic, organic_since, organic_status,
      conversion_started_on, appellation, altitude_m, soil, notes, is_active
    ) VALUES (
      CAST(${id} AS UUID), ${state.code}, ${state.name}, ${state.ownership},
      CAST(${state.supplier_contact_id} AS UUID),
      ${state.sigpac.province}, ${state.sigpac.municipality}, ${state.sigpac.aggregate}, ${state.sigpac.zone},
      ${state.sigpac.polygon}, ${state.sigpac.parcel}, ${state.sigpac.enclosure},
      CAST(${state.area_ha} AS DECIMAL(8,4)), ${state.vineyard_register_ref},
      ${state.organic_status === 'organic'}, CAST(${state.organic_since} AS DATE), ${state.organic_status},
      CAST(${state.conversion_started_on} AS DATE), ${state.appellation}, ${state.altitude_m},
      ${state.soil}, ${state.notes}, ${state.is_active}
    )
  `);
  tx.audit({
    table: 'vineyard.parcel',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { id, code: state.code, name: state.name, sigpac: formatSigpac(state.sigpac) },
  });
}

function insertVarieties(tx: Tx, parcelId: string, varieties: VarietyInput[]): void {
  for (const variety of varieties) {
    const id = newId();
    tx.write(sql`
      INSERT INTO vineyard.parcel_variety (id, parcel_id, variety, color, area_ha, planting_year, rootstock)
      VALUES (
        CAST(${id} AS UUID), CAST(${parcelId} AS UUID), ${variety.variety}, ${variety.color},
        CAST(${variety.area_ha} AS DECIMAL(8,4)), ${variety.planting_year}, ${variety.rootstock}
      )
    `);
    tx.audit({
      table: 'vineyard.parcel_variety',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { id, parcel_id: parcelId, ...variety },
    });
  }
}

async function assertUnique(tx: Tx, state: ParcelState, ignoreId: string | null): Promise<void> {
  const codeRows = await tx.read(sql`
    SELECT id::VARCHAR AS id FROM vineyard.parcel
    WHERE code = ${state.code}
      AND (${ignoreId}::VARCHAR IS NULL OR id <> CAST(${ignoreId} AS UUID))
  `);
  if (codeRows.length > 0) throw domainError('WC_VALIDATION', { code: 'Ya existe una parcela con este código' });
  const sigpac = state.sigpac;
  const sigpacRows = await tx.read(sql`
    SELECT id::VARCHAR AS id FROM vineyard.parcel
    WHERE sigpac_province = ${sigpac.province}
      AND sigpac_municipality = ${sigpac.municipality}
      AND sigpac_aggregate = ${sigpac.aggregate}
      AND sigpac_zone = ${sigpac.zone}
      AND sigpac_polygon = ${sigpac.polygon}
      AND sigpac_parcel = ${sigpac.parcel}
      AND sigpac_enclosure = ${sigpac.enclosure}
      AND (${ignoreId}::VARCHAR IS NULL OR id <> CAST(${ignoreId} AS UUID))
  `);
  if (sigpacRows.length > 0) {
    throw domainError('WC_VALIDATION', { sigpac: 'Ya existe una parcela con esta referencia SIGPAC' });
  }
}

async function assertSupplier(tx: Tx, contactId: string | null): Promise<void> {
  if (contactId === null) return;
  const rows = await tx.read(sql`SELECT id FROM party.contact WHERE id = CAST(${contactId} AS UUID) AND archived_at IS NULL`);
  if (rows.length === 0) throw domainError('WC_VALIDATION', { supplier_contact_id: 'El viticultor no existe' });
}

async function assertVarieties(tx: Tx, state: ParcelState): Promise<void> {
  const seen = new Set<string>();
  for (const variety of state.varieties) {
    if (seen.has(variety.variety)) {
      throw domainError('WC_VALIDATION', { varieties: 'La variedad está repetida en la parcela' });
    }
    seen.add(variety.variety);
    const catalogue = await activeVariety(tx, variety.variety);
    if (variety.color !== '' && variety.color !== catalogue.color) {
      throw domainError('WC_VALIDATION', { varieties: `El color de ${variety.variety} no coincide con el catálogo` });
    }
    variety.color = catalogue.color;
  }
  if (areaExceeds(addAreas(state.varieties.map((variety) => variety.area_ha)), state.area_ha)) {
    throw domainError('WC_VALIDATION', { varieties: 'La suma de superficies por variedad supera la de la parcela' });
  }
}

function parseParcel(body: Record<string, unknown>, current: Parcel | null): ParcelState {
  const code = current?.code ?? upper(body.code, 'code', CODE, 'Usa mayúsculas, dígitos o guion (2-20)');
  const name = requiredText(body.name, 'name', 120);
  const ownership = oneOf(body.ownership, 'ownership', OWNERSHIP);
  const supplier = optionalUuid(body.supplier_contact_id, 'supplier_contact_id');
  if (ownership === 'supplier' && supplier === null) {
    throw domainError('WC_VALIDATION', { supplier_contact_id: 'La parcela de proveedor necesita un contacto' });
  }
  if (ownership !== 'supplier' && supplier !== null) {
    throw domainError('WC_VALIDATION', { supplier_contact_id: 'Solo la parcela de proveedor lleva contacto' });
  }
  const sigpac = typeof body.sigpac === 'string' ? parseRequiredSigpac(body.sigpac) : (current ? parseRequiredSigpac(current.sigpac) : parseRequiredSigpac(''));
  const area = parseArea(body.area_ha, 'area_ha');
  const organic = oneOf(body.organic_status ?? current?.organic_status ?? 'organic', 'organic_status', ORGANIC);
  const organicSince = optionalDate(body.organic_since, 'organic_since');
  const conversionStarted = optionalDate(body.conversion_started_on, 'conversion_started_on');
  checkOrganic(organic, organicSince, conversionStarted);
  const varieties = parseVarieties(body.varieties, current);
  return {
    code,
    name,
    ownership,
    supplier_contact_id: supplier,
    sigpac,
    area_ha: area,
    vineyard_register_ref: optionalText(body.vineyard_register_ref, 'vineyard_register_ref', 40),
    organic_status: organic,
    organic_since: organicSince,
    conversion_started_on: conversionStarted,
    appellation: optionalText(body.appellation, 'appellation', 80),
    altitude_m: optionalAltitude(body.altitude_m),
    soil: optionalText(body.soil, 'soil', 120),
    notes: optionalText(body.notes, 'notes', 2000),
    is_active: body.is_active === undefined ? (current?.is_active ?? true) : body.is_active === true,
    varieties,
  };
}

function parseVarieties(value: unknown, current: Parcel | null): VarietyInput[] {
  if (value === undefined) {
    if (current === null) throw domainError('WC_VALIDATION', { varieties: 'Indica al menos una variedad' });
    return current.varieties.map((variety) => ({
      variety: variety.variety,
      color: variety.color,
      area_ha: variety.area_ha,
      planting_year: variety.planting_year,
      rootstock: variety.rootstock,
    }));
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw domainError('WC_VALIDATION', { varieties: 'Indica al menos una variedad' });
  }
  return value.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw domainError('WC_VALIDATION', { [`varieties[${index}]`]: 'La variedad no es válida' });
    }
    const row = item as Record<string, unknown>;
    const variety = upper(row.variety ?? row.code, `varieties[${index}].variety`, CODE, 'Código de variedad no válido');
    const area = parseArea(row.area_ha, `varieties[${index}].area_ha`);
    const year = optionalYear(row.planting_year, `varieties[${index}].planting_year`);
    const sentColor = row.color;
    let color = '';
    if (sentColor !== undefined && sentColor !== null && sentColor !== '') {
      if (sentColor !== 'red' && sentColor !== 'white') {
        throw domainError('WC_VALIDATION', { [`varieties[${index}].color`]: 'El color es red o white' });
      }
      color = sentColor;
    }
    return {
      variety,
      color,
      area_ha: area,
      planting_year: year,
      rootstock: optionalText(row.rootstock, `varieties[${index}].rootstock`, 40),
    };
  });
}

function checkOrganic(status: string, organicSince: string | null, conversionStarted: string | null): void {
  if (status === 'organic') {
    if (organicSince === null) {
      throw domainError('WC_VALIDATION', { organic_since: 'La parcela ecológica necesita la fecha desde la que lo es' });
    }
    if (conversionStarted !== null && conversionStarted > organicSince) {
      throw domainError('WC_VALIDATION', { conversion_started_on: 'La conversión empieza antes de pasar a ecológico' });
    }
    return;
  }
  if (status === 'in_conversion') {
    if (conversionStarted === null) {
      throw domainError('WC_VALIDATION', { conversion_started_on: 'La conversión necesita fecha de inicio' });
    }
    if (organicSince !== null) {
      throw domainError('WC_VALIDATION', { organic_since: 'En conversión todavía no hay fecha de ecológico' });
    }
    return;
  }
  if (organicSince !== null || conversionStarted !== null) {
    throw domainError('WC_VALIDATION', { organic_status: 'La parcela convencional no lleva fechas de ecológico' });
  }
}

function parseRequiredSigpac(value: string): SigpacRef {
  const parsed = parseSigpac(value);
  if (typeof parsed === 'string') throw domainError('WC_VALIDATION', { sigpac: parsed });
  return parsed;
}

function parcelToBody(parcel: Parcel): Record<string, unknown> {
  return {
    code: parcel.code,
    name: parcel.name,
    ownership: parcel.ownership,
    supplier_contact_id: parcel.supplier_contact_id,
    sigpac: parcel.sigpac,
    area_ha: parcel.area_ha,
    vineyard_register_ref: parcel.vineyard_register_ref,
    organic_status: parcel.organic_status,
    organic_since: parcel.organic_since,
    conversion_started_on: parcel.conversion_started_on,
    appellation: parcel.appellation,
    altitude_m: parcel.altitude_m,
    soil: parcel.soil,
    notes: parcel.notes,
    is_active: parcel.is_active,
  };
}

function toParcel(row: Record<string, unknown>, varieties: ParcelVariety[]): Parcel {
  const sigpac: SigpacRef = {
    province: integerOrNull(row.sigpac_province) ?? 0,
    municipality: integerOrNull(row.sigpac_municipality) ?? 0,
    aggregate: integerOrNull(row.sigpac_aggregate) ?? 0,
    zone: integerOrNull(row.sigpac_zone) ?? 0,
    polygon: integerOrNull(row.sigpac_polygon) ?? 0,
    parcel: integerOrNull(row.sigpac_parcel) ?? 0,
    enclosure: integerOrNull(row.sigpac_enclosure) ?? 0,
  };
  const organicSince = dayOf(row.organic_since);
  return {
    id: idOf(row.id),
    code: text(row.code),
    name: text(row.name),
    ownership: text(row.ownership),
    supplier_contact_id: textOrNull(row.supplier_contact_id)?.toLowerCase() ?? null,
    sigpac: formatSigpac(sigpac),
    area_ha: formatArea(text(row.area_ha)),
    vineyard_register_ref: textOrNull(row.vineyard_register_ref),
    organic_status: textOrNull(row.organic_status) ?? (flag(row.is_organic) ? 'organic' : 'conventional'),
    is_organic: flag(row.is_organic),
    organic_since: organicSince,
    conversion_started_on: dayOf(row.conversion_started_on),
    appellation: textOrNull(row.appellation),
    altitude_m: integerOrNull(row.altitude_m),
    soil: textOrNull(row.soil),
    notes: textOrNull(row.notes),
    is_active: flag(row.is_active),
    created_at: instantOf(row.created_at),
    varieties,
  };
}

function upper(value: unknown, field: string, pattern: RegExp, message: string): string {
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Es obligatorio' });
  const code = value.trim().toUpperCase();
  if (!pattern.test(code)) throw domainError('WC_VALIDATION', { [field]: message });
  return code;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Es obligatorio' });
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw domainError('WC_VALIDATION', { [field]: `Texto de 1 a ${max} caracteres` });
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, max);
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw domainError('WC_VALIDATION', { [field]: `Valores: ${allowed.join(', ')}` });
  }
  return value as T;
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Debe ser un UUID' });
  }
  return value.toLowerCase();
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE.test(value) || !isMadridCivilDate(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Fecha YYYY-MM-DD' });
  }
  return value;
}

function optionalYear(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const year = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw domainError('WC_VALIDATION', { [field]: 'El año de plantación está entre 1900 y 2100' });
  }
  return year;
}

function optionalAltitude(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const altitude = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(altitude) || altitude < 0 || altitude > 4000) {
    throw domainError('WC_VALIDATION', { altitude_m: 'La altitud está entre 0 y 4000 m' });
  }
  return altitude;
}
