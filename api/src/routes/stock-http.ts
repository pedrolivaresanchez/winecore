import { requestIdFor, sessionOf } from '../auth/guard';
import type { Actor } from '../core/db/writer';
import { DomainError } from '../core/errors';
import { isBusinessDate, isInstant } from '../core/inventory/periods';
import type { BalanceQuery, FiscalQuery, MoveQuery } from '../core/inventory/service/stock.service';
import { assertState } from '../core/inventory/service/stock.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function actorFrom(request: Request): Actor {
  const user = sessionOf(request);
  return { type: 'user', id: user.id, requestId: requestIdFor(request) };
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 2_000_000) {
    throw new DomainError('WC_VALIDATION', 422, 'El cuerpo es demasiado grande.', { body: 'Demasiado grande' });
  }
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainError('WC_VALIDATION', 422, 'JSON no válido.', { body: 'JSON no válido' });
  }
}

export function countId(params: { id?: string }): string {
  const id = params.id?.trim().toLowerCase() ?? '';
  if (!UUID.test(id)) {
    throw new DomainError('WC_VALIDATION', 422, 'Identificador de aforo no válido.', { id: 'UUID no válido' });
  }
  return id;
}

function param(url: URL, ...names: string[]): string | null {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value !== null && value.trim() !== '') return value.trim();
  }
  return null;
}

function uuidParam(value: string | null, field: string): string | null {
  if (value === null) return null;
  if (!UUID.test(value)) {
    throw new DomainError('WC_VALIDATION', 422, 'Identificador no válido.', { [field]: 'UUID no válido' });
  }
  return value.toLowerCase();
}

export function parseLimit(value: string | null, fallback: number, max: number): number {
  if (value === null || value.trim() === '') return fallback;
  if (!/^\d{1,4}$/.test(value)) {
    throw new DomainError('WC_VALIDATION', 422, 'El límite no es válido.', { limit: `Entero entre 1 y ${max}` });
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > max) {
    throw new DomainError('WC_VALIDATION', 422, 'El límite no es válido.', { limit: `Entero entre 1 y ${max}` });
  }
  return parsed;
}

export function parseAt(value: string | null): string {
  if (value === null || value.trim() === '') return new Date().toISOString();
  const text = value.trim();
  if (!isBusinessDate(text) && !isInstant(text)) {
    throw new DomainError('WC_VALIDATION', 422, 'La fecha de existencias debe ser un día o un instante con zona horaria.', { at: text });
  }
  return text;
}

function cursorOf(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  return value.trim();
}

export function balanceQuery(request: Request, fallbackLimit: number): BalanceQuery {
  const url = new URL(request.url);
  return {
    at: parseAt(param(url, 'at')),
    locationId: uuidParam(param(url, 'location_id'), 'location_id'),
    vesselId: uuidParam(param(url, 'vessel_id'), 'vessel_id'),
    owner: param(url, 'owner', 'owner_entity_id'),
    productId: uuidParam(param(url, 'product_id'), 'product_id'),
    lotId: uuidParam(param(url, 'lot_id'), 'lot_id'),
    state: assertState(param(url, 'state', 'product_state')),
    limit: parseLimit(param(url, 'limit'), fallbackLimit, 1000),
    cursor: cursorOf(param(url, 'cursor')),
  };
}

export function fiscalQuery(request: Request): FiscalQuery {
  const url = new URL(request.url);
  return {
    at: parseAt(param(url, 'at')),
    taxWarehouseId: uuidParam(param(url, 'tax_warehouse_id'), 'tax_warehouse_id'),
    productId: uuidParam(param(url, 'product_id'), 'product_id'),
    lotId: uuidParam(param(url, 'lot_id'), 'lot_id'),
    limit: parseLimit(param(url, 'limit'), 100, 1000),
    cursor: cursorOf(param(url, 'cursor')),
  };
}

export function moveQuery(request: Request): MoveQuery {
  const url = new URL(request.url);
  const book = param(url, 'book');
  if (book !== 'physical' && book !== 'fiscal') {
    throw new DomainError('WC_VALIDATION', 422, 'El libro debe ser physical o fiscal.', { book: book ?? 'vacío' });
  }
  const source = param(url, 'source');
  let sourceId: string | null = null;
  let sourceTable: string | null = null;
  if (source) {
    if (UUID.test(source)) sourceId = source.toLowerCase();
    else if (/^[a-z_]+\.[a-z_]+$/.test(source)) sourceTable = source;
    else throw new DomainError('WC_VALIDATION', 422, 'El origen no es válido.', { source: 'UUID o tabla' });
  }
  return {
    book,
    from: param(url, 'from'),
    to: param(url, 'to'),
    moveType: param(url, 'move_type'),
    lotId: uuidParam(param(url, 'lot_id'), 'lot_id'),
    productId: uuidParam(param(url, 'product_id'), 'product_id'),
    locationId: uuidParam(param(url, 'location_id'), 'location_id'),
    vesselId: uuidParam(param(url, 'vessel_id'), 'vessel_id'),
    owner: param(url, 'owner', 'owner_entity_id'),
    sourceId,
    sourceTable,
    silicieEntryId: uuidParam(param(url, 'silicie_entry_id'), 'silicie_entry_id'),
    limit: parseLimit(param(url, 'limit'), 50, 200),
    cursor: cursorOf(param(url, 'cursor')),
  };
}

export function formatOf(request: Request): 'json' | 'html' | 'csv' {
  const format = new URL(request.url).searchParams.get('format')?.trim().toLowerCase() ?? 'json';
  if (format === 'json' || format === 'html' || format === 'csv') return format;
  throw new DomainError('WC_VALIDATION', 422, 'El formato no es válido.', { format });
}
