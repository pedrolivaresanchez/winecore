import type { Actor, Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { businessDate, isMadridCivilDate } from '../time';
import { dayOf, flag, idOf, integer, integerOrNull, text, textOrNull } from './rows';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z0-9-]{2,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RISKS = ['none', 'heat_wave', 'rain', 'storm', 'hail'] as const;
type WeatherRisk = (typeof RISKS)[number];

const DEFAULT_BEFORE = 3;
const DEFAULT_AFTER = 7;
const DEFAULT_PULL: Record<WeatherRisk, number> = {
  none: 0,
  heat_wave: 2,
  rain: 3,
  storm: 4,
  hail: 4,
};

const RISK_ES: Record<WeatherRisk, string> = {
  none: 'sin riesgo meteorológico',
  heat_wave: 'ola de calor',
  rain: 'lluvia',
  storm: 'tormenta',
  hail: 'granizo',
};

export interface Suggestion {
  earliest_on: string;
  latest_on: string;
  suggested_on: string | null;
  pull_days: number;
  rationale: string;
}

export function suggestHarvestDate(input: {
  ready: string;
  weather: WeatherRisk;
  crewNeeded: number;
  crew: ReadonlyMap<string, number>;
  beforeDays?: number;
  afterDays?: number;
  pullDays?: Partial<Record<WeatherRisk, number>>;
}): Suggestion {
  const before = input.beforeDays ?? DEFAULT_BEFORE;
  const after = input.afterDays ?? DEFAULT_AFTER;
  const pull = input.pullDays?.[input.weather] ?? DEFAULT_PULL[input.weather];
  const earliest = addDays(input.ready, -before);
  const latest = addDays(input.ready, after);
  let preferred = addDays(input.ready, -pull);
  if (preferred < earliest) preferred = earliest;
  if (preferred > latest) preferred = latest;
  let suggested: string | null = null;
  let people = 0;
  for (let day = preferred; day <= latest; day = addDays(day, 1)) {
    const available = input.crew.get(day) ?? 0;
    if (available >= input.crewNeeded) {
      suggested = day;
      people = available;
      break;
    }
  }
  return {
    earliest_on: earliest,
    latest_on: latest,
    suggested_on: suggested,
    pull_days: pull,
    rationale: rationale({
      ready: input.ready,
      weather: input.weather,
      pull,
      earliest,
      latest,
      preferred,
      suggested,
      people,
      crewNeeded: input.crewNeeded,
    }),
  };
}

export async function listCrew(writer: Writer, from: string | null, to: string | null) {
  const filters = ['TRUE'];
  if (from) filters.push(sql`day >= CAST(${from} AS DATE)`);
  if (to) filters.push(sql`day <= CAST(${to} AS DATE)`);
  const rows = await writer.read(`
    SELECT day::VARCHAR AS day, people, notes
    FROM vineyard.crew_availability
    WHERE ${filters.join(' AND ')}
    ORDER BY day
  `);
  return {
    items: rows.map((row) => ({
      day: dayOf(row.day),
      people: integer(row.people),
      notes: textOrNull(row.notes),
    })),
    total: rows.length,
  };
}

export async function putCrew(writer: Writer, actor: Actor, day: string, body: Record<string, unknown>) {
  const date = requiredDate(day, 'day');
  const people = countOf(body.people, 'people', 0, 500);
  const notes = optionalText(body.notes, 'notes', 500);
  await writer.withWrite(actor, async (tx) => {
    const existing = await tx.read(sql`SELECT day::VARCHAR AS day FROM vineyard.crew_availability WHERE day = CAST(${date} AS DATE)`);
    if (existing.length === 0) {
      tx.write(sql`
        INSERT INTO vineyard.crew_availability (day, people, notes)
        VALUES (CAST(${date} AS DATE), ${people}, ${notes})
      `);
      tx.audit({ table: 'vineyard.crew_availability', rowId: date, action: 'INSERT', before: null, after: { day: date, people, notes } });
    } else {
      tx.write(sql`
        UPDATE vineyard.crew_availability SET people = ${people}, notes = ${notes}
        WHERE day = CAST(${date} AS DATE)
      `);
      tx.audit({ table: 'vineyard.crew_availability', rowId: date, action: 'UPDATE', before: { day: date }, after: { day: date, people, notes } });
    }
  });
  return { day: date, people, notes };
}

export async function deleteCrew(writer: Writer, actor: Actor, day: string) {
  const date = requiredDate(day, 'day');
  await writer.withWrite(actor, async (tx) => {
    const existing = await tx.read(sql`SELECT people, notes FROM vineyard.crew_availability WHERE day = CAST(${date} AS DATE)`);
    if (existing.length === 0) throw domainError('WC_NOT_FOUND');
    tx.write(sql`DELETE FROM vineyard.crew_availability WHERE day = CAST(${date} AS DATE)`);
    tx.audit({ table: 'vineyard.crew_availability', rowId: date, action: 'DELETE', before: existing[0], after: null });
  });
  return { day: date, deleted: true };
}

export async function listPlans(writer: Writer, campaign: number | null) {
  const filter = campaign === null ? sql`WHERE TRUE` : sql`WHERE h.vintage = ${campaign}`;
  const rows = await planRows(writer, filter);
  return { items: rows, total: rows.length };
}

export async function getPlan(writer: Writer, id: string) {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const rows = await planRows(writer, sql`WHERE h.id = CAST(${id} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

export async function createPlan(writer: Writer, actor: Actor, body: Record<string, unknown>) {
  const parcelCode = upper(body.parcel_code, 'parcel_code');
  const vintage = yearOf(body.vintage, 'vintage');
  const weather = body.weather_risk === undefined ? 'none' : oneOf(body.weather_risk, 'weather_risk', RISKS);
  const weatherNote = optionalText(body.weather_note, 'weather_note', 500);
  const crewNeeded = countOf(body.crew_needed, 'crew_needed', 1, 500);
  const explicitReady = body.ripeness_ready_on === undefined || body.ripeness_ready_on === null || body.ripeness_ready_on === ''
    ? null
    : requiredDate(String(body.ripeness_ready_on), 'ripeness_ready_on');
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const parcel = await parcelByCode(tx, parcelCode);
    const ready = explicitReady ?? await readyFromMaturity(tx, parcel.id);
    if (ready === null) {
      throw domainError('WC_VALIDATION', { ripeness_ready_on: 'No hay un control de maduración con días estimados; indica la fecha' });
    }
    const duplicate = await tx.read(sql`
      SELECT id FROM vineyard.harvest_plan
      WHERE parcel_id = CAST(${parcel.id} AS UUID) AND vintage = ${vintage}
    `);
    if (duplicate.length > 0) throw domainError('WC_VALIDATION', { parcel_code: 'Ya hay un plan para esta parcela y añada' });
    tx.write(sql`
      INSERT INTO vineyard.harvest_plan (
        id, parcel_id, vintage, ripeness_ready_on, weather_risk, weather_note, crew_needed, status
      ) VALUES (
        CAST(${id} AS UUID), CAST(${parcel.id} AS UUID), ${vintage}, CAST(${ready} AS DATE),
        ${weather}, ${weatherNote}, ${crewNeeded}, 'draft'
      )
    `);
    tx.audit({
      table: 'vineyard.harvest_plan',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { id, parcel_code: parcelCode, vintage, ripeness_ready_on: ready },
    });
  });
  return getPlan(writer, id);
}

export async function updatePlan(writer: Writer, actor: Actor, id: string, body: Record<string, unknown>) {
  const current = await getPlan(writer, id);
  if (current.status === 'confirmed' || current.status === 'done') {
    throw domainError('WC_VALIDATION', { status: 'Un plan confirmado no se edita' });
  }
  const weather = body.weather_risk === undefined ? current.weather_risk : oneOf(body.weather_risk, 'weather_risk', RISKS);
  const weatherNote = body.weather_note === undefined ? current.weather_note : optionalText(body.weather_note, 'weather_note', 500);
  const crewNeeded = body.crew_needed === undefined ? current.crew_needed : countOf(body.crew_needed, 'crew_needed', 1, 500);
  const ready = body.ripeness_ready_on === undefined
    ? current.ripeness_ready_on
    : requiredDate(String(body.ripeness_ready_on), 'ripeness_ready_on');
  const status = body.status === undefined ? current.status : oneOf(body.status, 'status', ['draft', 'cancelled'] as const);
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      UPDATE vineyard.harvest_plan SET
        ripeness_ready_on = CAST(${ready} AS DATE),
        weather_risk = ${weather},
        weather_note = ${weatherNote},
        crew_needed = ${crewNeeded},
        earliest_on = NULL,
        latest_on = NULL,
        suggested_on = NULL,
        rationale = NULL,
        status = ${status}
      WHERE id = CAST(${id} AS UUID)
    `);
    tx.audit({
      table: 'vineyard.harvest_plan',
      rowId: id,
      action: 'UPDATE',
      before: current,
      after: { ...current, weather_risk: weather, crew_needed: crewNeeded, status, suggested_on: null },
    });
  });
  return getPlan(writer, id);
}

