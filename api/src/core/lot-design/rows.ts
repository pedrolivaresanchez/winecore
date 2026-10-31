import { sql } from '../db/sql';

const IDENT = /^[a-z_][a-z0-9_]*$/;

export interface SqlReader {
  read<T = Record<string, unknown>>(statement: string): Promise<T[]>;
}

export async function tableExists(reader: SqlReader, schema: string, table: string): Promise<boolean> {
  if (!IDENT.test(schema) || !IDENT.test(table)) return false;
  const rows = await reader.read<{ n: unknown }>(sql`
    SELECT count(*)::VARCHAR AS n
    FROM information_schema.tables
    WHERE table_schema = ${schema} AND table_name = ${table}
  `);
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function columnSet(reader: SqlReader, schema: string, table: string): Promise<Set<string>> {
  if (!IDENT.test(schema) || !IDENT.test(table)) return new Set();
  const rows = await reader.read<{ column_name: string }>(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${table}
  `);
  return new Set(rows.map((row) => String(row.column_name)));
}

export function asNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asInt(value: unknown): number | null {
  const parsed = asNum(value);
  if (parsed == null) return null;
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}

export function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === 'true';
}

export function asText(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return text.length === 0 ? null : text;
}

export function asCivil(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match?.[1] ?? null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function stringList(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

export function roundTo(value: number, scale: number): number {
  const factor = 10 ** scale;
  return Math.round(value * factor) / factor;
}

export function gramsPerHectolitre(dose: number, unit: string): number | null {
  if (unit === 'g/hl') return roundTo(dose, 3);
  if (unit === 'mg/l') return roundTo(dose / 10, 3);
  if (unit === 'g/l') return roundTo(dose * 100, 3);
  return null;
}
