import { domainError } from '../errors';

const KEY = /^[a-z][a-z0-9_]{0,40}$/;
const FORBIDDEN_KEY =
  /(^|_)(emails?|e_mail|phones?|telephones?|tax_ids?|nifs?|nies?|ibans?|eoris?|names?|nombres?|legal_name|trade_name|full_name|display_name|addresses?|postal_code|city|notes|correo|telefono)($|_)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const TAX_ID = /^(?:\d{8}[A-Z]|[A-Z]\d{7}[A-Z0-9])$/i;
const LINK = /^\/[A-Za-z0-9._~/-]{1,180}$/;

const MAX_DEPTH = 6;
const MAX_NODES = 40;

export function assertEventPayload(payload: Record<string, unknown>): void {
  walk(payload, 'payload', 0);
}

export function safeLink(payload: Record<string, unknown>): string | null {
  const link = payload.link;
  return typeof link === 'string' && LINK.test(link) ? link : null;
}

export function amountText(payload: Record<string, unknown>): string | null {
  const value = payload.amount;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const text = Object.is(value, -0) ? '0' : String(value);
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(text)) return null;
  return text;
}

function walk(value: unknown, path: string, depth: number): void {
  if (depth > MAX_DEPTH) reject(path);
  if (value === null) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject(path);
    return;
  }
  if (typeof value === 'string') {
    if (!isSafeString(value)) reject(path);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_NODES) reject(path);
    value.forEach((item, index) => walk(item, `${path}.${index}`, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_NODES) reject(path);
    for (const [key, child] of entries) {
      if (!KEY.test(key) || FORBIDDEN_KEY.test(key)) reject(`${path}.${key}`);
      walk(child, `${path}.${key}`, depth + 1);
    }
    return;
  }
  reject(path);
}

function isSafeString(value: string): boolean {
  if (UUID.test(value)) return true;
  if (LINK.test(value)) return true;
  if (!IDENT.test(value)) return false;
  if (TAX_ID.test(value)) return false;
  if (isPhone(value)) return false;
  return true;
}

function isPhone(value: string): boolean {
  const digits = value.replace(/[()\s-]/g, '');
  return /^\+?\d{9,15}$/.test(digits);
}

function reject(path: string): never {
  throw domainError('WC_VALIDATION', {
    [path]: 'El evento solo puede llevar identificadores, importes y enlaces',
  });
}
