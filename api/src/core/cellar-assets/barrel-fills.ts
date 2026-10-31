import { auditInsert, auditUpdate, intOf, isUuid, uuidList } from '../cellar/service/http';
import type { Tx } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';

export interface BarrelFillMove {
  vessel_id: string | null;
  volume_ml: number;
  lot_id: string | null;
  occurred_at: string;
}

/**
 * A lot that enters an empty barrel counts as one fill (one use).
 *
 * Called from operation confirm, inside the same `withWrite`, after the stock
 * moves are queued. Those writes stay buffered until commit, so `tx.read`
 * still sees the balance from before this operation. That is the empty check.
 * Do not run this after commit: the barrel would already look full.
 */
export async function noteBarrelFills(
  tx: Tx,
  moves: readonly BarrelFillMove[],
  operationId: string,
  actorId: string,
): Promise<void> {
  if (!isUuid(operationId)) return;
  const delta = new Map<string, { volume: number; lotId: string | null; at: string }>();
  for (const move of moves) {
    if (!move.vessel_id || !isUuid(move.vessel_id)) continue;
    if (!Number.isSafeInteger(move.volume_ml) || move.volume_ml === 0) continue;
    const id = move.vessel_id.toLowerCase();
    const current = delta.get(id) ?? { volume: 0, lotId: null, at: move.occurred_at };
    const volume = current.volume + move.volume_ml;
    if (!Number.isSafeInteger(volume)) {
      throw domainError('WC_VALIDATION', { volume_ml: 'Volumen fuera de rango' });
    }
    delta.set(id, {
      volume,
      lotId: move.volume_ml > 0 && move.lot_id && isUuid(move.lot_id) ? move.lot_id.toLowerCase() : current.lotId,
      at: move.occurred_at > current.at ? move.occurred_at : current.at,
    });
  }
  const positive = [...delta.entries()].filter(([, row]) => row.volume > 0);
  if (positive.length === 0) return;

  const barrels = await tx.read<{ id: string }>(`
    SELECT id::VARCHAR AS id
    FROM cellar.vessel
    WHERE kind = 'barrel' AND id IN (${uuidList(positive.map(([id]) => id))})
  `);
  const barrelIds = new Set(barrels.map((row) => row.id.toLowerCase()));
  const targets = positive.filter(([id]) => barrelIds.has(id));
  if (targets.length === 0) return;
  const targetIds = targets.map(([id]) => id);

  const beforeRows = await tx.read<{ vessel_id: string; volume_ml: string }>(`
    SELECT vessel_id::VARCHAR AS vessel_id, coalesce(sum(volume_ml), 0)::VARCHAR AS volume_ml
    FROM inventory.stock_move
    WHERE vessel_id IN (${uuidList(targetIds)})
    GROUP BY vessel_id
  `);
  const before = new Map(beforeRows.map((row) => [row.vessel_id.toLowerCase(), intOf(row.volume_ml)]));

  const already = await tx.read<{ vessel_id: string }>(`
    SELECT vessel_id::VARCHAR AS vessel_id
    FROM cellar.barrel_fill
    WHERE operation_id = CAST('${operationId.toLowerCase()}' AS UUID)
      AND vessel_id IN (${uuidList(targetIds)})
  `);
  const seen = new Set(already.map((row) => row.vessel_id.toLowerCase()));

  for (const [vesselId, row] of targets) {
    if (seen.has(vesselId)) continue;
    const previous = before.get(vesselId) ?? 0;
    const after = previous + row.volume;
    if (previous > 0 || after <= 0) continue;

    const fillId = newId();
    const lotId = row.lotId;
    auditInsert(tx, 'cellar.barrel_fill', fillId, {
      id: fillId,
      vessel_id: vesselId,
      operation_id: operationId.toLowerCase(),
      lot_id: lotId,
      filled_at: row.at,
    }, sql`
      INSERT INTO cellar.barrel_fill (id, vessel_id, operation_id, lot_id, filled_at, created_by)
      VALUES (
        CAST(${fillId} AS UUID),
        CAST(${vesselId} AS UUID),
        CAST(${operationId} AS UUID),
        CAST(${lotId} AS UUID),
        CAST(${row.at} AS TIMESTAMPTZ),
        ${actorId}
      )
    `);

    const sheets = await tx.read<{ use_count: unknown }>(sql`
      SELECT use_count
      FROM cellar.barrel
      WHERE vessel_id = CAST(${vesselId} AS UUID)
    `);
    const sheet = sheets[0];
    if (!sheet) continue;
    const useCount = intOf(sheet.use_count);
    const next = useCount + 1;
    auditUpdate(tx, 'cellar.barrel', vesselId, { use_count: useCount }, { use_count: next }, sql`
      UPDATE cellar.barrel
      SET use_count = ${next}
      WHERE vessel_id = CAST(${vesselId} AS UUID)
    `);
  }
}
