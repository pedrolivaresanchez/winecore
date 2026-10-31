import type { Actor, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { flag, idOf, instantOf, text } from './rows';

const CODE = /^[A-Z0-9-]{2,20}$/;
const COLORS = ['red', 'white'] as const;

export interface GrapeVariety {
  id: string;
  code: string;
  name: string;
  color: string;
  is_active: boolean;
  created_at: string;
}

export async function listVarieties(writer: Writer): Promise<{ items: GrapeVariety[]; total: number }> {
  const rows = await writer.read(`
    SELECT id::VARCHAR AS id, code, name, color, is_active, created_at
    FROM vineyard.grape_variety
    ORDER BY code
  `);
  return { items: rows.map(toVariety), total: rows.length };
}

export async function createVariety(writer: Writer, actor: Actor, body: Record<string, unknown>): Promise<GrapeVariety> {
  const state = parseVariety(body, null);
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const existing = await tx.read(sql`SELECT id FROM vineyard.grape_variety WHERE code = ${state.code}`);
    if (existing.length > 0) throw domainError('WC_VALIDATION', { code: 'Ya existe esta variedad' });
    tx.write(sql`
      INSERT INTO vineyard.grape_variety (id, code, name, color, is_active)
      VALUES (CAST(${id} AS UUID), ${state.code}, ${state.name}, ${state.color}, ${state.is_active})
    `);
    tx.audit({
      table: 'vineyard.grape_variety',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { id, ...state },
    });
  });
  return requireVariety(writer, state.code);
}

export async function updateVariety(
  writer: Writer,
  actor: Actor,
  code: string,
  body: Record<string, unknown>,
): Promise<GrapeVariety> {
  const current = await requireVariety(writer, code);
  const state = parseVariety(body, current);
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      UPDATE vineyard.grape_variety
      SET name = ${state.name}, color = ${state.color}, is_active = ${state.is_active}
      WHERE id = CAST(${current.id} AS UUID)
    `);
    tx.audit({
      table: 'vineyard.grape_variety',
      rowId: current.id,
      action: 'UPDATE',
      before: current,
      after: { ...current, ...state },
    });
  });
  return requireVariety(writer, current.code);
}

export async function requireVariety(writer: Writer, code: string): Promise<GrapeVariety> {
  const normalized = code.trim().toUpperCase();
  if (!CODE.test(normalized)) throw domainError('WC_NOT_FOUND');
  const rows = await writer.read(sql`
    SELECT id::VARCHAR AS id, code, name, color, is_active, created_at
    FROM vineyard.grape_variety
    WHERE code = ${normalized}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return toVariety(row);
}

export async function activeVariety(tx: { read<T>(statement: string): Promise<T[]> }, code: string): Promise<GrapeVariety> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name, color, is_active, created_at
    FROM vineyard.grape_variety
    WHERE code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_VALIDATION', { variety: 'La variedad no está en el catálogo' });
  const variety = toVariety(row);
  if (!variety.is_active) throw domainError('WC_VALIDATION', { variety: 'La variedad no está activa' });
  return variety;
}

function parseVariety(body: Record<string, unknown>, current: GrapeVariety | null): Omit<GrapeVariety, 'id' | 'created_at'> {
  const code = current?.code ?? upperCode(body.code, 'code');
  const name = requiredText(body.name ?? current?.name, 'name', 80);
  const colorValue = body.color ?? current?.color;
  if (typeof colorValue !== 'string' || !(COLORS as readonly string[]).includes(colorValue)) {
    throw domainError('WC_VALIDATION', { color: 'El color es red o white' });
  }
  const isActive = body.is_active === undefined ? (current?.is_active ?? true) : body.is_active === true;
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
    throw domainError('WC_VALIDATION', { is_active: 'Tiene que ser sí o no' });
  }
  return { code, name, color: colorValue, is_active: isActive };
}

function upperCode(value: unknown, field: string): string {
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Es obligatorio' });
  const code = value.trim().toUpperCase();
  if (!CODE.test(code)) throw domainError('WC_VALIDATION', { [field]: 'Usa mayúsculas, dígitos o guion (2-20)' });
  return code;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw domainError('WC_VALIDATION', { [field]: 'Es obligatorio' });
  const trimmed = value.trim();
  if (trimmed.length === 0) throw domainError('WC_VALIDATION', { [field]: 'Es obligatorio' });
  if (trimmed.length > max) throw domainError('WC_VALIDATION', { [field]: `Máximo ${max} caracteres` });
  return trimmed;
}

function toVariety(row: Record<string, unknown>): GrapeVariety {
  return {
    id: idOf(row.id),
    code: text(row.code),
    name: text(row.name),
    color: text(row.color),
    is_active: flag(row.is_active),
    created_at: instantOf(row.created_at),
  };
}
