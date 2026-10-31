import { isUuid } from '../catalog/fields';
import { ancestorLotIds } from '../cellar/service/lots';
import { uuidList } from '../cellar/service/http';
import { asRecord, asText, tableExists, type SqlReader } from './rows';

export interface ParcelRef {
  id: string;
  code: string;
  name: string;
}

function parcelIdFromDetails(details: unknown): string | null {
  const record = asRecord(details);
  const raw = record.parcel_id ?? record.parcelId;
  if (typeof raw !== 'string' || !isUuid(raw)) return null;
  return raw.toLowerCase();
}

async function parcelRows(reader: SqlReader, ids: readonly string[]): Promise<ParcelRef[]> {
  if (ids.length === 0) return [];
  if (!(await tableExists(reader, 'vineyard', 'parcel'))) return [];
  const rows = await reader.read<{ id: string; code: string; name: string }>(`
    SELECT id::VARCHAR AS id, code, name
    FROM vineyard.parcel
    WHERE id IN (${uuidList([...ids])})
  `);
  return rows
    .map((row) => ({
      id: String(row.id).toLowerCase(),
      code: String(row.code),
      name: String(row.name),
    }))
    .sort((a, b) => a.code.localeCompare(b.code, 'es'));
}

async function parcelIdsForLots(reader: SqlReader, lotIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(lotIds.map((id) => id.toLowerCase()).filter((id) => isUuid(id)))];
  const found = new Set<string>();
  if (ids.length === 0) return found;
  if (await tableExists(reader, 'vineyard', 'harvest')) {
    const rows = await reader.read<{ parcel_id: string }>(`
      SELECT DISTINCT h.parcel_id::VARCHAR AS parcel_id
      FROM inventory.lot l
      JOIN vineyard.harvest h ON h.reception_operation_id = l.created_by_operation_id
      WHERE l.id IN (${uuidList(ids)})
        AND h.parcel_id IS NOT NULL
    `);
    for (const row of rows) {
      const id = asText(row.parcel_id);
      if (id && isUuid(id)) found.add(id.toLowerCase());
    }
  }
  const details = await reader.read<{ details: unknown }>(`
    SELECT o.details
    FROM inventory.lot l
    JOIN cellar.operation o ON o.id = l.created_by_operation_id
    WHERE l.id IN (${uuidList(ids)})
  `);
  for (const row of details) {
    const parcelId = parcelIdFromDetails(row.details);
    if (parcelId) found.add(parcelId);
  }
  return found;
}

/** Parcels reached by this lot and its ancestors (the cellar genealogy walk). */
export async function originParcels(reader: SqlReader, lotId: string): Promise<ParcelRef[]> {
  const ancestors = await ancestorLotIds(reader, lotId);
  const ids = await parcelIdsForLots(reader, [lotId, ...ancestors]);
  return parcelRows(reader, [...ids]);
}

/**
 * Every lot mapped to the parcels of its ancestor closure.
 * Same parent walk as `ancestorLotIds`, in one pass for the vintage report.
 */
export async function traceLotParcels(reader: SqlReader): Promise<Map<string, string[]>> {
  const found = new Map<string, Set<string>>();
  const add = (lotId: string, parcelId: string) => {
    const lot = lotId.toLowerCase();
    const parcel = parcelId.toLowerCase();
    if (!isUuid(lot) || !isUuid(parcel)) return;
    const set = found.get(lot) ?? new Set<string>();
    set.add(parcel);
    found.set(lot, set);
  };
  if (await tableExists(reader, 'vineyard', 'harvest')) {
    const rows = await reader.read<{ lot_id: string; parcel_id: string }>(`
      WITH RECURSIVE walk AS (
        SELECT id AS lot_id, id AS ancestor_id, 0 AS depth
        FROM inventory.lot
        UNION ALL
        SELECT walk.lot_id, e.parent_lot_id, walk.depth + 1
        FROM inventory.lot_edge e
        JOIN walk ON e.child_lot_id = walk.ancestor_id
        WHERE walk.depth < 32
      )
      SELECT DISTINCT walk.lot_id::VARCHAR AS lot_id, h.parcel_id::VARCHAR AS parcel_id
      FROM walk
      JOIN inventory.lot anc ON anc.id = walk.ancestor_id
      JOIN vineyard.harvest h ON h.reception_operation_id = anc.created_by_operation_id
      WHERE h.parcel_id IS NOT NULL
    `);
    for (const row of rows) add(String(row.lot_id), String(row.parcel_id));
  }
  const details = await reader.read<{ lot_id: string; details: unknown }>(`
    WITH RECURSIVE walk AS (
      SELECT id AS lot_id, id AS ancestor_id, 0 AS depth
      FROM inventory.lot
      UNION ALL
      SELECT walk.lot_id, e.parent_lot_id, walk.depth + 1
      FROM inventory.lot_edge e
      JOIN walk ON e.child_lot_id = walk.ancestor_id
      WHERE walk.depth < 32
    )
    SELECT DISTINCT walk.lot_id::VARCHAR AS lot_id, o.details
    FROM walk
    JOIN inventory.lot anc ON anc.id = walk.ancestor_id
    JOIN cellar.operation o ON o.id = anc.created_by_operation_id
  `);
  for (const row of details) {
    const parcelId = parcelIdFromDetails(row.details);
    if (parcelId) add(String(row.lot_id), parcelId);
  }
  return new Map([...found].map(([lotId, parcels]) => [lotId, [...parcels].sort()]));
}
