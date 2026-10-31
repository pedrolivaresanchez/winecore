import {
  actorFor,
  auditDelete,
  auditInsert,
  auditUpdate,
  countOf,
  invalid,
  isUuid,
  oneOf,
  optionalText,
  optionalUuid,
  parseLimit,
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
} from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { HOLDER_LABELS, ZONE_KINDS, ZONE_LABELS, type HolderKind, type ZoneKind } from './constants';
import { doubleOf, idOf, requireFinite, requireRotation, requireSpan } from './parse';
import { PLAN_METADATA, type PlanMetadata } from './plan-metadata';

export interface ZoneView {
  id: string;
  location_id: string;
  location_code: string;
  code: string;
  name: string;
  kind: ZoneKind;
  kind_label: string;
  plan_attachment_id: string | null;
  notes: string | null;
  is_active: boolean;
  positions: PositionView[];
}

export interface PositionView {
  id: string;
  zone_id: string;
  zone_code: string;
  vessel_id: string | null;
  vessel_code: string | null;
  holder_id: string | null;
  holder_code: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

interface ZoneRow {
  id: string;
  location_id: string;
  location_code: string;
  code: string;
  name: string;
  kind: ZoneKind;
  plan_attachment_id: string | null;
  notes: string | null;
  is_active: boolean;
}

interface ZonePatch {
  name?: string;
  kind?: ZoneKind;
  plan_attachment_id?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

interface Geom {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

type Reader = Pick<Writer, 'read'>;

const ZONE_COLUMNS = `
  z.id::VARCHAR AS id, z.location_id::VARCHAR AS location_id, loc.code AS location_code,
  z.code, z.name, z.kind, z.plan_attachment_id::VARCHAR AS plan_attachment_id,
  z.notes, z.is_active
`;

export async function listZones(writer: Writer, request: Request): Promise<ListBody<ZoneView> & { metadata: PlanMetadata }> {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const locationId = optionalQueryUuid(url.searchParams.get('location_id'));
  const kind = optionalKind(url.searchParams.get('kind'));
  const filters = ['TRUE'];
  if (locationId) filters.push(sql`z.location_id = CAST(${locationId} AS UUID)`);
  if (kind) filters.push(sql`z.kind = ${kind}`);
  const where = filters.join(' AND ');
  const total = await countOf(writer, `SELECT count(*)::VARCHAR AS total FROM cellar.zone z WHERE ${where}`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT ${ZONE_COLUMNS}
    FROM cellar.zone z
    JOIN inventory.location loc ON loc.id = z.location_id
    WHERE ${where}
    ORDER BY z.code
    LIMIT ${limit + 1}
  `);
  const parsed = rows.map(zoneOf);
  const positions = await positionsFor(writer, parsed.map((row) => row.id));
  return {
    ...slicePage(parsed.map((row) => toZone(row, positions.get(row.id) ?? [])), limit, total, (row) => row.code),
    metadata: PLAN_METADATA,
  };
}

export async function getZone(writer: Writer, _request: Request, code: string): Promise<ZoneView & { metadata: PlanMetadata }> {
  const row = await zoneByCode(writer, code);
  const positions = await positionsFor(writer, [row.id]);
  return { ...toZone(row, positions.get(row.id) ?? []), metadata: PLAN_METADATA };
}

export async function createZone(writer: Writer, request: Request): Promise<ZoneView> {
  const body = await readJson(request);
  const draft = {
    location_id: requireUuid(body.location_id, 'location_id'),
    code: requireCode(body.code),
    name: requireText(body.name, 'name', 120),
    kind: oneOf(body.kind, 'kind', ZONE_KINDS),
    plan_attachment_id: optionalUuid(body.plan_attachment_id, 'plan_attachment_id'),
    notes: optionalText(body.notes, 'notes', 2000),
  };
  const actor = actorFor(request, 'alta de zona');
  const code = await writer.withWrite(actor, async (tx) => {
    await assertLocation(tx, draft.location_id);
    const clash = await tx.read(sql`SELECT id FROM cellar.zone WHERE code = ${draft.code}`);
    if (clash.length > 0) invalid({ code: 'Ya existe una zona con este código' });
    await assertAttachment(tx, draft.plan_attachment_id);
    const id = newId();
    auditInsert(tx, 'cellar.zone', id, { id, ...draft, is_active: true }, sql`
      INSERT INTO cellar.zone (id, location_id, code, name, kind, plan_attachment_id, notes, is_active)
      VALUES (
        CAST(${id} AS UUID),
        CAST(${draft.location_id} AS UUID),
        ${draft.code},
        ${draft.name},
        ${draft.kind},
        CAST(${draft.plan_attachment_id} AS UUID),
        ${draft.notes},
        TRUE
      )
    `);
    if (draft.plan_attachment_id) await linkPlan(tx, id, draft.plan_attachment_id, actor.id);
    return draft.code;
  });
  return getZone(writer, request, code);
}

export async function patchZone(writer: Writer, request: Request, code: string): Promise<ZoneView> {
  const body = await readJson(request);
  const patch = parseZonePatch(body);
  const actor = actorFor(request, 'edición de zona');
  await writer.withWrite(actor, async (tx) => {
    const current = await zoneByCode(tx, code);
    const next = {
      name: patch.name ?? current.name,
      kind: patch.kind ?? current.kind,
      plan_attachment_id: patch.plan_attachment_id === undefined ? current.plan_attachment_id : patch.plan_attachment_id,
      notes: patch.notes === undefined ? current.notes : patch.notes,
      is_active: patch.is_active ?? current.is_active,
    };
    await assertAttachment(tx, next.plan_attachment_id);
    auditUpdate(tx, 'cellar.zone', current.id, {
      name: current.name,
      kind: current.kind,
      plan_attachment_id: current.plan_attachment_id,
      notes: current.notes,
      is_active: current.is_active,
    }, next, sql`
      UPDATE cellar.zone SET
        name = ${next.name},
        kind = ${next.kind},
        plan_attachment_id = CAST(${next.plan_attachment_id} AS UUID),
        notes = ${next.notes},
        is_active = ${next.is_active}
      WHERE id = CAST(${current.id} AS UUID)
    `);
    if (next.plan_attachment_id) await linkPlan(tx, current.id, next.plan_attachment_id, actor.id);
  });
  return getZone(writer, request, code);
}

export async function createPosition(writer: Writer, request: Request, zoneCode: string): Promise<PositionView & { metadata: PlanMetadata }> {
  const body = await readJson(request);
  const geom = requireGeom(body);
  const subject = readSubject(body);
  const actor = actorFor(request, 'alta de posición en el plano');
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const zone = await zoneByCode(tx, zoneCode);
    if (!zone.is_active) invalid({ code: 'La zona está archivada' });
    const resolved = await resolveSubject(tx, subject, zone.location_id);
    await assertPositionFree(tx, resolved);
    auditInsert(tx, 'cellar.plan_position', id, { id, zone_id: zone.id, ...resolved, ...geom }, sql`
      INSERT INTO cellar.plan_position (id, zone_id, vessel_id, holder_id, x, y, width, height, rotation)
      VALUES (
        CAST(${id} AS UUID),
        CAST(${zone.id} AS UUID),
        CAST(${resolved.vessel_id} AS UUID),
        CAST(${resolved.holder_id} AS UUID),
        ${geom.x},
        ${geom.y},
        ${geom.width},
        ${geom.height},
        ${geom.rotation}
      )
    `);
  });
  return { ...await positionById(writer, id), metadata: PLAN_METADATA };
}

export async function patchPosition(
  writer: Writer,
  request: Request,
  zoneCode: string,
  positionId: string,
): Promise<PositionView & { metadata: PlanMetadata }> {
  if (!isUuid(positionId)) throw domainError('WC_NOT_FOUND');
  const body = await readJson(request);
  const geom = patchGeom(body);
  const actor = actorFor(request, 'edición de posición en el plano');
  await writer.withWrite(actor, async (tx) => {
    const zone = await zoneByCode(tx, zoneCode);
    const current = await positionById(tx, positionId);
    if (current.zone_id !== zone.id) throw domainError('WC_NOT_FOUND');
    const next = {
      x: geom.x ?? current.x,
      y: geom.y ?? current.y,
      width: geom.width ?? current.width,
      height: geom.height ?? current.height,
      rotation: geom.rotation ?? current.rotation,
    };
    auditUpdate(tx, 'cellar.plan_position', positionId, {
      x: current.x, y: current.y, width: current.width, height: current.height, rotation: current.rotation,
    }, next, sql`
      UPDATE cellar.plan_position SET
        x = ${next.x}, y = ${next.y}, width = ${next.width}, height = ${next.height}, rotation = ${next.rotation}
      WHERE id = CAST(${positionId} AS UUID)
    `);
  });
  return { ...await positionById(writer, positionId), metadata: PLAN_METADATA };
}

export async function deletePosition(
  writer: Writer,
  request: Request,
  zoneCode: string,
  positionId: string,
): Promise<{ id: string; deleted: true; vessel_code: string | null; holder_code: string | null }> {
  if (!isUuid(positionId)) throw domainError('WC_NOT_FOUND');
  const actor = actorFor(request, 'quitar del plano');
  const removed = await writer.withWrite(actor, async (tx) => {
    const zone = await zoneByCode(tx, zoneCode);
    const current = await positionById(tx, positionId);
    if (current.zone_id !== zone.id) throw domainError('WC_NOT_FOUND');
    auditDelete(tx, 'cellar.plan_position', positionId, current, sql`
      DELETE FROM cellar.plan_position WHERE id = CAST(${positionId} AS UUID)
    `);
    return { vessel_code: current.vessel_code, holder_code: current.holder_code };
  });
  return { id: positionId, deleted: true, ...removed };
}

function toZone(row: ZoneRow, positions: PositionView[]): ZoneView {
  return { ...row, kind_label: ZONE_LABELS[row.kind], positions };
}

function zoneOf(row: Record<string, unknown>): ZoneRow {
  const kind = textOf(row.kind);
  if (!(ZONE_KINDS as readonly string[]).includes(kind)) throw new Error('Tipo de zona no válido');
  return {
    id: idOf(row.id),
    location_id: idOf(row.location_id),
    location_code: textOf(row.location_code),
    code: textOf(row.code),
    name: textOf(row.name),
    kind: kind as ZoneKind,
    plan_attachment_id: row.plan_attachment_id == null ? null : idOf(row.plan_attachment_id),
    notes: textOrNull(row.notes),
    is_active: row.is_active === true,
  };
}

async function zoneByCode(source: Reader, code: string): Promise<ZoneRow> {
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await source.read<Record<string, unknown>>(sql`
    SELECT z.id::VARCHAR AS id, z.location_id::VARCHAR AS location_id, loc.code AS location_code,
           z.code, z.name, z.kind, z.plan_attachment_id::VARCHAR AS plan_attachment_id, z.notes, z.is_active
    FROM cellar.zone z
    JOIN inventory.location loc ON loc.id = z.location_id
    WHERE z.code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return zoneOf(row);
}

async function positionsFor(source: Reader, zoneIds: readonly string[]): Promise<Map<string, PositionView[]>> {
  const map = new Map<string, PositionView[]>();
  if (zoneIds.length === 0) return map;
  const rows = await source.read<Record<string, unknown>>(`
    SELECT p.id::VARCHAR AS id, p.zone_id::VARCHAR AS zone_id, z.code AS zone_code,
           p.vessel_id::VARCHAR AS vessel_id, v.code AS vessel_code,
           p.holder_id::VARCHAR AS holder_id, h.code AS holder_code,
           p.x, p.y, p.width, p.height, p.rotation
    FROM cellar.plan_position p
    JOIN cellar.zone z ON z.id = p.zone_id
    LEFT JOIN cellar.vessel v ON v.id = p.vessel_id
    LEFT JOIN cellar.holder h ON h.id = p.holder_id
    WHERE p.zone_id IN (${uuidList(zoneIds)})
    ORDER BY z.code, coalesce(v.code, h.code)
  `);
  for (const row of rows) {
    const view = positionOf(row);
    const list = map.get(view.zone_id) ?? [];
    list.push(view);
    map.set(view.zone_id, list);
  }
  return map;
}

async function positionById(source: Reader, id: string): Promise<PositionView> {
  const rows = await source.read<Record<string, unknown>>(sql`
    SELECT p.id::VARCHAR AS id, p.zone_id::VARCHAR AS zone_id, z.code AS zone_code,
           p.vessel_id::VARCHAR AS vessel_id, v.code AS vessel_code,
           p.holder_id::VARCHAR AS holder_id, h.code AS holder_code,
           p.x, p.y, p.width, p.height, p.rotation
    FROM cellar.plan_position p
    JOIN cellar.zone z ON z.id = p.zone_id
    LEFT JOIN cellar.vessel v ON v.id = p.vessel_id
    LEFT JOIN cellar.holder h ON h.id = p.holder_id
    WHERE p.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return positionOf(row);
}

function positionOf(row: Record<string, unknown>): PositionView {
  return {
    id: idOf(row.id),
    zone_id: idOf(row.zone_id),
    zone_code: textOf(row.zone_code),
    vessel_id: row.vessel_id == null ? null : idOf(row.vessel_id),
    vessel_code: textOrNull(row.vessel_code),
    holder_id: row.holder_id == null ? null : idOf(row.holder_id),
    holder_code: textOrNull(row.holder_code),
    x: doubleOf(row.x),
    y: doubleOf(row.y),
    width: doubleOf(row.width),
    height: doubleOf(row.height),
    rotation: doubleOf(row.rotation),
  };
}

function parseZonePatch(body: Record<string, unknown>): ZonePatch {
  if ('code' in body) invalid({ code: 'El código no se modifica' });
  if ('location_id' in body) invalid({ location_id: 'La ubicación de la zona no se cambia' });
  const patch: ZonePatch = {};
  if ('name' in body) patch.name = requireText(body.name, 'name', 120);
  if ('kind' in body) patch.kind = oneOf(body.kind, 'kind', ZONE_KINDS);
  if ('plan_attachment_id' in body) patch.plan_attachment_id = optionalUuid(body.plan_attachment_id, 'plan_attachment_id');
  if ('notes' in body) patch.notes = optionalText(body.notes, 'notes', 2000);
  if ('is_active' in body) patch.is_active = requireBool(body.is_active, 'is_active');
  if (Object.keys(patch).length === 0) invalid({ body: 'No hay cambios' });
  return patch;
}

function requireGeom(body: Record<string, unknown>): Geom {
  if (!('x' in body) || !('y' in body) || !('width' in body) || !('height' in body) || !('rotation' in body)) {
    invalid({ x: 'Faltan coordenadas (x, y, width, height, rotation)' });
  }
  return {
    x: requireFinite(body.x, 'x'),
    y: requireFinite(body.y, 'y'),
    width: requireSpan(body.width, 'width'),
    height: requireSpan(body.height, 'height'),
    rotation: requireRotation(body.rotation),
  };
}

function patchGeom(body: Record<string, unknown>): Partial<Geom> {
  const geom: Partial<Geom> = {};
  if ('x' in body) geom.x = requireFinite(body.x, 'x');
  if ('y' in body) geom.y = requireFinite(body.y, 'y');
  if ('width' in body) geom.width = requireSpan(body.width, 'width');
  if ('height' in body) geom.height = requireSpan(body.height, 'height');
  if ('rotation' in body) geom.rotation = requireRotation(body.rotation);
  if (Object.keys(geom).length === 0) invalid({ body: 'No hay cambios' });
  return geom;
}

interface SubjectInput {
  vessel_id: string | null;
  vessel_code: string | null;
  holder_id: string | null;
  holder_code: string | null;
}

function readSubject(body: Record<string, unknown>): SubjectInput {
  const vesselId = blank(body.vessel_id) ? null : requireUuid(body.vessel_id, 'vessel_id');
  const vesselCode = blank(body.vessel_code) ? null : requireCode(body.vessel_code, 'vessel_code');
  const holderId = blank(body.holder_id) ? null : requireUuid(body.holder_id, 'holder_id');
  const holderCode = blank(body.holder_code) ? null : requireCode(body.holder_code, 'holder_code');
  const vessel = vesselId !== null || vesselCode !== null;
  const holder = holderId !== null || holderCode !== null;
  if (vessel === holder) invalid({ vessel_code: 'Indica un recipiente o un soporte, no los dos' });
  return { vessel_id: vesselId, vessel_code: vesselCode, holder_id: holderId, holder_code: holderCode };
}

function blank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

async function resolveSubject(
  tx: Tx,
  subject: SubjectInput,
  locationId: string,
): Promise<{ vessel_id: string | null; holder_id: string | null }> {
  if (subject.vessel_id || subject.vessel_code) {
    const rows = await tx.read<{ id: string; location_id: string }>(subject.vessel_id
      ? sql`SELECT id::VARCHAR AS id, location_id::VARCHAR AS location_id FROM cellar.vessel WHERE id = CAST(${subject.vessel_id} AS UUID)`
      : sql`SELECT id::VARCHAR AS id, location_id::VARCHAR AS location_id FROM cellar.vessel WHERE code = ${subject.vessel_code}`);
    const row = rows[0];
    if (!row) invalid({ vessel_code: 'El recipiente no existe' });
    if (idOf(row.location_id) !== locationId) invalid({ vessel_code: 'El recipiente no está en la ubicación de la zona' });
    return { vessel_id: idOf(row.id), holder_id: null };
  }
  const rows = await tx.read<{ id: string; location_id: string; kind: string }>(subject.holder_id
    ? sql`SELECT id::VARCHAR AS id, location_id::VARCHAR AS location_id, kind FROM cellar.holder WHERE id = CAST(${subject.holder_id} AS UUID)`
    : sql`SELECT id::VARCHAR AS id, location_id::VARCHAR AS location_id, kind FROM cellar.holder WHERE code = ${subject.holder_code}`);
  const row = rows[0];
  if (!row) invalid({ holder_code: 'El soporte no existe' });
  if (idOf(row.location_id) !== locationId) invalid({ holder_code: 'El soporte no está en la ubicación de la zona' });
  if (!(row.kind in HOLDER_LABELS)) invalid({ holder_code: 'El soporte no es un nicho ni un jaulón' });
  return { vessel_id: null, holder_id: idOf(row.id) };
}

async function assertPositionFree(tx: Tx, subject: { vessel_id: string | null; holder_id: string | null }): Promise<void> {
  if (subject.vessel_id) {
    const rows = await tx.read(sql`SELECT id FROM cellar.plan_position WHERE vessel_id = CAST(${subject.vessel_id} AS UUID)`);
    if (rows.length > 0) invalid({ vessel_code: 'El recipiente ya está en el plano' });
  }
  if (subject.holder_id) {
    const rows = await tx.read(sql`SELECT id FROM cellar.plan_position WHERE holder_id = CAST(${subject.holder_id} AS UUID)`);
    if (rows.length > 0) invalid({ holder_code: 'El soporte ya está en el plano' });
  }
}

async function assertLocation(tx: Tx, locationId: string): Promise<void> {
  const rows = await tx.read(sql`
    SELECT id FROM inventory.location WHERE id = CAST(${locationId} AS UUID) AND is_active
  `);
  if (rows.length === 0) invalid({ location_id: 'La ubicación no existe o está archivada' });
}

async function assertAttachment(tx: Tx, attachmentId: string | null): Promise<void> {
  if (attachmentId === null) return;
  const rows = await tx.read(sql`SELECT id FROM core.attachment WHERE id = CAST(${attachmentId} AS UUID)`);
  if (rows.length === 0) invalid({ plan_attachment_id: 'El adjunto no existe' });
}

async function linkPlan(tx: Tx, zoneId: string, attachmentId: string, actorId: string): Promise<void> {
  const existing = await tx.read(sql`
    SELECT id FROM core.attachment_link
    WHERE attachment_id = CAST(${attachmentId} AS UUID)
      AND entity_table = 'cellar.zone'
      AND entity_id = CAST(${zoneId} AS UUID)
      AND role = 'other'
  `);
  if (existing.length > 0) return;
  const id = newId();
  auditInsert(tx, 'core.attachment_link', id, {
    attachment_id: attachmentId,
    entity_table: 'cellar.zone',
    entity_id: zoneId,
    role: 'other',
  }, sql`
    INSERT INTO core.attachment_link (id, attachment_id, entity_table, entity_id, role, created_by)
    VALUES (
      CAST(${id} AS UUID), CAST(${attachmentId} AS UUID), 'cellar.zone', CAST(${zoneId} AS UUID), 'other', ${actorId}
    )
  `);
}

function optionalKind(value: string | null): ZoneKind | null {
  if (value === null || value.trim() === '') return null;
  return oneOf(value, 'kind', ZONE_KINDS);
}

function optionalQueryUuid(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  return requireUuid(value, 'location_id');
}

export function holderKindLabel(kind: string): string {
  if (kind === 'nicho' || kind === 'jaulon') return HOLDER_LABELS[kind as HolderKind];
  return kind;
}
