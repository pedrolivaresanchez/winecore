import { newId } from '../../ids';
import { sql } from '../../db/sql';
import type { Tx, Writer } from '../../db/writer';
import { DomainError, domainError } from '../../errors';
import { isWinecoreQr, newQrToken, qrPayload } from '../qr';
import {
  actorFor,
  auditInsert,
  auditUpdate,
  boolOf,
  countOf,
  decodeOpCursor,
  encodeOpCursor,
  fillPct,
  intOf,
  invalid,
  isUuid,
  oneOf,
  optionalText,
  parseLimit,
  positiveInt,
  readJson,
  requireBool,
  requireCode,
  requireText,
  requireUuid,
  slicePage,
  textOf,
  textOrNull,
  uuidList,
  type ListBody,
} from './http';

const KINDS = ['tank_storage', 'tank_fermenter', 'barrel', 'demijohn', 'ibc', 'other'] as const;
const MATERIALS = ['stainless_steel', 'oak', 'glass', 'concrete', 'plastic', 'other'] as const;
const STATUSES = ['in_service', 'out_of_service', 'retired'] as const;

type VesselKind = (typeof KINDS)[number];
type VesselMaterial = (typeof MATERIALS)[number];

export interface VesselView {
  id: string;
  code: string;
  name: string;
  kind: string;
  material: string;
  capacity_ml: number;
  has_cooling_jacket: boolean;
  location_id: string;
  location_code: string;
  location_name: string;
  zone: string | null;
  sisv_code: string | null;
  status: string;
  /** Map state: empty, fermenting, aging, or the administrative status. */
  state: string;
  lot_id: string | null;
  lot_code: string | null;
  wine_name: string | null;
  vintage: number | null;
  volume_ml: number;
  product_state: string | null;
  fill_pct: string;
  notes: string | null;
  created_at: string;
  qr_token?: string;
}

interface VesselRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  material: string;
  capacity_ml: number;
  has_cooling_jacket: boolean;
  location_id: string;
  location_code: string;
  location_name: string;
  zone: string | null;
  sisv_code: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  qr_token: string | null;
}

interface Content {
  lot_id: string | null;
  lot_code: string | null;
  wine_name: string | null;
  vintage: number | null;
  volume_ml: number;
  product_state: string | null;
  owner_entity_id: string | null;
}

const EMPTY: Content = {
  lot_id: null,
  lot_code: null,
  wine_name: null,
  vintage: null,
  volume_ml: 0,
  product_state: null,
  owner_entity_id: null,
};