export async function suggestPlan(writer: Writer, actor: Actor, id: string) {
  const current = await getPlan(writer, id);
  if (current.status !== 'draft') throw domainError('WC_VALIDATION', { status: 'Solo se sugiere sobre un borrador' });
  if (!current.ripeness_ready_on || current.crew_needed == null) {
    throw domainError('WC_VALIDATION', { ripeness_ready_on: 'Faltan la fecha de madurez o el personal necesario' });
  }
  const crewRows = await writer.read<Record<string, unknown>>(`
    SELECT day::VARCHAR AS day, people FROM vineyard.crew_availability
  `);
  const crew = new Map<string, number>();
  for (const row of crewRows) {
    const day = dayOf(row.day);
    if (day) crew.set(day, integer(row.people));
  }
  const suggestion = suggestHarvestDate({
    ready: current.ripeness_ready_on,
    weather: (current.weather_risk ?? 'none') as WeatherRisk,
    crewNeeded: current.crew_needed,
    crew,
  });
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      UPDATE vineyard.harvest_plan SET
        earliest_on = CAST(${suggestion.earliest_on} AS DATE),
        latest_on = CAST(${suggestion.latest_on} AS DATE),
        suggested_on = CAST(${suggestion.suggested_on} AS DATE),
        rationale = ${suggestion.rationale}
      WHERE id = CAST(${id} AS UUID) AND status = 'draft'
    `);
    tx.audit({
      table: 'vineyard.harvest_plan',
      rowId: id,
      action: 'UPDATE',
      before: { suggested_on: current.suggested_on },
      after: suggestion,
    });
  });
  return getPlan(writer, id);
}

export async function confirmPlan(writer: Writer, actor: Actor, id: string) {
  const current = await getPlan(writer, id);
  if (current.status !== 'draft') throw domainError('WC_VALIDATION', { status: 'Solo se confirma un borrador' });
  if (!current.suggested_on) {
    throw domainError('WC_VALIDATION', { suggested_on: 'Primero hay que calcular la fecha sugerida' });
  }
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      UPDATE vineyard.harvest_plan SET status = 'confirmed'
      WHERE id = CAST(${id} AS UUID) AND status = 'draft'
    `);
    tx.audit({
      table: 'vineyard.harvest_plan',
      rowId: id,
      action: 'UPDATE',
      before: { status: 'draft' },
      after: { status: 'confirmed', suggested_on: current.suggested_on },
    });
  });
  return getPlan(writer, id);
}

