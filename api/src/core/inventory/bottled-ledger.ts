import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { DomainError } from '../errors';
import { newId } from '../ids';
import type { StockMove } from './types';
import { planBottledDelta, type PlacementStock } from './bottled-allocate';
import { assertPhysical, entityByCode, onHand, reversalOf, stockMove, writeStockMove, type MoveDraft } from '../sales/moves';

type Slot = PlacementStock & { locationCode: string; ownerId: string; notForSale: boolean };

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

function intOf(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

async function slots(tx: Tx): Promise<Slot[]> {
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT p.id::VARCHAR AS id, p.location_id::VARCHAR AS location_id, loc.code AS location_code,
           p.owner_entity_id::VARCHAR AS owner_id, p.lot_id::VARCHAR AS lot_id,
           p.product_id::VARCHAR AS product_id, p.product_state, p.bottle_ml::VARCHAR AS bottle_ml,
           p.line_no::VARCHAR AS line_no, p.niche_number::VARCHAR AS niche_number,
           p.not_for_sale, coalesce(sum(m.qty_units), 0)::VARCHAR AS bottles
    FROM cellar.bottled_placement p
    JOIN inventory.location loc ON loc.id = p.location_id
    LEFT JOIN cellar.bottled_move m ON m.placement_id = p.id
    GROUP BY p.id, p.location_id, loc.code, p.owner_entity_id, p.lot_id, p.product_id,
             p.product_state, p.bottle_ml, p.line_no, p.niche_number, p.not_for_sale
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    locationId: idOf(row.location_id),
    locationCode: String(row.location_code),
    ownerId: idOf(row.owner_id),
    lotId: row.lot_id == null ? null : idOf(row.lot_id),
    productId: row.product_id == null ? null : idOf(row.product_id),
    productState: String(row.product_state),
    bottleMl: row.bottle_ml == null || row.bottle_ml === '' ? null : intOf(row.bottle_ml),
    bottles: intOf(row.bottles),
    lineNo: intOf(row.line_no),
    nicheNumber: row.niche_number == null || row.niche_number === '' ? null : intOf(row.niche_number),
    notForSale: row.not_for_sale === true,
  }));
}

function insertBottled(tx: Tx, input: {
  at: string;
  placementId: string;
  units: number;
  volumeMl: number;
  moveType: 'opening' | 'delivery_out' | 'invoice_out' | 'return_in' | 'loss' | 'reversal';
  lotId: string | null;
  sourceTable: string;
  sourceId: string;
  sourceLineId: string | null;
  reversesId: string | null;
  actor: string;
}): void {
  const id = newId();
  tx.write(sql`
    INSERT INTO cellar.bottled_move (
      id, occurred_at, placement_id, qty_units, volume_ml, move_type, lot_id,
      source_table, source_id, source_line_id, reverses_move_id, created_by
    ) VALUES (
      CAST(${id} AS UUID), CAST(${input.at} AS TIMESTAMPTZ), CAST(${input.placementId} AS UUID),
      ${input.units}, ${input.volumeMl}, ${input.moveType},
      CASE WHEN ${input.lotId} IS NULL THEN NULL ELSE CAST(${input.lotId} AS UUID) END,
      ${input.sourceTable}, CAST(${input.sourceId} AS UUID),
      CASE WHEN ${input.sourceLineId} IS NULL THEN NULL ELSE CAST(${input.sourceLineId} AS UUID) END,
      CASE WHEN ${input.reversesId} IS NULL THEN NULL ELSE CAST(${input.reversesId} AS UUID) END,
      ${input.actor}
    )
  `);
}

