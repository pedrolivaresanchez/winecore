import {
  actorFor,
  auditInsert,
  auditUpdate,
  countOf,
  fillPct,
  intOf,
  invalid,
  oneOf,
  optionalText,
  optionalUuid,
  parseLimit,
  positiveInt,
  readJson,
  requireCode,
  requireText,
  requireUuid,
  slicePage,
  textOf,
  textOrNull,
  uuidList,
  type ListBody,
} from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { isInstant } from '../inventory/periods';
import {
  HOLDER_KINDS,
  HOLDER_LABELS,
  PACKAGED_STATES,
  holderStockKey,
  type HolderKind,
  type HolderStockKey,
  type PackagedState,
} from './constants';
import { idOf, nonzeroInt } from './parse';

export interface HolderBalance {
  location_id: string;
  holder_id: string;
  holder_code: string;
  holder_kind: HolderKind;
  owner_entity_id: string;
  lot_id: string;
  lot_code: string;
  product_id: string;
  product_state: PackagedState;
  qty_units: number;
  stock_key: HolderStockKey;
}

export interface HolderView {
  id: string;
  location_id: string;
  zone_id: string | null;
  code: string;
  name: string;
  kind: HolderKind;
  kind_label: string;
  number: number | null;
  capacity_bottles: number | null;
  nominal_volume_ml: number | null;
  format: string | null;
  notes: string | null;
  is_active: boolean;
  count: number;
  fill_pct: string | null;
  lot_id: string | null;
  lot_code: string | null;
  product_id: string | null;
  product_state: PackagedState | null;
  owner_entity_id: string | null;
  state: string;
  stock_key: HolderStockKey | null;
  balances: HolderBalance[];
}

interface HolderRow {
  id: string;
  location_id: string;
  zone_id: string | null;
  code: string;
  name: string;
  kind: HolderKind;
  number: number | null;
  capacity_bottles: number | null;
  nominal_volume_ml: number | null;
  format: string | null;
  notes: string | null;
  is_active: boolean;
}

type Reader = Pick<Writer, 'read'>;

const HOLDER_COLUMNS = `
  id::VARCHAR AS id, location_id::VARCHAR AS location_id, zone_id::VARCHAR AS zone_id,
  code, name, kind, cage_number, capacity_units, nominal_volume_ml, format_code, notes, is_active
`;