export async function listVessels(writer: Writer, request: Request): Promise<ListBody<VesselView>> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = optionalCodeCursor(url.searchParams.get('cursor'));
  const zone = optionalQuery(url.searchParams.get('zone'), 'zone', 40);
  const kind = optionalEnum(url.searchParams.get('kind'), 'kind', KINDS);
  const status = optionalEnum(url.searchParams.get('status'), 'status', STATUSES);
  const locationId = optionalQueryUuid(url.searchParams.get('location_id'));
  const filters = ['TRUE'];
  if (zone) filters.push(sql`v.zone = ${zone}`);
  if (kind) filters.push(sql`v.kind = ${kind}`);
  if (status) filters.push(sql`v.status = ${status}`);
  if (locationId) filters.push(sql`v.location_id = CAST(${locationId} AS UUID)`);
  const where = filters.join(' AND ');
  const page = [...filters];
  if (cursor) page.push(sql`v.code > ${cursor}`);
  const total = await countOf(writer, `SELECT count(*)::VARCHAR AS total FROM cellar.vessel v WHERE ${where}`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT ${VESSEL_COLUMNS}
    FROM cellar.vessel v
    JOIN inventory.location loc ON loc.id = v.location_id
    WHERE ${page.join(' AND ')}
    ORDER BY v.code
    LIMIT ${limit + 1}
  `);
  const parsed = rows.map(rowOf);
  const contents = await contentsFor(writer, parsed.map((row) => row.id));
  const views = parsed.map((row) => toView(row, contents.get(row.id) ?? EMPTY, false));
  return slicePage(views, limit, total, (row) => row.code);
}

export async function getVessel(writer: Writer, _request: Request, code: string): Promise<VesselView> {
  const row = await vesselByCode(writer, code);
  const contents = await contentsFor(writer, [row.id]);
  return toView(row, contents.get(row.id) ?? EMPTY, true);
}

export async function createVessel(writer: Writer, request: Request): Promise<VesselView> {
  const body = await readJson(request);
  const draft = parseCreate(body);
  const user = actorFor(request, 'alta de recipiente');
  const code = await writer.withWrite(user, async (tx) => {
    const clash = await tx.read(sql`SELECT id FROM cellar.vessel WHERE code = ${draft.code}`);
    if (clash.length > 0) invalid({ code: 'Ya existe un recipiente con este código' });
    await assertLocation(tx, draft.location_id);
    const token = await mintToken(tx);
    const id = newId();
    const after = { id, ...draft, qr_token: token, status: 'in_service' };
    auditInsert(tx, 'cellar.vessel', id, after, sql`
      INSERT INTO cellar.vessel (
        id, code, name, kind, capacity_ml, has_cooling_jacket, material,
        location_id, zone, sisv_code, qr_token, status, notes
      ) VALUES (
        CAST(${id} AS UUID),
        ${draft.code},
        ${draft.name},
        ${draft.kind},
        ${draft.capacity_ml},
        ${draft.has_cooling_jacket},
        ${draft.material},
        CAST(${draft.location_id} AS UUID),
        ${draft.zone},
        ${draft.sisv_code},
        ${token},
        'in_service',
        ${draft.notes}
      )
    `);
    return draft.code;
  });
  return getVessel(writer, request, code);
}

export async function patchVessel(writer: Writer, request: Request, code: string): Promise<VesselView> {
  const body = await readJson(request);
  const patch = parsePatch(body);
  const user = actorFor(request, 'edición de recipiente');
  await writer.withWrite(user, async (tx) => {
    const current = await vesselByCode(tx, code);
    if (current.status === 'retired') {
      throw new DomainError('WC_ILLEGAL_TRANSITION', 409, 'El recipiente está dado de baja');
    }
    const content = (await contentsFor(tx, [current.id])).get(current.id) ?? EMPTY;
    const next = {
      ...current,
      name: patch.name ?? current.name,
      kind: patch.kind ?? current.kind,
      capacity_ml: patch.capacity_ml ?? current.capacity_ml,
      has_cooling_jacket: patch.has_cooling_jacket ?? current.has_cooling_jacket,
      material: patch.material ?? current.material,
      location_id: patch.location_id ?? current.location_id,
      zone: patch.zone === undefined ? current.zone : patch.zone,
      sisv_code: patch.sisv_code === undefined ? current.sisv_code : patch.sisv_code,
      notes: patch.notes === undefined ? current.notes : patch.notes,
    };
    assertJacket(next.kind, next.has_cooling_jacket);
    if (content.volume_ml > next.capacity_ml) {
      throw new DomainError(
        'WC025',
        422,
        `El recipiente supera su capacidad (${content.volume_ml} mL > ${next.capacity_ml} mL)`,
        { capacity_ml: 'La capacidad no cubre el volumen actual' },
      );
    }
    if (content.volume_ml > 0 && (next.kind !== current.kind || next.material !== current.material)) {
      invalid({ kind: 'El recipiente tiene contenido; no se puede cambiar el tipo ni el material' });
    }
    if (content.volume_ml > 0 && next.location_id !== current.location_id) {
      invalid({ location_id: 'El recipiente tiene contenido; trasiega antes de cambiar la ubicación' });
    }
    if (next.location_id !== current.location_id) await assertLocation(tx, next.location_id);
    if (!isUuid(current.id)) throw new Error('Identificador de recipiente no válido');
    const sets = [
      sql`name = ${next.name}`,
      sql`kind = ${next.kind}`,
      sql`capacity_ml = ${next.capacity_ml}`,
      sql`has_cooling_jacket = ${next.has_cooling_jacket}`,
      sql`material = ${next.material}`,
      sql`location_id = CAST(${next.location_id} AS UUID)`,
      sql`zone = ${next.zone}`,
      sql`sisv_code = ${next.sisv_code}`,
      sql`notes = ${next.notes}`,
    ];
    auditUpdate(tx, 'cellar.vessel', current.id, current, next, `
      UPDATE cellar.vessel
      SET ${sets.join(', ')}
      WHERE id = CAST('${current.id}' AS UUID)
    `);
  });
  return getVessel(writer, request, code);
}

export async function retireVessel(writer: Writer, request: Request, code: string): Promise<VesselView> {
  const body = await readJson(request);
  const reason = requireText(body.reason, 'reason', 500);
  const user = actorFor(request, reason);
  await writer.withWrite(user, async (tx) => {
    const current = await vesselByCode(tx, code);
    if (current.status === 'retired') {
      throw new DomainError('WC_ILLEGAL_TRANSITION', 409, 'El recipiente ya está dado de baja');
    }
    const content = (await contentsFor(tx, [current.id])).get(current.id) ?? EMPTY;
    if (content.volume_ml !== 0) {
      invalid({ volume_ml: 'El recipiente tiene contenido; no se puede dar de baja' });
    }
    const drafts = await tx.read<{ total: unknown }>(sql`
      SELECT count(*)::VARCHAR AS total
      FROM cellar.operation_line l
      JOIN cellar.operation o ON o.id = l.operation_id
      WHERE l.vessel_id = CAST(${current.id} AS UUID) AND o.status = 'draft'
    `);
    if (intOf(drafts[0]?.total ?? 0) > 0) {
      invalid({ status: 'Hay operaciones en borrador sobre este recipiente' });
    }
    const next = { ...current, status: 'retired' };
    auditUpdate(tx, 'cellar.vessel', current.id, current, next, sql`
      UPDATE cellar.vessel
      SET status = 'retired'
      WHERE id = CAST(${current.id} AS UUID)
    `);
  });
  return getVessel(writer, request, code);
}

export async function vesselQr(writer: Writer, _request: Request, code: string, publicUrl: string): Promise<{
  code: string;
  qr_token: string;
  payload: string;
}> {
  const row = await vesselByCode(writer, code);
  if (row.qr_token === null || !isWinecoreQr(row.qr_token)) {
    throw new DomainError('WC_QR_FOREIGN', 422, 'El recipiente no tiene un QR de WineCore');
  }
  return { code: row.code, qr_token: row.qr_token, payload: qrPayload(publicUrl, row.qr_token) };
}

export async function resolveQr(writer: Writer, request: Request, token: string): Promise<VesselView> {
  if (!isWinecoreQr(token)) throw domainError('WC_QR_FOREIGN');
  const rows = await writer.read<{ code: string }>(sql`
    SELECT code FROM cellar.vessel WHERE qr_token = ${token}
  `);
  const code = rows[0]?.code;
  if (!code) throw domainError('WC_NOT_FOUND');
  return getVessel(writer, request, code);
}

export async function vesselHistory(writer: Writer, _request: Request, code: string): Promise<ListBody<OperationHistory>> {
  const row = await vesselByCode(writer, code);
  const url = new URL(_request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = decodeOpCursor(url.searchParams.get('cursor'));
  const filters = [sql`o.id IN (
    SELECT operation_id FROM cellar.operation_line WHERE vessel_id = CAST(${row.id} AS UUID)
    UNION
    SELECT source_id FROM inventory.stock_move
    WHERE vessel_id = CAST(${row.id} AS UUID) AND source_table = 'cellar.operation'
    UNION
    SELECT operation_id FROM cellar.cleaning_record WHERE vessel_id = CAST(${row.id} AS UUID)
  )`];
  const where = filters.join(' AND ');
  const page = [...filters];
  if (cursor) {
    page.push(sql`(
      o.occurred_at < CAST(${cursor.occurredAt} AS TIMESTAMPTZ)
      OR (o.occurred_at = CAST(${cursor.occurredAt} AS TIMESTAMPTZ) AND o.id < CAST(${cursor.id} AS UUID))
    )`);
  }
  const total = await countOf(writer, `SELECT count(*)::VARCHAR AS total FROM cellar.operation o WHERE ${where}`);
  const headers = await writer.read<Record<string, unknown>>(`
    SELECT o.id::VARCHAR AS id, o.number, o.op_type, o.occurred_at, o.status, o.reason,
           o.performed_by, o.legal_entity_id::VARCHAR AS legal_entity_id
    FROM cellar.operation o
    WHERE ${page.join(' AND ')}
    ORDER BY o.occurred_at DESC, o.id DESC
    LIMIT ${limit + 1}
  `);
  const hasMore = headers.length > limit;
  const pageRows = hasMore ? headers.slice(0, limit) : headers;
  const lines = await linesFor(writer, pageRows.map((item) => textOf(item.id)));
  const items = pageRows.map((item) => ({
    id: textOf(item.id),
    legal_entity_id: textOf(item.legal_entity_id),
    number: textOrNull(item.number),
    op_type: textOf(item.op_type),
    occurred_at: textOf(item.occurred_at),
    status: textOf(item.status),
    reason: textOrNull(item.reason),
    performed_by: textOf(item.performed_by),
    lines: lines.get(textOf(item.id)) ?? [],
  }));
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: hasMore && last ? encodeOpCursor(last.occurred_at, last.id) : null,
    total,
  };
}

export interface OperationHistory {
  id: string;
  legal_entity_id: string;
  number: string | null;
  op_type: string;
  occurred_at: string;
  status: string;
  reason: string | null;
  performed_by: string;
  lines: HistoryLine[];
}

interface HistoryLine {
  id: string;
  role: string;
  lot_id: string;
  vessel_id: string | null;
  location_id: string | null;
  product_id: string | null;
  product_state: string;
  volume_ml: number;
  qty_units: number;
  mass_g: number;
  loss_kind: string | null;
}

const VESSEL_COLUMNS = `
  v.id::VARCHAR AS id, v.code, v.name, v.kind, v.material,
  v.capacity_ml::VARCHAR AS capacity_ml, v.has_cooling_jacket,
  v.location_id::VARCHAR AS location_id, loc.code AS location_code, loc.name AS location_name,
  v.zone, v.sisv_code, v.status, v.notes, v.created_at, v.qr_token
`;

function parseCreate(body: Record<string, unknown>): {
  code: string;
  name: string;
  kind: VesselKind;
  capacity_ml: number;
  has_cooling_jacket: boolean;
  material: VesselMaterial;
  location_id: string;
  zone: string | null;
  sisv_code: string | null;
  notes: string | null;
} {
  const kind = oneOf(body.kind, 'kind', KINDS);
  const hasCooling = body.has_cooling_jacket === undefined ? false : requireBool(body.has_cooling_jacket, 'has_cooling_jacket');
  assertJacket(kind, hasCooling);
  return {
    code: requireCode(body.code),
    name: requireText(body.name, 'name', 120),
    kind,
    capacity_ml: positiveInt(body.capacity_ml, 'capacity_ml'),
    has_cooling_jacket: hasCooling,
    material: oneOf(body.material, 'material', MATERIALS),
    location_id: requireUuid(body.location_id, 'location_id'),
    zone: optionalText(body.zone, 'zone', 40),
    sisv_code: optionalText(body.sisv_code, 'sisv_code', 20),
    notes: optionalText(body.notes, 'notes', 2000),
  };
}

function parsePatch(body: Record<string, unknown>): {
  name?: string;
  kind?: VesselKind;
  capacity_ml?: number;
  has_cooling_jacket?: boolean;
  material?: VesselMaterial;
  location_id?: string;
  zone?: string | null;
  sisv_code?: string | null;
  notes?: string | null;
} {
  if ('code' in body) invalid({ code: 'El código no se modifica' });
  if ('status' in body) invalid({ status: 'El estado se cambia al dar de baja el recipiente' });
  if ('qr_token' in body) invalid({ qr_token: 'El QR no se edita' });
  const patch: ReturnType<typeof parsePatch> = {};
  if ('name' in body) patch.name = requireText(body.name, 'name', 120);
  if ('kind' in body) patch.kind = oneOf(body.kind, 'kind', KINDS);
  if ('capacity_ml' in body) patch.capacity_ml = positiveInt(body.capacity_ml, 'capacity_ml');
  if ('has_cooling_jacket' in body) patch.has_cooling_jacket = requireBool(body.has_cooling_jacket, 'has_cooling_jacket');
  if ('material' in body) patch.material = oneOf(body.material, 'material', MATERIALS);
  if ('location_id' in body) patch.location_id = requireUuid(body.location_id, 'location_id');
  if ('zone' in body) patch.zone = optionalText(body.zone, 'zone', 40);
  if ('sisv_code' in body) patch.sisv_code = optionalText(body.sisv_code, 'sisv_code', 20);
  if ('notes' in body) patch.notes = optionalText(body.notes, 'notes', 2000);
  if (Object.keys(patch).length === 0) invalid({ body: 'No hay cambios' });
  return patch;
}

function assertJacket(kind: string, hasCooling: boolean): void {
  if (kind === 'tank_fermenter' && !hasCooling) {
    invalid({ has_cooling_jacket: 'El fermentador exige camisa de frío' });
  }
}

async function assertLocation(tx: Tx, locationId: string): Promise<void> {
  const rows = await tx.read(sql`
    SELECT id FROM inventory.location
    WHERE id = CAST(${locationId} AS UUID) AND is_active
  `);
  if (rows.length === 0) invalid({ location_id: 'La ubicación no existe o está archivada' });
}

async function mintToken(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = newQrToken();
    const clash = await tx.read(sql`SELECT id FROM cellar.vessel WHERE qr_token = ${token}`);
    if (clash.length === 0) return token;
  }
  throw new Error('No se ha podido generar un QR único');
}

async function vesselByCode(source: Writer | Tx, code: string): Promise<VesselRow> {
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await source.read<Record<string, unknown>>(sql`
    SELECT
      v.id::VARCHAR AS id, v.code, v.name, v.kind, v.material,
      v.capacity_ml::VARCHAR AS capacity_ml, v.has_cooling_jacket,
      v.location_id::VARCHAR AS location_id, loc.code AS location_code, loc.name AS location_name,
      v.zone, v.sisv_code, v.status, v.notes, v.created_at, v.qr_token
    FROM cellar.vessel v
    JOIN inventory.location loc ON loc.id = v.location_id
    WHERE v.code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return rowOf(row);
}

