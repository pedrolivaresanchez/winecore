import { Decimal } from 'decimal.js';
import type { UserCtx } from '../auth/permissions';
import { canonicalJson } from '../db/audit';
import { sql } from '../db/sql';
import type { Actor, Tx } from '../db/writer';
import { DomainError, domainError } from '../errors';
import { sha256Hex } from '../hash';
import { newId } from '../ids';
import { takeNumber } from '../series';
import { businessDate } from '../time';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INCOTERMS = new Set(['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']);

export function actorOf(user: UserCtx, request: Request, reason?: string): Actor {
  return {
    type: 'user',
    id: user.id,
    requestId: request.headers.get('x-request-id') ?? newId(),
    ...(reason ? { reason } : {}),
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}

export function asRecord(raw: unknown, field = 'body'): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('WC_VALIDATION', { [field]: 'El cuerpo debe ser un objeto' });
  }
  return raw as Record<string, unknown>;
}

export function pathId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!UUID_RE.test(id)) throw domainError('WC_NOT_FOUND');
  return id;
}

export function bodyId(value: unknown, field: string, fields: Record<string, string>): string | null {
  if (typeof value !== 'string' || !UUID_RE.test(value.trim())) {
    fields[field] = 'Identificador no válido';
    return null;
  }
  return value.trim().toLowerCase();
}

export function fail(message: string, fields?: Record<string, string>): never {
  throw new DomainError('WC_VALIDATION', 422, message, fields);
}

export function boolOf(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === 't';
}

export function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

export function idOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text.toLowerCase();
}

export function dateOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match?.[1] ?? String(value);
}

export function decOf(value: unknown): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === 'bigint') return new Decimal(value.toString());
  if (typeof value === 'number' || typeof value === 'string') return new Decimal(value);
  return new Decimal(String(value));
}

export function textOf(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length === 0 ? null : text;
}

export function hashBody(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function isoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseDate(value: unknown, field: string, fields: Record<string, string>, required: boolean): string | null {
  if (value == null || value === '') {
    if (required) fields[field] = 'La fecha es obligatoria';
    return null;
  }
  if (typeof value !== 'string' || !isoDate(value)) {
    fields[field] = 'La fecha debe ser YYYY-MM-DD';
    return null;
  }
  return value;
}

export function parseDecimal(
  value: unknown,
  field: string,
  fields: Record<string, string>,
  required: boolean,
): Decimal | null {
  if (value == null || value === '') {
    if (required) fields[field] = 'El importe es obligatorio';
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    fields[field] = 'El importe no es válido';
    return null;
  }
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error('nan');
    return parsed;
  } catch {
    fields[field] = 'El importe no es válido';
    return null;
  }
}

export function optionalText(value: unknown, field: string, fields: Record<string, string>, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    fields[field] = 'Debe ser texto';
    return null;
  }
  const text = value.trim();
  if (text.length > max) fields[field] = `Máximo ${max} caracteres`;
  return text;
}

export function parseIncoterm(value: unknown, field: string, fields: Record<string, string>): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !INCOTERMS.has(value)) {
    fields[field] = 'Incoterm no válido';
    return null;
  }
  return value;
}

export function throwIf(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
}

export async function assignNumber(
  tx: Tx,
  legalEntityId: string,
  docType: string,
  date: Date,
): Promise<{ number: string; seriesId: string }> {
  const year = Number(businessDate(date).slice(0, 4));
  const rows = await tx.read<{ id: unknown; is_default: unknown }>(sql`
    SELECT id, is_default
    FROM core.number_series
    WHERE legal_entity_id = CAST(${legalEntityId} AS UUID)
      AND doc_type = ${docType}
      AND "year" = ${year}
      AND is_active
    ORDER BY is_default DESC, created_at
  `);
  const preferred = rows.find((row) => boolOf(row.is_default)) ?? rows[0];
  if (!preferred) throw domainError('WC010');
  const seriesId = idOf(preferred.id);
  const number = await takeNumber(tx, { legalEntityId, docType, date });
  return { number, seriesId };
}

export function outbox(
  tx: Tx,
  eventType: string,
  table: string,
  id: string,
  legalEntityId: string | null,
  payload: unknown,
  availableAt?: Date,
): void {
  const when = availableAt ?? new Date();
  tx.write(sql`
    INSERT INTO ops.outbox_event (
      event_type, aggregate_table, aggregate_id, legal_entity_id, payload, occurred_at, available_at
    ) VALUES (
      ${eventType}, ${table}, CAST(${id} AS UUID),
      CASE WHEN ${legalEntityId} IS NULL THEN NULL ELSE CAST(${legalEntityId} AS UUID) END,
      ${sql.json(payload)}, ${when}, ${when}
    )
  `);
}