/** Al confirmar un albarán, las botellas salen del hueco de esa ubicación y ese lote. */
export async function applyDeliveryBottled(tx: Tx, moves: readonly StockMove[]): Promise<void> {
  const relevant = moves.filter((move) => move.move_type === 'delivery_out' || move.move_type === 'return_in');
  if (relevant.length === 0) return;
  const stock = await slots(tx);
  for (const move of relevant) {
    const planned = planBottledDelta(stock, {
      locationId: move.location_id,
      lotId: move.lot_id,
      productId: move.product_id,
      productState: move.product_state,
      units: move.qty_units,
    });
    for (const line of planned) {
      const row = stock.find((item) => item.id === line.placementId);
      if (row) row.bottles += line.units;
      insertBottled(tx, {
        at: move.occurred_at,
        placementId: line.placementId,
        units: line.units,
        volumeMl: line.volumeMl,
        moveType: move.move_type === 'return_in' ? 'return_in' : 'delivery_out',
        lotId: move.lot_id,
        sourceTable: move.source_table,
        sourceId: move.source_id,
        sourceLineId: move.source_line_id,
        reversesId: null,
        actor: move.created_by,
      });
    }
  }
}

export async function reverseBottledDocument(tx: Tx, sourceTable: string, sourceId: string, at: string, actor: string): Promise<void> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, placement_id::VARCHAR AS placement_id, qty_units::VARCHAR AS qty_units,
           volume_ml::VARCHAR AS volume_ml, lot_id::VARCHAR AS lot_id, source_line_id::VARCHAR AS source_line_id
    FROM cellar.bottled_move
    WHERE source_table = ${sourceTable}
      AND source_id = CAST(${sourceId} AS UUID)
      AND move_type <> 'reversal'
      AND NOT EXISTS (
        SELECT 1 FROM cellar.bottled_move rev
        WHERE rev.reverses_move_id = cellar.bottled_move.id
      )
  `);
  for (const row of rows) {
    insertBottled(tx, {
      at,
      placementId: idOf(row.placement_id),
      units: -intOf(row.qty_units),
      volumeMl: -intOf(row.volume_ml),
      moveType: 'reversal',
      lotId: row.lot_id == null ? null : idOf(row.lot_id),
      sourceTable,
      sourceId,
      sourceLineId: row.source_line_id == null ? null : idOf(row.source_line_id),
      reversesId: idOf(row.id),
      actor,
    });
  }
}

/** Anula la salida física que la factura hizo sin albarán. */
export async function reverseInvoiceStock(tx: Tx, invoiceId: string, at: string, actor: string): Promise<void> {
  const physical = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, occurred_at::VARCHAR AS occurred_at, move_type, location_id::VARCHAR AS location_id,
           vessel_id::VARCHAR AS vessel_id, owner_entity_id::VARCHAR AS owner_entity_id, lot_id::VARCHAR AS lot_id,
           product_id::VARCHAR AS product_id, product_state, qty_units::VARCHAR AS qty_units,
           volume_ml::VARCHAR AS volume_ml, mass_g::VARCHAR AS mass_g, loss_kind,
           source_line_id::VARCHAR AS source_line_id, created_by
    FROM inventory.stock_move
    WHERE source_table = 'billing.invoice' AND source_id = CAST(${invoiceId} AS UUID) AND move_type <> 'reversal'
      AND NOT EXISTS (
        SELECT 1 FROM inventory.stock_move rev WHERE rev.reverses_move_id = inventory.stock_move.id
      )
  `);
  const now = new Date();
  for (const row of physical) {
    const move: StockMove = {
      id: idOf(row.id),
      occurred_at: at,
      move_type: String(row.move_type) as StockMove['move_type'],
      location_id: idOf(row.location_id),
      vessel_id: row.vessel_id == null ? null : idOf(row.vessel_id),
      owner_entity_id: idOf(row.owner_entity_id),
      lot_id: row.lot_id == null ? null : idOf(row.lot_id),
      product_id: row.product_id == null ? null : idOf(row.product_id),
      product_state: String(row.product_state) as StockMove['product_state'],
      qty_units: intOf(row.qty_units),
      volume_ml: intOf(row.volume_ml),
      mass_g: intOf(row.mass_g),
      loss_kind: row.loss_kind == null ? null : String(row.loss_kind) as StockMove['loss_kind'],
      source_table: 'billing.invoice',
      source_id: invoiceId,
      source_line_id: row.source_line_id == null ? null : idOf(row.source_line_id),
      reverses_move_id: null,
      created_by: actor,
    };
    writeStockMove(tx, reversalOf(move, at, actor), now);
  }
  await reverseBottledDocument(tx, 'billing.invoice', invoiceId, at, actor);
}

