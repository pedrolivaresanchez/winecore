import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { businessDate } from '../time';
import { derivePrefix, formatSeriesNumber, seriesPrefixError } from './prefix';

type Read = <T = Record<string, unknown>>(statement: string) => Promise<T[]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DOC_TYPES = [
  'invoice',
  'credit_note',
  'simplified_invoice',
  'intercompany_invoice',
  'delivery_note',
  'quote',
  'sales_order',
  'proforma',
  'cellar_operation',
  'inventory_count',
] as const;

export type DocType = (typeof DOC_TYPES)[number];

export function isDocType(value: string): value is DocType {
  return (DOC_TYPES as readonly string[]).includes(value);
}

export type SeriesJson = {
  id: string;
  legal_entity_id: string;
  doc_type: string;
  code: string;
  year: number;
  prefix: string;
  padding: number;
  next_value: number;
  last_number: string | null;
  is_default: boolean;
  verifactu: boolean;
  is_active: boolean;
  created_at: string;
};

export type SeriesFilter = {
  legalEntityId?: string;
  docType?: string;
  year?: number;
};

type SeriesRow = {
  id: unknown;
  legal_entity_id: unknown;
  doc_type: unknown;
  code: unknown;
  series_year: unknown;
  prefix: unknown;
  padding: unknown;
  next_value: unknown;
  is_default: unknown;
  verifactu: unknown;
  is_active: unknown;
  created_at: unknown;
};

type SeriesInput = {
  legalEntityId: string;
  docType: DocType;
  code: string;
  prefix: string | null;
  padding: number | null;
  isDefault: boolean | null;
  verifactu: boolean | null;
  year: number | null;
};

const SERIES_COLUMNS = `
  id, legal_entity_id, doc_type, code, "year" AS series_year, prefix, padding,
  next_value, is_default, verifactu, is_active, created_at
`;

const reservedNext = new WeakMap<Tx, Map<string, number>>();

export function seriesYear(date: Date): number {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw domainError('WC_VALIDATION', { date: 'Fecha no válida' });
  }
  return Number(businessDate(date).slice(0, 4));
}

function num(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return Number.NaN;
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === 't';
}

function stamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function seriesJson(row: SeriesRow): SeriesJson {
  const next = num(row.next_value);
  const padding = num(row.padding);
  const prefix = String(row.prefix);
  const last = Number.isInteger(next) && next > 1 && Number.isInteger(padding) && padding > 0
    ? formatSeriesNumber(prefix, padding, next - 1)
    : null;
  return {
    id: String(row.id).toLowerCase(),
    legal_entity_id: String(row.legal_entity_id).toLowerCase(),
    doc_type: String(row.doc_type),
    code: String(row.code),
    year: num(row.series_year),
    prefix,
    padding,
    next_value: next,
    last_number: last,
    is_default: flag(row.is_default),
    verifactu: flag(row.verifactu),
    is_active: flag(row.is_active),
    created_at: stamp(row.created_at),
  };
}

function claim(tx: Tx, seriesId: string, dbNext: number, padding: number): number {
  let pending = reservedNext.get(tx);
  if (!pending) {
    pending = new Map();
    reservedNext.set(tx, pending);
  }
  const next = pending.get(seriesId) ?? dbNext;
  if (!Number.isInteger(next) || next < 1 || String(next).length > padding) {
    throw domainError('WC011');
  }
  pending.set(seriesId, next + 1);
  return next;
}

/**
 * Toma el número dentro de `withWrite`. El incremento queda en la misma
 * escritura: si la operación falla después, no hay commit y no queda hueco.
 * La serie es la activa de la entidad, el tipo y el año de `date` en Europe/Madrid.
 */
