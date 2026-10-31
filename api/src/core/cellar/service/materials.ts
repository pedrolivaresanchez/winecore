import { Decimal } from 'decimal.js';
import { scale } from '../../catalog/fields';
import { sql } from '../../db/sql';
import type { Tx } from '../../db/writer';
import { domainError, DomainError } from '../../errors';
import { newId } from '../../ids';
import { findNegativeBalances, stockAt } from '../../inventory/balances';
import { isInstant } from '../../inventory/periods';
import { STOCK_GROUP_KEYS, type StockMove } from '../../inventory/types';
import {
  allocateUnits,
  basisFor,
  consumptionUnits,
  type MaterialPer,
} from '../materials';
import type { StockMoveDraft } from '../types';
import { intOf, textOf, textOrNull } from './http';

export interface MaterialUseLine {
  format_material_id: string;
  product_id: string;
  sku: string;
  name: string;
  per: MaterialPer;
  basis: number;
  quantity_each: string;
  quantity: number;
  available: number;
  required_total: number;
  shortfall: number;
  short: boolean;
  warning: string | null;
}

export interface BottlingMaterialPlan {
  lines: MaterialUseLine[];
  exits: StockMoveDraft[];
  short: boolean;
}

export interface BottlingOutput {
  productId: string;
  qtyUnits: number;
  volumeMl: number;
  locationId: string;
  ownerEntityId: string;
}

const EMPTY: BottlingMaterialPlan = { lines: [], exits: [], short: false };

/**
 * Materials the bottling would consume, and the stock exits to write with it.
 * A shortage is a warning here: the caller decides whether to refuse the confirm.
 */