async function readyFromMaturity(tx: Tx, parcelId: string): Promise<string | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT checked_at, estimated_days_to_harvest
    FROM vineyard.maturity_check
    WHERE parcel_id = CAST(${parcelId} AS UUID) AND estimated_days_to_harvest IS NOT NULL
    ORDER BY checked_at DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  const checked = businessDate(asInstant(row.checked_at));
  const days = integerOrNull(row.estimated_days_to_harvest);
  if (days === null) return null;
  return addDays(checked, days);
}

async function planRows(writer: Writer, filter: string) {
  const rows = await writer.read(`
    SELECT h.id::VARCHAR AS id, p.code AS parcel_code, h.vintage, h.ripeness_ready_on::VARCHAR AS ripeness_ready_on,
           h.weather_risk, h.weather_note, h.crew_needed, h.earliest_on::VARCHAR AS earliest_on,
           h.latest_on::VARCHAR AS latest_on, h.suggested_on::VARCHAR AS suggested_on, h.rationale, h.status
    FROM vineyard.harvest_plan h
    JOIN vineyard.parcel p ON p.id = h.parcel_id
    ${filter}
    ORDER BY h.vintage, p.code
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    parcel_code: text(row.parcel_code),
    vintage: integer(row.vintage),
    ripeness_ready_on: dayOf(row.ripeness_ready_on),
    weather_risk: textOrNull(row.weather_risk),
    weather_note: textOrNull(row.weather_note),
    crew_needed: integerOrNull(row.crew_needed),
    earliest_on: dayOf(row.earliest_on),
    latest_on: dayOf(row.latest_on),
    suggested_on: dayOf(row.suggested_on),
    rationale: textOrNull(row.rationale),
    status: text(row.status),
  }));
}

async function parcelByCode(tx: Tx, code: string): Promise<{ id: string }> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, is_active FROM vineyard.parcel WHERE code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  if (!flag(row.is_active)) {
    throw domainError('WC_VALIDATION', { parcel_code: 'La parcela no está activa' });
  }
  return { id: idOf(row.id) };
}

function asInstant(value: unknown): Date {
  if (value instanceof Date) return value;
  let text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T12:00:00Z`);
  if (text.includes(' ') && !text.includes('T')) text = text.replace(' ', 'T');
  if (/[+-]\d{2}$/.test(text)) text = `${text}:00`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw domainError('WC_VALIDATION', { checked_at: 'La fecha del control de maduración no es válida' });
  }
  return date;
}