export async function takeNumber(
  tx: Tx,
  input: { legalEntityId: string; docType: string; date: Date; seriesId?: string },
): Promise<string> {
  if (!UUID.test(input.legalEntityId)) {
    throw domainError('WC_VALIDATION', { legal_entity_id: 'Identificador no válido' });
  }
  if (!isDocType(input.docType)) {
    throw domainError('WC_VALIDATION', { doc_type: 'Tipo de documento no válido' });
  }
  if (input.seriesId !== undefined && !UUID.test(input.seriesId)) throw domainError('WC010');
  const year = seriesYear(input.date);
  // seriesId fija la serie del borrador (factura o rectificativa). Sin él, la de por defecto.
  const rows = await tx.read<{
    id: unknown;
    prefix: unknown;
    padding: unknown;
    next_value: unknown;
    is_default: unknown;
  }>(input.seriesId
    ? sql`
      SELECT id, prefix, padding, next_value, is_default
      FROM core.number_series
      WHERE id = CAST(${input.seriesId} AS UUID)
        AND legal_entity_id = CAST(${input.legalEntityId} AS UUID)
        AND doc_type = ${input.docType}
        AND "year" = ${year}
        AND is_active
    `
    : sql`
      SELECT id, prefix, padding, next_value, is_default
      FROM core.number_series
      WHERE legal_entity_id = CAST(${input.legalEntityId} AS UUID)
        AND doc_type = ${input.docType}
        AND "year" = ${year}
        AND is_active
      ORDER BY is_default DESC, created_at
    `);
  if (rows.length === 0) throw domainError('WC010');
  const only = rows.length === 1 ? rows[0] : undefined;
  const preferred = input.seriesId ? rows[0] : rows.find((row) => flag(row.is_default)) ?? only;
  if (!preferred) throw domainError('WC010');
  const id = String(preferred.id).toLowerCase();
  const padding = num(preferred.padding);
  const dbNext = num(preferred.next_value);
  if (!Number.isInteger(padding) || padding < 1) throw domainError('WC011');
  const taken = claim(tx, id, dbNext, padding);
  tx.write(sql`
    UPDATE core.number_series
    SET next_value = ${taken + 1}
    WHERE id = CAST(${id} AS UUID) AND is_active
  `);
  tx.audit({
    table: 'core.number_series',
    rowId: id,
    action: 'UPDATE',
    before: { next_value: taken },
    after: { next_value: taken + 1 },
  });
  return formatSeriesNumber(String(preferred.prefix), padding, taken);
}

const DEFAULT_LETTERS: Partial<Record<DocType, string>> = {
  quote: 'PR',
  sales_order: 'PE',
  delivery_note: 'AL',
  invoice: 'F',
  credit_note: 'R',
  simplified_invoice: 'FS',
  proforma: 'PF',
};

const DEFAULT_PADDING = 4;
const VARIANTS = ['', ...'BCDEFGHIJKLMNOPQRSTUVWXYZ'];

export type ProvisionedSeries = {
  id: string;
  legalEntityId: string;
  docType: DocType;
  code: string;
  year: number;
  prefix: string;
  padding: number;
};

const provisioned = new WeakMap<Tx, Map<string, ProvisionedSeries>>();

/**
 * Abre la serie por defecto cuando la entidad no tiene ninguna (ni activa ni de baja)
 * para el tipo y el año: sin ella no se numera el primer documento. Si ya hay alguna,
 * devuelve null y manda la configuración existente. La serie nueva no se ve con
 * `tx.read` hasta el commit: dentro de la misma escritura se numera con `takeProvisionedNumber`.
 */