export type InvoiceBottleLine = {
  id: string;
  productId: string | null;
  lotId: string | null;
  quantity: string;
  deliveryNoteLineId: string | null;
};

/**
 * Factura sin albarán: si el lote está en un hueco de TFRP (CVPO) o de la bodega,
 * las botellas salen de ahí. Una factura que ya nace de un albarán no vuelve a descontar.
 */
export async function deductInvoicedBottles(tx: Tx, input: {
  invoiceId: string;
  number: string;
  entityCode: string;
  issueDate: string;
  actorId: string;
  lines: readonly InvoiceBottleLine[];
}): Promise<void> {
  const pending = input.lines.filter((line) => !line.deliveryNoteLineId && line.productId && line.lotId);
  if (pending.length === 0) return;
  const stock = await slots(tx);
  if (stock.length === 0) return;
  const entities = await entityByCode(tx);
  const seller = entities.get(input.entityCode);
  const po = entities.get('PO');
  const cvpo = entities.get('CVPO');
  if (!seller) return;
  const occurredAt = `${input.issueDate}T12:00:00+01:00`;
  const planned: StockMove[] = [];
  const bottled: { placementId: string; units: number; volumeMl: number; lotId: string; lineId: string }[] = [];
  for (const line of pending) {
    const units = Number(line.quantity);
    const lotId = line.lotId;
    const productId = line.productId;
    if (!Number.isInteger(units) || units <= 0 || !productId || !lotId) continue;
    const product = await tx.read<{ kind: string; nominal: unknown; for_sale: unknown; tracked: unknown }>(sql`
      SELECT p.kind, f.nominal_volume_ml AS nominal, p.for_sale, p.is_stock_tracked AS tracked
      FROM catalog.product p
      LEFT JOIN catalog.format f ON f.id = p.format_id
      WHERE p.id = CAST(${productId} AS UUID)
    `);
    const row = product[0];
    if (!row || String(row.kind) !== 'wine' || row.tracked === false || row.for_sale === false) continue;
    const state = 'packaged_labeled';
    const pools = stock.filter((slot) => slot.lotId === lotId && slot.productId === productId && slot.productState === state && slot.bottles > 0 && !slot.notForSale);
    if (pools.length === 0) continue;
    const preferred = input.entityCode === 'CVPO' ? 'TFRP' : 'BOD';
    const locationId = (pools.find((slot) => slot.locationCode === preferred) ?? pools[0])?.locationId;
    if (!locationId) continue;
    const here = pools.filter((slot) => slot.locationId === locationId);
    const nominal = row.nominal == null ? here[0]?.bottleMl ?? null : Number(row.nominal);
    if (!nominal) continue;
    let owner = seller;
    let transfer = false;
    if (await onHand(tx, { locationId, ownerId: seller, lotId, productId, state }) < units) {
      if (input.entityCode === 'CVPO' && po && cvpo && seller === cvpo && await onHand(tx, { locationId, ownerId: po, lotId, productId, state }) >= units) {
        owner = po;
        transfer = true;
      } else {
        const any = here.reduce((sum, slot) => sum + slot.bottles, 0);
        if (any > 0) {
          throw new DomainError('WC024', 422, `No hay botellas suficientes del lote en ${preferred}`, {
            lot_id: lotId,
            location_id: locationId,
          });
        }
        continue;
      }
    }
    const volume = units * nominal;
    const draft = (partial: Omit<MoveDraft, 'lot_id' | 'product_id' | 'source_line_id'>): StockMove => stockMove(input.invoiceId, occurredAt, input.actorId, {
      ...partial,
      lot_id: lotId,
      product_id: productId,
      source_line_id: line.id,
    });
    if (transfer && cvpo) {
      planned.push(draft({ move_type: 'ownership_out', location_id: locationId, owner_entity_id: owner, product_state: state, qty_units: -units, volume_ml: -volume }));
      planned.push(draft({ move_type: 'ownership_in', location_id: locationId, owner_entity_id: cvpo, product_state: state, qty_units: units, volume_ml: volume }));
      planned.push(draft({ move_type: 'delivery_out', location_id: locationId, owner_entity_id: cvpo, product_state: state, qty_units: -units, volume_ml: -volume }));
    } else {
      planned.push(draft({ move_type: 'delivery_out', location_id: locationId, owner_entity_id: owner, product_state: state, qty_units: -units, volume_ml: -volume }));
    }
    const delta = planBottledDelta(stock, { locationId, lotId, productId, productState: state, units: -units });
    for (const item of delta) {
      const slot = stock.find((rowSlot) => rowSlot.id === item.placementId);
      if (slot) slot.bottles += item.units;
      bottled.push({ placementId: item.placementId, units: item.units, volumeMl: item.volumeMl, lotId, lineId: line.id });
    }
  }
  if (planned.length === 0) return;
  await assertPhysical(tx, planned);
  const now = new Date();
  for (const move of planned) {
    const written = { ...move, source_table: 'billing.invoice' };
    writeStockMove(tx, written, now);
  }
  for (const line of bottled) {
    insertBottled(tx, {
      at: occurredAt,
      placementId: line.placementId,
      units: line.units,
      volumeMl: line.volumeMl,
      moveType: 'invoice_out',
      lotId: line.lotId,
      sourceTable: 'billing.invoice',
      sourceId: input.invoiceId,
      sourceLineId: line.lineId,
      reversesId: null,
      actor: input.actorId,
    });
  }
}

