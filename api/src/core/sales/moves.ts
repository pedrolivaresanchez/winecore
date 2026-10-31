import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { DomainError } from '../errors';
import { findNegativeBalances } from '../inventory/balances';
import { assertPeriodOpen } from '../inventory/periods';
import { loadLocks, loadStockMoves } from '../inventory/service/rows';
import type { ProductState, StockMove } from '../inventory/types';
import { idOf, newRowId } from './db';

export type MoveDraft = {
  move_type: StockMove['move_type'];
  location_id: string;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string;
  product_state: ProductState;
  qty_units: number;
  volume_ml: number;
  source_line_id: string | null;
  reverses_move_id?: string | null;
  loss_kind?: 'incident' | 'authorized' | null;
};

export function stockMove(noteId: string, occurredAt: string, actorId: string, draft: MoveDraft): StockMove {
  return {
    id: newRowId(),
    occurred_at: occurredAt,
    move_type: draft.move_type,
    location_id: draft.location_id,
    vessel_id: null,
    owner_entity_id: draft.owner_entity_id,
    lot_id: draft.lot_id,
    product_id: draft.product_id,
    product_state: draft.product_state,
    qty_units: draft.qty_units,
    volume_ml: draft.volume_ml,
    mass_g: 0,
    loss_kind: draft.loss_kind ?? null,
    source_table: 'sales.delivery_note',
    source_id: noteId,
    source_line_id: draft.source_line_id,
    reverses_move_id: draft.reverses_move_id ?? null,
    created_by: actorId,
  };
}

export async function assertPhysical(tx: Tx, planned: readonly StockMove[]): Promise<void> {
  if (planned.length === 0) return;
  const locks = (await loadLocks(tx)).filter((lock) => lock.ledger === 'physical');
  for (const move of planned) assertPeriodOpen(move.occurred_at, locks);
  const existing = await loadStockMoves(tx, 'TRUE');
  const before = new Set(findNegativeBalances(existing).map(signature));
  const after = findNegativeBalances([...existing, ...planned]);
  const caused = after.filter((finding) => !before.has(signature(finding)));
  const first = caused[0];
  if (!first) return;
  const lotCode = await codeOf(tx, 'inventory.lot', first.lot_id);
  const locationCode = await codeOf(tx, 'inventory.location', first.location_id);
  throw new DomainError(
    'WC024',
    422,
    `No hay existencias suficientes del lote ${lotCode} en ${locationCode}`,
    { lot_id: first.lot_id ?? '', location_id: first.location_id ?? '' },
    caused,
  );
}

function signature(finding: { code: string; at: string; location_id: string | null; owner_entity_id: string | null; lot_id: string | null; product_id: string | null; product_state: string | null; qty_units: number; volume_ml: number }): string {
  return [
    finding.code,
    finding.at,
    finding.location_id,
    finding.owner_entity_id,
    finding.lot_id,
    finding.product_id,
    finding.product_state,
    finding.qty_units,
    finding.volume_ml,
  ].join('|');
}

async function codeOf(tx: Tx, table: 'inventory.lot' | 'inventory.location', id: string | null): Promise<string> {
  if (!id) return '—';
  const rows = await tx.read<{ code: string }>(sql`SELECT code FROM ${sql.raw(table)} WHERE id = CAST(${id} AS UUID)`);
  return rows[0] ? String(rows[0].code) : id.slice(0, 8);
}

export function writeStockMove(tx: Tx, move: StockMove, now: Date): void {
  const id = move.id ?? newRowId();
  tx.write(sql`
    INSERT INTO inventory.stock_move (
      id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
      product_state, qty_units, volume_ml, mass_g, loss_kind, source_table, source_id,
      source_line_id, reverses_move_id, created_by, created_at
    ) VALUES (
      CAST(${id} AS UUID), CAST(${move.occurred_at} AS TIMESTAMPTZ), ${move.move_type},
      CAST(${move.location_id} AS UUID),
      CASE WHEN ${move.vessel_id} IS NULL THEN NULL ELSE CAST(${move.vessel_id} AS UUID) END,
      CAST(${move.owner_entity_id} AS UUID),
      CASE WHEN ${move.lot_id} IS NULL THEN NULL ELSE CAST(${move.lot_id} AS UUID) END,
      CASE WHEN ${move.product_id} IS NULL THEN NULL ELSE CAST(${move.product_id} AS UUID) END,
      ${move.product_state}, ${move.qty_units}, ${move.volume_ml}, ${move.mass_g}, ${move.loss_kind},
      ${move.source_table}, CAST(${move.source_id} AS UUID),
      CASE WHEN ${move.source_line_id} IS NULL THEN NULL ELSE CAST(${move.source_line_id} AS UUID) END,
      CASE WHEN ${move.reverses_move_id} IS NULL THEN NULL ELSE CAST(${move.reverses_move_id} AS UUID) END,
      ${move.created_by}, ${now}
    )
  `);
  tx.audit({
    table: 'inventory.stock_move',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: {
      move_type: move.move_type,
      location_id: move.location_id,
      owner_entity_id: move.owner_entity_id,
      lot_id: move.lot_id,
      product_id: move.product_id,
      qty_units: move.qty_units,
      volume_ml: move.volume_ml,
      source_id: move.source_id,
    },
  });
}

export function reversalOf(move: StockMove, occurredAt: string, actorId: string): StockMove {
  return {
    ...move,
    id: newRowId(),
    occurred_at: occurredAt,
    move_type: 'reversal',
    qty_units: -move.qty_units,
    volume_ml: -move.volume_ml,
    mass_g: -move.mass_g,
    loss_kind: null,
    reverses_move_id: move.id ?? null,
    created_by: actorId,
    created_at: undefined,
  };
}

export async function onHand(
  tx: Tx,
  key: { locationId: string; ownerId: string; lotId: string | null; productId: string; state: string },
): Promise<number> {
  const moves = await loadStockMoves(tx, `location_id = CAST(${sql`${key.locationId}`} AS UUID)`);
  let qty = 0;
  for (const move of moves) {
    if (move.owner_entity_id !== key.ownerId) continue;
    if ((move.lot_id ?? null) !== key.lotId) continue;
    if ((move.product_id ?? null) !== key.productId) continue;
    if (move.product_state !== key.state) continue;
    if (move.vessel_id != null) continue;
    qty += move.qty_units;
  }
  return qty;
}

export async function entityByCode(tx: Tx): Promise<Map<string, string>> {
  const rows = await tx.read<{ id: unknown; code: string }>(sql`SELECT id, code FROM core.legal_entity`);
  return new Map(rows.map((row) => [String(row.code), idOf(row.id)]));
}
