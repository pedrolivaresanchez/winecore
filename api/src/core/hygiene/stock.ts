import { findNegativeBalances } from '../inventory/balances';
import { assertPeriodOpen } from '../inventory/periods';
import type { PeriodLock, StockMove } from '../inventory/types';
import type { Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import {
  actorFor,
  auditInsert,
  auditUpdate,
  intOf,
  invalid,
  oneOf,
  readJson,
  requireUuid,
  textOf,
  textOrNull,
  uuidList,
} from '../cellar/service/http';
import { CONSUMABLE_KINDS, type ConsumableKind } from './constants';
import {
  requireConsumable,
  requireEntity,
  requireLocation,
  requireProductPackaging,
} from './lookups';
import { idOf, noteOf, parseInstant, positiveUnits } from './parse';

export interface ConsumptionLine {
  id: string;
  productId: string;
  locationId: string;
  ownerEntityId: string;
  quantity: number;
  purpose: ConsumableKind;
  filtrationId: string | null;
  cleaningLogId: string | null;
  operationId: string | null;
}

const GOODS_COLUMNS = `
  id::VARCHAR AS id, occurred_at, move_type, location_id::VARCHAR AS location_id,
  vessel_id::VARCHAR AS vessel_id, owner_entity_id::VARCHAR AS owner_entity_id,
  lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id, product_state,
  qty_units, volume_ml::VARCHAR AS volume_ml, mass_g::VARCHAR AS mass_g, loss_kind,
  source_table, source_id::VARCHAR AS source_id, source_line_id::VARCHAR AS source_line_id,
  reverses_move_id::VARCHAR AS reverses_move_id, created_by
`;

export async function registerConsumable(writer: Writer, request: Request) {
  const body = await readJson(request);
  const productId = requireUuid(body.product_id, 'product_id');
  const kind = oneOf(body.consumable_kind, 'consumable_kind', CONSUMABLE_KINDS);
  const actor = actorFor(request, 'alta de consumible');
  await writer.withWrite(actor, async (tx) => {
    const product = await requireProductPackaging(tx, productId);
    const existing = await tx.read(sql`
      SELECT product_id FROM hygiene.consumable WHERE product_id = CAST(${productId} AS UUID)
    `);
    if (existing.length > 0) invalid({ product_id: 'Ya está registrado como consumible' });
    auditInsert(tx, 'hygiene.consumable', productId, {
      product_id: productId,
      consumable_kind: kind,
      sku: product.sku,
    }, sql`
      INSERT INTO hygiene.consumable (product_id, consumable_kind, created_by)
      VALUES (CAST(${productId} AS UUID), ${kind}, ${actor.id})
    `);
  });
  return readConsumable(writer, productId);
}

export async function listConsumables(writer: Writer) {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT c.product_id::VARCHAR AS product_id, c.consumable_kind, c.created_at,
           p.sku, p.name, p.unit
    FROM hygiene.consumable c
    JOIN catalog.product p ON p.id = c.product_id
    ORDER BY p.sku
  `);
  return {
    items: rows.map((row) => ({
      product_id: idOf(row.product_id),
      consumable_kind: textOf(row.consumable_kind),
      sku: textOf(row.sku),
      name: textOf(row.name),
      unit: textOf(row.unit),
      created_at: textOf(row.created_at),
    })),
  };
}

export async function createReceipt(writer: Writer, request: Request) {
  const body = await readJson(request);
  const productId = requireUuid(body.product_id, 'product_id');
  const locationId = requireUuid(body.location_id, 'location_id');
  const ownerId = requireUuid(body.owner_entity_id, 'owner_entity_id');
  const quantity = positiveUnits(body.quantity, 'quantity');
  const occurredAt = parseInstant(body.occurred_at, 'occurred_at');
  const supplierName = noteOf(body.supplier_name, 'supplier_name', 120);
  const actor = actorFor(request, 'entrada de consumible');
  const receiptId = newId();
  const moveId = newId();
  await writer.withWrite(actor, async (tx) => {
    await requireConsumable(tx, productId, 'product_id');
    await requireLocation(tx, locationId, 'location_id');
    await requireEntity(tx, ownerId, 'owner_entity_id');
    await assertPhysicalOpen(tx, occurredAt);
    const move = goodsMove({
      id: moveId,
      occurredAt,
      moveType: 'purchase_in',
      locationId,
      ownerId,
      productId,
      qty: quantity,
      sourceTable: 'hygiene.consumable_receipt',
      sourceId: receiptId,
      createdBy: actor.id,
    });
    await assertGoods(tx, [move]);
    insertStock(tx, move);
    auditInsert(tx, 'hygiene.consumable_receipt', receiptId, {
      id: receiptId,
      product_id: productId,
      quantity,
      stock_move_id: moveId,
    }, sql`
      INSERT INTO hygiene.consumable_receipt (
        id, product_id, location_id, owner_entity_id, quantity, occurred_at, supplier_name,
        stock_move_id, created_by
      ) VALUES (
        CAST(${receiptId} AS UUID),
        CAST(${productId} AS UUID),
        CAST(${locationId} AS UUID),
        CAST(${ownerId} AS UUID),
        ${quantity},
        CAST(${occurredAt} AS TIMESTAMPTZ),
        ${supplierName},
        CAST(${moveId} AS UUID),
        ${actor.id}
      )
    `);
  });
  const balance = await balanceUnits(writer, productId, locationId, ownerId);
  return {
    id: receiptId,
    product_id: productId,
    location_id: locationId,
    owner_entity_id: ownerId,
    quantity,
    occurred_at: occurredAt,
    supplier_name: supplierName,
    stock_move_id: moveId,
    balance_units: balance,
  };
}

/**
 * Posts planned consumable lines for a cellar operation inside the caller's write.
 * Cleaning logs store lines as `planned`; confirmación de la operación las da de baja.
 * La filtración no pasa por el motor de bodega: su consumo entra ya como `posted`
 * desde POST /v1/hygiene/filtrations, en el mismo write que la ficha.
 */
export async function postPlannedConsumptions(
  tx: Tx,
  args: { operationId: string; occurredAt: string; actorId: string },
): Promise<void> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, product_id::VARCHAR AS product_id, location_id::VARCHAR AS location_id,
           owner_entity_id::VARCHAR AS owner_entity_id, quantity, purpose,
           filtration_id::VARCHAR AS filtration_id, cleaning_log_id::VARCHAR AS cleaning_log_id
    FROM hygiene.consumable_use
    WHERE operation_id = CAST(${args.operationId} AS UUID) AND status = 'planned'
    ORDER BY id
  `);
  if (rows.length === 0) return;
  const lines: ConsumptionLine[] = rows.map((row) => ({
    id: idOf(row.id),
    productId: idOf(row.product_id),
    locationId: idOf(row.location_id),
    ownerEntityId: idOf(row.owner_entity_id),
    quantity: intOf(row.quantity),
    purpose: textOf(row.purpose) as ConsumableKind,
    filtrationId: row.filtration_id == null ? null : idOf(row.filtration_id),
    cleaningLogId: row.cleaning_log_id == null ? null : idOf(row.cleaning_log_id),
    operationId: args.operationId,
  }));
  const moves = await guardOut(tx, lines, args.occurredAt, args.actorId);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const move = moves[index];
    if (!line || !move) continue;
    insertStock(tx, move);
    auditUpdate(tx, 'hygiene.consumable_use', line.id, { status: 'planned', stock_move_id: null }, {
      status: 'posted',
      stock_move_id: move.id,
      occurred_at: args.occurredAt,
    }, sql`
      UPDATE hygiene.consumable_use
      SET status = 'posted',
          stock_move_id = CAST(${move.id} AS UUID),
          occurred_at = CAST(${args.occurredAt} AS TIMESTAMPTZ)
      WHERE id = CAST(${line.id} AS UUID) AND status = 'planned'
    `);
  }
}