export async function disposePlacement(tx: Tx, input: {
  placementId: string;
  bottles: number;
  reason: string;
  actorId: string;
  at: string;
}): Promise<{ bottles: number; volume_ml: number }> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError('WC_VALIDATION', 422, 'Indica el motivo de la baja', { reason: 'Obligatorio' });
  if (!Number.isInteger(input.bottles) || input.bottles <= 0) {
    throw new DomainError('WC_VALIDATION', 422, 'Indica las botellas que se dan de baja', { bottles: 'Obligatorio' });
  }
  const stock = await slots(tx);
  const slot = stock.find((row) => row.id === input.placementId);
  if (!slot) throw new DomainError('WC_NOT_FOUND', 404, 'Ese hueco no existe');
  if (slot.bottles < input.bottles) {
    throw new DomainError('WC024', 422, 'No hay tantas botellas en ese hueco', { bottles: String(slot.bottles) });
  }
  const volume = slot.bottleMl ? input.bottles * slot.bottleMl : 0;
  if (slot.lotId && slot.productId && slot.bottleMl && !slot.notForSale) {
    const move = stockMove(input.placementId, input.at, input.actorId, {
      move_type: 'loss',
      location_id: slot.locationId,
      owner_entity_id: slot.ownerId,
      lot_id: slot.lotId,
      product_id: slot.productId,
      product_state: slot.productState as StockMove['product_state'],
      qty_units: -input.bottles,
      volume_ml: -volume,
      source_line_id: null,
      loss_kind: 'authorized',
    });
    writeStockMove(tx, { ...move, source_table: 'cellar.bottled_placement' }, new Date());
  }
  insertBottled(tx, {
    at: input.at,
    placementId: slot.id,
    units: -input.bottles,
    volumeMl: -volume,
    moveType: 'loss',
    lotId: slot.lotId,
    sourceTable: 'cellar.bottled_placement',
    sourceId: slot.id,
    sourceLineId: newId(),
    reversesId: null,
    actor: input.actorId,
  });
  tx.audit({
    table: 'cellar.bottled_placement',
    rowId: slot.id,
    action: 'LOSS',
    before: { bottles: slot.bottles },
    after: { bottles: slot.bottles - input.bottles, reason },
  });
  return { bottles: input.bottles, volume_ml: volume === 0 ? 0 : volume };
}
