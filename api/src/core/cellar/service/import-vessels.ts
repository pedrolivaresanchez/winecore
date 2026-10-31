import { newId } from '../../ids';
import { sql } from '../../db/sql';
import type { Tx, Writer } from '../../db/writer';
import { newQrToken } from '../qr';
import { ZONE_KINDS, type ZoneKind } from '../../cellar-assets/constants';
import { deletePlanPosition, insertPlanPosition } from '../../cellar-assets/zones';
import { doubleOf } from '../../cellar-assets/parse';
import {
  CODE_RE,
  actorFor,
  auditInsert,
  auditUpdate,
  boolOf,
  intOf,
  invalid,
  readJson,
  requireUuid,
  textOf,
  textOrNull,
  uuidList,
} from './http';

const KINDS = ['tank_storage', 'tank_fermenter', 'barrel', 'demijohn', 'ibc', 'other'] as const;
const MATERIALS = ['stainless_steel', 'oak', 'glass', 'concrete', 'plastic', 'other'] as const;
const STATUSES = ['in_service', 'out_of_service', 'retired'] as const;
const MAX_ROWS = 500;
const MAX_BYTES = 1_000_000;
const NAME_MAX = 120;
const ZONE_MAX = 40;
const BOARD_W = 1000;
const GAP = 16;

type VesselKind = (typeof KINDS)[number];
type VesselMaterial = (typeof MATERIALS)[number];
type VesselStatus = (typeof STATUSES)[number];

const HEADER = 'code,name,kind,capacity_litres,material,cooling,zone,status';
const EXAMPLE = 'EJ-01,Depósito de ejemplo,tank_storage,1000,stainless_steel,no,Nave ejemplo,in_service';

const COLUMN_ALIAS: Record<string, string> = {
  code: 'code',
  codigo: 'code',
  name: 'name',
  nombre: 'name',
  kind: 'kind',
  tipo: 'kind',
  capacity_litres: 'capacity_litres',
  capacidad: 'capacity_litres',
  litros: 'capacity_litres',
  capacity: 'capacity_litres',
  material: 'material',
  cooling: 'cooling',
  frio: 'cooling',
  camisa: 'cooling',
  zone: 'zone',
  zona: 'zone',
  status: 'status',
  estado: 'status',
  zone_kind: 'zone_kind',
  tipo_zona: 'zone_kind',
  tipo_de_zona: 'zone_kind',
};

const REQUIRED = ['code', 'name', 'kind', 'capacity_litres', 'material'] as const;

export interface VesselImportError {
  row: number;
  code: string | null;
  message: string;
}

export interface VesselImportRow {
  row: number;
  code: string;
  result: 'created' | 'updated' | 'skipped';
  zone_code: string | null;
}

export interface VesselImportReport {
  created: number;
  updated: number;
  skipped: number;
  errors: VesselImportError[];
  rows: VesselImportRow[];
}

interface Draft {
  row: number;
  code: string;
  name: string;
  kind: VesselKind;
  capacityMl: number;
  material: VesselMaterial;
  cooling: boolean;
  zoneName: string | null;
  zoneKind: ZoneKind | null;
  status: VesselStatus | null;
}

interface Geom {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

interface MemPosition {
  id: string;
  zoneId: string;
  fresh: boolean;
  geom: Geom;
}

interface MemVessel {
  id: string;
  code: string;
  name: string;
  kind: string;
  material: string;
  capacityMl: number;
  cooling: boolean;
  locationId: string;
  zone: string | null;
  status: string;
  volumeMl: number;
  fresh: boolean;
  inserted: { name: string; capacityMl: number; zone: string | null; status: string; kind: string; material: string; cooling: boolean; token: string };
  position: MemPosition | null;
}

interface MemZone {
  id: string;
  code: string;
  name: string;
  kind: ZoneKind;
  active: boolean;
  fresh: boolean;
  reactivate: boolean;
  taken: Geom[];
}

interface ParsedRow {
  draft?: Draft;
  error?: VesselImportError;
}

export function vesselImportTemplate(): Response {
  const body = `${HEADER}\r\n${EXAMPLE}\r\n`;
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="recipientes.csv"',
    },
  });
}