export async function listHolders(writer: Writer, request: Request): Promise<ListBody<HolderView>> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const locationId = queryUuid(url.searchParams.get('location_id'));
  const kind = queryKind(url.searchParams.get('kind'));
  const filters = ['TRUE'];
  if (locationId) filters.push(sql`location_id = CAST(${locationId} AS UUID)`);
  if (kind) filters.push(sql`kind = ${kind}`);
  const where = filters.join(' AND ');
  const total = await countOf(writer, `SELECT count(*)::VARCHAR AS total FROM cellar.holder WHERE ${where}`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT ${HOLDER_COLUMNS}
    FROM cellar.holder
    WHERE ${where}
    ORDER BY code
    LIMIT ${limit + 1}
  `);
  const parsed = rows.map(holderOf);
  const balances = await balancesFor(writer, parsed.map((row) => row.id));
  return slicePage(parsed.map((row) => toView(row, balances.get(row.id) ?? [])), limit, total, (row) => row.code);
}

export async function getHolder(writer: Writer, _request: Request, code: string): Promise<HolderView> {
  const row = await holderByCode(writer, code);
  const balances = await balancesFor(writer, [row.id]);
  return toView(row, balances.get(row.id) ?? []);
}

export async function createHolder(writer: Writer, request: Request): Promise<HolderView> {
  const body = await readJson(request);
  const draft = parseHolder(body, true);
  const actor = actorFor(request, 'alta de soporte');
  const code = await writer.withWrite(actor, async (tx) => {
    await assertLocation(tx, draft.location_id);
    await assertZone(tx, draft.zone_id, draft.location_id);
    const clash = await tx.read(sql`SELECT id FROM cellar.holder WHERE code = ${draft.code}`);
    if (clash.length > 0) invalid({ code: 'Ya existe un soporte con este código' });
    await assertCageFree(tx, draft.location_id, draft.number, null);
    const id = newId();
    auditInsert(tx, 'cellar.holder', id, { id, ...draft, is_active: true }, sql`
      INSERT INTO cellar.holder (
        id, location_id, zone_id, code, kind, name, cage_number, capacity_units,
        nominal_volume_ml, format_code, notes, is_active
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${draft.location_id} AS UUID),
        CAST(${draft.zone_id} AS UUID),
        ${draft.code},
        ${draft.kind},
        ${draft.name},
        ${draft.number},
        ${draft.capacity_bottles},
        ${draft.nominal_volume_ml},
        ${draft.format},
        ${draft.notes},
        TRUE
      )
    `);
    return draft.code;
  });
  return getHolder(writer, request, code);
}

export async function patchHolder(writer: Writer, request: Request, code: string): Promise<HolderView> {
  const body = await readJson(request);
  const patch = parseHolderPatch(body);
  const actor = actorFor(request, 'edición de soporte');
  await writer.withWrite(actor, async (tx) => {
    const current = await holderByCode(tx, code);
    const next = {
      name: patch.name ?? current.name,
      zone_id: patch.zone_id === undefined ? current.zone_id : patch.zone_id,
      number: patch.number === undefined ? current.number : patch.number,
      capacity_bottles: patch.capacity_bottles === undefined ? current.capacity_bottles : patch.capacity_bottles,
      nominal_volume_ml: patch.nominal_volume_ml === undefined ? current.nominal_volume_ml : patch.nominal_volume_ml,
      format: patch.format === undefined ? current.format : patch.format,
      notes: patch.notes === undefined ? current.notes : patch.notes,
      is_active: patch.is_active ?? current.is_active,
    };
    if (current.kind === 'jaulon') {
      if (next.number === null || next.capacity_bottles === null || next.nominal_volume_ml === null) {
        invalid({ kind: 'El jaulón exige número, capacidad y formato' });
      }
    }
    await assertZone(tx, next.zone_id, current.location_id);
    if (next.number !== null) await assertCageFree(tx, current.location_id, next.number, current.id);
    const balances = await balancesFor(tx, [current.id]);
    const count = (balances.get(current.id) ?? []).reduce((sum, row) => sum + row.qty_units, 0);
    if (next.capacity_bottles !== null && count > next.capacity_bottles) {
      throw domainError(
        'WC025',
        { capacity_bottles: String(next.capacity_bottles) },
        `El ${HOLDER_LABELS[current.kind]} supera su capacidad (${count} botellas > ${next.capacity_bottles} botellas)`,
      );
    }
    auditUpdate(tx, 'cellar.holder', current.id, current, next, sql`
      UPDATE cellar.holder SET
        name = ${next.name},
        zone_id = CAST(${next.zone_id} AS UUID),
        cage_number = ${next.number},
        capacity_units = ${next.capacity_bottles},
        nominal_volume_ml = ${next.nominal_volume_ml},
        format_code = ${next.format},
        notes = ${next.notes},
        is_active = ${next.is_active}
      WHERE id = CAST(${current.id} AS UUID)
    `);
  });
  return getHolder(writer, request, code);
}

export async function postHolderMove(writer: Writer, request: Request, code: string): Promise<HolderView> {
  const body = await readJson(request);
  const move = parseMove(body);
  const actor = actorFor(request, 'movimiento de soporte');
  await writer.withWrite(actor, async (tx) => {
    const holder = await holderByCode(tx, code);
    if (!holder.is_active) invalid({ code: 'El soporte no está activo' });
    if (holder.kind === 'jaulon' && move.product_state !== 'packaged_unlabeled') {
      invalid({ product_state: 'El jaulón guarda vino embotellado sin etiquetar' });
    }
    await assertOwner(tx, move.owner_entity_id);
    await assertLot(tx, move.lot_id);
    await assertProduct(tx, move.product_id);
    const balances = await balancesFor(tx, [holder.id]);
    const current = balances.get(holder.id) ?? [];
    assertNextBalance(holder, current, move);
    const id = newId();
    auditInsert(tx, 'cellar.holder_move', id, {
      id,
      holder_id: holder.id,
      location_id: holder.location_id,
      ...move,
    }, sql`
      INSERT INTO cellar.holder_move (
        id, occurred_at, holder_id, location_id, owner_entity_id, lot_id, product_id,
        product_state, qty_units, source_table, source_id, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${move.occurred_at} AS TIMESTAMPTZ),
        CAST(${holder.id} AS UUID),
        CAST(${holder.location_id} AS UUID),
        CAST(${move.owner_entity_id} AS UUID),
        CAST(${move.lot_id} AS UUID),
        CAST(${move.product_id} AS UUID),
        ${move.product_state},
        ${move.qty_units},
        'cellar.holder_move',
        CAST(${id} AS UUID),
        ${actor.id}
      )
    `);
  });
  return getHolder(writer, request, code);
}

export async function listHolderStock(writer: Writer, request: Request): Promise<ListBody<HolderBalance>> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const filters = ['TRUE'];
  const locationId = queryUuid(url.searchParams.get('location_id'));
  const holderId = queryUuid(url.searchParams.get('holder_id'));
  const holder = queryCode(url.searchParams.get('holder'));
  const state = queryState(url.searchParams.get('state'));
  const kind = queryKind(url.searchParams.get('kind'));
  if (locationId) filters.push(sql`m.location_id = CAST(${locationId} AS UUID)`);
  if (holderId) filters.push(sql`m.holder_id = CAST(${holderId} AS UUID)`);
  if (holder) filters.push(sql`h.code = ${holder}`);
  if (state) filters.push(sql`m.product_state = ${state}`);
  if (kind) filters.push(sql`h.kind = ${kind}`);
  const where = filters.join(' AND ');
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT m.location_id::VARCHAR AS location_id, m.holder_id::VARCHAR AS holder_id,
           h.code AS holder_code, h.kind AS holder_kind,
           m.owner_entity_id::VARCHAR AS owner_entity_id, m.lot_id::VARCHAR AS lot_id, l.code AS lot_code,
           m.product_id::VARCHAR AS product_id, m.product_state, sum(m.qty_units)::VARCHAR AS qty_units
    FROM cellar.holder_move m
    JOIN cellar.holder h ON h.id = m.holder_id
    JOIN inventory.lot l ON l.id = m.lot_id
    WHERE ${where}
    GROUP BY m.location_id, m.holder_id, h.code, h.kind, m.owner_entity_id, m.lot_id, l.code, m.product_id, m.product_state
    HAVING sum(m.qty_units) <> 0
    ORDER BY h.code, m.product_state, l.code
    LIMIT ${limit + 1}
  `);
  const totalRows = await writer.read<{ total: string }>(`
    SELECT count(*)::VARCHAR AS total FROM (
      SELECT 1
      FROM cellar.holder_move m
      JOIN cellar.holder h ON h.id = m.holder_id
      WHERE ${where}
      GROUP BY m.location_id, m.holder_id, m.owner_entity_id, m.lot_id, m.product_id, m.product_state
      HAVING sum(m.qty_units) <> 0
    ) s
  `);
  const items = rows.map(balanceOf);
  return slicePage(items, limit, intOf(totalRows[0]?.total ?? 0), (row) => row.holder_code);
}

