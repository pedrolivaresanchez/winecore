import type { Actor, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import {
  FieldBag,
  boolValue,
  enumValue,
  hasKey,
  intValue,
  readObject,
  rejectUnknown,
  requireUuid,
  textValue,
} from './fields';
import { activeParam, asCount, cursorParam, limitParam, pageOf } from './query';
import { asBool, asNullableInt, asString } from './rows';

const CONTAINERS = ['bottle', 'bag_in_box', 'keg', 'other'] as const;
const CODE = /^[A-Z0-9]{2,10}$/;
const FIELDS = [
  'code', 'name', 'container', 'nominal_volume_ml', 'units_per_case', 'cases_per_pallet',
  'unit_gross_weight_g', 'unit_net_weight_g', 'is_active',
] as const;

export interface Format {
  id: string;
  code: string;
  name: string;
  container: string;
  nominal_volume_ml: number;
  units_per_case: number;
  cases_per_pallet: number;
  unit_gross_weight_g: number | null;
  unit_net_weight_g: number | null;
  is_active: boolean;
}

interface FormatState {
  code: string;
  name: string;
  container: string;
  nominal_volume_ml: number;
  units_per_case: number;
  cases_per_pallet: number;
  unit_gross_weight_g: number | null;
  unit_net_weight_g: number | null;
  is_active: boolean;
}

export async function listFormats(writer: Writer, request: Request) {
  const url = new URL(request.url);
  const limit = limitParam(url);
  const cursor = cursorParam(url);
  const active = activeParam(url);
  const filters = ['TRUE'];
  if (active !== null) filters.push(sql`is_active = ${active}`);
  if (cursor) {
    filters.push(sql`(code > ${cursor.k} OR (code = ${cursor.k} AND id > CAST(${cursor.id} AS UUID)))`);
  }
  const totalRows = await writer.read<{ total: unknown }>(`
    SELECT count(*) AS total FROM catalog.format WHERE ${active === null ? 'TRUE' : sql`is_active = ${active}`}
  `);
  const rows = await writer.read(`
    SELECT id, code, name, container, nominal_volume_ml, units_per_case, cases_per_pallet,
           unit_gross_weight_g, unit_net_weight_g, is_active
    FROM catalog.format
    WHERE ${filters.join(' AND ')}
    ORDER BY code, id
    LIMIT ${limit + 1}
  `);
  return pageOf(rows.map(toFormat), limit, asCount(totalRows[0]?.total), (row) => row.code);
}

export async function createFormat(writer: Writer, actor: Actor, body: unknown): Promise<Format> {
  const input = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(input, FIELDS, errors);
  const state = parseFormat(input, null, errors);
  errors.fail();
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const existing = await tx.read<{ id: string }>(sql`SELECT id FROM catalog.format WHERE code = ${state.code}`);
    if (existing.length > 0) throw domainError('WC_VALIDATION', { code: 'Ya existe' });
    writeFormat(tx, id, state, null);
  });
  return requireFormat(writer, id);
}

