import { actorFor, auditInsert, auditUpdate, intOf, uuidList } from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { newId } from '../ids';

export interface UseCountBackfill {
  barrels: number;
  fills_added: number;
  updated: number;
  unchanged: number;
}

interface Sheet {
  vesselId: string;
  useCount: number;
}

interface FillKey {
  vesselId: string;
  operationId: string;
}

interface Move {
  id: string;
  vesselId: string;
  operationId: string;
  at: string;
  volume: number;
  lotId: string | null;
}

/**
 * Deja `use_count` igual al número de llenados (historial `cellar.barrel_fill`
 * más los cruces de vacío a lleno que falten en el libro). Repetir no cambia
 * el resultado.
 */
export async function backfillBarrelUseCounts(writer: Writer, request: Request): Promise<UseCountBackfill> {
  const actor = actorFor(request, 'recuento de usos de barrica');
  return writer.withWrite(actor, async (tx) => {
    const sheets = await tx.read<{ vessel_id: string; use_count: unknown }>(`
      SELECT vessel_id::VARCHAR AS vessel_id, use_count
      FROM cellar.barrel
    `);
    const barrels: Sheet[] = sheets.map((row) => ({
      vesselId: String(row.vessel_id).toLowerCase(),
      useCount: intOf(row.use_count),
    }));
    const existingRows = barrels.length === 0
      ? []
      : await tx.read<{ vessel_id: string; operation_id: string }>(`
        SELECT vessel_id::VARCHAR AS vessel_id, operation_id::VARCHAR AS operation_id
        FROM cellar.barrel_fill
        WHERE vessel_id IN (${uuidList(barrels.map((row) => row.vesselId))})
      `);
    const existing = new Map<string, Set<string>>();
    for (const row of existingRows) {
      const vesselId = String(row.vessel_id).toLowerCase();
      const operationId = String(row.operation_id).toLowerCase();
      const set = existing.get(vesselId) ?? new Set<string>();
      set.add(operationId);
      existing.set(vesselId, set);
    }
    const discovered = discoverFills(await loadMoves(tx, barrels.map((row) => row.vesselId)));
    let fillsAdded = 0;
    let updated = 0;
    for (const sheet of barrels) {
      const known = new Set(existing.get(sheet.vesselId) ?? []);
      const found = discovered.get(sheet.vesselId);
      if (found) {
        for (const [operationId, fill] of found) {
          if (known.has(operationId)) continue;
          const fillId = newId();
          const key: FillKey = { vesselId: sheet.vesselId, operationId };
          auditInsert(tx, 'cellar.barrel_fill', fillId, {
            id: fillId,
            vessel_id: key.vesselId,
            operation_id: key.operationId,
            lot_id: fill.lotId,
            filled_at: fill.at,
            backfill: true,
          }, sql`
            INSERT INTO cellar.barrel_fill (id, vessel_id, operation_id, lot_id, filled_at, created_by)
            VALUES (
              CAST(${fillId} AS UUID),
              CAST(${key.vesselId} AS UUID),
              CAST(${key.operationId} AS UUID),
              CAST(${fill.lotId} AS UUID),
              CAST(${fill.at} AS TIMESTAMPTZ),
              ${actor.id}
            )
          `);
          known.add(operationId);
          fillsAdded += 1;
        }
      }
      const next = known.size;
      if (next === sheet.useCount) continue;
      auditUpdate(tx, 'cellar.barrel', sheet.vesselId, { use_count: sheet.useCount }, { use_count: next }, sql`
        UPDATE cellar.barrel
        SET use_count = ${next}
        WHERE vessel_id = CAST(${sheet.vesselId} AS UUID)
      `);
      updated += 1;
    }
    const result: UseCountBackfill = {
      barrels: barrels.length,
      fills_added: fillsAdded,
      updated,
      unchanged: barrels.length - updated,
    };
    tx.audit({
      table: 'cellar.barrel',
      rowId: null,
      action: 'EVENT',
      before: null,
      after: { backfill: 'use_count', ...result },
    });
    return result;
  });
}

async function loadMoves(tx: { read<T>(statement: string): Promise<T[]> }, vesselIds: string[]): Promise<Move[]> {
  if (vesselIds.length === 0) return [];
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT m.id::VARCHAR AS id, m.vessel_id::VARCHAR AS vessel_id, m.source_id::VARCHAR AS operation_id,
           m.occurred_at::VARCHAR AS occurred_at, m.volume_ml::VARCHAR AS volume_ml,
           m.lot_id::VARCHAR AS lot_id
    FROM inventory.stock_move m
    JOIN cellar.operation o ON o.id = m.source_id AND o.status = 'confirmed'
    WHERE m.source_table = 'cellar.operation'
      AND m.vessel_id IN (${uuidList(vesselIds)})
    ORDER BY m.occurred_at, m.id
  `);
  return rows.map((row) => ({
    id: String(row.id).toLowerCase(),
    vesselId: String(row.vessel_id).toLowerCase(),
    operationId: String(row.operation_id).toLowerCase(),
    at: String(row.occurred_at),
    volume: intOf(row.volume_ml),
    lotId: row.lot_id == null ? null : String(row.lot_id).toLowerCase(),
  }));
}

function discoverFills(moves: readonly Move[]): Map<string, Map<string, { at: string; lotId: string | null }>> {
  const byVessel = new Map<string, Move[]>();
  for (const move of moves) {
    const list = byVessel.get(move.vesselId) ?? [];
    list.push(move);
    byVessel.set(move.vesselId, list);
  }
  const found = new Map<string, Map<string, { at: string; lotId: string | null }>>();
  for (const [vesselId, list] of byVessel) {
    list.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
    let volume = 0;
    const fills = new Map<string, { at: string; lotId: string | null }>();
    for (const move of list) {
      const previous = volume;
      volume += move.volume;
      if (previous <= 0 && volume > 0 && !fills.has(move.operationId)) {
        fills.set(move.operationId, { at: move.at, lotId: move.lotId });
      }
    }
    if (fills.size > 0) found.set(vesselId, fills);
  }
  return found;
}