export async function importVessels(writer: Writer, request: Request): Promise<VesselImportReport> {
  const type = request.headers.get('content-type') ?? '';
  const loaded = type.includes('multipart/form-data')
    ? await loadForm(request)
    : await loadJson(request);
  await assertLocation(writer, loaded.locationId);
  const parsed = loaded.rows;
  const errors = parsed.flatMap((row) => (row.error ? [row.error] : []));
  const drafts = parsed.flatMap((row) => (row.draft ? [row.draft] : []));
  if (drafts.length === 0) return reportOf([], errors);
  const user = actorFor(request, 'importación de recipientes');
  const applied = await writer.withWrite(user, async (tx) => applyDrafts(tx, loaded.locationId, drafts));
  return reportOf(applied, [...errors, ...applied.flatMap((row) => (row.error ? [row.error] : []))].sort((a, b) => a.row - b.row));
}

function reportOf(applied: ApplyRow[], errors: VesselImportError[]): VesselImportReport {
  const rows = applied.flatMap((row) => (row.row ? [row.row] : []));
  return {
    created: rows.filter((row) => row.result === 'created').length,
    updated: rows.filter((row) => row.result === 'updated').length,
    skipped: rows.filter((row) => row.result === 'skipped').length,
    errors,
    rows,
  };
}

interface ApplyRow {
  row?: VesselImportRow;
  error?: VesselImportError;
}