function rationale(input: {
  ready: string;
  weather: WeatherRisk;
  pull: number;
  earliest: string;
  latest: string;
  preferred: string;
  suggested: string | null;
  people: number;
  crewNeeded: number;
}): string {
  const ready = spanishDate(input.ready);
  const window = `La ventana va del ${spanishDate(input.earliest)} al ${spanishDate(input.latest)}.`;
  const weather = input.pull === 0
    ? 'No hay riesgo meteorológico que adelante la vendimia.'
    : `Hay riesgo de ${RISK_ES[input.weather]}, así que la búsqueda se adelanta ${input.pull} días, al ${spanishDate(input.preferred)}.`;
  if (input.suggested === null) {
    return `La madurez prevista es el ${ready}. ${window} ${weather} No hay ningún día de esa búsqueda con al menos ${input.crewNeeded} personas.`;
  }
  return `La madurez prevista es el ${ready}. ${window} ${weather} El primer día con al menos ${input.crewNeeded} personas es el ${spanishDate(input.suggested)} (${input.people} disponibles).`;
}

function spanishDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
}

export function addDays(iso: string, days: number): string {
  const match = DATE.exec(iso);
  if (!match) throw domainError('WC_VALIDATION', { date: 'Fecha no válida' });
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function requiredDate(value: string, field: string): string {
  if (!DATE.test(value) || !isMadridCivilDate(value)) throw domainError('WC_VALIDATION', { [field]: 'Fecha YYYY-MM-DD' });
  return value;
}

function yearOf(value: unknown, field: string): number {
  const year = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) {
    throw domainError('WC_VALIDATION', { [field]: 'La añada está entre 1990 y 2100' });
  }
  return year;
}

function countOf(value: unknown, field: string, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw domainError('WC_VALIDATION', { [field]: `Entero entre ${min} y ${max}` });
  }
  return parsed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Debe ser un texto' });
  const trimmed = value.trim();
  if (trimmed.length > max) throw domainError('WC_VALIDATION', { [field]: `Máximo ${max} caracteres` });
  return trimmed.length === 0 ? null : trimmed;
}

function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw domainError('WC_VALIDATION', { [field]: `Valores: ${allowed.join(', ')}` });
  }
  return value as T;
}

function upper(value: unknown, field: string): string {
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Es obligatorio' });
  const code = value.trim().toUpperCase();
  if (!CODE.test(code)) throw domainError('WC_VALIDATION', { [field]: 'Código no válido' });
  return code;
}
