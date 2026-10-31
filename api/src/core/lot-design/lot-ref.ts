import { isUuid } from '../catalog/fields';
import { sql } from '../db/sql';
import { DomainError, domainError } from '../errors';
import { asInt, asText, type SqlReader } from './rows';

const LOT_CODE = /^[A-Z0-9][A-Z0-9./-]{1,29}$/;

export interface LotRow {
  id: string;
  code: string;
  kind: string;
  wine_id: string | null;
  vintage: number | null;
  producer_entity_id: string;
  status: string;
  created_by_operation_id: string | null;
}

export async function requireLot(reader: SqlReader, code: string, producerId: string | null): Promise<LotRow> {
  if (!LOT_CODE.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await reader.read<Record<string, unknown>>(producerId
    ? sql`
      SELECT
        id::VARCHAR AS id, code, kind, wine_id::VARCHAR AS wine_id, vintage::VARCHAR AS vintage,
        producer_entity_id::VARCHAR AS producer_entity_id, status,
        created_by_operation_id::VARCHAR AS created_by_operation_id
      FROM inventory.lot
      WHERE code = ${code} AND producer_entity_id = CAST(${producerId} AS UUID)
    `
    : sql`
      SELECT
        id::VARCHAR AS id, code, kind, wine_id::VARCHAR AS wine_id, vintage::VARCHAR AS vintage,
        producer_entity_id::VARCHAR AS producer_entity_id, status,
        created_by_operation_id::VARCHAR AS created_by_operation_id
      FROM inventory.lot
      WHERE code = ${code}
    `);
  if (rows.length > 1) {
    throw new DomainError(
      'WC_VALIDATION',
      422,
      'Hay varios lotes con este código; indica producer_entity_id',
      { producer_entity_id: 'Indica el productor' },
    );
  }
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const id = asText(row.id);
  if (!id || !isUuid(id)) throw domainError('WC_NOT_FOUND');
  return {
    id: id.toLowerCase(),
    code: String(row.code),
    kind: String(row.kind),
    wine_id: asText(row.wine_id)?.toLowerCase() ?? null,
    vintage: asInt(row.vintage),
    producer_entity_id: String(row.producer_entity_id).toLowerCase(),
    status: String(row.status),
    created_by_operation_id: asText(row.created_by_operation_id)?.toLowerCase() ?? null,
  };
}