async function applyDrafts(tx: Tx, locationId: string, drafts: Draft[]): Promise<ApplyRow[]> {
  const codes = [...new Set(drafts.map((draft) => draft.code))];
  const vessels = new Map<string, MemVessel>();
  const existing = await tx.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, code, name, kind, material,
           capacity_ml::VARCHAR AS capacity_ml, has_cooling_jacket,
           location_id::VARCHAR AS location_id, zone, status
    FROM cellar.vessel
    WHERE code IN (${codes.map((code) => sql`${code}`).join(', ')})
  `);
  const ids = existing.map((row) => textOf(row.id));
  const volumes = new Map<string, number>();
  if (ids.length > 0) {
    const sums = await tx.read<Record<string, unknown>>(`
      SELECT vessel_id::VARCHAR AS vessel_id, coalesce(sum(volume_ml), 0)::VARCHAR AS volume_ml
      FROM inventory.stock_move
      WHERE vessel_id IN (${uuidList(ids)})
      GROUP BY vessel_id
    `);
    for (const row of sums) volumes.set(textOf(row.vessel_id), intOf(row.volume_ml));
  }
  for (const row of existing) {
    const id = textOf(row.id);
    const vessel = vesselOf(row, volumes.get(id) ?? 0);
    vessels.set(vessel.code, vessel);
  }

  const zones = new Map<string, MemZone>();
  const takenCodes = new Set<string>();
  const zoneRows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name, kind, is_active
    FROM cellar.zone
    WHERE location_id = CAST(${locationId} AS UUID)
  `);
  for (const row of zoneRows) {
    const zone = zoneOf(row);
    zones.set(zone.id, zone);
    takenCodes.add(zone.code);
  }
  const allCodes = await tx.read<{ code: string }>('SELECT code FROM cellar.zone');
  for (const row of allCodes) takenCodes.add(textOf(row.code));

  const positionWhere = ids.length === 0
    ? sql`z.location_id = CAST(${locationId} AS UUID)`
    : `(${sql`z.location_id = CAST(${locationId} AS UUID)`} OR p.vessel_id IN (${uuidList(ids)}))`;
  const positions = await tx.read<Record<string, unknown>>(`
    SELECT p.id::VARCHAR AS id, p.zone_id::VARCHAR AS zone_id,
           p.vessel_id::VARCHAR AS vessel_id,
           p.x, p.y, p.width, p.height, p.rotation
    FROM cellar.plan_position p
    JOIN cellar.zone z ON z.id = p.zone_id
    WHERE ${positionWhere}
  `);
  for (const row of positions) {
    const zoneId = textOf(row.zone_id);
    const geom: Geom = {
      x: doubleOf(row.x),
      y: doubleOf(row.y),
      width: doubleOf(row.width),
      height: doubleOf(row.height),
      rotation: doubleOf(row.rotation),
    };
    const zone = zones.get(zoneId);
    if (zone) zone.taken.push(geom);
    const vesselId = textOrNull(row.vessel_id);
    if (!vesselId) continue;
    const vessel = [...vessels.values()].find((item) => item.id === vesselId);
    if (!vessel || vessel.position) continue;
    vessel.position = { id: textOf(row.id), zoneId, fresh: false, geom };
  }

  const positionInserts: { id: string; zoneId: string; vesselId: string; geom: Geom }[] = [];
  const positionDeletes: { id: string; before: MemPosition & { vesselId: string } }[] = [];
  const results: ApplyRow[] = [];

  for (const draft of drafts) {
    const current = vessels.get(draft.code);
    if (current && current.locationId !== locationId) {
      results.push({ error: { row: draft.row, code: draft.code, message: 'El código ya existe en otra ubicación' } });
      continue;
    }
    if (current && current.status === 'retired') {
      results.push({ error: { row: draft.row, code: draft.code, message: 'El recipiente está dado de baja' } });
      continue;
    }
    if (current && (current.kind !== draft.kind || current.material !== draft.material || current.cooling !== draft.cooling)) {
      results.push({ error: { row: draft.row, code: draft.code, message: 'El código ya existe con otro tipo, material o frío' } });
      continue;
    }
    if (current && draft.status !== null && draft.status !== current.status) {
      results.push({ error: { row: draft.row, code: draft.code, message: 'El estado no se cambia al importar' } });
      continue;
    }
    if (current && draft.capacityMl < current.volumeMl) {
      results.push({ error: { row: draft.row, code: draft.code, message: 'La capacidad no cubre el volumen actual' } });
      continue;
    }

    const zone = draft.zoneName === null
      ? null
      : ensureZone(zones, takenCodes, draft.zoneName, draft.zoneKind ?? 'elaboration');
    const nextZone = zone ? zone.name : current?.zone ?? null;

    if (!current) {
      const status = draft.status ?? 'in_service';
      const vessel: MemVessel = {
        id: newId(),
        code: draft.code,
        name: draft.name,
        kind: draft.kind,
        material: draft.material,
        capacityMl: draft.capacityMl,
        cooling: draft.cooling,
        locationId,
        zone: nextZone,
        status,
        volumeMl: 0,
        fresh: true,
        inserted: {
          name: draft.name,
          capacityMl: draft.capacityMl,
          zone: nextZone,
          status,
          kind: draft.kind,
          material: draft.material,
          cooling: draft.cooling,
          token: newQrToken(),
        },
        position: null,
      };
      vessels.set(draft.code, vessel);
      if (zone) place(vessel, zone, zones, positionInserts, positionDeletes);
      results.push({ row: { row: draft.row, code: draft.code, result: 'created', zone_code: zone?.code ?? null } });
      continue;
    }

    const changed = current.name !== draft.name || current.capacityMl !== draft.capacityMl || current.zone !== nextZone;
    current.name = draft.name;
    current.capacityMl = draft.capacityMl;
    current.zone = nextZone;
    const placedNow = zone ? place(current, zone, zones, positionInserts, positionDeletes) : false;
    results.push({
      row: {
        row: draft.row,
        code: draft.code,
        result: changed || placedNow ? 'updated' : 'skipped',
        zone_code: zone?.code ?? null,
      },
    });
  }

  for (const zone of zones.values()) {
    if (!zone.fresh) continue;
    auditInsert(tx, 'cellar.zone', zone.id, {
      id: zone.id,
      location_id: locationId,
      code: zone.code,
      name: zone.name,
      kind: zone.kind,
      is_active: true,
    }, sql`
      INSERT INTO cellar.zone (id, location_id, code, name, kind, plan_attachment_id, notes, is_active)
      VALUES (
        CAST(${zone.id} AS UUID),
        CAST(${locationId} AS UUID),
        ${zone.code},
        ${zone.name},
        ${zone.kind},
        NULL,
        NULL,
        TRUE
      )
    `);
  }
  for (const zone of zones.values()) {
    if (!zone.reactivate) continue;
    auditUpdate(tx, 'cellar.zone', zone.id, { is_active: false }, { is_active: true }, sql`
      UPDATE cellar.zone SET is_active = TRUE WHERE id = CAST(${zone.id} AS UUID)
    `);
  }
  for (const vessel of vessels.values()) {
    if (!vessel.fresh) continue;
    const born = vessel.inserted;
    auditInsert(tx, 'cellar.vessel', vessel.id, {
      id: vessel.id,
      code: vessel.code,
      name: born.name,
      kind: born.kind,
      capacity_ml: born.capacityMl,
      has_cooling_jacket: born.cooling,
      material: born.material,
      location_id: locationId,
      zone: born.zone,
      status: born.status,
      qr_token: born.token,
    }, sql`
      INSERT INTO cellar.vessel (
        id, code, name, kind, capacity_ml, has_cooling_jacket, material,
        location_id, zone, sisv_code, qr_token, status, notes
      ) VALUES (
        CAST(${vessel.id} AS UUID),
        ${vessel.code},
        ${born.name},
        ${born.kind},
        ${born.capacityMl},
        ${born.cooling},
        ${born.material},
        CAST(${locationId} AS UUID),
        ${born.zone},
        NULL,
        ${born.token},
        ${born.status},
        NULL
      )
    `);
    if (born.name !== vessel.name || born.capacityMl !== vessel.capacityMl || born.zone !== vessel.zone) {
      auditUpdate(tx, 'cellar.vessel', vessel.id, {
        name: born.name,
        capacity_ml: born.capacityMl,
        zone: born.zone,
      }, {
        name: vessel.name,
        capacity_ml: vessel.capacityMl,
        zone: vessel.zone,
      }, sql`
        UPDATE cellar.vessel
        SET name = ${vessel.name}, capacity_ml = ${vessel.capacityMl}, zone = ${vessel.zone}
        WHERE id = CAST(${vessel.id} AS UUID)
      `);
    }
  }
  for (const vessel of vessels.values()) {
    if (vessel.fresh) continue;
    const born = vessel.inserted;
    if (born.name === vessel.name && born.capacityMl === vessel.capacityMl && born.zone === vessel.zone) continue;
    auditUpdate(tx, 'cellar.vessel', vessel.id, {
      name: born.name,
      capacity_ml: born.capacityMl,
      zone: born.zone,
    }, {
      name: vessel.name,
      capacity_ml: vessel.capacityMl,
      zone: vessel.zone,
    }, sql`
      UPDATE cellar.vessel
      SET name = ${vessel.name}, capacity_ml = ${vessel.capacityMl}, zone = ${vessel.zone}
      WHERE id = CAST(${vessel.id} AS UUID)
    `);
  }
  for (const position of positionDeletes) {
    deletePlanPosition(tx, position.id, {
      id: position.before.id,
      zone_id: position.before.zoneId,
      vessel_id: position.before.vesselId,
      x: position.before.geom.x,
      y: position.before.geom.y,
      width: position.before.geom.width,
      height: position.before.geom.height,
      rotation: position.before.geom.rotation,
    });
  }
  for (const position of positionInserts) {
    insertPlanPosition(tx, position.id, position.zoneId, position.vesselId, null, position.geom);
  }
  return results;
}

