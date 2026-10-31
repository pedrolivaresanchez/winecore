import type { Actor, Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { businessDate, isMadridCivilDate } from '../time';
import { isInstant } from '../inventory/periods';
import { formatArea, formatKg, parseKg, parseMeasure, yieldKgPerHa } from './quantity';
import { dayOf, flag, idOf, instantOf, integer, integerOrNull, objectOf, text, textOrNull } from './rows';
import type { StoredTicket } from './ticket';

const CODE = /^[A-Z0-9-]{2,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TASKS = ['pruning', 'tillage', 'mowing', 'green_pruning', 'harvest', 'planting', 'other'] as const;
const SOURCES = ['manual', 'voice', 'chat'] as const;
const SANITARY = ['good', 'fair', 'poor'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParcelRef {
  id: string;
  code: string;
  is_active: boolean;
}

export async function createFieldTask(writer: Writer, actor: Actor, body: Record<string, unknown>) {
  const parcelCode = upper(body.parcel_code, 'parcel_code');
  const doneOn = requiredDate(body.done_on, 'done_on');
  if (doneOn > businessDate(new Date())) throw domainError('WC_VALIDATION', { done_on: 'La fecha no puede ser futura' });
  const kind = oneOf(body.kind, 'kind', TASKS);
  const source = body.source === undefined ? 'manual' : oneOf(body.source, 'source', SOURCES);
  const operator = optionalText(body.operator_name, 'operator_name', 120);
  const hours = body.hours === undefined || body.hours === null || body.hours === '' ? null : parseMeasure(body.hours, 'hours', 9999.99);
  const notes = optionalText(body.notes, 'notes', 2000);
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const parcel = await parcelByCode(tx, parcelCode);
    if (!parcel.is_active) throw domainError('WC_VALIDATION', { parcel_code: 'La parcela no está activa' });
    tx.write(sql`
      INSERT INTO vineyard.field_task (id, parcel_id, done_on, kind, operator_name, hours, notes, source)
      VALUES (
        CAST(${id} AS UUID), CAST(${parcel.id} AS UUID), CAST(${doneOn} AS DATE), ${kind},
        ${operator}, CAST(${hours} AS DECIMAL(6,2)), ${notes}, ${source}
      )
    `);
    tx.audit({
      table: 'vineyard.field_task',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { id, parcel_code: parcel.code, done_on: doneOn, kind },
    });
  });
  return readTask(writer, id);
}

export async function listFieldTasks(writer: Writer, parcelCode: string | null) {
  const filter = parcelCode ? sql`WHERE p.code = ${parcelCode.trim().toUpperCase()}` : sql`WHERE TRUE`;
  const rows = await writer.read(`
    SELECT t.id::VARCHAR AS id, p.code AS parcel_code, t.done_on::VARCHAR AS done_on, t.kind,
           t.operator_name, t.hours::VARCHAR AS hours, t.notes, t.source, t.created_at
    FROM vineyard.field_task t
    JOIN vineyard.parcel p ON p.id = t.parcel_id
    ${filter}
    ORDER BY t.done_on DESC, t.id
  `);
  return {
    items: rows.map((row) => ({
      id: idOf(row.id),
      parcel_code: text(row.parcel_code),
      done_on: dayOf(row.done_on),
      kind: text(row.kind),
      operator_name: textOrNull(row.operator_name),
      hours: textOrNull(row.hours),
      notes: textOrNull(row.notes),
      source: text(row.source),
      created_at: instantOf(row.created_at),
    })),
    total: rows.length,
  };
}

export async function createMaturityCheck(writer: Writer, actor: Actor, body: Record<string, unknown>, authorFallback: string) {
  const parcelCode = upper(body.parcel_code, 'parcel_code');
  const checkedAt = requiredInstant(body.checked_at, 'checked_at');
  if (businessDate(new Date(checkedAt)) > businessDate(new Date())) {
    throw domainError('WC_VALIDATION', { checked_at: 'La fecha no puede ser futura' });
  }
  const sugar = parseMeasure(body.sugar_gl, 'sugar_gl', 400);
  const probable = parseMeasure(body.probable_abv, 'probable_abv', 25);
  const acidity = parseMeasure(body.total_acidity, 'total_acidity', 30);
  const ph = parseMeasure(body.ph, 'ph', 14);
  const sanitary = body.sanitary_status === undefined || body.sanitary_status === null
    ? null
    : oneOf(body.sanitary_status, 'sanitary_status', SANITARY);
  const days = optionalDays(body.estimated_days_to_harvest);
  const author = optionalText(body.author, 'author', 120) ?? authorFallback;
  const source = body.source === undefined ? 'manual' : oneOf(body.source, 'source', SOURCES);
  const notes = optionalText(body.sensory_notes, 'sensory_notes', 2000);
  const weather = body.weather_snapshot === undefined ? null : objectOf(body.weather_snapshot);
  if (body.weather_snapshot !== undefined && body.weather_snapshot !== null && weather === null) {
    throw domainError('WC_VALIDATION', { weather_snapshot: 'Tiene que ser un objeto' });
  }
  const tasting = parseTasting(body);
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const parcel = await parcelByCode(tx, parcelCode);
    if (!parcel.is_active) throw domainError('WC_VALIDATION', { parcel_code: 'La parcela no está activa' });
    if (tasting.photo_attachment_id) await assertAttachment(tx, tasting.photo_attachment_id);
    tx.write(sql`
      INSERT INTO vineyard.maturity_check (
        id, parcel_id, checked_at, author, sensory_notes, estimated_days_to_harvest,
        sanitary_status, weather_snapshot, probable_abv, total_acidity, sugar_gl, ph, source,
        seed_color, seed_crunch, skin_astringency, skin_color_release, pulp_sweetness, pulp_acidity,
        phenolic_maturity, photo_attachment_id
      ) VALUES (
        CAST(${id} AS UUID), CAST(${parcel.id} AS UUID), CAST(${checkedAt} AS TIMESTAMPTZ), ${author},
        ${notes}, ${days}, ${sanitary}, ${sql.json(weather)},
        CAST(${probable} AS DECIMAL(4,2)), CAST(${acidity} AS DECIMAL(5,2)),
        CAST(${sugar} AS DECIMAL(6,2)), CAST(${ph} AS DECIMAL(4,2)), ${source},
        ${tasting.seed_color}, ${tasting.seed_crunch}, ${tasting.skin_astringency}, ${tasting.skin_color_release},
        ${tasting.pulp_sweetness}, ${tasting.pulp_acidity}, ${tasting.phenolic_maturity},
        CAST(${tasting.photo_attachment_id} AS UUID)
      )
    `);
    tx.audit({
      table: 'vineyard.maturity_check',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { id, parcel_code: parcel.code, checked_at: checkedAt, sugar_gl: sugar, probable_abv: probable, ph },
    });
  });
  return readMaturity(writer, id);
}