export async function ensureDefaultSeries(
  tx: Tx,
  legalEntityId: string,
  docType: string,
  year: number,
): Promise<ProvisionedSeries | null> {
  if (!UUID.test(legalEntityId)) {
    throw domainError('WC_VALIDATION', { legal_entity_id: 'Identificador no válido' });
  }
  if (!isDocType(docType)) {
    throw domainError('WC_VALIDATION', { doc_type: 'Tipo de documento no válido' });
  }
  const letters = DEFAULT_LETTERS[docType];
  if (!letters || !Number.isInteger(year) || year < 2020 || year > 2100) return null;
  const entityId = legalEntityId.toLowerCase();
  const key = `${entityId}|${docType}|${year}`;
  const pending = provisioned.get(tx) ?? new Map<string, ProvisionedSeries>();
  provisioned.set(tx, pending);
  const known = pending.get(key);
  if (known) return known;

  const existing = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.number_series
    WHERE legal_entity_id = CAST(${entityId} AS UUID)
      AND doc_type = ${docType}
      AND "year" = ${year}
    LIMIT 1
  `);
  if (existing[0]) return null;
  const entities = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.legal_entity
    WHERE id = CAST(${entityId} AS UUID) AND is_active
    LIMIT 1
  `);
  if (!entities[0]) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });

  const taken = await tx.read<{ prefix: unknown }>(sql`
    SELECT prefix FROM core.number_series WHERE legal_entity_id = CAST(${entityId} AS UUID)
  `);
  const used = new Set(taken.map((row) => String(row.prefix)));
  for (const other of pending.values()) {
    if (other.legalEntityId === entityId) used.add(other.prefix);
  }
  const yy = String(year % 100).padStart(2, '0');
  const variant = VARIANTS.find((suffix) => !used.has(`${letters}${yy}${suffix}-`));
  if (variant === undefined) throw domainError('WC010');
  const series: ProvisionedSeries = {
    id: newId(),
    legalEntityId: entityId,
    docType,
    code: letters,
    year,
    prefix: `${letters}${yy}${variant}-`,
    padding: DEFAULT_PADDING,
  };
  tx.write(sql`
    INSERT INTO core.number_series (
      id, legal_entity_id, doc_type, code, year, prefix, padding,
      next_value, is_default, verifactu, is_active
    ) VALUES (
      CAST(${series.id} AS UUID),
      CAST(${entityId} AS UUID),
      ${docType},
      ${series.code},
      ${year},
      ${series.prefix},
      ${series.padding},
      1,
      TRUE,
      FALSE,
      TRUE
    )
  `);
  tx.audit({
    table: 'core.number_series',
    rowId: series.id,
    action: 'INSERT',
    before: null,
    after: {
      legal_entity_id: entityId,
      doc_type: docType,
      code: series.code,
      year,
      prefix: series.prefix,
      padding: series.padding,
      next_value: 1,
      is_default: true,
      verifactu: false,
      is_active: true,
      provisioned: true,
    },
  });
  pending.set(key, series);
  return series;
}

export function takeProvisionedNumber(tx: Tx, series: ProvisionedSeries): string {
  const taken = claim(tx, series.id, 1, series.padding);
  tx.write(sql`
    UPDATE core.number_series
    SET next_value = ${taken + 1}
    WHERE id = CAST(${series.id} AS UUID) AND is_active
  `);
  tx.audit({
    table: 'core.number_series',
    rowId: series.id,
    action: 'UPDATE',
    before: { next_value: taken },
    after: { next_value: taken + 1 },
  });
  return formatSeriesNumber(series.prefix, series.padding, taken);
}

function parseSeriesBody(raw: unknown): SeriesInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  const body = raw as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const legalEntityId = typeof body.legal_entity_id === 'string' ? body.legal_entity_id.trim().toLowerCase() : '';
  if (!UUID.test(legalEntityId)) fields.legal_entity_id = 'Identificador no válido';
  const docTypeRaw = typeof body.doc_type === 'string' ? body.doc_type : '';
  if (!isDocType(docTypeRaw)) fields.doc_type = 'Tipo de documento no válido';
  const code = typeof body.code === 'string' ? body.code : '';
  if (!/^[A-Z]{1,4}$/.test(code)) fields.code = 'El código debe tener de 1 a 4 letras mayúsculas';

  let prefix: string | null = null;
  if (body.prefix !== undefined && body.prefix !== null) {
    if (typeof body.prefix !== 'string') fields.prefix = 'Debe ser texto';
    else prefix = body.prefix;
  }
  const padding = optionalInt(body.padding, 'padding', 3, 8, fields);
  const year = optionalInt(body.year, 'year', 2020, 2100, fields);
  const isDefault = optionalBool(body.is_default, 'is_default', fields);
  const verifactu = optionalBool(body.verifactu, 'verifactu', fields);
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  if (!isDocType(docTypeRaw)) throw domainError('WC_VALIDATION', { doc_type: 'Tipo de documento no válido' });
  return {
    legalEntityId,
    docType: docTypeRaw,
    code,
    prefix,
    padding,
    isDefault,
    verifactu,
    year,
  };
}