function place(
  vessel: MemVessel,
  zone: MemZone,
  zones: Map<string, MemZone>,
  inserts: { id: string; zoneId: string; vesselId: string; geom: Geom }[],
  deletes: { id: string; before: MemPosition & { vesselId: string } }[],
): boolean {
  if (vessel.position && vessel.position.zoneId === zone.id) return false;
  const previous = vessel.position;
  if (previous) {
    if (previous.fresh) {
      const index = inserts.findIndex((item) => item.id === previous.id);
      if (index >= 0) inserts.splice(index, 1);
    } else {
      deletes.push({ id: previous.id, before: { ...previous, vesselId: vessel.id } });
    }
    const owner = zones.get(previous.zoneId);
    if (owner) owner.taken = owner.taken.filter((item) => item !== previous.geom);
    vessel.position = null;
  }
  const size = markerSize(vessel.kind);
  const geom = nextSlot(zone.taken, size.width, size.height);
  const id = newId();
  inserts.push({ id, zoneId: zone.id, vesselId: vessel.id, geom });
  zone.taken.push(geom);
  vessel.position = { id, zoneId: zone.id, fresh: true, geom };
  return true;
}

function ensureZone(
  zones: Map<string, MemZone>,
  takenCodes: Set<string>,
  name: string,
  kind: ZoneKind,
): MemZone {
  const found = [...zones.values()].find((zone) => sameName(zone.name, name));
  if (found) {
    if (!found.active) {
      found.active = true;
      found.reactivate = !found.fresh;
    }
    return found;
  }
  const zone: MemZone = {
    id: newId(),
    code: allocateCode(name, takenCodes),
    name,
    kind,
    active: true,
    fresh: true,
    reactivate: false,
    taken: [],
  };
  zones.set(zone.id, zone);
  return zone;
}