function rowOf(row: Record<string, unknown>): VesselRow {
  return {
    id: textOf(row.id),
    code: textOf(row.code),
    name: textOf(row.name),
    kind: textOf(row.kind),
    material: textOf(row.material),
    capacity_ml: intOf(row.capacity_ml),
    has_cooling_jacket: boolOf(row.has_cooling_jacket),
    location_id: textOf(row.location_id),
    location_code: textOf(row.location_code),
    location_name: textOf(row.location_name),
    zone: textOrNull(row.zone),
    sisv_code: textOrNull(row.sisv_code),
    status: textOf(row.status),
    notes: textOrNull(row.notes),
    created_at: textOf(row.created_at),
    qr_token: textOrNull(row.qr_token),
  };
}

function toView(row: VesselRow, content: Content, includeQr: boolean): VesselView {
  const view: VesselView = {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    material: row.material,
    capacity_ml: row.capacity_ml,
    has_cooling_jacket: row.has_cooling_jacket,
    location_id: row.location_id,
    location_code: row.location_code,
    location_name: row.location_name,
    zone: row.zone,
    sisv_code: row.sisv_code,
    status: row.status,
    state: mapState(row, content),
    lot_id: content.lot_id,
    lot_code: content.lot_code,
    wine_name: content.wine_name,
    vintage: content.vintage,
    volume_ml: content.volume_ml,
    product_state: content.product_state,
    fill_pct: fillPct(content.volume_ml, row.capacity_ml),
    notes: row.notes,
    created_at: row.created_at,
  };
  if (includeQr && row.qr_token) view.qr_token = row.qr_token;
  return view;
}

