import type { Actor, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import {
  FieldBag,
  boolValue,
  enumValue,
  hasKey,
  readObject,
  rejectUnknown,
  requireUuid,
  textValue,
} from './fields';
import { activeParam, asCount, cursorParam, limitParam, pageOf } from './query';
import { asBool, asNullableString, asString } from './rows';

const COLORS = ['red', 'white', 'rose', 'orange', 'sweet', 'sparkling', 'other'] as const;
const CATEGORIES = ['wine', 'pgi_wine', 'pdo_wine', 'fortified', 'other'] as const;
const CODE = /^[A-Z0-9-]{2,20}$/;
const FIELDS = [
  'code', 'name', 'color', 'category', 'pdo_pgi_name', 'is_single_plot',
  'is_organic', 'no_added_sulfites', 'description', 'is_active',
] as const;

export interface Wine {
  id: string;
  code: string;
  name: string;
  color: string;
  category: string;
  pdo_pgi_name: string | null;
  is_single_plot: boolean;
  is_organic: boolean;
  no_added_sulfites: boolean;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

interface WineState {
  code: string;
  name: string;
  color: string;
  category: string;
  pdo_pgi_name: string | null;
  is_single_plot: boolean;
  is_organic: boolean;
  no_added_sulfites: boolean;
  description: string | null;
  is_active: boolean;
}

export async function listWines(writer: Writer, request: Request) {
  const url = new URL(request.url);
  const limit = limitParam(url);
  const cursor = cursorParam(url);
  const active = activeParam(url);
  const filters = ['TRUE'];
  if (active !== null) filters.push(sql`is_active = ${active}`);
  if (cursor) {
    filters.push(sql`(code > ${cursor.k} OR (code = ${cursor.k} AND id > CAST(${cursor.id} AS UUID)))`);
  }
  const where = filters.join(' AND ');
  const totalRows = await writer.read<{ total: unknown }>(`
    SELECT count(*) AS total FROM catalog.wine WHERE ${active === null ? 'TRUE' : sql`is_active = ${active}`}
  `);
  const rows = await writer.read(`
    SELECT id, code, name, color, category, pdo_pgi_name, is_single_plot, is_organic,
           no_added_sulfites, description, is_active, created_at
    FROM catalog.wine
    WHERE ${where}
    ORDER BY code, id
    LIMIT ${limit + 1}
  `);
  return pageOf(rows.map(toWine), limit, asCount(totalRows[0]?.total), (row) => row.code);
}

export async function createWine(writer: Writer, actor: Actor, body: unknown): Promise<Wine> {
  const input = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(input, FIELDS, errors);
  const state = parseWine(input, null, errors);
  errors.fail();
  const id = newId();
  const now = new Date();
  await writer.withWrite(actor, async (tx) => {
    const existing = await tx.read<{ id: string }>(sql`SELECT id FROM catalog.wine WHERE code = ${state.code}`);
    if (existing.length > 0) throw domainError('WC_VALIDATION', { code: 'Ya existe' });
    tx.write(sql`
      INSERT INTO catalog.wine (
        id, code, name, color, category, pdo_pgi_name, is_single_plot, is_organic,
        no_added_sulfites, description, is_active, created_at
      ) VALUES (
        CAST(${id} AS UUID), ${state.code}, ${state.name}, ${state.color}, ${state.category},
        ${state.pdo_pgi_name}, ${state.is_single_plot}, ${state.is_organic},
        ${state.no_added_sulfites}, ${state.description}, ${state.is_active}, ${now}
      )
    `);
    tx.audit({
      table: 'catalog.wine',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { id, ...state, created_at: now.toISOString() },
    });
  });
  return requireWine(writer, id);
}

export async function updateWine(writer: Writer, actor: Actor, id: string, body: unknown): Promise<Wine> {
  requireUuid(id);
  const input = readObject(body);
  const current = await requireWine(writer, id);
  const errors = new FieldBag();
  rejectUnknown(input, FIELDS, errors);
  if (Object.keys(input).length === 0) errors.add('body', 'Nada que actualizar');
  const state = parseWine(input, current, errors);
  errors.fail();
  try {
  await writer.withWrite(actor, async (tx) => {
    if (state.code !== current.code) {
      const existing = await tx.read<{ id: string }>(sql`
        SELECT id FROM catalog.wine WHERE code = ${state.code} AND id <> CAST(${id} AS UUID)
      `);
      if (existing.length > 0) throw domainError('WC_VALIDATION', { code: 'Ya existe' });
    }
    const assignments = [
      sql`name = ${state.name}`,
      sql`color = ${state.color}`,
      sql`category = ${state.category}`,
      sql`pdo_pgi_name = ${state.pdo_pgi_name}`,
      sql`is_single_plot = ${state.is_single_plot}`,
      sql`is_organic = ${state.is_organic}`,
      sql`no_added_sulfites = ${state.no_added_sulfites}`,
      sql`description = ${state.description}`,
      sql`is_active = ${state.is_active}`,
    ];
    if (state.code !== current.code) assignments.unshift(sql`code = ${state.code}`);
    tx.write(`UPDATE catalog.wine SET ${assignments.join(', ')} WHERE ${sql`id = CAST(${id} AS UUID)`}`);
    tx.audit({
      table: 'catalog.wine',
      rowId: id,
      action: 'UPDATE',
      before: current,
      after: { ...current, ...state },
    });
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('still referenced')) {
      throw domainError('WC_VALIDATION', { code: 'No se puede cambiar porque ya está en uso' });
    }
    throw error;
  }
  return requireWine(writer, id);
}

export async function requireWine(writer: Writer, id: string): Promise<Wine> {
  requireUuid(id);
  const rows = await writer.read(sql`
    SELECT id, code, name, color, category, pdo_pgi_name, is_single_plot, is_organic,
           no_added_sulfites, description, is_active, created_at
    FROM catalog.wine
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return toWine(row);
}

function parseWine(input: Record<string, unknown>, current: Wine | null, errors: FieldBag): WineState {
  const code = pickText(input, 'code', current?.code ?? null, errors, {
    required: true,
    pattern: CODE,
    patternMessage: 'Usa mayúsculas, dígitos o guion (2-20)',
  });
  const name = pickText(input, 'name', current?.name ?? null, errors, { required: true, min: 1, max: 120 });
  const color = pickEnum(input, 'color', current?.color ?? null, COLORS, errors);
  const category = pickEnum(input, 'category', current?.category ?? 'wine', CATEGORIES, errors);
  const pdo = pickText(input, 'pdo_pgi_name', current?.pdo_pgi_name ?? null, errors, { max: 120 });
  const single = pickBool(input, 'is_single_plot', current?.is_single_plot ?? false, errors);
  const organic = pickBool(input, 'is_organic', current?.is_organic ?? true, errors);
  const sulfites = pickBool(input, 'no_added_sulfites', current?.no_added_sulfites ?? false, errors);
  const description = pickText(input, 'description', current?.description ?? null, errors, { max: 4000 });
  const active = pickBool(input, 'is_active', current?.is_active ?? true, errors);
  return {
    code: code ?? '',
    name: name ?? '',
    color: color ?? '',
    category: category ?? 'wine',
    pdo_pgi_name: pdo,
    is_single_plot: single,
    is_organic: organic,
    no_added_sulfites: sulfites,
    description,
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

function pickBool(input: Record<string, unknown>, key: string, current: boolean, errors: FieldBag): boolean {
  if (!hasKey(input, key)) return current;
  return boolValue(input[key], key, errors) ?? current;
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
    return (current as T | null) ?? null;
  }
  return enumValue(input[key], key, allowed, errors);
}

function toWine(row: Record<string, unknown>): Wine {
  return {
    id: asString(row.id),
    code: asString(row.code),
    name: asString(row.name),
    color: asString(row.color),
    category: asString(row.category),
    pdo_pgi_name: asNullableString(row.pdo_pgi_name),
    is_single_plot: asBool(row.is_single_plot),
    is_organic: asBool(row.is_organic),
    no_added_sulfites: asBool(row.no_added_sulfites),
    description: asNullableString(row.description),
    is_active: asBool(row.is_active),
    created_at: asString(row.created_at),
  };
}