function vesselOf(row: Record<string, unknown>, volumeMl: number): MemVessel {
  const name = textOf(row.name);
  const capacityMl = intOf(row.capacity_ml);
  const zone = textOrNull(row.zone);
  const status = textOf(row.status);
  const kind = textOf(row.kind);
  const material = textOf(row.material);
  const cooling = boolOf(row.has_cooling_jacket);
  return {
    id: textOf(row.id),
    code: textOf(row.code),
    name,
    kind,
    material,
    capacityMl,
    cooling,
    locationId: textOf(row.location_id),
    zone,
    status,
    volumeMl,
    fresh: false,
    inserted: { name, capacityMl, zone, status, kind, material, cooling, token: '' },
    position: null,
  };
}

function zoneOf(row: Record<string, unknown>): MemZone {
  const kind = textOf(row.kind);
  if (!(ZONE_KINDS as readonly string[]).includes(kind)) throw new Error('Tipo de zona no válido');
  return {
    id: textOf(row.id),
    code: textOf(row.code),
    name: textOf(row.name),
    kind: kind as ZoneKind,
    active: row.is_active === true,
    fresh: false,
    reactivate: false,
    taken: [],
  };
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase('es') === right.trim().toLocaleLowerCase('es');
}

function allocateCode(name: string, taken: Set<string>): string {
  const folded = name.normalize('NFD').replace(/\p{M}/gu, '');
  let slug = folded.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length < 2) slug = 'ZN';
  slug = slug.slice(0, 20).replace(/-+$/g, '');
  if (slug.length < 2 || !CODE_RE.test(slug)) slug = 'ZN';
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  for (let n = 2; n < 100; n += 1) {
    const suffix = `-${n}`;
    const head = slug.slice(0, 20 - suffix.length).replace(/-+$/g, '');
    const candidate = `${head}${suffix}`;
    if (CODE_RE.test(candidate) && !taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error('No hay un código de zona libre');
}

function markerSize(kind: string): { width: number; height: number } {
  switch (kind) {
    case 'barrel':
      return { width: 108, height: 64 };
    case 'demijohn':
      return { width: 92, height: 92 };
    case 'ibc':
      return { width: 96, height: 96 };
    case 'tank_fermenter':
      return { width: 108, height: 118 };
    case 'tank_storage':
      return { width: 136, height: 88 };
    default:
      return { width: 110, height: 78 };
  }
}

function nextSlot(taken: readonly Geom[], width: number, height: number): Geom {
  const cols = Math.max(1, Math.floor((BOARD_W - 48) / (width + GAP)));
  for (let index = 0; index < 96; index += 1) {
    const x = 24 + (index % cols) * (width + GAP);
    const y = 24 + Math.floor(index / cols) * (height + GAP);
    const hits = taken.some(
      (geom) => x < geom.x + geom.width && x + width > geom.x && y < geom.y + geom.height && y + height > geom.y,
    );
    if (!hits) return { x, y, width, height, rotation: 0 };
  }
  const bottom = taken.reduce((max, geom) => Math.max(max, geom.y + geom.height), 24);
  return { x: 24, y: bottom + GAP, width, height, rotation: 0 };
}

async function assertLocation(writer: Writer, locationId: string): Promise<void> {
  const rows = await writer.read(sql`
    SELECT id FROM inventory.location
    WHERE id = CAST(${locationId} AS UUID) AND is_active
  `);
  if (rows.length === 0) invalid({ location_id: 'La ubicación no existe o está archivada' });
}

async function loadJson(request: Request): Promise<{ locationId: string; rows: ParsedRow[] }> {
  const body = await readJson(request);
  const locationId = requireUuid(body.location_id, 'location_id');
  if (!Array.isArray(body.rows)) invalid({ rows: 'Faltan las filas' });
  if (body.rows.length === 0) invalid({ rows: 'No hay filas' });
  if (body.rows.length > MAX_ROWS) invalid({ rows: 'Demasiadas filas (máximo 500)' });
  const rows = body.rows.map((value, index) => parseJsonRow(value, index + 1));
  return { locationId, rows };
}

type RequestForm = Awaited<ReturnType<Request['formData']>>;

async function loadForm(request: Request): Promise<{ locationId: string; rows: ParsedRow[] }> {
  let form: RequestForm;
  try {
    form = await request.formData();
  } catch {
    invalid({ body: 'Se espera multipart con el fichero' });
  }
  const locationRaw = form.get('location_id');
  if (typeof locationRaw !== 'string') invalid({ location_id: 'Debe ser un UUID' });
  const locationId = requireUuid(locationRaw, 'location_id');
  const csv = await csvText(form);
  if (csv.length > MAX_BYTES) invalid({ body: 'El fichero es demasiado grande' });
  return { locationId, rows: parseCsvRows(csv) };
}

async function csvText(form: RequestForm): Promise<string> {
  const file = form.get('file') ?? form.get('csv');
  if (typeof File !== 'undefined' && file instanceof File) {
    if (file.size > MAX_BYTES) invalid({ body: 'El fichero es demasiado grande' });
    return file.text();
  }
  if (typeof Blob !== 'undefined' && file instanceof Blob) {
    if (file.size > MAX_BYTES) invalid({ body: 'El fichero es demasiado grande' });
    return file.text();
  }
  if (typeof file === 'string') return file;
  invalid({ body: 'Se espera multipart con el fichero' });
}

function parseJsonRow(value: unknown, row: number): ParsedRow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { error: { row, code: null, message: 'La fila no es un objeto' } };
  }
  const record: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const canonical = columnKey(key);
    if (!canonical) continue;
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw === 'boolean') record[canonical] = raw ? 'si' : 'no';
    else if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return { error: { row, code: null, message: 'La capacidad debe ser litros positivos' } };
      record[canonical] = String(raw);
    } else if (typeof raw === 'string') record[canonical] = raw;
    else return { error: { row, code: codeOf(record), message: 'La fila tiene un valor no válido' } };
  }
  return parseRecord(record, row);
}