export async function planBottlingMaterials(
  tx: Tx,
  input: {
    operationId: string;
    occurredAt: string;
    createdBy: string;
    output: BottlingOutput | null;
  },
): Promise<BottlingMaterialPlan> {
  if (!input.output) return EMPTY;
  const format = await tx.read<Record<string, unknown>>(sql`
    SELECT f.nominal_volume_ml, f.units_per_case, f.cases_per_pallet
    FROM catalog.product p
    JOIN catalog.format f ON f.id = p.format_id
    WHERE p.id = CAST(${input.output.productId} AS UUID)
  `);
  const spec = format[0];
  if (!spec) return EMPTY;
  const nominal = intOf(spec.nominal_volume_ml);
  const unitsPerCase = intOf(spec.units_per_case);
  const casesPerPallet = intOf(spec.cases_per_pallet);
  if (input.output.volumeMl !== input.output.qtyUnits * nominal) {
    throw domainError('WC_VALIDATION', { nominal_volume_ml: 'No coincide con el formato del producto' });
  }
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT m.id::VARCHAR AS id, m.material_product_id::VARCHAR AS material_product_id, m.per,
           CAST(m.quantity AS VARCHAR) AS quantity, p.sku, p.name, p.kind, p.is_stock_tracked
    FROM catalog.format_material m
    JOIN catalog.product p ON p.id = m.material_product_id
    WHERE m.format_id = (
      SELECT format_id FROM catalog.product WHERE id = CAST(${input.output.productId} AS UUID)
    )
    ORDER BY p.sku, CASE m.per WHEN 'unit' THEN 1 WHEN 'case' THEN 2 ELSE 3 END, m.id
  `);
  if (rows.length === 0) return EMPTY;

  const drafted: {
    format_material_id: string;
    product_id: string;
    sku: string;
    name: string;
    per: MaterialPer;
    basis: number;
    quantity_each: string;
    quantity: number;
  }[] = [];
  for (const row of rows) {
    const per = textOf(row.per);
    if (per !== 'unit' && per !== 'case' && per !== 'pallet') {
      throw domainError('WC_VALIDATION', { per: 'La base del material no es válida' });
    }
    if (textOf(row.kind) !== 'packaging_material' || row.is_stock_tracked !== true) {
      throw domainError('WC_VALIDATION', { material_product_id: 'El material de la lista no lleva stock' });
    }
    const basis = basisFor(per, input.output.qtyUnits, unitsPerCase, casesPerPallet);
    const quantity = consumptionUnits(new Decimal(textOf(row.quantity)), basis);
    if (quantity === null) {
      throw domainError('WC_VALIDATION', { quantity: 'El consumo debe ser un número entero de unidades' });
    }
    drafted.push({
      format_material_id: textOf(row.id),
      product_id: textOf(row.material_product_id),
      sku: textOf(row.sku),
      name: textOf(row.name),
      per,
      basis,
      quantity_each: scale(row.quantity, 3),
      quantity,
    });
  }

  const required = new Map<string, number>();
  for (const line of drafted) {
    required.set(line.product_id, (required.get(line.product_id) ?? 0) + line.quantity);
  }
  const moves = await loadGoodsMoves(tx, input.output.ownerEntityId, [...required.keys()]);
  const balances = stockAt(moves, input.occurredAt, STOCK_GROUP_KEYS);
  const available = new Map<string, number>();
  const buckets = new Map<string, { location_id: string; qty_units: number }[]>();
  for (const balance of balances) {
    if (!balance.product_id || balance.product_state !== 'goods') continue;
    if (balance.vessel_id !== null || balance.lot_id !== null) continue;
    available.set(balance.product_id, (available.get(balance.product_id) ?? 0) + balance.qty_units);
    const list = buckets.get(balance.product_id) ?? [];
    list.push({ location_id: balance.location_id ?? '', qty_units: balance.qty_units });
    buckets.set(balance.product_id, list);
  }

  const lines: MaterialUseLine[] = drafted.map((line) => {
    const total = required.get(line.product_id) ?? line.quantity;
    const onHand = available.get(line.product_id) ?? 0;
    const shortfall = Math.max(0, total - onHand);
    const short = shortfall > 0;
    return {
      ...line,
      available: onHand,
      required_total: total,
      shortfall,
      short,
      warning: short ? `Falta stock de ${line.name} (${line.sku}): hacen falta ${total} ud y hay ${onHand}` : null,
    };
  });
  if (lines.some((line) => line.short)) {
    return { lines, exits: [], short: true };
  }

  const exits: StockMoveDraft[] = [];
  for (const [productId, total] of [...required.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const taken = allocateUnits(total, buckets.get(productId) ?? [], input.output.locationId);
    if (!taken) {
      return markShort(lines, productId);
    }
    for (const piece of taken) {
      exits.push({
        id: newId(),
        occurred_at: input.occurredAt,
        move_type: 'cellar_out',
        location_id: piece.location_id,
        vessel_id: null,
        owner_entity_id: input.output.ownerEntityId,
        lot_id: null,
        product_id: productId,
        product_state: 'goods',
        qty_units: -piece.qty_units,
        volume_ml: 0,
        mass_g: 0,
        loss_kind: null,
        source_table: 'cellar.operation',
        source_id: input.operationId,
        source_line_id: null,
        reverses_move_id: null,
        created_by: input.createdBy,
      });
    }
  }

  const findings = findNegativeBalances([...moves, ...exits]);
  const blocked = new Set(
    findings
      .filter((finding) => exits.some((move) => sameGoods(move, finding)))
      .map((finding) => finding.product_id)
      .filter((id): id is string => id !== null),
  );
  if (blocked.size > 0) {
    const next = lines.map((line) => blocked.has(line.product_id)
      ? {
        ...line,
        short: true,
        shortfall: Math.max(line.shortfall, 1),
        warning: `Saldo negativo de ${line.name}`,
      }
      : line);
    return { lines: next, exits: [], short: true };
  }
  return { lines, exits, short: false };
}

function markShort(lines: MaterialUseLine[], productId: string): BottlingMaterialPlan {
  const next = lines.map((line) => line.product_id === productId
    ? {
      ...line,
      short: true,
      shortfall: Math.max(line.shortfall, 1),
      warning: line.warning ?? `Falta stock de ${line.name}`,
    }
    : line);
  return { lines: next, exits: [], short: true };
}

function sameGoods(
  move: StockMoveDraft,
  finding: { location_id: string | null; vessel_id: string | null; owner_entity_id: string | null; lot_id: string | null; product_id: string | null; product_state: string | null },
): boolean {
  return move.location_id === finding.location_id
    && move.vessel_id === finding.vessel_id
    && move.owner_entity_id === finding.owner_entity_id
    && move.lot_id === finding.lot_id
    && move.product_id === finding.product_id
    && move.product_state === finding.product_state;
}

export async function loadGoodsMoves(
  tx: { read<T = Record<string, unknown>>(statement: string): Promise<T[]> },
  ownerEntityId: string,
  productIds: readonly string[],
): Promise<StockMove[]> {
  if (productIds.length === 0) return [];
  const ownerSql = uuidLiteral(ownerEntityId);
  const list = productIds.map((id) => uuidLiteral(id)).join(', ');
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, occurred_at, move_type, location_id::VARCHAR AS location_id,
           vessel_id::VARCHAR AS vessel_id, owner_entity_id::VARCHAR AS owner_entity_id,
           lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id, product_state,
           qty_units, volume_ml::VARCHAR AS volume_ml, mass_g::VARCHAR AS mass_g, loss_kind,
           source_table, source_id::VARCHAR AS source_id, source_line_id::VARCHAR AS source_line_id,
           reverses_move_id::VARCHAR AS reverses_move_id, created_by
    FROM inventory.stock_move
    WHERE product_state = 'goods'
      AND vessel_id IS NULL
      AND lot_id IS NULL
      AND owner_entity_id = ${ownerSql}
      AND product_id IN (${list})
  `);
  return rows.map(toStockMove);
}

export function toStockMove(row: Record<string, unknown>): StockMove {
  return {
    id: textOf(row.id),
    occurred_at: asInstant(row.occurred_at),
    move_type: textOf(row.move_type) as StockMove['move_type'],
    location_id: textOf(row.location_id),
    vessel_id: textOrNull(row.vessel_id),
    owner_entity_id: textOf(row.owner_entity_id),
    lot_id: textOrNull(row.lot_id),
    product_id: textOrNull(row.product_id),
    product_state: 'goods',
    qty_units: intOf(row.qty_units),
    volume_ml: intOf(row.volume_ml),
    mass_g: intOf(row.mass_g),
    loss_kind: textOrNull(row.loss_kind) as StockMove['loss_kind'],
    source_table: textOf(row.source_table),
    source_id: textOf(row.source_id),
    source_line_id: textOrNull(row.source_line_id),
    reverses_move_id: textOrNull(row.reverses_move_id),
    created_by: textOf(row.created_by),
  };
}

function uuidLiteral(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new DomainError('WC_VALIDATION', 422, 'Identificador no válido');
  }
  return `CAST('${value.toLowerCase()}' AS UUID)`;
}

function asInstant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (isInstant(text)) return text;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) throw domainError('WC_VALIDATION', { occurred_at: 'Fecha no válida' });
  return new Date(parsed).toISOString();
}