function optionalInt(
  value: unknown,
  field: string,
  min: number,
  max: number,
  fields: Record<string, string>,
): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fields[field] = 'Debe ser un número entero';
    return null;
  }
  if (value < min || value > max) {
    fields[field] = `Debe estar entre ${min} y ${max}`;
    return null;
  }
  return value;
}

function optionalBool(value: unknown, field: string, fields: Record<string, string>): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    fields[field] = 'Debe ser verdadero o falso';
    return null;
  }
  return value;
}

/**
 * Alta de la serie del año siguiente. La primera de un código puede indicar
 * el año (si no, el año que viene en Madrid). Las siguientes solo abren
 * el año posterior al último de ese código, copiando relleno y banderas.
 */
export async function createSeries(tx: Tx, raw: unknown): Promise<string> {
  const input = parseSeriesBody(raw);
  const previousRows = await tx.read<{
    series_year: unknown;
    prefix: unknown;
    padding: unknown;
    is_default: unknown;
    verifactu: unknown;
  }>(sql`
    SELECT "year" AS series_year, prefix, padding, is_default, verifactu
    FROM core.number_series
    WHERE legal_entity_id = CAST(${input.legalEntityId} AS UUID)
      AND doc_type = ${input.docType}
      AND code = ${input.code}
    ORDER BY "year" DESC
    LIMIT 1
  `);
  const previous = previousRows[0];
  let year: number;
  if (previous) {
    const nextYear = num(previous.series_year) + 1;
    if (nextYear > 2100) {
      throw domainError('WC_VALIDATION', { year: 'No se puede crear una serie posterior a 2100' });
    }
    if (input.year !== null && input.year !== nextYear) {
      throw domainError('WC_VALIDATION', { year: `La siguiente serie de este código es la de ${nextYear}` });
    }
    year = nextYear;
  } else if (input.year !== null) {
    year = input.year;
  } else {
    year = seriesYear(new Date()) + 1;
    if (year > 2100) {
      throw domainError('WC_VALIDATION', { year: 'No se puede crear una serie posterior a 2100' });
    }
  }

  const padding = input.padding ?? (previous ? num(previous.padding) : 4);
  if (!Number.isInteger(padding) || padding < 3 || padding > 8) {
    throw domainError('WC_VALIDATION', { padding: 'El relleno debe estar entre 3 y 8' });
  }
  let prefix = input.prefix;
  if (prefix === null) {
    const derived = previous ? derivePrefix(String(previous.prefix), year) : null;
    if (!derived) throw domainError('WC_VALIDATION', { prefix: 'Indica el prefijo de la serie' });
    prefix = derived;
  }
  const problem = seriesPrefixError(prefix, padding);
  if (problem) throw domainError('WC_VALIDATION', { prefix: problem });
  const isDefault = input.isDefault ?? (previous ? flag(previous.is_default) : false);
  const verifactu = input.verifactu ?? (previous ? flag(previous.verifactu) : false);

  const entities = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.legal_entity WHERE id = CAST(${input.legalEntityId} AS UUID) LIMIT 1
  `);
  if (!entities[0]) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });
  const samePrefix = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.number_series
    WHERE legal_entity_id = CAST(${input.legalEntityId} AS UUID) AND prefix = ${prefix}
    LIMIT 1
  `);
  if (samePrefix[0]) throw domainError('WC_VALIDATION', { prefix: 'Ya existe una serie con este prefijo en la entidad' });
  const sameCode = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.number_series
    WHERE legal_entity_id = CAST(${input.legalEntityId} AS UUID)
      AND doc_type = ${input.docType}
      AND code = ${input.code}
      AND "year" = ${year}
    LIMIT 1
  `);
  if (sameCode[0]) throw domainError('WC_VALIDATION', { code: 'Ya existe una serie con este código y año' });

  if (isDefault) await clearDefault(tx, input.legalEntityId, input.docType, year);
  const id = newId();
  tx.write(sql`
    INSERT INTO core.number_series (
      id, legal_entity_id, doc_type, code, year, prefix, padding,
      next_value, is_default, verifactu, is_active
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${input.legalEntityId} AS UUID),
      ${input.docType},
      ${input.code},
      ${year},
      ${prefix},
      ${padding},
      1,
      ${isDefault},
      ${verifactu},
      TRUE
    )
  `);
  tx.audit({
    table: 'core.number_series',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: {
      legal_entity_id: input.legalEntityId,
      doc_type: input.docType,
      code: input.code,
      year,
      prefix,
      padding,
      next_value: 1,
      is_default: isDefault,
      verifactu,
      is_active: true,
    },
  });
  return id;
}

async function clearDefault(tx: Tx, legalEntityId: string, docType: string, year: number): Promise<void> {
  const current = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.number_series
    WHERE legal_entity_id = CAST(${legalEntityId} AS UUID)
      AND doc_type = ${docType}
      AND "year" = ${year}
      AND is_default
  `);
  for (const row of current) {
    const rowId = String(row.id).toLowerCase();
    tx.write(sql`
      UPDATE core.number_series
      SET is_default = FALSE
      WHERE id = CAST(${rowId} AS UUID)
    `);
    tx.audit({
      table: 'core.number_series',
      rowId,
      action: 'UPDATE',
      before: { is_default: true },
      after: { is_default: false },
    });
  }
}