function parseCsvRows(text: string): ParsedRow[] {
  const table = parseCsvTable(text);
  const headerRow = table.find((row) => row.cells.some((cell) => cell.trim() !== ''));
  if (!headerRow) invalid({ body: 'No hay filas' });
  const columns: (string | null)[] = [];
  const seen = new Set<string>();
  for (const cell of headerRow.cells) {
    const key = columnKey(cell);
    if (key && seen.has(key)) invalid({ body: `Columna repetida: ${key}` });
    if (key) seen.add(key);
    columns.push(key);
  }
  const missing = REQUIRED.filter((key) => !seen.has(key));
  if (missing.length > 0) invalid({ body: `Faltan columnas: ${missing.join(', ')}` });
  const data = table.filter((row) => row.line > headerRow.line && row.cells.some((cell) => cell.trim() !== ''));
  if (data.length === 0) invalid({ rows: 'No hay filas' });
  if (data.length > MAX_ROWS) invalid({ rows: 'Demasiadas filas (máximo 500)' });
  return data.map((row) => {
    const record: Record<string, string> = {};
    columns.forEach((key, index) => {
      if (!key) return;
      const value = row.cells[index] ?? '';
      if (value.trim() !== '') record[key] = value;
    });
    return parseRecord(record, row.line);
  });
}