export async function holderByCode(source: Reader, code: string): Promise<HolderRow> {
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await source.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, location_id::VARCHAR AS location_id, zone_id::VARCHAR AS zone_id,
           code, name, kind, cage_number, capacity_units, nominal_volume_ml, format_code, notes, is_active
    FROM cellar.holder
    WHERE code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return holderOf(row);
}

export async function balanceQtyAt(
  reader: Reader,
  holderId: string,
  key: { owner_entity_id: string; lot_id: string; product_id: string; product_state: string },
  at: string,
): Promise<number> {
  const rows = await reader.read<{ qty: string }>(sql`
    SELECT coalesce(sum(qty_units), 0)::VARCHAR AS qty
    FROM cellar.holder_move
    WHERE holder_id = CAST(${holderId} AS UUID)
      AND owner_entity_id = CAST(${key.owner_entity_id} AS UUID)
      AND lot_id = CAST(${key.lot_id} AS UUID)
      AND product_id = CAST(${key.product_id} AS UUID)
      AND product_state = ${key.product_state}
      AND occurred_at <= CAST(${at} AS TIMESTAMPTZ)
  `);
  return intOf(rows[0]?.qty ?? 0);
}

export async function nominalMl(reader: Reader, productId: string, fallback: number | null): Promise<number> {
  const rows = await reader.read<{ nominal: string | null }>(sql`
    SELECT f.nominal_volume_ml::VARCHAR AS nominal
    FROM catalog.product p
    LEFT JOIN catalog.format f ON f.id = p.format_id
    WHERE p.id = CAST(${productId} AS UUID)
  `);
  if (rows.length === 0) invalid({ product_id: 'El producto no existe' });
  const nominal = rows[0]?.nominal;
  if (nominal != null && nominal !== '') return intOf(nominal);
  return fallback ?? 0;
}