export async function assertChannel(tx: Tx, code: string): Promise<void> {
  const rows = await tx.read<{ code: string }>(sql`
    SELECT code FROM sales.channel WHERE code = ${code} AND is_active
  `);
  if (!rows[0]) fail('El canal no existe', { channel: code });
}

export type CustomerRow = {
  id: string;
  legal_name: string;
  country_code: string;
  default_channel: string | null;
  default_price_list_id: string | null;
  is_customer: boolean;
  language: string;
};

export async function loadCustomer(tx: Tx, id: string): Promise<CustomerRow> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, legal_name, country_code, default_channel, default_price_list_id, is_customer, language
    FROM party.contact
    WHERE id = CAST(${id} AS UUID) AND archived_at IS NULL
  `);
  const row = rows[0];
  if (!row) fail('El cliente no existe', { customer_id: id });
  return {
    id: idOf(row.id),
    legal_name: String(row.legal_name),
    country_code: String(row.country_code),
    default_channel: textOf(row.default_channel),
    default_price_list_id: idOrNull(row.default_price_list_id),
    is_customer: boolOf(row.is_customer),
    language: String(row.language),
  };
}

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  name_en: string | null;
  kind: string;
  wine_id: string | null;
  requires_lot: boolean;
  is_stock_tracked: boolean;
  is_active: boolean;
  default_tax_code: string | null;
  gtin: string | null;
  unit: string;
  nominal_volume_ml: number | null;
};

export async function loadProduct(tx: Tx, id: string): Promise<ProductRow> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT p.id, p.sku, p.name, p.name_en, p.kind, p.wine_id, p.requires_lot, p.is_stock_tracked,
           p.is_active, p.default_tax_code, p.gtin, p.unit, f.nominal_volume_ml
    FROM catalog.product p
    LEFT JOIN catalog.format f ON f.id = p.format_id
    WHERE p.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) fail('El producto no existe', { product_id: id });
  const nominal = row.nominal_volume_ml == null ? null : Number(row.nominal_volume_ml);
  return {
    id: idOf(row.id),
    sku: String(row.sku),
    name: String(row.name),
    name_en: textOf(row.name_en),
    kind: String(row.kind),
    wine_id: idOrNull(row.wine_id),
    requires_lot: boolOf(row.requires_lot),
    is_stock_tracked: boolOf(row.is_stock_tracked),
    is_active: boolOf(row.is_active),
    default_tax_code: textOf(row.default_tax_code),
    gtin: textOf(row.gtin),
    unit: String(row.unit),
    nominal_volume_ml: nominal != null && Number.isFinite(nominal) ? nominal : null,
  };
}

export type LocationRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  tax_warehouse_id: string | null;
  controlling_entity_id: string;
  is_active: boolean;
};

export async function loadLocation(tx: Tx, id: string): Promise<LocationRow> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, code, name, kind, tax_warehouse_id, controlling_entity_id, is_active
    FROM inventory.location
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) fail('La ubicación no existe', { location_id: id });
  return {
    id: idOf(row.id),
    code: String(row.code),
    name: String(row.name),
    kind: String(row.kind),
    tax_warehouse_id: idOrNull(row.tax_warehouse_id),
    controlling_entity_id: idOf(row.controlling_entity_id),
    is_active: boolOf(row.is_active),
  };
}

export async function entityCode(tx: Tx, id: string): Promise<string | null> {
  const rows = await tx.read<{ code: string }>(sql`
    SELECT code FROM core.legal_entity WHERE id = CAST(${id} AS UUID)
  `);
  return rows[0] ? String(rows[0].code) : null;
}

export async function assertEntity(tx: Tx, id: string): Promise<string> {
  const code = await entityCode(tx, id);
  if (!code) fail('La entidad no existe', { legal_entity_id: id });
  return code;
}

export async function taxRateOf(tx: Tx, code: string): Promise<Decimal> {
  const rows = await tx.read<{ rate: unknown }>(sql`
    SELECT rate FROM billing.tax_code WHERE code = ${code} AND is_active
  `);
  const row = rows[0];
  if (!row) fail('El impuesto no existe', { tax_code: code });
  return decOf(row.rate);
}

export function moneyText(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function priceText(value: Decimal): string {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

export function qtyText(value: Decimal): string {
  return value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

export function newRowId(): string {
  return newId();
}