/** Inserta el consumo y el movimiento de stock. La ficha padre ya está encolada en el write. */
export async function consumeNow(
  tx: Tx,
  lines: readonly ConsumptionLine[],
  occurredAt: string,
  actorId: string,
): Promise<void> {
  if (lines.length === 0) return;
  const moves = await guardOut(tx, lines, occurredAt, actorId);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const move = moves[index];
    if (!line || !move) continue;
    insertStock(tx, move);
    auditInsert(tx, 'hygiene.consumable_use', line.id, {
      id: line.id,
      product_id: line.productId,
      quantity: line.quantity,
      purpose: line.purpose,
      status: 'posted',
      stock_move_id: move.id,
    }, sql`
      INSERT INTO hygiene.consumable_use (
        id, product_id, location_id, owner_entity_id, quantity, purpose, filtration_id,
        cleaning_log_id, operation_id, status, stock_move_id, occurred_at, created_by
      ) VALUES (
        CAST(${line.id} AS UUID),
        CAST(${line.productId} AS UUID),
        CAST(${line.locationId} AS UUID),
        CAST(${line.ownerEntityId} AS UUID),
        ${line.quantity},
        ${line.purpose},
        CAST(${line.filtrationId} AS UUID),
        CAST(${line.cleaningLogId} AS UUID),
        CAST(${line.operationId} AS UUID),
        'posted',
        CAST(${move.id} AS UUID),
        CAST(${occurredAt} AS TIMESTAMPTZ),
        ${actorId}
      )
    `);
  }
}