async function balancesFor(reader: Reader, holderIds: readonly string[]): Promise<Map<string, HolderBalance[]>> {
  const map = new Map<string, HolderBalance[]>();
  if (holderIds.length === 0) return map;
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT m.location_id::VARCHAR AS location_id, m.holder_id::VARCHAR AS holder_id,
           h.code AS holder_code, h.kind AS holder_kind,
           m.owner_entity_id::VARCHAR AS owner_entity_id, m.lot_id::VARCHAR AS lot_id, l.code AS lot_code,
           m.product_id::VARCHAR AS product_id, m.product_state, sum(m.qty_units)::VARCHAR AS qty_units
    FROM cellar.holder_move m
    JOIN cellar.holder h ON h.id = m.holder_id
    JOIN inventory.lot l ON l.id = m.lot_id
    WHERE m.holder_id IN (${uuidList(holderIds)})
    GROUP BY m.location_id, m.holder_id, h.code, h.kind, m.owner_entity_id, m.lot_id, l.code, m.product_id, m.product_state
    HAVING sum(m.qty_units) <> 0
  `);
  for (const row of rows) {
    const balance = balanceOf(row);
    const list = map.get(balance.holder_id) ?? [];
    list.push(balance);
    map.set(balance.holder_id, list);
  }
  return map;
}

function toView(row: HolderRow, balances: HolderBalance[]): HolderView {
  const sole = balances.length === 1 ? balances[0] : undefined;
  const count = balances.reduce((sum, item) => sum + item.qty_units, 0);
  return {
    id: row.id,
    location_id: row.location_id,
    zone_id: row.zone_id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    kind_label: HOLDER_LABELS[row.kind],
    number: row.number,
    capacity_bottles: row.capacity_bottles,
    nominal_volume_ml: row.nominal_volume_ml,
    format: row.format,
    notes: row.notes,
    is_active: row.is_active,
    count,
    fill_pct: row.capacity_bottles === null ? null : fillPct(count, row.capacity_bottles),
    lot_id: sole?.lot_id ?? null,
    lot_code: sole?.lot_code ?? null,
    product_id: sole?.product_id ?? null,
    product_state: sole?.product_state ?? null,
    owner_entity_id: sole?.owner_entity_id ?? null,
    state: count > 0 ? (sole?.product_state ?? 'mixed') : 'empty',
    stock_key: sole?.stock_key ?? null,
    balances,
  };
}

function holderOf(row: Record<string, unknown>): HolderRow {
  const kind = textOf(row.kind);
  if (!(HOLDER_KINDS as readonly string[]).includes(kind)) throw new Error('Tipo de soporte no válido');
  return {
    id: idOf(row.id),
    location_id: idOf(row.location_id),
    zone_id: row.zone_id == null ? null : idOf(row.zone_id),
    code: textOf(row.code),
    name: textOf(row.name),
    kind: kind as HolderKind,
    number: row.cage_number == null ? null : intOf(row.cage_number),
    capacity_bottles: row.capacity_units == null ? null : intOf(row.capacity_units),
    nominal_volume_ml: row.nominal_volume_ml == null ? null : intOf(row.nominal_volume_ml),
    format: textOrNull(row.format_code),
    notes: textOrNull(row.notes),
    is_active: row.is_active === true,
  };
}

function balanceOf(row: Record<string, unknown>): HolderBalance {
  const kind = textOf(row.holder_kind) as HolderKind;
  const state = textOf(row.product_state) as PackagedState;
  const parts = {
    location_id: idOf(row.location_id),
    holder_id: idOf(row.holder_id),
    owner_entity_id: idOf(row.owner_entity_id),
    lot_id: idOf(row.lot_id),
    product_id: idOf(row.product_id),
    product_state: state,
  };
  return {
    ...parts,
    holder_code: textOf(row.holder_code),
    holder_kind: kind,
    lot_code: textOf(row.lot_code),
    product_state: state,
    qty_units: intOf(row.qty_units),
    stock_key: holderStockKey(parts),
  };
}

interface HolderDraft {
  location_id: string;
  zone_id: string | null;
  code: string;
  name: string;
  kind: HolderKind;
  number: number | null;
  capacity_bottles: number | null;
  nominal_volume_ml: number | null;
  format: string | null;
  notes: string | null;
}

function parseHolder(body: Record<string, unknown>, _create: true): HolderDraft {
  const kind = oneOf(body.kind, 'kind', HOLDER_KINDS);
  const number = body.number === undefined || body.number === null ? null : positiveInt(body.number, 'number');
  const capacity = body.capacity_bottles === undefined || body.capacity_bottles === null
    ? null
    : positiveInt(body.capacity_bottles, 'capacity_bottles');
  const nominal = body.nominal_volume_ml === undefined || body.nominal_volume_ml === null
    ? null
    : positiveInt(body.nominal_volume_ml, 'nominal_volume_ml');
  const format = optionalFormat(body.format);
  if (kind === 'jaulon' && (number === null || capacity === null || nominal === null)) {
    invalid({ kind: 'El jaulón exige número, capacidad en botellas y volumen nominal' });
  }
  return {
    location_id: requireUuid(body.location_id, 'location_id'),
    zone_id: optionalUuid(body.zone_id, 'zone_id'),
    code: requireCode(body.code),
    name: requireText(body.name, 'name', 120),
    kind,
    number,
    capacity_bottles: capacity,
    nominal_volume_ml: nominal,
    format,
    notes: optionalText(body.notes, 'notes', 2000),
  };
}

interface HolderPatch {
  name?: string;
  zone_id?: string | null;
  number?: number | null;
  capacity_bottles?: number | null;
  nominal_volume_ml?: number | null;
  format?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

function parseHolderPatch(body: Record<string, unknown>): HolderPatch {
  if ('code' in body) invalid({ code: 'El código no se modifica' });
  if ('kind' in body) invalid({ kind: 'El tipo no se modifica' });
  if ('location_id' in body) invalid({ location_id: 'La ubicación no se cambia' });
  const patch: HolderPatch = {};
  if ('name' in body) patch.name = requireText(body.name, 'name', 120);
  if ('zone_id' in body) patch.zone_id = optionalUuid(body.zone_id, 'zone_id');
  if ('number' in body) patch.number = body.number === null ? null : positiveInt(body.number, 'number');
  if ('capacity_bottles' in body) {
    patch.capacity_bottles = body.capacity_bottles === null ? null : positiveInt(body.capacity_bottles, 'capacity_bottles');
  }
  if ('nominal_volume_ml' in body) {
    patch.nominal_volume_ml = body.nominal_volume_ml === null ? null : positiveInt(body.nominal_volume_ml, 'nominal_volume_ml');
  }
  if ('format' in body) patch.format = optionalFormat(body.format);
  if ('notes' in body) patch.notes = optionalText(body.notes, 'notes', 2000);
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') invalid({ is_active: 'Debe ser verdadero o falso' });
    patch.is_active = body.is_active;
  }
  if (Object.keys(patch).length === 0) invalid({ body: 'No hay cambios' });
  return patch;
}

interface MoveInput {
  occurred_at: string;
  owner_entity_id: string;
  lot_id: string;
  product_id: string;
  product_state: PackagedState;
  qty_units: number;
}

function parseMove(body: Record<string, unknown>): MoveInput {
  const occurred = typeof body.occurred_at === 'string' ? body.occurred_at.trim() : '';
  if (!isInstant(occurred)) invalid({ occurred_at: 'Debe ser un instante con zona horaria' });
  return {
    occurred_at: occurred,
    owner_entity_id: requireUuid(body.owner_entity_id, 'owner_entity_id'),
    lot_id: requireUuid(body.lot_id, 'lot_id'),
    product_id: requireUuid(body.product_id, 'product_id'),
    product_state: oneOf(body.product_state, 'product_state', PACKAGED_STATES),
    qty_units: nonzeroInt(body.qty_units, 'qty_units'),
  };
}

function assertNextBalance(holder: HolderRow, current: readonly HolderBalance[], move: MoveInput): void {
  const next = new Map<string, number>();
  for (const row of current) {
    next.set(balanceIdentity(row), row.qty_units);
  }
  const key = balanceIdentity({
    holder_id: holder.id,
    owner_entity_id: move.owner_entity_id,
    lot_id: move.lot_id,
    product_id: move.product_id,
    product_state: move.product_state,
  });
  const qty = (next.get(key) ?? 0) + move.qty_units;
  if (!Number.isSafeInteger(qty)) invalid({ qty_units: 'El saldo se sale de rango' });
  next.set(key, qty);
  for (const value of next.values()) {
    if (value < 0) {
      throw domainError('WC024', { qty_units: String(value) }, 'El soporte quedaría con saldo negativo');
    }
  }
  const positive = [...next.values()].filter((value) => value > 0);
  if (positive.length > 1) {
    throw domainError('WC026', { holder_id: holder.id }, 'El recipiente contiene otro lote');
  }
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (holder.capacity_bottles !== null && total > holder.capacity_bottles) {
    throw domainError(
      'WC025',
      { capacity_bottles: String(holder.capacity_bottles) },
      `El ${HOLDER_LABELS[holder.kind]} supera su capacidad (${total} botellas > ${holder.capacity_bottles} botellas)`,
    );
  }
}

function balanceIdentity(row: {
  holder_id: string;
  owner_entity_id: string;
  lot_id: string;
  product_id: string;
  product_state: string;
}): string {
  return [row.holder_id, row.owner_entity_id, row.lot_id, row.product_id, row.product_state].join('\u001f');
}

function optionalFormat(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Z0-9]{2,10}$/.test(value)) {
    invalid({ format: 'Debe cumplir ^[A-Z0-9]{2,10}$' });
  }
  return value;
}

async function assertLocation(tx: Tx, locationId: string): Promise<void> {
  const rows = await tx.read(sql`
    SELECT id FROM inventory.location WHERE id = CAST(${locationId} AS UUID) AND is_active
  `);
  if (rows.length === 0) invalid({ location_id: 'La ubicación no existe o está archivada' });
}

async function assertZone(tx: Tx, zoneId: string | null, locationId: string): Promise<void> {
  if (zoneId === null) return;
  const rows = await tx.read<{ location_id: string }>(sql`
    SELECT location_id::VARCHAR AS location_id FROM cellar.zone WHERE id = CAST(${zoneId} AS UUID) AND is_active
  `);
  const row = rows[0];
  if (!row) invalid({ zone_id: 'La zona no existe o está archivada' });
  if (idOf(row.location_id) !== locationId) invalid({ zone_id: 'La zona no está en la ubicación del soporte' });
}

async function assertCageFree(tx: Tx, locationId: string, number: number | null, exceptId: string | null): Promise<void> {
  if (number === null) return;
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id
    FROM cellar.holder
    WHERE location_id = CAST(${locationId} AS UUID)
      AND kind = 'jaulon'
      AND cage_number = ${number}
      AND is_active
  `);
  const clash = rows.find((row) => idOf(row.id) !== exceptId);
  if (clash) invalid({ number: 'Ya hay un jaulón activo con este número en la ubicación' });
}