export async function listMaturityChecks(writer: Writer, parcelCode: string | null) {
  const filter = parcelCode ? sql`WHERE p.code = ${parcelCode.trim().toUpperCase()}` : sql`WHERE TRUE`;
  const rows = await writer.read(`
    SELECT m.id::VARCHAR AS id, p.code AS parcel_code, m.checked_at, m.author, m.sensory_notes,
           m.estimated_days_to_harvest, m.sanitary_status, m.probable_abv::VARCHAR AS probable_abv,
           m.total_acidity::VARCHAR AS total_acidity, m.sugar_gl::VARCHAR AS sugar_gl, m.ph::VARCHAR AS ph,
           m.seed_color, m.seed_crunch, m.skin_astringency, m.skin_color_release,
           m.pulp_sweetness, m.pulp_acidity, m.phenolic_maturity,
           m.photo_attachment_id::VARCHAR AS photo_attachment_id, m.source, m.created_at
    FROM vineyard.maturity_check m
    JOIN vineyard.parcel p ON p.id = m.parcel_id
    ${filter}
    ORDER BY m.checked_at DESC, m.id
  `);
  return {
    items: rows.map((row) => ({
      id: idOf(row.id),
      parcel_code: text(row.parcel_code),
      checked_at: instantOf(row.checked_at),
      author: text(row.author),
      sensory_notes: textOrNull(row.sensory_notes),
      estimated_days_to_harvest: integerOrNull(row.estimated_days_to_harvest),
      sanitary_status: textOrNull(row.sanitary_status),
      probable_abv: text(row.probable_abv),
      total_acidity: text(row.total_acidity),
      sugar_gl: textOrNull(row.sugar_gl),
      ph: textOrNull(row.ph),
      seed_color: textOrNull(row.seed_color),
      seed_crunch: row.seed_crunch == null ? null : flag(row.seed_crunch),
      skin_astringency: integerOrNull(row.skin_astringency),
      skin_color_release: integerOrNull(row.skin_color_release),
      pulp_sweetness: integerOrNull(row.pulp_sweetness),
      pulp_acidity: integerOrNull(row.pulp_acidity),
      phenolic_maturity: integerOrNull(row.phenolic_maturity),
      photo_attachment_id: textOrNull(row.photo_attachment_id)?.toLowerCase() ?? null,
      source: text(row.source),
      created_at: instantOf(row.created_at),
    })),
    total: rows.length,
  };
}