export async function insertPlannedUse(tx: Tx, line: ConsumptionLine, actorId: string): Promise<void> {
  auditInsert(tx, 'hygiene.consumable_use', line.id, {
    id: line.id,
    product_id: line.productId,
    quantity: line.quantity,
    purpose: line.purpose,
    status: 'planned',
  }, sql`
    INSERT INTO hygiene.consumable_use (
      id, product_id, location_id, owner_entity_id, quantity, purpose, filtration_id,
      cleaning_log_id, operation_id, status, created_by
    ) VALUES (
      CAST(${line.id} AS UUID),
      CAST(${line.productId} AS UUID),
      CAST(${line.locationId} AS UUID),
      CAST(${line.ownerEntityId} AS UUID),
      ${line.quantity},
      ${line.purpose},
      CAST(${line.filtrationId} AS UUID),
      CAST(${line.cleaningLogId} AS UUID),
      CAST(${line.operationId} AS UUID),
      'planned',
      ${actorId}
    )
  `);
}

export async function balanceUnits(
  reader: { read<T>(statement: string): Promise<T[]> },
  productId: string,
  locationId: string,
  ownerId: string,
): Promise<number> {
  const rows = await reader.read<{ qty: unknown }>(sql`
    SELECT COALESCE(sum(qty_units), 0)::VARCHAR AS qty
    FROM inventory.stock_move
    WHERE product_id = CAST(${productId} AS UUID)
      AND location_id = CAST(${locationId} AS UUID)
      AND owner_entity_id = CAST(${ownerId} AS UUID)
      AND product_state = 'goods'
      AND vessel_id IS NULL
      AND lot_id IS NULL
  `);
  return intOf(rows[0]?.qty ?? 0);
}