async function assertOwner(tx: Tx, id: string): Promise<void> {
  const rows = await tx.read(sql`SELECT id FROM core.legal_entity WHERE id = CAST(${id} AS UUID)`);
  if (rows.length === 0) invalid({ owner_entity_id: 'La entidad no existe' });
}

async function assertLot(tx: Tx, id: string): Promise<void> {
  const rows = await tx.read(sql`SELECT id FROM inventory.lot WHERE id = CAST(${id} AS UUID)`);
  if (rows.length === 0) invalid({ lot_id: 'El lote no existe' });
}

async function assertProduct(tx: Tx, id: string): Promise<void> {
  const rows = await tx.read(sql`SELECT id FROM catalog.product WHERE id = CAST(${id} AS UUID)`);
  if (rows.length === 0) invalid({ product_id: 'El producto no existe' });
}

function queryUuid(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  return requireUuid(value, 'id');
}

function queryCode(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  return requireCode(value, 'holder');
}

function queryKind(value: string | null): HolderKind | null {
  if (value === null || value.trim() === '') return null;
  return oneOf(value, 'kind', HOLDER_KINDS);
}

function queryState(value: string | null): PackagedState | null {
  if (value === null || value.trim() === '') return null;
  return oneOf(value, 'state', PACKAGED_STATES);
}