function mapState(row: VesselRow, content: Content): string {
  if (row.status !== 'in_service') return row.status;
  if (content.volume_ml <= 0) return 'empty';
  if (row.kind === 'barrel' && row.material === 'oak' && content.product_state === 'wine') return 'aging';
  if (content.product_state === 'must') return 'fermenting';
  return content.product_state ?? 'empty';
}

async function contentsFor(source: Writer | Tx, vesselIds: readonly string[]): Promise<Map<string, Content>> {
  const map = new Map<string, Content>();
  if (vesselIds.length === 0) return map;
  const rows = await source.read<Record<string, unknown>>(`
    SELECT vessel_id::VARCHAR AS vessel_id, lot_id::VARCHAR AS lot_id, product_state,
           owner_entity_id::VARCHAR AS owner_entity_id,
           sum(volume_ml)::VARCHAR AS volume_ml
    FROM inventory.stock_move
    WHERE vessel_id IN (${uuidList(vesselIds)})
    GROUP BY vessel_id, lot_id, product_state, owner_entity_id
    HAVING sum(volume_ml) <> 0 OR sum(qty_units) <> 0 OR sum(mass_g) <> 0
  `);
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const id = textOf(row.vessel_id);
    const list = grouped.get(id) ?? [];
    list.push(row);
    grouped.set(id, list);
  }
  const lotIds = [...new Set(rows.map((row) => textOrNull(row.lot_id)).filter((id): id is string => id !== null))];
  const codes = new Map<string, { code: string; wine_name: string | null; vintage: number | null }>();
  if (lotIds.length > 0) {
    const lots = await source.read<{ id: string; code: string; wine_name: string | null; vintage: number | null }>(`
      SELECT l.id::VARCHAR AS id, l.code, w.name AS wine_name, l.vintage
      FROM inventory.lot l
      LEFT JOIN catalog.wine w ON w.id = l.wine_id
      WHERE l.id IN (${uuidList(lotIds)})
    `);
    for (const lot of lots) {
      codes.set(lot.id, {
        code: lot.code,
        wine_name: lot.wine_name,
        vintage: lot.vintage == null ? null : intOf(lot.vintage),
      });
    }
  }
  for (const [vesselId, list] of grouped) {
    if (list.length === 1) {
      const row = list[0];
      if (!row) continue;
      const lotId = textOrNull(row.lot_id);
      const lot = lotId ? codes.get(lotId) : undefined;
      map.set(vesselId, {
        lot_id: lotId,
        lot_code: lot?.code ?? null,
        wine_name: lot?.wine_name ?? null,
        vintage: lot?.vintage ?? null,
        volume_ml: intOf(row.volume_ml),
        product_state: textOrNull(row.product_state),
        owner_entity_id: textOrNull(row.owner_entity_id),
      });
      continue;
    }
    const volume = list.reduce((sum, row) => sum + intOf(row.volume_ml), 0);
    map.set(vesselId, { ...EMPTY, volume_ml: volume });
  }
  return map;
}