export async function createHarvest(writer: Writer, actor: Actor, body: Record<string, unknown>) {
  const parcelCode = upper(body.parcel_code, 'parcel_code');
  const vintage = requiredYear(body.vintage, 'vintage');
  const harvestedOn = requiredDate(body.harvested_on, 'harvested_on');
  const variety = upper(body.variety, 'variety');
  const estimated = body.estimated_kg === undefined || body.estimated_kg === null || body.estimated_kg === ''
    ? null
    : parseKg(body.estimated_kg, 'estimated_kg');
  if (estimated !== null && estimated.grams % 100 !== 0) {
    throw domainError('WC_VALIDATION', { estimated_kg: 'Los kilos previstos admiten un decimal' });
  }
  const storedKg = estimated === null ? null : (estimated.grams / 1000).toFixed(1);
  const crew = optionalCrew(body.crew_size);
  const notes = optionalText(body.notes, 'notes', 2000);
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const parcel = await parcelByCode(tx, parcelCode);
    if (!parcel.is_active) throw domainError('WC_VALIDATION', { parcel_code: 'La parcela no está activa' });
    await assertParcelVariety(tx, parcel.id, variety);
    tx.write(sql`
      INSERT INTO vineyard.harvest (id, parcel_id, vintage, harvested_on, variety, estimated_kg, crew_size, notes)
      VALUES (
        CAST(${id} AS UUID), CAST(${parcel.id} AS UUID), ${vintage}, CAST(${harvestedOn} AS DATE),
        ${variety}, CAST(${storedKg} AS DECIMAL(10,1)), ${crew}, ${notes}
      )
    `);
    tx.audit({
      table: 'vineyard.harvest',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { id, parcel_code: parcel.code, vintage, variety, harvested_on: harvestedOn },
    });
  });
  return readHarvest(writer, id);
}

export async function listHarvests(writer: Writer, campaign: number | null) {
  const filter = campaign === null ? sql`WHERE TRUE` : sql`WHERE h.vintage = ${campaign}`;
  const rows = await harvestRows(writer, filter);
  return { items: rows, total: rows.length };
}

