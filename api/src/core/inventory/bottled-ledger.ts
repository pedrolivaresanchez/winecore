import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { DomainError, domainError } from '../errors';
import { newId } from '../ids';
import type { StockMove } from './types';
import { planBottledDelta, type PlacementStock } from './bottled-allocate';
import { assertPhysical, entityByCode, onHand, reversalOf, stockMove, writeStockMove, type MoveDraft } from '../sales/moves';

type Slot = PlacementStock & {
  locationCode: string;
  ownerId: string;
  notForSale: boolean;
  slotKind: string;
  slotCode: string;
};

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
           p.slot_kind, p.slot_code, p.not_for_sale, coalesce(sum(m.qty_units), 0)::VARCHAR AS bottles
    FROM cellar.bottled_placement p
    JOIN inventory.location loc ON loc.id = p.location_id
    LEFT JOIN cellar.bottled_move m ON m.placement_id = p.id
    GROUP BY p.id, p.location_id, loc.code, p.owner_entity_id, p.lot_id, p.product_id,
             p.product_state, p.bottle_ml, p.line_no, p.niche_number, p.slot_kind, p.slot_code, p.not_for_sale
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
    slotKind: String(row.slot_kind),
    slotCode: String(row.slot_code),
  }));
}

function insertBottled(tx: Tx, input: {
  at: string;
  placementId: string;
  units: number;
  volumeMl: number;
  moveType: 'opening' | 'delivery_out' | 'invoice_out' | 'return_in' | 'loss' | 'reversal' | 'cellar_in' | 'cellar_out';
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

const LOT_CODE = /^[A-Z0-9][A-Z0-9./-]{1,29}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Corrección manual de un nicho, jaulón, caja o palet.
 * La cantidad ajusta el libro de vino envasado. El cambio de etiqueta no.
 * No hay asiento de SILICIE. El granel no vive en estos huecos.
 */
export async function correctPlacement(writer: Writer, actor: Actor, input: {
  placementId: string;
  bottles: number;
  lotCode: string;
  productId: string | null;
  labeled: boolean;
  note: string;
  actorId: string;
  at: string;
}): Promise<{ bottles: number; lot_code: string | null; product_id: string | null; labeled: boolean; note: string | null }> {
  const placementId = input.placementId.trim().toLowerCase();
  if (!UUID.test(placementId)) throw new DomainError('WC_VALIDATION', 422, 'Ese hueco no existe', { id: 'UUID no válido' });
  if (!Number.isInteger(input.bottles) || input.bottles < 0) {
    throw new DomainError('WC_VALIDATION', 422, 'Las botellas tienen que ser un entero positivo o cero', { bottles: 'No válido' });
  }
  const note = input.note.trim();
  if (note.length > 400) throw new DomainError('WC_VALIDATION', 422, 'La nota es demasiado larga', { note: 'Máximo 400 caracteres' });
  const lotCode = input.lotCode.trim().toUpperCase();
  if (lotCode !== '' && !LOT_CODE.test(lotCode)) {
    throw new DomainError('WC_VALIDATION', 422, 'El código de lote no es válido', { lot_code: 'Mayúsculas, números y . / -' });
  }
  const productId = input.productId?.trim().toLowerCase() || null;
  if (productId && !UUID.test(productId)) {
    throw new DomainError('WC_VALIDATION', 422, 'El producto no es válido', { product_id: 'UUID no válido' });
  }
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT p.id::VARCHAR AS id, p.location_id::VARCHAR AS location_id, p.owner_entity_id::VARCHAR AS owner_id,
           p.lot_id::VARCHAR AS lot_id, p.product_id::VARCHAR AS product_id, p.bottle_ml::VARCHAR AS bottle_ml,
           p.slot_kind, p.product_state, p.note, p.wine_label, l.code AS lot_code,
           coalesce(sum(m.qty_units), 0)::VARCHAR AS bottles
    FROM cellar.bottled_placement p
    LEFT JOIN inventory.lot l ON l.id = p.lot_id
    LEFT JOIN cellar.bottled_move m ON m.placement_id = p.id
    WHERE p.id = CAST(${placementId} AS UUID)
    GROUP BY p.id, p.location_id, p.owner_entity_id, p.lot_id, p.product_id, p.bottle_ml,
             p.slot_kind, p.product_state, p.note, p.wine_label, l.code
  `);
  const row = rows[0];
  if (!row) throw new DomainError('WC_NOT_FOUND', 404, 'Ese hueco no existe');
  const kind = String(row.slot_kind);
  if (!['caja', 'nicho', 'jaulon', 'palet'].includes(kind)) {
    throw new DomainError('WC_VALIDATION', 422, 'Ese hueco no es de envasado');
  }
  if (kind === 'jaulon' && input.labeled) {
    throw new DomainError('WC_VALIDATION', 422, 'Un jaulón se queda sin etiquetar. La etiqueta se pone en Etiquetado.', { labeled: 'No válido' });
  }
  const current = intOf(row.bottles);
  const bottleMl = row.bottle_ml == null || row.bottle_ml === '' ? null : intOf(row.bottle_ml);
  const previousCode = row.lot_code == null ? '' : String(row.lot_code);
  const previousProduct = row.product_id == null ? null : idOf(row.product_id);
  let lotId = row.lot_id == null ? null : idOf(row.lot_id);
  if (lotCode !== previousCode) {
    if (lotCode === '') lotId = null;
    else {
      const found = await writer.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM inventory.lot WHERE code = ${lotCode} LIMIT 1`);
      if (!found[0]) throw new DomainError('WC_VALIDATION', 422, 'Ese lote no existe', { lot_code: 'Créalo antes en Lotes' });
      lotId = idOf(found[0].id);
    }
  }
  let wineId: string | null = null;
  let wineLabel = String(row.wine_label);
  if (productId) {
    const products = await writer.read<{ name: string; wine_id: string | null; kind: string; nominal: string | null }>(sql`
      SELECT p.name, p.wine_id::VARCHAR AS wine_id, p.kind, f.nominal_volume_ml::VARCHAR AS nominal
      FROM catalog.product p
      LEFT JOIN catalog.format f ON f.id = p.format_id
      WHERE p.id = CAST(${productId} AS UUID) AND p.is_active = TRUE
    `);
    const product = products[0];
    if (!product || product.kind !== 'wine') {
      throw new DomainError('WC_VALIDATION', 422, 'Ese producto no existe', { product_id: 'Elige un vino' });
    }
    const nominal = product.nominal == null ? null : intOf(product.nominal);
    if (bottleMl && nominal && nominal !== bottleMl) {
      throw new DomainError('WC_VALIDATION', 422, 'El formato del producto no coincide con las botellas', { product_id: 'Mismo volumen' });
    }
    wineId = product.wine_id ? idOf(product.wine_id) : null;
    wineLabel = product.name;
  }
  const state = input.labeled ? 'packaged_labeled' : 'packaged_unlabeled';
  const identityChanged = (productId ?? null) !== previousProduct || (lotId ?? null) !== (row.lot_id == null ? null : idOf(row.lot_id));
  const qtyChanged = input.bottles !== current;
  if ((qtyChanged || identityChanged) && input.bottles > 0 && (!productId || !lotId)) {
    throw new DomainError('WC_VALIDATION', 422, 'Indica producto y lote para corregir la cantidad', { bottles: 'Falta el producto o el lote' });
  }
  if (qtyChanged && !bottleMl) {
    throw new DomainError('WC_VALIDATION', 422, 'Sin formato no se puede corregir la cantidad', { bottles: 'Falta el volumen de la botella' });
  }
  if (identityChanged && current > 0 && !bottleMl) {
    throw new DomainError('WC_VALIDATION', 422, 'Sin formato no se puede cambiar el producto ni el lote', { product_id: 'Falta el volumen de la botella' });
  }
  const before = {
    bottles: current,
    lot_code: previousCode || null,
    product_id: previousProduct,
    labeled: String(row.product_state) === 'packaged_labeled',
    note: row.note == null ? null : String(row.note),
  };
  const after = {
    bottles: input.bottles,
    lot_code: lotCode || null,
    product_id: productId,
    labeled: input.labeled,
    note: note || null,
  };
  if (JSON.stringify(before) === JSON.stringify(after)) return after;
  const locationId = idOf(row.location_id);
  const ownerId = idOf(row.owner_id);
  const oldLot = row.lot_id == null ? null : idOf(row.lot_id);
  const delta = input.bottles - current;
  const kept = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, occurred_at::VARCHAR AS occurred_at, qty_units::VARCHAR AS qty_units, volume_ml::VARCHAR AS volume_ml,
           move_type, lot_id::VARCHAR AS lot_id, source_table, source_id::VARCHAR AS source_id,
           source_line_id::VARCHAR AS source_line_id, reverses_move_id::VARCHAR AS reverses_id, created_by
    FROM cellar.bottled_move WHERE placement_id = CAST(${placementId} AS UUID)
  `);
  const replay = (target: Tx, rows: Record<string, unknown>[]) => {
    for (const move of rows) {
      insertBottled(target, {
        at: String(move.occurred_at),
        placementId,
        units: intOf(move.qty_units),
        volumeMl: intOf(move.volume_ml),
        moveType: String(move.move_type) as 'opening',
        lotId: move.lot_id == null ? null : idOf(move.lot_id),
        sourceTable: String(move.source_table),
        sourceId: idOf(move.source_id),
        sourceLineId: move.source_line_id == null ? null : idOf(move.source_line_id),
        reversesId: move.reverses_id == null ? null : idOf(move.reverses_id),
        actor: String(move.created_by),
      });
    }
  };
  await writer.withWrite(actor, async (live) => {
    live.write(sql`DELETE FROM cellar.bottled_move WHERE placement_id = CAST(${placementId} AS UUID)`);
  });
  try {
    await writer.withWrite(actor, async (live) => {
      if (bottleMl && (qtyChanged || identityChanged)) {
        if ((previousProduct ?? '') === (productId ?? '') && (oldLot ?? '') === (lotId ?? '')) {
          postBookAdjust(live, { locationId, ownerId, lotId, productId, units: input.bottles - current, bottleMl, at: input.at, actorId: input.actorId, placementId });
        } else {
          postBookAdjust(live, { locationId, ownerId, lotId: oldLot, productId: previousProduct, units: -current, bottleMl, at: input.at, actorId: input.actorId, placementId });
          postBookAdjust(live, { locationId, ownerId, lotId, productId, units: input.bottles, bottleMl, at: input.at, actorId: input.actorId, placementId });
        }
      }
      live.write(sql`
    UPDATE cellar.bottled_placement SET
      lot_id = CASE WHEN ${lotId} IS NULL THEN NULL ELSE CAST(${lotId} AS UUID) END,
      lot_code_raw = ${lotCode || null},
      product_id = CASE WHEN ${productId} IS NULL THEN NULL ELSE CAST(${productId} AS UUID) END,
      wine_id = CASE
        WHEN ${productId} IS NULL THEN NULL
        WHEN ${wineId} IS NULL THEN wine_id
        ELSE CAST(${wineId} AS UUID)
      END,
      wine_label = ${wineLabel},
      product_state = ${state},
      note = ${note || null},
      match_status = CASE WHEN ${productId} IS NULL THEN match_status ELSE 'matched' END
    WHERE id = CAST(${placementId} AS UUID)
      `);
      replay(live, kept);
      if (delta !== 0 && bottleMl) {
        insertBottled(live, {
          at: input.at,
          placementId,
          units: delta,
          volumeMl: delta * bottleMl,
          moveType: delta > 0 ? 'cellar_in' : 'cellar_out',
          lotId,
          sourceTable: 'cellar.bottled_placement',
          sourceId: placementId,
          sourceLineId: null,
          reversesId: null,
          actor: input.actorId,
        });
      }
      live.audit({ table: 'cellar.bottled_placement', rowId: placementId, action: 'UPDATE', before, after });
    });
  } catch (error) {
    await writer.withWrite(actor, async (live) => replay(live, kept));
    throw error;
  }
  return after;
}

function postBookAdjust(tx: Tx, input: {
  locationId: string;
  ownerId: string;
  lotId: string | null;
  productId: string | null;
  units: number;
  bottleMl: number;
  at: string;
  actorId: string;
  placementId: string;
}): void {
  if (input.units === 0 || !input.lotId || !input.productId) return;
  const volume = input.units * input.bottleMl;
  const inbound = input.units > 0;
  tx.write(sql`
    INSERT INTO inventory.stock_move (
      id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
      product_state, qty_units, volume_ml, mass_g, source_table, source_id, created_by
    ) VALUES (
      CAST(${newId()} AS UUID), CAST(${input.at} AS TIMESTAMPTZ), ${inbound ? 'count_adjust_in' : 'count_adjust_out'},
      CAST(${input.locationId} AS UUID), NULL, CAST(${input.ownerId} AS UUID), CAST(${input.lotId} AS UUID),
      CAST(${input.productId} AS UUID), 'packaged_labeled', ${input.units}, ${volume}, 0,
      'cellar.bottled_placement', CAST(${input.placementId} AS UUID), ${input.actorId}
    )
  `);
}

export type CellarPackagedMove = {
  occurred_at: string;
  move_type: string;
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: string;
  qty_units: number;
  volume_ml: number;
  source_table: string;
  source_id: string;
  source_line_id: string | null;
  created_by: string;
};

/**
 * El envasado y el etiquetado mueven el libro físico sin recipiente.
 * El mapa sigue ese movimiento: el jaulón solo guarda sin etiquetar;
 * un nicho puede tener a la vez una línea sin etiquetar y otra etiquetada.
 */
export async function applyOperationBottled(tx: Tx, moves: readonly CellarPackagedMove[]): Promise<void> {
  const relevant = moves.filter((move) =>
    move.vessel_id == null
    && (move.product_state === 'packaged_unlabeled' || move.product_state === 'packaged_labeled')
    && move.qty_units !== 0
    && move.lot_id
    && move.product_id
  );
  if (relevant.length === 0) return;
  const stock = await slots(tx);
  const touchedNiches: { locationId: string; code: string; number: number; left: number }[] = [];
  const ordered = [...relevant].sort((left, right) => left.qty_units - right.qty_units);
  for (const raw of ordered) {
    const move: CellarPackagedMove = {
      ...raw,
      location_id: idOf(raw.location_id),
      owner_entity_id: idOf(raw.owner_entity_id),
      lot_id: raw.lot_id ? idOf(raw.lot_id) : null,
      product_id: raw.product_id ? idOf(raw.product_id) : null,
    };
    const bottleMl = move.qty_units !== 0 && move.volume_ml % move.qty_units === 0
      ? Math.abs(move.volume_ml / move.qty_units)
      : null;
    if (move.qty_units < 0) {
      const kinds = move.product_state === 'packaged_unlabeled' ? ['jaulon', 'nicho'] : ['nicho', 'caja', 'palet'];
      let left = -move.qty_units;
      for (const kind of kinds) {
        if (left === 0) break;
        const planned = planBottledDelta(stock.filter((slot) => slot.slotKind === kind), {
          locationId: move.location_id,
          lotId: move.lot_id,
          productId: move.product_id,
          productState: move.product_state,
          units: -left,
        });
        for (const line of planned) {
          const slot = stock.find((item) => item.id === line.placementId);
          if (!slot) continue;
          slot.bottles += line.units;
          left -= -line.units;
          if (slot.slotKind === 'nicho' && slot.nicheNumber != null && move.product_state === 'packaged_unlabeled') {
            touchedNiches.push({
              locationId: slot.locationId,
              code: slot.slotCode,
              number: slot.nicheNumber,
              left: -line.units,
            });
          }
          insertBottled(tx, {
            at: move.occurred_at,
            placementId: slot.id,
            units: line.units,
            volumeMl: line.volumeMl,
            moveType: move.move_type === 'loss' ? 'loss' : 'cellar_out',
            lotId: move.lot_id,
            sourceTable: move.source_table,
            sourceId: move.source_id,
            sourceLineId: move.source_line_id,
            reversesId: null,
            actor: move.created_by,
          });
        }
      }
      if (left > 0) throw domainError('WC024', undefined, 'No hay botellas suficientes en el mapa de nichos y jaulones');
      continue;
    }
    let pending = move.qty_units;
    if (move.product_state === 'packaged_labeled') {
      for (const niche of touchedNiches) {
        if (pending === 0 || niche.left === 0 || niche.locationId !== move.location_id) continue;
        const take = Math.min(pending, niche.left);
        await addBottles(tx, stock, {
          move, bottleMl, units: take, kind: 'nicho', slotCode: niche.code, nicheNumber: niche.number,
        });
        niche.left -= take;
        pending -= take;
      }
    }
    if (pending === 0) continue;
    const kind = move.product_state === 'packaged_unlabeled' ? 'jaulon' : 'caja';
    await addBottles(tx, stock, { move, bottleMl, units: pending, kind, slotCode: null, nicheNumber: null });
  }
}

async function addBottles(tx: Tx, stock: Slot[], input: {
  move: CellarPackagedMove;
  bottleMl: number | null;
  units: number;
  kind: 'jaulon' | 'nicho' | 'caja';
  slotCode: string | null;
  nicheNumber: number | null;
}): Promise<void> {
  const found = stock.find((slot) =>
    slot.locationId === input.move.location_id
    && slot.lotId === input.move.lot_id
    && slot.productId === input.move.product_id
    && slot.productState === input.move.product_state
    && slot.slotKind === input.kind
    && (input.slotCode == null || slot.slotCode === input.slotCode)
    && (input.bottleMl == null || slot.bottleMl === input.bottleMl)
  );
  const placementId = found?.id ?? newId();
  const volume = input.bottleMl ? input.units * input.bottleMl : Math.abs(input.move.volume_ml);
  if (!found) {
    const code = input.slotCode ?? nextCode(stock, input.kind);
    const lineNo = stock.filter((slot) => slot.slotCode === code).reduce((max, slot) => Math.max(max, slot.lineNo), 0) + 1;
    const named = await tx.read<{ name: string }>(sql`
      SELECT name FROM catalog.product WHERE id = CAST(${input.move.product_id} AS UUID)
    `);
    const wineLabel = named[0]?.name
      ?? (input.kind === 'jaulon' ? 'Jaulón sin etiquetar' : 'Etiquetado');
    stock.push({
      id: placementId,
      locationId: input.move.location_id,
      locationCode: '',
      ownerId: input.move.owner_entity_id,
      lotId: input.move.lot_id,
      productId: input.move.product_id,
      productState: input.move.product_state,
      bottleMl: input.bottleMl,
      bottles: 0,
      lineNo,
      nicheNumber: input.nicheNumber,
      notForSale: false,
      slotKind: input.kind,
      slotCode: code,
    });
    tx.write(sql`
      INSERT INTO cellar.bottled_placement (
        id, location_id, slot_kind, slot_code, niche_number, line_no, wine_label, lot_id, product_id,
        owner_entity_id, opened_bottles, bottle_ml, opened_volume_ml, product_state, not_for_sale,
        match_status, match_note, source_sheet, source_row, photo_date
      ) VALUES (
        CAST(${placementId} AS UUID), CAST(${input.move.location_id} AS UUID), ${input.kind}, ${code},
        ${input.nicheNumber}, ${lineNo}, ${wineLabel},
        CAST(${input.move.lot_id} AS UUID), CAST(${input.move.product_id} AS UUID),
        CAST(${input.move.owner_entity_id} AS UUID), 0, ${input.bottleMl}, 0, ${input.move.product_state}, FALSE,
        'matched', ${input.kind === 'nicho' ? 'Parte etiquetada del mismo nicho' : null},
        'cellar.operation', ${nextOperationRow()}, CURRENT_DATE
      )
    `);
  }
  const slot = stock.find((item) => item.id === placementId);
  if (slot) slot.bottles += input.units;
  insertBottled(tx, {
    at: input.move.occurred_at,
    placementId,
    units: input.units,
    volumeMl: volume,
    moveType: 'cellar_in',
    lotId: input.move.lot_id,
    sourceTable: input.move.source_table,
    sourceId: input.move.source_id,
    sourceLineId: input.move.source_line_id,
    reversesId: null,
    actor: input.move.created_by,
  });
}

let operationRow = 1000;

function nextOperationRow(): number {
  operationRow += 1;
  return operationRow;
}

function nextCode(stock: readonly Slot[], kind: string): string {
  const prefix = kind === 'jaulon' ? 'JAU-' : kind === 'caja' ? 'CAJ-' : 'NIC-';
  let n = stock.filter((slot) => slot.slotKind === kind).length + 1;
  let code = `${prefix}${String(n).padStart(2, '0')}`;
  while (stock.some((slot) => slot.slotCode === code)) {
    n += 1;
    code = `${prefix}${String(n).padStart(2, '0')}`;
  }
  return code;
}
