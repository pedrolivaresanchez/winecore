import { sql } from '../db/sql';
import { domainError } from '../errors';
import { asId, asInt, asText } from './rows';
import { invalid } from './validate';

type Read = {
  read<T = Record<string, unknown>>(statement: string): Promise<T[]>;
};

export interface LotRef {
  id: string;
  code: string;
  wine_id: string | null;
  vintage: number | null;
}

export interface ProductRef {
  id: string;
  wine_id: string | null;
  vintage: number | null;
}

export async function requireRow(read: Read, table: string, id: string, field: string): Promise<void> {
  const rows = await read.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM ${sql.raw(table)} WHERE id = CAST(${id} AS UUID) LIMIT 1
  `);
  if (!rows[0]) invalid({ [field]: 'No existe' });
}

export async function loadLot(read: Read, id: string): Promise<LotRef | null> {
  const rows = await read.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, wine_id::VARCHAR AS wine_id, vintage
    FROM inventory.lot
    WHERE id = CAST(${id} AS UUID)
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: asId(row.id),
    code: asText(row.code),
    wine_id: row.wine_id == null ? null : asId(row.wine_id),
    vintage: asInt(row.vintage),
  };
}

export async function findLotByCode(read: Read, code: string): Promise<LotRef | null> {
  const rows = await read.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, wine_id::VARCHAR AS wine_id, vintage
    FROM inventory.lot
    WHERE code = ${code}
  `);
  if (rows.length > 1) invalid({ lot_code: 'Hay varios lotes con este código' });
  const row = rows[0];
  if (!row) return null;
  return {
    id: asId(row.id),
    code: asText(row.code),
    wine_id: row.wine_id == null ? null : asId(row.wine_id),
    vintage: asInt(row.vintage),
  };
}

export async function findByCode(read: Read, table: string, code: string, field: string): Promise<string | null> {
  const rows = await read.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM ${sql.raw(table)} WHERE code = ${code} LIMIT 2
  `);
  if (rows.length > 1) invalid({ [field]: 'Hay varias filas con este código' });
  const row = rows[0];
  return row ? asId(row.id) : null;
}

export async function loadProduct(read: Read, id: string): Promise<ProductRef | null> {
  const rows = await read.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, wine_id::VARCHAR AS wine_id, vintage
    FROM catalog.product
    WHERE id = CAST(${id} AS UUID)
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: asId(row.id),
    wine_id: row.wine_id == null ? null : asId(row.wine_id),
    vintage: asInt(row.vintage),
  };
}

export async function loadUserName(read: Read, id: string): Promise<string | null> {
  const rows = await read.read<{ display_name: string }>(sql`
    SELECT display_name FROM core.app_user WHERE id = CAST(${id} AS UUID) LIMIT 1
  `);
  const row = rows[0];
  return row ? asText(row.display_name) : null;
}

export async function requireAttachment(read: Read, id: string, field: string): Promise<void> {
  const rows = await read.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.attachment WHERE id = CAST(${id} AS UUID) LIMIT 1
  `);
  if (!rows[0]) throw domainError('WC_VALIDATION', { [field]: 'El adjunto no existe' });
}