async function linesFor(source: Writer | Tx, operationIds: readonly string[]): Promise<Map<string, HistoryLine[]>> {
  const map = new Map<string, HistoryLine[]>();
  if (operationIds.length === 0) return map;
  const rows = await source.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, operation_id::VARCHAR AS operation_id, role,
           lot_id::VARCHAR AS lot_id, vessel_id::VARCHAR AS vessel_id,
           location_id::VARCHAR AS location_id, product_id::VARCHAR AS product_id,
           product_state, volume_ml::VARCHAR AS volume_ml, qty_units,
           mass_g::VARCHAR AS mass_g, loss_kind
    FROM cellar.operation_line
    WHERE operation_id IN (${uuidList(operationIds)})
    ORDER BY id
  `);
  for (const row of rows) {
    const operationId = textOf(row.operation_id);
    const list = map.get(operationId) ?? [];
    list.push({
      id: textOf(row.id),
      role: textOf(row.role),
      lot_id: textOf(row.lot_id),
      vessel_id: textOrNull(row.vessel_id),
      location_id: textOrNull(row.location_id),
      product_id: textOrNull(row.product_id),
      product_state: textOf(row.product_state),
      volume_ml: intOf(row.volume_ml),
      qty_units: intOf(row.qty_units),
      mass_g: intOf(row.mass_g),
      loss_kind: textOrNull(row.loss_kind),
    });
    map.set(operationId, list);
  }
  return map;
}

function optionalCodeCursor(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  return requireCode(value, 'cursor');
}

function optionalQuery(value: string | null, field: string, max: number): string | null {
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  if (trimmed.length > max) invalid({ [field]: `Máximo ${max} caracteres` });
  return trimmed;
}

function optionalQueryUuid(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  return requireUuid(value, 'location_id');
}

function optionalEnum<T extends string>(value: string | null, field: string, allowed: readonly T[]): T | null {
  if (value === null || value.trim() === '') return null;
  return oneOf(value, field, allowed);
}
