import type { Actor, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { stockAt } from '../inventory/balances';
import { assertPeriodOpen, isBusinessDate, isInstant } from '../inventory/periods';
import { STOCK_GROUP_KEYS, type PeriodLock } from '../inventory/types';
import { businessDate } from '../time';
import { toStockMove } from '../cellar/service/materials';
import {
  FieldBag,
  hasKey,
  intValue,
  isUuid,
  readObject,
  rejectUnknown,
  requireUuid,
} from './fields';
import { asString } from './rows';

const RECEIPT_FIELDS = ['product_id', 'location_id', 'owner_entity_id', 'qty_units', 'occurred_at'] as const;

export interface MaterialReceipt {
  id: string;
  product_id: string;
  location_id: string;
  owner_entity_id: string;
  qty_units: number;
  occurred_at: string;
  move_type: 'purchase_in';
  product_state: 'goods';
}

export interface MaterialBalance {
  product_id: string;
  sku: string;
  name: string;
  location_id: string;
  owner_entity_id: string;
  vessel_id: null;
  lot_id: null;
  product_state: 'goods';
  qty_units: number;
}

export async function listMaterialStock(
  writer: Writer,
  request: Request,
): Promise<{ at: string; items: MaterialBalance[]; total: number }> {
  const url = new URL(request.url);
  const at = url.searchParams.get('at')?.trim() ?? '';
  if (!isBusinessDate(at) && !isInstant(at)) {
    throw domainError('WC_VALIDATION', { at: 'Usa un día (AAAA-MM-DD) o un instante con zona horaria' });
  }
  const productId = optionalUuid(url.searchParams.get('product_id'), 'product_id');
  const locationId = optionalUuid(url.searchParams.get('location_id'), 'location_id');
  const owner = await resolveOwner(writer, url.searchParams.get('owner'));
  const filters = [
    `m.product_state = 'goods'`,
    `m.vessel_id IS NULL`,
    `m.lot_id IS NULL`,
    `p.kind = 'packaging_material'`,
  ];
  if (productId) filters.push(sql`m.product_id = CAST(${productId} AS UUID)`);
  if (locationId) filters.push(sql`m.location_id = CAST(${locationId} AS UUID)`);
  if (owner) filters.push(sql`m.owner_entity_id = CAST(${owner} AS UUID)`);
  const loaded = await writer.read<Record<string, unknown>>(`
    SELECT m.id::VARCHAR AS id, m.occurred_at, m.move_type, m.location_id::VARCHAR AS location_id,
           m.vessel_id::VARCHAR AS vessel_id, m.owner_entity_id::VARCHAR AS owner_entity_id,
           m.lot_id::VARCHAR AS lot_id, m.product_id::VARCHAR AS product_id, m.product_state,
           m.qty_units, m.volume_ml::VARCHAR AS volume_ml, m.mass_g::VARCHAR AS mass_g, m.loss_kind,
           m.source_table, m.source_id::VARCHAR AS source_id, m.source_line_id::VARCHAR AS source_line_id,
           m.reverses_move_id::VARCHAR AS reverses_move_id, m.created_by,
           p.sku, p.name
    FROM inventory.stock_move m
    JOIN catalog.product p ON p.id = m.product_id
    WHERE ${filters.join(' AND ')}
  `);
  const names = new Map(loaded.map((row) => [asString(row.product_id), { sku: asString(row.sku), name: asString(row.name) }]));
  const rows = stockAt(loaded.map(toStockMove), at, STOCK_GROUP_KEYS).filter((row) => (
    row.product_state === 'goods' && row.product_id && row.location_id && row.owner_entity_id
  ));
  const items: MaterialBalance[] = rows.map((row) => {
    const product = names.get(row.product_id ?? '')!;
    return {
      product_id: row.product_id ?? '',
      sku: product.sku,
      name: product.name,
      location_id: row.location_id ?? '',
      owner_entity_id: row.owner_entity_id ?? '',
      vessel_id: null,
      lot_id: null,
      product_state: 'goods',
      qty_units: row.qty_units,
    };
  });
  items.sort((left, right) => left.sku.localeCompare(right.sku) || left.location_id.localeCompare(right.location_id));
  return { at, items, total: items.length };
}

export async function receiveMaterial(writer: Writer, actor: Actor, body: unknown): Promise<MaterialReceipt> {
  const input = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(input, RECEIPT_FIELDS, errors);
  const productId = uuidField(input, 'product_id', errors);
  const locationId = uuidField(input, 'location_id', errors);
  const ownerId = hasKey(input, 'owner_entity_id') && input.owner_entity_id != null
    ? uuidField(input, 'owner_entity_id', errors)
    : null;
  const qty = intValue(input.qty_units, 'qty_units', errors, { min: 1, max: 1_000_000_000 });
  const occurredAt = typeof input.occurred_at === 'string' && isInstant(input.occurred_at)
    ? input.occurred_at
    : (errors.add('occurred_at', 'Debe ser un instante ISO-8601 con zona horaria'), null);
  errors.fail();
  if (!productId || !locationId || qty == null || !occurredAt) {
    throw domainError('WC_VALIDATION');
  }
  if (businessDate(new Date(occurredAt)) > businessDate(new Date())) {
    throw domainError('WC_VALIDATION', { occurred_at: 'La fecha no puede ser futura' });
  }
  const id = newId();
  let owner = ownerId ?? '';
  await writer.withWrite(actor, async (tx) => {
    const product = await tx.read<{ kind: string; is_active: boolean; is_stock_tracked: boolean }>(sql`
      SELECT kind, is_active, is_stock_tracked
      FROM catalog.product
      WHERE id = CAST(${productId} AS UUID)
    `);
    const item = product[0];
    if (!item) throw domainError('WC_VALIDATION', { product_id: 'El producto no existe' });
    if (item.kind !== 'packaging_material') {
      throw domainError('WC_VALIDATION', { product_id: 'Tiene que ser un material de envasado' });
    }
    if (item.is_active !== true || item.is_stock_tracked !== true) {
      throw domainError('WC_VALIDATION', { product_id: 'El material no admite entradas de stock' });
    }
    const locations = await tx.read<{ controlling_entity_id: string; is_active: boolean }>(sql`
      SELECT controlling_entity_id::VARCHAR AS controlling_entity_id, is_active
      FROM inventory.location
      WHERE id = CAST(${locationId} AS UUID)
    `);
    const location = locations[0];
    if (!location) throw domainError('WC_VALIDATION', { location_id: 'La ubicación no existe' });
    if (location.is_active !== true) throw domainError('WC_VALIDATION', { location_id: 'La ubicación está archivada' });
    owner = ownerId ?? location.controlling_entity_id;
    if (ownerId) {
      const entities = await tx.read(sql`SELECT id FROM core.legal_entity WHERE id = CAST(${ownerId} AS UUID)`);
      if (entities.length === 0) throw domainError('WC_VALIDATION', { owner_entity_id: 'La entidad no existe' });
    }
    const locks = await tx.read<Record<string, unknown>>(`
      SELECT ledger, locked_until::VARCHAR AS locked_until, locked_by, locked_at, reason
      FROM inventory.period_lock
    `);
    assertPeriodOpen(occurredAt, locks.map(toLock).filter((lock) => lock.ledger === 'physical'));
    const stored = {
      id,
      product_id: productId,
      location_id: locationId,
      owner_entity_id: owner,
      qty_units: qty,
      occurred_at: occurredAt,
      move_type: 'purchase_in',
      product_state: 'goods',
    };
    tx.write(sql`
      INSERT INTO inventory.stock_move (
        id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
        product_state, qty_units, volume_ml, mass_g, loss_kind, source_table, source_id,
        source_line_id, reverses_move_id, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${occurredAt} AS TIMESTAMPTZ),
        ${'purchase_in'},
        CAST(${locationId} AS UUID),
        NULL,
        CAST(${owner} AS UUID),
        NULL,
        CAST(${productId} AS UUID),
        ${'goods'},
        ${qty},
        0,
        0,
        NULL,
        ${'catalog.product'},
        CAST(${productId} AS UUID),
        NULL,
        NULL,
        ${actor.id}
      )
    `);
    tx.audit({ table: 'inventory.stock_move', rowId: id, action: 'INSERT', before: null, after: stored });
  });
  return {
    id,
    product_id: productId,
    location_id: locationId,
    owner_entity_id: owner,
    qty_units: qty,
    occurred_at: occurredAt,
    move_type: 'purchase_in',
    product_state: 'goods',
  };
}

function toLock(row: Record<string, unknown>): PeriodLock {
  return {
    ledger: asString(row.ledger) === 'fiscal' ? 'fiscal' : 'physical',
    locked_until: asString(row.locked_until).slice(0, 10),
    locked_by: asString(row.locked_by),
    locked_at: asString(row.locked_at),
    reason: asString(row.reason),
  };
}

async function resolveOwner(writer: Writer, raw: string | null): Promise<string | null> {
  if (raw === null || raw.trim() === '') return null;
  const value = raw.trim();
  if (isUuid(value)) return value;
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = ${value}
  `);
  const id = rows[0]?.id;
  if (!id) throw domainError('WC_VALIDATION', { owner: 'La entidad no existe' });
  return id;
}

function optionalUuid(value: string | null, field: string): string | null {
  if (value === null || value.trim() === '') return null;
  return requireUuid(value.trim(), field);
}

function uuidField(input: Record<string, unknown>, field: string, errors: FieldBag): string | null {
  const value = input[field];
  if (typeof value !== 'string' || !isUuid(value)) {
    errors.add(field, 'Identificador no válido');
    return null;
  }
  return value;
}