async function readConsumable(writer: Writer, productId: string) {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT c.product_id::VARCHAR AS product_id, c.consumable_kind, p.sku, p.name, p.unit
    FROM hygiene.consumable c
    JOIN catalog.product p ON p.id = c.product_id
    WHERE c.product_id = CAST(${productId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return {
    product_id: idOf(row.product_id),
    consumable_kind: textOf(row.consumable_kind),
    sku: textOf(row.sku),
    name: textOf(row.name),
    unit: textOf(row.unit),
  };
}

async function guardOut(
  tx: Tx,
  lines: readonly ConsumptionLine[],
  occurredAt: string,
  actorId: string,
): Promise<StockMove[]> {
  await assertPhysicalOpen(tx, occurredAt);
  const moves = lines.map((line) => goodsMove({
    id: newId(),
    occurredAt,
    moveType: 'cellar_out',
    locationId: line.locationId,
    ownerId: line.ownerEntityId,
    productId: line.productId,
    qty: -line.quantity,
    sourceTable: 'hygiene.consumable_use',
    sourceId: line.id,
    createdBy: actorId,
  }));
  await assertGoods(tx, moves);
  return moves;
}

async function assertPhysicalOpen(tx: Tx, occurredAt: string): Promise<void> {
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT ledger, locked_until::VARCHAR AS locked_until, locked_by, locked_at, reason
    FROM inventory.period_lock
    WHERE ledger = 'physical'
  `);
  const locks: PeriodLock[] = rows.map((row) => ({
    ledger: 'physical',
    locked_until: textOf(row.locked_until).slice(0, 10),
    locked_by: textOf(row.locked_by),
    locked_at: textOf(row.locked_at),
    reason: textOf(row.reason),
  }));
  assertPeriodOpen(occurredAt, locks);
}

function goodsMove(args: {
  id: string;
  occurredAt: string;
  moveType: 'purchase_in' | 'cellar_out';
  locationId: string;
  ownerId: string;
  productId: string;
  qty: number;
  sourceTable: string;
  sourceId: string;
  createdBy: string;
}): StockMove {
  return {
    id: args.id,
    occurred_at: args.occurredAt,
    move_type: args.moveType,
    location_id: args.locationId,
    vessel_id: null,
    owner_entity_id: args.ownerId,
    lot_id: null,
    product_id: args.productId,
    product_state: 'goods',
    qty_units: args.qty,
    volume_ml: 0,
    mass_g: 0,
    loss_kind: null,
    source_table: args.sourceTable,
    source_id: args.sourceId,
    source_line_id: null,
    reverses_move_id: null,
    created_by: args.createdBy,
  };
}

async function assertGoods(tx: Tx, drafts: readonly StockMove[]): Promise<void> {
  const existing = await loadGoods(tx, drafts);
  const findings = findNegativeBalances([...existing, ...drafts]);
  const hit = findings.find((finding) => drafts.some((move) => sameGoods(move, finding)));
  if (!hit) return;
  throw domainError('WC024', { product_id: hit.product_id ?? '' }, 'No hay existencias suficientes del consumible');
}

function sameGoods(move: StockMove, finding: { location_id: string | null; vessel_id: string | null; owner_entity_id: string | null; lot_id: string | null; product_id: string | null; product_state: string | null }): boolean {
  return move.location_id === finding.location_id
    && move.vessel_id === finding.vessel_id
    && move.owner_entity_id === finding.owner_entity_id
    && move.lot_id === finding.lot_id
    && move.product_id === finding.product_id
    && move.product_state === finding.product_state;
}

async function loadGoods(tx: Tx, drafts: readonly StockMove[]): Promise<StockMove[]> {
  const productIds = [...new Set(drafts.map((move) => move.product_id).filter((id): id is string => id !== null))];
  const locationIds = [...new Set(drafts.map((move) => move.location_id))];
  if (productIds.length === 0) return [];
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT ${GOODS_COLUMNS}
    FROM inventory.stock_move
    WHERE product_state = 'goods'
      AND vessel_id IS NULL
      AND lot_id IS NULL
      AND product_id IN (${uuidList(productIds)})
      AND location_id IN (${uuidList(locationIds)})
  `);
  return rows.map((row) => ({
    id: textOf(row.id),
    occurred_at: textOf(row.occurred_at),
    move_type: textOf(row.move_type) as StockMove['move_type'],
    location_id: textOf(row.location_id).toLowerCase(),
    vessel_id: row.vessel_id == null ? null : textOf(row.vessel_id).toLowerCase(),
    owner_entity_id: textOf(row.owner_entity_id).toLowerCase(),
    lot_id: row.lot_id == null ? null : textOf(row.lot_id).toLowerCase(),
    product_id: row.product_id == null ? null : textOf(row.product_id).toLowerCase(),
    product_state: 'goods',
    qty_units: intOf(row.qty_units),
    volume_ml: intOf(row.volume_ml),
    mass_g: intOf(row.mass_g),
    loss_kind: null,
    source_table: textOf(row.source_table),
    source_id: textOf(row.source_id),
    source_line_id: textOrNull(row.source_line_id),
    reverses_move_id: textOrNull(row.reverses_move_id),
    created_by: textOf(row.created_by),
  }));
}

function insertStock(tx: Tx, move: StockMove): void {
  auditInsert(tx, 'inventory.stock_move', move.id ?? '', move, sql`
    INSERT INTO inventory.stock_move (
      id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
      product_state, qty_units, volume_ml, mass_g, loss_kind, source_table, source_id,
      source_line_id, reverses_move_id, created_by
    ) VALUES (
      CAST(${move.id} AS UUID),
      CAST(${move.occurred_at} AS TIMESTAMPTZ),
      ${move.move_type},
      CAST(${move.location_id} AS UUID),
      CAST(${move.vessel_id} AS UUID),
      CAST(${move.owner_entity_id} AS UUID),
      CAST(${move.lot_id} AS UUID),
      CAST(${move.product_id} AS UUID),
      ${move.product_state},
      ${move.qty_units},
      ${move.volume_ml},
      ${move.mass_g},
      ${move.loss_kind},
      ${move.source_table},
      CAST(${move.source_id} AS UUID),
      CAST(${move.source_line_id} AS UUID),
      CAST(${move.reverses_move_id} AS UUID),
      ${move.created_by}
    )
  `);
}
