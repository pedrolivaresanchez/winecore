import { domainError } from '../errors';

export function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

export function text(value: unknown): string {
  if (value == null) throw new Error('Texto ausente');
  return String(value);
}

export function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

export function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === 't';
}

export function integer(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  throw new Error('Entero ausente');
}

export function integerOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  return integer(value);
}

export function dayOf(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function instantOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;
  const parsed = new Date(raw.includes(' ') ? raw.replace(' ', 'T') : raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString();
}

export function objectOf(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      return null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

export interface FieldBag {
  add(field: string, message: string): void;
  throwIfAny(): void;
}

export function fieldBag(): FieldBag {
  const fields: Record<string, string> = {};
  return {
    add(field, message) {
      if (fields[field] === undefined) fields[field] = message;
    },
    throwIfAny() {
      if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
    },
  };
}
