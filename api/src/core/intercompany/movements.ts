import type { Decimal } from 'decimal.js';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { money } from '../money';
import { businessDate } from '../time';
import { inMadridPeriod } from './calendar';
import { asDecimal, dateText, uuidIn, uuidText } from './numbers';

/**
 * Input of the monthly settlement. The sales module is still in progress, so this
 * is the contract it will fill: every P.O → CVPO ownership change in the month.
 *
 * A row counts when an `ownership_out` of the seller is paired with an `ownership_in`
 * of the buyer for the same source, location, product and lot, and the out falls in
 * the month by Europe/Madrid civil date. A transfer delivery note from a seller
 * location to a buyer location counts on its issue date when no ownership move
 * exists yet for that line.
 */
export interface IntercompanyTransfer {
  sourceTable: 'sales.delivery_note_line' | 'inventory.stock_move';
  sourceId: string;
  productId: string;
  lotId: string | null;
  quantity: Decimal;
  occurredAt: string;
  occurredOn: string;
  documentNumber: string | null;
  deliveryNoteId: string | null;
}

export interface IntercompanyMovementQuery {
  sellerEntityId: string;
  buyerEntityId: string;
  periodStart: string;
  periodEnd: string;
}

export async function listPoToCvpoTransfers(
  tx: Tx,
  query: IntercompanyMovementQuery,
): Promise<IntercompanyTransfer[]> {
  const moves = await loadMoves(tx, query);
  const notes = await loadNotes(tx, query);
  const fromMoves = pairMoves(moves, query, notes);
  const coveredLines = new Set(fromMoves.map((row) => row.sourceId));
  const lineIds = notes.map((note) => note.lineId);
  const linked = await linesWithOwnership(tx, lineIds);
  const fromNotes = notes
    .filter((note) => note.kind === 'transfer')
    .filter((note) => note.fromEntityId === query.sellerEntityId && note.toEntityId === query.buyerEntityId)
    .filter((note) => !linked.has(note.lineId) && !coveredLines.has(note.lineId))
    .map((note) => noteTransfer(note));
  return [...fromMoves, ...fromNotes].sort((left, right) => {
    const byTime = left.occurredAt.localeCompare(right.occurredAt);
    return byTime === 0 ? left.sourceId.localeCompare(right.sourceId) : byTime;
  });
}

interface MoveRow {
  id: string;
  occurred_at: string;
  move_type: string;
  location_id: string;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  qty_units: number | string;
  volume_ml: number | string;
  source_table: string;
  source_id: string;
  source_line_id: string | null;
}

interface NoteRow {
  lineId: string;
  deliveryNoteId: string;
  number: string | null;
  kind: string;
  issueDate: string;
  productId: string;
  lotId: string | null;
  quantity: Decimal;
  fromEntityId: string;
  toEntityId: string | null;
}