function parseRecord(record: Record<string, string>, row: number): ParsedRow {
  const codeRaw = record.code ?? '';
  const code = codeRaw.trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    return { error: { row, code: code || null, message: 'El código debe cumplir ^[A-Z0-9-]{2,20}$' } };
  }
  const name = (record.name ?? '').trim();
  if (name.length === 0) return { error: { row, code, message: 'El nombre es obligatorio' } };
  if (name.length > NAME_MAX) return { error: { row, code, message: 'El nombre admite como máximo 120 caracteres' } };
  const kind = oneOf(record.kind, KINDS);
  if (!kind) {
    return { error: { row, code, message: `Tipo no válido. Debe ser uno de: ${KINDS.join(', ')}` } };
  }
  const capacityMl = parseLitres(record.capacity_litres ?? '');
  if (capacityMl === null) return { error: { row, code, message: 'La capacidad debe ser litros positivos' } };
  const material = oneOf(record.material, MATERIALS);
  if (!material) {
    return { error: { row, code, message: `Material no válido. Debe ser uno de: ${MATERIALS.join(', ')}` } };
  }
  const cooling = parseCooling(record.cooling);
  if (cooling === null) return { error: { row, code, message: 'El frío debe ser si o no' } };
  if (kind === 'tank_fermenter' && !cooling) {
    return { error: { row, code, message: 'El fermentador exige camisa de frío' } };
  }
  const zone = parseZone(record.zone, record.zone_kind);
  if (typeof zone === 'string') return { error: { row, code, message: zone } };
  const statusRaw = (record.status ?? '').trim().toLowerCase();
  let status: VesselStatus | null = null;
  if (statusRaw !== '') {
    if (!(STATUSES as readonly string[]).includes(statusRaw)) {
      return { error: { row, code, message: 'El estado no es válido. Debe ser in_service, out_of_service o retired' } };
    }
    status = statusRaw as VesselStatus;
  }
  return {
    draft: {
      row,
      code,
      name,
      kind,
      capacityMl,
      material,
      cooling,
      zoneName: zone.name,
      zoneKind: zone.kind,
      status,
    },
  };
}

function parseZone(raw: string | undefined, kindRaw: string | undefined): { name: string | null; kind: ZoneKind | null } | string {
  let kind: ZoneKind | null = null;
  if (kindRaw !== undefined && kindRaw.trim() !== '') {
    const folded = kindRaw.trim().toLowerCase();
    if (!(ZONE_KINDS as readonly string[]).includes(folded)) return 'El tipo de zona no es válido';
    kind = folded as ZoneKind;
  }
  if (raw === undefined || raw.trim() === '') return { name: null, kind };
  let name = raw.trim();
  const pipe = name.lastIndexOf('|');
  if (pipe > 0) {
    const suffix = name.slice(pipe + 1).trim().toLowerCase();
    if ((ZONE_KINDS as readonly string[]).includes(suffix)) {
      name = name.slice(0, pipe).trim();
      if (kind === null) kind = suffix as ZoneKind;
    }
  }
  if (name.length === 0) return 'La zona no tiene nombre';
  if (name.length > ZONE_MAX) return 'La zona admite como máximo 40 caracteres';
  return { name, kind };
}

function parseLitres(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, '');
  if (text.length === 0) return null;
  const normalized = text.includes(',') && !text.includes('.') ? text.replace(',', '.') : text;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const litres = Number(normalized);
  if (!Number.isFinite(litres) || litres <= 0) return null;
  const ml = Math.round(litres * 1000);
  if (!Number.isSafeInteger(ml) || ml <= 0) return null;
  return ml;
}

function parseCooling(raw: string | undefined): boolean | null {
  if (raw === undefined || raw.trim() === '') return false;
  const folded = raw.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  if (folded === 'si' || folded === 's' || folded === 'yes' || folded === 'true' || folded === '1') return true;
  if (folded === 'no' || folded === 'n' || folded === 'false' || folded === '0') return false;
  return null;
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[]): T | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (!(allowed as readonly string[]).includes(value)) return null;
  return value as T;
}

function columnKey(header: string): string | null {
  const folded = header.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, '_');
  return COLUMN_ALIAS[folded] ?? null;
}

function codeOf(record: Record<string, string>): string | null {
  const code = (record.code ?? '').trim().toUpperCase();
  return code.length > 0 ? code : null;
}

function parseCsvTable(text: string): { line: number; cells: string[] }[] {
  const source = text.replace(/^\uFEFF/, '');
  const delimiter = sniffDelimiter(source);
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const pushRow = () => {
    cells.push(cell);
    rows.push({ line: start, cells });
    cells = [];
    cell = '';
  };
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index] ?? '';
    if (quoted) {
      if (ch === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      cells.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      pushRow();
      line += 1;
      start = line;
      continue;
    }
    if (ch === '\r') continue;
    cell += ch;
  }
  if (cell.length > 0 || cells.length > 0) pushRow();
  return rows;
}

function sniffDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quoted) {
      if (ch === '"') {
        if (text[index + 1] === '"') index += 1;
        else quoted = false;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === '\n') break;
    if (ch === ',') commas += 1;
    if (ch === ';') semis += 1;
  }
  return semis > commas ? ';' : ',';
}