export type EnsureSeriesInput = {
  legalEntityId: string;
  docType: DocType;
  code: string;
  year: number;
  prefix: string;
  padding: number;
  isDefault: boolean;
  verifactu: boolean;
};

export type EnsuredSeries = {
  id: string;
  status: 'created' | 'reactivated' | 'skipped';
  legal_entity_id: string;
  doc_type: DocType;
  code: string;
  year: number;
  prefix: string;
};

/**
 * Deja activa la serie de un año concreto. Si ya hay una activa para la entidad,
 * el tipo y el año, no crea otra. Sirve para la puesta en marcha, que abre el año
 * en curso y el siguiente a la vez.
 */
export async function ensureSeriesForYear(tx: Tx, input: EnsureSeriesInput): Promise<EnsuredSeries> {
  if (!UUID.test(input.legalEntityId)) {
    throw domainError('WC_VALIDATION', { legal_entity_id: 'Identificador no válido' });
  }
  if (!isDocType(input.docType)) {
    throw domainError('WC_VALIDATION', { doc_type: 'Tipo de documento no válido' });
  }
  if (!/^[A-Z]{1,4}$/.test(input.code)) {
    throw domainError('WC_VALIDATION', { code: 'El código debe tener de 1 a 4 letras mayúsculas' });
  }
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) {
    throw domainError('WC_VALIDATION', { year: 'El año debe estar entre 2020 y 2100' });
  }
  if (!Number.isInteger(input.padding) || input.padding < 3 || input.padding > 8) {
    throw domainError('WC_VALIDATION', { padding: 'El relleno debe estar entre 3 y 8' });
  }
  const problem = seriesPrefixError(input.prefix, input.padding);
  if (problem) throw domainError('WC_VALIDATION', { prefix: problem });

  const entities = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.legal_entity
    WHERE id = CAST(${input.legalEntityId} AS UUID) AND is_active
    LIMIT 1
  `);
  if (!entities[0]) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });

  const active = await tx.read<{ id: string; code: unknown; prefix: unknown }>(sql`
    SELECT id, code, prefix
    FROM core.number_series
    WHERE legal_entity_id = CAST(${input.legalEntityId} AS UUID)
      AND doc_type = ${input.docType}
      AND "year" = ${input.year}
      AND is_active
    LIMIT 1
  `);
  const current = active[0];
  if (current) {
    return {
      id: String(current.id).toLowerCase(),
      status: 'skipped',
      legal_entity_id: input.legalEntityId,
      doc_type: input.docType,
      code: String(current.code),
      year: input.year,
      prefix: String(current.prefix),
    };
  }

  const sameCode = await tx.read<{ id: string; prefix: unknown }>(sql`
    SELECT id, prefix
    FROM core.number_series
    WHERE legal_entity_id = CAST(${input.legalEntityId} AS UUID)
      AND doc_type = ${input.docType}
      AND code = ${input.code}
      AND "year" = ${input.year}
    LIMIT 1
  `);
  const prior = sameCode[0];
  if (prior) {
    const id = String(prior.id).toLowerCase();
    if (input.isDefault) await clearDefault(tx, input.legalEntityId, input.docType, input.year);
    tx.write(sql`
      UPDATE core.number_series
      SET is_active = TRUE, is_default = ${input.isDefault}, verifactu = ${input.verifactu}
      WHERE id = CAST(${id} AS UUID)
    `);
    tx.audit({
      table: 'core.number_series',
      rowId: id,
      action: 'UPDATE',
      before: { is_active: false },
      after: { is_active: true, is_default: input.isDefault, verifactu: input.verifactu },
    });
    return {
      id,
      status: 'reactivated',
      legal_entity_id: input.legalEntityId,
      doc_type: input.docType,
      code: input.code,
      year: input.year,
      prefix: String(prior.prefix),
    };
  }

  const samePrefix = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.number_series
    WHERE legal_entity_id = CAST(${input.legalEntityId} AS UUID) AND prefix = ${input.prefix}
    LIMIT 1
  `);
  if (samePrefix[0]) {
    throw domainError('WC_VALIDATION', { prefix: 'Ya existe una serie con este prefijo en la entidad' });
  }

  if (input.isDefault) await clearDefault(tx, input.legalEntityId, input.docType, input.year);
  const id = newId();
  tx.write(sql`
    INSERT INTO core.number_series (
      id, legal_entity_id, doc_type, code, year, prefix, padding,
      next_value, is_default, verifactu, is_active
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${input.legalEntityId} AS UUID),
      ${input.docType},
      ${input.code},
      ${input.year},
      ${input.prefix},
      ${input.padding},
      1,
      ${input.isDefault},
      ${input.verifactu},
      TRUE
    )
  `);
  tx.audit({
    table: 'core.number_series',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: {
      legal_entity_id: input.legalEntityId,
      doc_type: input.docType,
      code: input.code,
      year: input.year,
      prefix: input.prefix,
      padding: input.padding,
      next_value: 1,
      is_default: input.isDefault,
      verifactu: input.verifactu,
      is_active: true,
    },
  });
  return {
    id,
    status: 'created',
    legal_entity_id: input.legalEntityId,
    doc_type: input.docType,
    code: input.code,
    year: input.year,
    prefix: input.prefix,
  };
}