async function loadMoves(tx: Tx, query: IntercompanyMovementQuery): Promise<MoveRow[]> {
  const from = new Date(`${query.periodStart}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - 2);
  const to = new Date(`${query.periodEnd}T00:00:00.000Z`);
  to.setUTCDate(to.getUTCDate() + 3);
  return tx.read<MoveRow>(sql`
    SELECT id, occurred_at, move_type, location_id, owner_entity_id, lot_id, product_id,
           qty_units, volume_ml, source_table, source_id, source_line_id
    FROM inventory.stock_move
    WHERE move_type IN ('ownership_out', 'ownership_in')
      AND owner_entity_id IN (CAST(${query.sellerEntityId} AS UUID), CAST(${query.buyerEntityId} AS UUID))
      AND occurred_at >= ${from}
      AND occurred_at < ${to}
  `);
}

async function loadNotes(tx: Tx, query: IntercompanyMovementQuery): Promise<NoteRow[]> {
  const rows = await tx.read<{
    line_id: string;
    delivery_note_id: string;
    number: string | null;
    kind: string;
    issue_date: string;
    product_id: string;
    lot_id: string | null;
    quantity: string;
    from_entity_id: string;
    to_entity_id: string | null;
  }>(sql`
    SELECT dnl.id AS line_id, dn.id AS delivery_note_id, dn.number, dn.kind, dn.issue_date,
           dnl.product_id, dnl.lot_id, dnl.quantity,
           fl.controlling_entity_id AS from_entity_id,
           tl.controlling_entity_id AS to_entity_id
    FROM sales.delivery_note dn
    JOIN sales.delivery_note_line dnl ON dnl.delivery_note_id = dn.id
    JOIN inventory.location fl ON fl.id = dn.from_location_id
    LEFT JOIN inventory.location tl ON tl.id = dn.to_location_id
    WHERE dn.status IN ('issued', 'shipped', 'delivered')
      AND dn.issue_date BETWEEN CAST(${query.periodStart} AS DATE) AND CAST(${query.periodEnd} AS DATE)
  `);
  return rows.map((row) => ({
    lineId: uuidText(row.line_id),
    deliveryNoteId: uuidText(row.delivery_note_id),
    number: row.number,
    kind: row.kind,
    issueDate: dateText(row.issue_date),
    productId: uuidText(row.product_id),
    lotId: row.lot_id == null ? null : uuidText(row.lot_id),
    quantity: asDecimal(row.quantity),
    fromEntityId: uuidText(row.from_entity_id),
    toEntityId: row.to_entity_id == null ? null : uuidText(row.to_entity_id),
  }));
}

function pairMoves(
  moves: readonly MoveRow[],
  query: IntercompanyMovementQuery,
  notes: readonly NoteRow[],
): IntercompanyTransfer[] {
  const noteByLine = new Map(notes.map((note) => [note.lineId, note]));
  const ins = moves.filter((move) => move.move_type === 'ownership_in' && uuidText(move.owner_entity_id) === query.buyerEntityId);
  const used = new Set<string>();
  const transfers: IntercompanyTransfer[] = [];
  for (const out of moves) {
    if (out.move_type !== 'ownership_out') continue;
    if (uuidText(out.owner_entity_id) !== query.sellerEntityId) continue;
    const occurredAt = new Date(out.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) continue;
    if (!inMadridPeriod(occurredAt, query.periodStart, query.periodEnd)) continue;
    const key = eventKey(out);
    const match = ins.find((inbound) => !used.has(uuidText(inbound.id)) && eventKey(inbound) === key);
    if (!match) continue;
    used.add(uuidText(match.id));
    const quantity = positiveQuantity(out.qty_units, out.volume_ml);
    if (quantity === null || out.product_id == null) continue;
    const lineId = out.source_line_id == null ? null : uuidText(out.source_line_id);
    const note = lineId ? noteByLine.get(lineId) : undefined;
    const useLine = lineId !== null && out.source_table === 'sales.delivery_note';
    transfers.push({
      sourceTable: useLine ? 'sales.delivery_note_line' : 'inventory.stock_move',
      sourceId: useLine && lineId ? lineId : uuidText(out.id),
      productId: uuidText(out.product_id),
      lotId: out.lot_id == null ? null : uuidText(out.lot_id),
      quantity,
      occurredAt: occurredAt.toISOString(),
      occurredOn: businessDate(occurredAt),
      documentNumber: note?.number ?? null,
      deliveryNoteId: note?.deliveryNoteId ?? null,
    });
  }
  return transfers;
}

async function linesWithOwnership(tx: Tx, lineIds: readonly string[]): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const rows = await tx.read<{ source_line_id: string }>(`
    SELECT DISTINCT source_line_id
    FROM inventory.stock_move
    WHERE move_type = 'ownership_out'
      AND source_line_id IS NOT NULL
      AND ${uuidIn('source_line_id', lineIds)}
  `);
  return new Set(rows.map((row) => uuidText(row.source_line_id)));
}

function noteTransfer(note: NoteRow): IntercompanyTransfer {
  const occurredAt = new Date(`${note.issueDate}T12:00:00.000Z`).toISOString();
  return {
    sourceTable: 'sales.delivery_note_line',
    sourceId: note.lineId,
    productId: note.productId,
    lotId: note.lotId,
    quantity: note.quantity,
    occurredAt,
    occurredOn: note.issueDate,
    documentNumber: note.number,
    deliveryNoteId: note.deliveryNoteId,
  };
}

function eventKey(move: MoveRow): string {
  return [
    move.source_table,
    uuidText(move.source_id),
    move.source_line_id == null ? '' : uuidText(move.source_line_id),
    uuidText(move.location_id),
    move.product_id == null ? '' : uuidText(move.product_id),
    move.lot_id == null ? '' : uuidText(move.lot_id),
  ].join('|');
}

function positiveQuantity(units: number | string, volumeMl: number | string): Decimal | null {
  const qty = asDecimal(units);
  if (!qty.isZero()) return qty.abs();
  const volume = asDecimal(volumeMl);
  if (volume.isZero()) return null;
  return money.mul(volume.abs(), money.fromString('0.001'));
}