export async function updateFormat(writer: Writer, actor: Actor, id: string, body: unknown): Promise<Format> {
  requireUuid(id);
  const input = readObject(body);
  const current = await requireFormat(writer, id);
  const errors = new FieldBag();
  rejectUnknown(input, FIELDS, errors);
  if (Object.keys(input).length === 0) errors.add('body', 'Nada que actualizar');
  const state = parseFormat(input, current, errors);
  errors.fail();
  try {
  await writer.withWrite(actor, async (tx) => {
    if (state.code !== current.code) {
      const existing = await tx.read<{ id: string }>(sql`
        SELECT id FROM catalog.format WHERE code = ${state.code} AND id <> CAST(${id} AS UUID)
      `);
      if (existing.length > 0) throw domainError('WC_VALIDATION', { code: 'Ya existe' });
    }
    writeFormat(tx, id, state, current);
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('still referenced')) {
      throw domainError('WC_VALIDATION', { code: 'No se puede cambiar porque ya está en uso' });
    }
    throw error;
  }
  return requireFormat(writer, id);
}

export async function requireFormat(writer: Writer, id: string): Promise<Format> {
  requireUuid(id);
  const rows = await writer.read(sql`
    SELECT id, code, name, container, nominal_volume_ml, units_per_case, cases_per_pallet,
           unit_gross_weight_g, unit_net_weight_g, is_active
    FROM catalog.format
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return toFormat(row);
}

function writeFormat(
  tx: { write(sql: string): void; audit(change: { table: string; rowId: string | null; action: string; before: unknown; after: unknown }): void },
  id: string,
  state: FormatState,
  before: Format | null,
): void {
  if (before === null) {
    tx.write(sql`
      INSERT INTO catalog.format (
        id, code, name, container, nominal_volume_ml, units_per_case, cases_per_pallet,
        unit_gross_weight_g, unit_net_weight_g, is_active
      ) VALUES (
        CAST(${id} AS UUID), ${state.code}, ${state.name}, ${state.container},
        ${state.nominal_volume_ml}, ${state.units_per_case}, ${state.cases_per_pallet},
        ${state.unit_gross_weight_g}, ${state.unit_net_weight_g}, ${state.is_active}
      )
    `);
    tx.audit({ table: 'catalog.format', rowId: id, action: 'INSERT', before: null, after: { id, ...state } });
    return;
  }
  const assignments = [
    sql`name = ${state.name}`,
    sql`container = ${state.container}`,
    sql`nominal_volume_ml = ${state.nominal_volume_ml}`,
    sql`units_per_case = ${state.units_per_case}`,
    sql`cases_per_pallet = ${state.cases_per_pallet}`,
    sql`unit_gross_weight_g = ${state.unit_gross_weight_g}`,
    sql`unit_net_weight_g = ${state.unit_net_weight_g}`,
    sql`is_active = ${state.is_active}`,
  ];
  if (before.code !== state.code) assignments.unshift(sql`code = ${state.code}`);
  tx.write(`UPDATE catalog.format SET ${assignments.join(', ')} WHERE ${sql`id = CAST(${id} AS UUID)`}`);
  tx.audit({
    table: 'catalog.format',
    rowId: id,
    action: 'UPDATE',
    before,
    after: { ...before, ...state },
  });
}

function parseFormat(input: Record<string, unknown>, current: Format | null, errors: FieldBag): FormatState {
  const code = pickText(input, 'code', current?.code ?? null, errors, {
    required: true,
    pattern: CODE,
    patternMessage: 'Usa mayúsculas o dígitos (2-10)',
  });
  const name = pickText(input, 'name', current?.name ?? null, errors, { required: true, min: 1, max: 120 });
  const container = pickEnum(input, 'container', current?.container ?? null, CONTAINERS, errors);
  const volume = pickInt(input, 'nominal_volume_ml', current?.nominal_volume_ml ?? null, errors, 1, 2147483647, true);
  const units = pickInt(input, 'units_per_case', current?.units_per_case ?? 6, errors, 1, 32767, false);
  const cases = pickInt(input, 'cases_per_pallet', current?.cases_per_pallet ?? 112, errors, 1, 32767, false);
  const gross = pickInt(input, 'unit_gross_weight_g', current?.unit_gross_weight_g ?? null, errors, 1, 2147483647, false);
  const net = pickInt(input, 'unit_net_weight_g', current?.unit_net_weight_g ?? null, errors, 1, 2147483647, false);
  const active = hasKey(input, 'is_active') ? (boolValue(input.is_active, 'is_active', errors) ?? true) : (current?.is_active ?? true);
  if (gross != null && net != null && net > gross) {
    errors.add('unit_net_weight_g', 'El peso neto no puede superar al bruto');
  }
  if (volume != null && volume <= 0) errors.add('nominal_volume_ml', 'El volumen debe ser mayor que 0');
  return {
    code: code ?? '',
    name: name ?? '',
    container: container ?? '',
    nominal_volume_ml: volume ?? 0,
    units_per_case: units ?? 6,
    cases_per_pallet: cases ?? 112,
    unit_gross_weight_g: gross,
    unit_net_weight_g: net,
    is_active: active,
  };
}

function pickText(
  input: Record<string, unknown>,
  key: string,
  current: string | null,
  errors: FieldBag,
  opts: { required?: boolean; min?: number; max?: number; pattern?: RegExp; patternMessage?: string },
): string | null {
  if (!hasKey(input, key)) {
    if (current == null && opts.required) errors.add(key, 'Obligatorio');
    return current;
  }
  return textValue(input[key], key, errors, opts);
}

function pickEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  current: string | null,
  allowed: readonly T[],
  errors: FieldBag,
): T | null {
  if (!hasKey(input, key)) {
    if (current == null) errors.add(key, 'Obligatorio');
    return current as T | null;
  }
  return enumValue(input[key], key, allowed, errors);
}

function pickInt(
  input: Record<string, unknown>,
  key: string,
  current: number | null,
  errors: FieldBag,
  min: number,
  max: number,
  required: boolean,
): number | null {
  if (!hasKey(input, key)) {
    if (current == null && required) errors.add(key, 'Obligatorio');
    return current;
  }
  if (input[key] == null) {
    if (required) errors.add(key, 'Obligatorio');
    return null;
  }
  return intValue(input[key], key, errors, { min, max });
}

function toFormat(row: Record<string, unknown>): Format {
  return {
    id: asString(row.id),
    code: asString(row.code),
    name: asString(row.name),
    container: asString(row.container),
    nominal_volume_ml: Number(row.nominal_volume_ml),
    units_per_case: Number(row.units_per_case),
    cases_per_pallet: Number(row.cases_per_pallet),
    unit_gross_weight_g: asNullableInt(row.unit_gross_weight_g),
    unit_net_weight_g: asNullableInt(row.unit_net_weight_g),
    is_active: asBool(row.is_active),
  };
}