export async function deactivateSeries(tx: Tx, id: string): Promise<void> {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const rows = await tx.read<{ is_active: unknown; is_default: unknown }>(sql`
    SELECT is_active, is_default FROM core.number_series WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  if (!flag(row.is_active)) return;
  const wasDefault = flag(row.is_default);
  tx.write(sql`
    UPDATE core.number_series
    SET is_active = FALSE, is_default = FALSE
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({
    table: 'core.number_series',
    rowId: id.toLowerCase(),
    action: 'UPDATE',
    before: { is_active: true, is_default: wasDefault },
    after: { is_active: false, is_default: false },
  });
}

export async function readSeries(read: Read, id: string): Promise<SeriesJson> {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const rows = await read<SeriesRow>(`
    SELECT ${SERIES_COLUMNS}
    FROM core.number_series
    WHERE id = CAST(${sql`${id}`} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return seriesJson(row);
}

export async function listSeries(read: Read, filter: SeriesFilter): Promise<SeriesJson[]> {
  const where = ['TRUE'];
  if (filter.legalEntityId) where.push(sql`legal_entity_id = CAST(${filter.legalEntityId} AS UUID)`);
  if (filter.docType) where.push(sql`doc_type = ${filter.docType}`);
  if (filter.year !== undefined) where.push(sql`"year" = ${filter.year}`);
  const rows = await read<SeriesRow>(`
    SELECT ${SERIES_COLUMNS}
    FROM core.number_series
    WHERE ${where.join(' AND ')}
    ORDER BY "year", doc_type, code
  `);
  return rows.map((row) => seriesJson(row));
}