export async function closeHarvest(writer: Writer, actor: Actor, id: string, body: Record<string, unknown>) {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const receptionId = uuidOf(body.reception_operation_id ?? body.receptionOperationId, 'reception_operation_id');
  await writer.withWrite(actor, async (tx) => {
    const harvests = await tx.read<Record<string, unknown>>(sql`
      SELECT h.id::VARCHAR AS id, h.parcel_id::VARCHAR AS parcel_id, p.code AS parcel_code,
             h.vintage, h.variety, h.reception_operation_id::VARCHAR AS reception_operation_id
      FROM vineyard.harvest h
      JOIN vineyard.parcel p ON p.id = h.parcel_id
      WHERE h.id = CAST(${id} AS UUID)
    `);
    const harvest = harvests[0];
    if (!harvest) throw domainError('WC_NOT_FOUND');
    if (textOrNull(harvest.reception_operation_id) !== null) {
      throw domainError('WC_VALIDATION', { reception_operation_id: 'La vendimia ya está cerrada' });
    }
    const operations = await tx.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, op_type, status, rectifies_operation_id::VARCHAR AS rectifies_operation_id, details
      FROM cellar.operation
      WHERE id = CAST(${receptionId} AS UUID)
    `);
    const operation = operations[0];
    if (!operation || text(operation.op_type) !== 'reception') {
      throw domainError('WC_VALIDATION', { reception_operation_id: 'La recepción de uva no existe' });
    }
    if (text(operation.status) !== 'confirmed' || textOrNull(operation.rectifies_operation_id) !== null) {
      throw domainError('WC_VALIDATION', { reception_operation_id: 'La recepción tiene que estar confirmada' });
    }
    const ticket = ticketOf(objectOf(operation.details));
    if (ticket === null) {
      throw domainError('WC_VALIDATION', { reception_operation_id: 'La operación no es una entrada de uva' });
    }
    if (ticket.vintage !== integer(harvest.vintage) || ticket.variety_code !== text(harvest.variety)) {
      throw domainError('WC_VALIDATION', { reception_operation_id: 'La recepción no es de esta añada y variedad' });
    }
    if (ticket.source.kind !== 'parcels' || !ticket.source.lines.some((line) => line.parcel_id === idOf(harvest.parcel_id))) {
      throw domainError('WC_VALIDATION', { reception_operation_id: 'La recepción no incluye esta parcela' });
    }
    tx.write(sql`
      UPDATE vineyard.harvest
      SET reception_operation_id = CAST(${receptionId} AS UUID)
      WHERE id = CAST(${id} AS UUID) AND reception_operation_id IS NULL
    `);
    tx.audit({
      table: 'vineyard.harvest',
      rowId: id,
      action: 'UPDATE',
      before: { reception_operation_id: null },
      after: { reception_operation_id: receptionId },
    });
  });
  return readHarvest(writer, id);
}

export async function harvestSummary(writer: Writer, campaign: number) {
  const operations = await writer.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, status, rectifies_operation_id::VARCHAR AS rectifies_operation_id, details
    FROM cellar.operation
    WHERE op_type = 'reception' AND status = 'confirmed' AND rectifies_operation_id IS NULL
  `);
  const areas = await writer.read<Record<string, unknown>>(`
    SELECT parcel_id::VARCHAR AS parcel_id, variety, area_ha::VARCHAR AS area_ha
    FROM vineyard.parcel_variety
  `);
  const areaByKey = new Map<string, string>();
  for (const row of areas) areaByKey.set(`${idOf(row.parcel_id)}|${text(row.variety)}`, text(row.area_ha));
  const parcels = await writer.read<Record<string, unknown>>(`SELECT id::VARCHAR AS id, code FROM vineyard.parcel`);
  const codeById = new Map(parcels.map((row) => [idOf(row.id), text(row.code)]));
  const grouped = new Map<string, { parcel_code: string | null; grower_contact_id: string | null; variety_code: string; organic_g: number; conventional_g: number; area_ha: string | null }>();
  for (const operation of operations) {
    const ticket = ticketOf(objectOf(operation.details));
    if (ticket === null || ticket.vintage !== campaign) continue;
    if (ticket.source.kind === 'grower') {
      addGroup(grouped, `grower|${ticket.source.contact_id}|${ticket.variety_code}`, {
        parcel_code: null,
        grower_contact_id: ticket.source.contact_id,
        variety_code: ticket.variety_code,
        grams: ticket.net_g,
        organic: ticket.is_organic,
        area_ha: null,
      });
      continue;
    }
    for (const line of ticket.source.lines) {
      addGroup(grouped, `${line.parcel_id}|${ticket.variety_code}`, {
        parcel_code: line.parcel_code || codeById.get(line.parcel_id) || null,
        grower_contact_id: null,
        variety_code: ticket.variety_code,
        grams: line.grams,
        organic: ticket.is_organic,
        area_ha: areaByKey.get(`${line.parcel_id}|${ticket.variety_code}`) ?? null,
      });
    }
  }
  const rows = [...grouped.values()].map((row) => {
    const net = row.organic_g + row.conventional_g;
    const area = row.area_ha === null ? null : formatArea(row.area_ha);
    return {
      parcel_code: row.parcel_code,
      grower_contact_id: row.grower_contact_id,
      variety_code: row.variety_code,
      area_ha: area,
      net_kg: formatKg(net),
      yield_kg_ha: area === null ? null : yieldKgPerHa(formatKg(net), area),
      organic_kg: formatKg(row.organic_g),
      conventional_kg: formatKg(row.conventional_g),
    };
  }).sort((left, right) => {
    const parcel = (left.parcel_code ?? '~~~').localeCompare(right.parcel_code ?? '~~~');
    return parcel || left.variety_code.localeCompare(right.variety_code);
  });
  const organic = rows.reduce((sum, row) => sum + kgToGrams(row.organic_kg), 0);
  const conventional = rows.reduce((sum, row) => sum + kgToGrams(row.conventional_kg), 0);
  return {
    campaign,
    rows,
    totals: {
      net_kg: formatKg(organic + conventional),
      organic_kg: formatKg(organic),
      conventional_kg: formatKg(conventional),
    },
  };
}

function addGroup(
  grouped: Map<string, { parcel_code: string | null; grower_contact_id: string | null; variety_code: string; organic_g: number; conventional_g: number; area_ha: string | null }>,
  key: string,
  input: { parcel_code: string | null; grower_contact_id: string | null; variety_code: string; grams: number; organic: boolean; area_ha: string | null },
): void {
  const current = grouped.get(key) ?? {
    parcel_code: input.parcel_code,
    grower_contact_id: input.grower_contact_id,
    variety_code: input.variety_code,
    organic_g: 0,
    conventional_g: 0,
    area_ha: input.area_ha,
  };
  if (input.organic) current.organic_g += input.grams;
  else current.conventional_g += input.grams;
  grouped.set(key, current);
}

function kgToGrams(kg: string): number {
  const [whole, frac = '000'] = kg.split('.');
  return Number(whole) * 1000 + Number(frac.padEnd(3, '0').slice(0, 3));
}

function ticketOf(details: Record<string, unknown> | null): StoredTicket | null {
  if (details === null) return null;
  const ticket = details.grape_reception;
  if (ticket === null || typeof ticket !== 'object' || Array.isArray(ticket)) return null;
  return ticket as StoredTicket;
}

async function readTask(writer: Writer, id: string) {
  const rows = await writer.read(sql`
    SELECT t.id::VARCHAR AS id, p.code AS parcel_code, t.done_on::VARCHAR AS done_on, t.kind,
           t.operator_name, t.hours::VARCHAR AS hours, t.notes, t.source, t.created_at
    FROM vineyard.field_task t
    JOIN vineyard.parcel p ON p.id = t.parcel_id
    WHERE t.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return {
    id: idOf(row.id),
    parcel_code: text(row.parcel_code),
    done_on: dayOf(row.done_on),
    kind: text(row.kind),
    operator_name: textOrNull(row.operator_name),
    hours: textOrNull(row.hours),
    notes: textOrNull(row.notes),
    source: text(row.source),
    created_at: instantOf(row.created_at),
  };
}

async function readMaturity(writer: Writer, id: string) {
  const listed = await listMaturityChecks(writer, null);
  const found = listed.items.find((item) => item.id === id);
  if (!found) throw domainError('WC_NOT_FOUND');
  return found;
}

async function readHarvest(writer: Writer, id: string) {
  const rows = await harvestRows(writer, sql`WHERE h.id = CAST(${id} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function harvestRows(writer: Writer, filter: string) {
  const rows = await writer.read(`
    SELECT h.id::VARCHAR AS id, p.code AS parcel_code, h.vintage, h.harvested_on::VARCHAR AS harvested_on,
           h.variety, h.estimated_kg::VARCHAR AS estimated_kg, h.crew_size, h.notes,
           h.reception_operation_id::VARCHAR AS reception_operation_id, h.created_at
    FROM vineyard.harvest h
    JOIN vineyard.parcel p ON p.id = h.parcel_id
    ${filter}
    ORDER BY h.harvested_on, p.code, h.variety
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    parcel_code: text(row.parcel_code),
    vintage: integer(row.vintage),
    harvested_on: dayOf(row.harvested_on),
    variety: text(row.variety),
    estimated_kg: textOrNull(row.estimated_kg),
    crew_size: integerOrNull(row.crew_size),
    notes: textOrNull(row.notes),
    reception_operation_id: textOrNull(row.reception_operation_id)?.toLowerCase() ?? null,
    closed: textOrNull(row.reception_operation_id) !== null,
    created_at: instantOf(row.created_at),
  }));
}

async function parcelByCode(tx: Tx, code: string): Promise<ParcelRef> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, is_active FROM vineyard.parcel WHERE code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return { id: idOf(row.id), code: text(row.code), is_active: flag(row.is_active) };
}

async function assertParcelVariety(tx: Tx, parcelId: string, variety: string): Promise<void> {
  const rows = await tx.read(sql`
    SELECT id FROM vineyard.parcel_variety
    WHERE parcel_id = CAST(${parcelId} AS UUID) AND variety = ${variety}
  `);
  if (rows.length === 0) throw domainError('WC_VALIDATION', { variety: 'La variedad no está en la parcela' });
}

const SEED_COLORS = ['green', 'mixed', 'brown'] as const;

function parseTasting(body: Record<string, unknown>) {
  return {
    seed_color: body.seed_color === undefined || body.seed_color === null || body.seed_color === ''
      ? null
      : oneOf(body.seed_color, 'seed_color', SEED_COLORS),
    seed_crunch: body.seed_crunch === undefined || body.seed_crunch === null ? null : body.seed_crunch === true,
    skin_astringency: score(body.skin_astringency, 'skin_astringency'),
    skin_color_release: score(body.skin_color_release, 'skin_color_release'),
    pulp_sweetness: score(body.pulp_sweetness, 'pulp_sweetness'),
    pulp_acidity: score(body.pulp_acidity, 'pulp_acidity'),
    phenolic_maturity: score(body.phenolic_maturity, 'phenolic_maturity'),
    photo_attachment_id: body.photo_attachment_id === undefined || body.photo_attachment_id === null || body.photo_attachment_id === ''
      ? null
      : uuidOf(body.photo_attachment_id, 'photo_attachment_id'),
  };
}

function score(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw domainError('WC_VALIDATION', { [field]: 'Escala de 1 a 5' });
  }
  return parsed;
}

async function assertAttachment(tx: Tx, id: string): Promise<void> {
  const rows = await tx.read<{ mime_type: string }>(sql`
    SELECT mime_type FROM core.attachment WHERE id = CAST(${id} AS UUID)
  `);
  const mime = rows[0]?.mime_type ?? '';
  if (!rows[0]) throw domainError('WC_VALIDATION', { photo_attachment_id: 'La foto no existe' });
  if (!mime.startsWith('image/')) {
    throw domainError('WC_VALIDATION', { photo_attachment_id: 'La foto debe ser JPEG, PNG o HEIC' });
  }
}

function upper(value: unknown, field: string): string {
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Es obligatorio' });
  const code = value.trim().toUpperCase();
  if (!CODE.test(code)) throw domainError('WC_VALIDATION', { [field]: 'Código no válido' });
  return code;
}

function requiredDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE.test(value) || !isMadridCivilDate(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Fecha YYYY-MM-DD' });
  }
  return value;
}

function requiredInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isInstant(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Instante ISO-8601 con zona horaria' });
  }
  return value;
}

function requiredYear(value: unknown, field: string): number {
  const year = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(year) || year < 1990 || year > 2100) {
    throw domainError('WC_VALIDATION', { [field]: 'La añada está entre 1990 y 2100' });
  }
  return year;
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

function optionalDays(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const days = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 90) {
    throw domainError('WC_VALIDATION', { estimated_days_to_harvest: 'Entre 0 y 90 días' });
  }
  return days;
}

function optionalCrew(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const crew = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(crew) || crew < 1 || crew > 500) {
    throw domainError('WC_VALIDATION', { crew_size: 'Entre 1 y 500 personas' });
  }
  return crew;
}

function uuidOf(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw domainError('WC_VALIDATION', { [field]: 'Debe ser un UUID' });
  return value.toLowerCase();
}
