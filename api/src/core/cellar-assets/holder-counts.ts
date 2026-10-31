import { actorFor, auditInsert, intOf, isUuid, oneOf, readJson, requireUuid } from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { uuidList as parseUuidList } from '../inventory/service/rows';
import { holderStockKey, PACKAGED_STATES, type HolderStockKey, type PackagedState } from './constants';
import { balanceQtyAt, holderByCode, nominalMl } from './holders';
import { idOf, nonNegativeInt } from './parse';

export interface HolderCountLineView {
  count_id: string;
  count_line_id: string;
  holder_id: string;
  holder_code: string;
  holder_kind: string;
  location_id: string;
  owner_entity_id: string;
  lot_id: string;
  product_id: string;
  product_state: PackagedState;
  counted_qty_units: number;
  counted_volume_ml: number;
  expected_qty_units: number;
  expected_volume_ml: number;
  stock_key: HolderStockKey;
}

export async function addHolderCountLine(writer: Writer, request: Request, countId: string): Promise<HolderCountLineView> {
  if (!isUuid(countId)) throw domainError('WC_NOT_FOUND');
  const body = await readJson(request);
  const input = parseLine(body);
  const actor = actorFor(request, 'línea de aforo de soporte');
  const lineId = newId();
  const linkId = newId();
  const view = await writer.withWrite(actor, async (tx) => {
    const countRows = await tx.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, status, location_ids, counted_at
      FROM inventory.inventory_count
      WHERE id = CAST(${countId} AS UUID)
    `);
    const count = countRows[0];
    if (!count) throw domainError('WC_NOT_FOUND');
    if (text(count.status) !== 'counting') {
      throw domainError('WC_VALIDATION', { status: text(count.status) }, 'El aforo no admite líneas en este estado');
    }
    const holder = input.holder_id
      ? await holderById(tx, input.holder_id)
      : await holderByCode(tx, input.holder_code ?? '');
    if (!holder.is_active) throw domainError('WC_VALIDATION', { holder_code: holder.code }, 'El soporte no está activo');
    if (holder.kind === 'jaulon' && input.product_state !== 'packaged_unlabeled') {
      throw domainError('WC_VALIDATION', { product_state: input.product_state }, 'El jaulón guarda vino embotellado sin etiquetar');
    }
    const locations = parseUuidList(count.location_ids);
    if (!locations.includes(holder.location_id)) {
      throw domainError('WC_VALIDATION', { location_id: holder.location_id }, 'La ubicación del soporte no está en el aforo');
    }
    await assertRefs(tx, input);
    const duplicate = await tx.read(sql`
      SELECT id FROM cellar.holder_count_line
      WHERE count_id = CAST(${countId} AS UUID)
        AND holder_id = CAST(${holder.id} AS UUID)
        AND owner_entity_id = CAST(${input.owner_entity_id} AS UUID)
        AND lot_id = CAST(${input.lot_id} AS UUID)
        AND product_id = CAST(${input.product_id} AS UUID)
        AND product_state = ${input.product_state}
    `);
    if (duplicate.length > 0) {
      throw domainError('WC_VALIDATION', { holder_code: holder.code }, 'Este recipiente ya está en el aforo');
    }
    const countedAt = text(count.counted_at);
    const expectedQty = await balanceQtyAt(tx, holder.id, input, countedAt);
    const nominal = await nominalMl(tx, input.product_id, holder.nominal_volume_ml);
    const expectedVolume = scale(expectedQty, nominal);
    const countedVolume = scale(input.counted_qty_units, nominal);
    const stockKey = holderStockKey({
      location_id: holder.location_id,
      holder_id: holder.id,
      owner_entity_id: input.owner_entity_id,
      lot_id: input.lot_id,
      product_id: input.product_id,
      product_state: input.product_state,
    });
    auditInsert(tx, 'inventory.inventory_count_line', lineId, {
      id: lineId,
      count_id: countId,
      location_id: holder.location_id,
      vessel_id: null,
      owner_entity_id: input.owner_entity_id,
      lot_id: input.lot_id,
      product_id: input.product_id,
      product_state: input.product_state,
      expected_qty_units: expectedQty,
      expected_volume_ml: expectedVolume,
      counted_qty_units: input.counted_qty_units,
      counted_volume_ml: countedVolume,
      method: 'unit_count',
    }, sql`
      INSERT INTO inventory.inventory_count_line (
        id, count_id, location_id, vessel_id, owner_entity_id, lot_id, product_id, product_state,
        expected_qty_units, expected_volume_ml, counted_qty_units, counted_volume_ml, method
      ) VALUES (
        CAST(${lineId} AS UUID),
        CAST(${countId} AS UUID),
        CAST(${holder.location_id} AS UUID),
        NULL,
        CAST(${input.owner_entity_id} AS UUID),
        CAST(${input.lot_id} AS UUID),
        CAST(${input.product_id} AS UUID),
        ${input.product_state},
        ${expectedQty},
        ${expectedVolume},
        ${input.counted_qty_units},
        ${countedVolume},
        'unit_count'
      )
    `);
    auditInsert(tx, 'cellar.holder_count_line', linkId, {
      id: linkId,
      count_id: countId,
      count_line_id: lineId,
      holder_id: holder.id,
      product_state: input.product_state,
      stock_key: stockKey,
    }, sql`
      INSERT INTO cellar.holder_count_line (
        id, count_id, count_line_id, holder_id, location_id, owner_entity_id, lot_id, product_id,
        product_state, counted_qty_units
      ) VALUES (
        CAST(${linkId} AS UUID),
        CAST(${countId} AS UUID),
        CAST(${lineId} AS UUID),
        CAST(${holder.id} AS UUID),
        CAST(${holder.location_id} AS UUID),
        CAST(${input.owner_entity_id} AS UUID),
        CAST(${input.lot_id} AS UUID),
        CAST(${input.product_id} AS UUID),
        ${input.product_state},
        ${input.counted_qty_units}
      )
    `);
    return {
      count_id: countId.toLowerCase(),
      count_line_id: lineId,
      holder_id: holder.id,
      holder_code: holder.code,
      holder_kind: holder.kind,
      location_id: holder.location_id,
      owner_entity_id: input.owner_entity_id,
      lot_id: input.lot_id,
      product_id: input.product_id,
      product_state: input.product_state,
      counted_qty_units: input.counted_qty_units,
      counted_volume_ml: countedVolume,
      expected_qty_units: expectedQty,
      expected_volume_ml: expectedVolume,
      stock_key: stockKey,
    };
  });
  return view;
}

interface LineInput {
  holder_id: string | null;
  holder_code: string | null;
  owner_entity_id: string;
  lot_id: string;
  product_id: string;
  product_state: PackagedState;
  counted_qty_units: number;
}

function parseLine(body: Record<string, unknown>): LineInput {
  const holderId = body.holder_id == null || body.holder_id === '' ? null : requireUuid(body.holder_id, 'holder_id');
  const holderCode = body.holder_code == null || body.holder_code === '' ? null : textCode(body.holder_code);
  if ((holderId === null) === (holderCode === null)) {
    throw domainError('WC_VALIDATION', { holder_code: 'Indica holder_code o holder_id' }, 'Indica el nicho o el jaulón');
  }
  return {
    holder_id: holderId,
    holder_code: holderCode,
    owner_entity_id: requireUuid(body.owner_entity_id, 'owner_entity_id'),
    lot_id: requireUuid(body.lot_id, 'lot_id'),
    product_id: requireUuid(body.product_id, 'product_id'),
    product_state: oneOf(body.product_state, 'product_state', PACKAGED_STATES),
    counted_qty_units: nonNegativeInt(body.counted_qty_units, 'counted_qty_units'),
  };
}

function textCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9-]{2,20}$/.test(value)) {
    throw domainError('WC_VALIDATION', { holder_code: 'Debe cumplir ^[A-Z0-9-]{2,20}$' }, 'El código del soporte no es válido');
  }
  return value;
}

async function holderById(reader: Pick<Writer, 'read'>, id: string) {
  const rows = await reader.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, location_id::VARCHAR AS location_id, zone_id::VARCHAR AS zone_id,
           code, name, kind, cage_number, capacity_units, nominal_volume_ml, format_code, notes, is_active
    FROM cellar.holder
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return {
    id: idOf(row.id),
    location_id: idOf(row.location_id),
    code: String(row.code),
    kind: String(row.kind),
    nominal_volume_ml: row.nominal_volume_ml == null ? null : intOf(row.nominal_volume_ml),
    is_active: row.is_active === true,
  };
}

async function assertRefs(
  reader: Pick<Writer, 'read'>,
  input: { owner_entity_id: string; lot_id: string; product_id: string },
): Promise<void> {
  const owner = await reader.read(sql`SELECT id FROM core.legal_entity WHERE id = CAST(${input.owner_entity_id} AS UUID)`);
  if (owner.length === 0) throw domainError('WC_VALIDATION', { owner_entity_id: input.owner_entity_id }, 'La entidad no existe');
  const lot = await reader.read(sql`SELECT id FROM inventory.lot WHERE id = CAST(${input.lot_id} AS UUID)`);
  if (lot.length === 0) throw domainError('WC_VALIDATION', { lot_id: input.lot_id }, 'El lote no existe');
  const product = await reader.read(sql`SELECT id FROM catalog.product WHERE id = CAST(${input.product_id} AS UUID)`);
  if (product.length === 0) throw domainError('WC_VALIDATION', { product_id: input.product_id }, 'El producto no existe');
}

function scale(qty: number, nominal: number): number {
  const volume = qty * nominal;
  if (!Number.isSafeInteger(volume)) {
    throw domainError('WC_VALIDATION', { counted_qty_units: String(qty) }, 'El volumen no cabe en un entero');
  }
  return volume;
}

function text(value: unknown): string {
  return String(value);
}
