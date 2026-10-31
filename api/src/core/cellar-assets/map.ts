import {
  fillPct,
  intOf,
  invalid,
  requireCode,
  requireUuid,
  textOf,
  textOrNull,
  uuidList,
} from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import {
  BARREL_STATUS_LABELS,
  OUTDOOR_AGING_LABEL,
  ZONE_LABELS,
  type BarrelStatus,
  type ZoneKind,
} from './constants';
import { doubleOf, idOf, litresOf } from './parse';
import { holderKindLabel } from './zones';

export interface MapVessel {
  position_id: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  id: string;
  code: string;
  name: string;
  kind: string;
  material: string;
  status: string;
  state: string;
  has_cooling_jacket: boolean;
  capacity_ml: number;
  volume_ml: number;
  /** Litros con un decimal, para colorear y leer el llenado sin otra llamada. */
  litres: string;
  fill_pct: string;
  lot_id: string | null;
  lot_code: string | null;
  product_state: string | null;
  outdoor_aging: boolean;
  aging_label: string | null;
  barrel_status: string | null;
  barrel_status_label: string | null;
  barrel_use_count: number | null;
}

export interface MapHolder {
  position_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  id: string;
  code: string;
  name: string;
  kind: string;
  kind_label: string;
  number: number | null;
  capacity_bottles: number | null;
  nominal_volume_ml: number | null;
  format: string | null;
  count: number;
  litres: string | null;
  fill_pct: string | null;
  lot_id: string | null;
  lot_code: string | null;
  product_state: string | null;
  state: string;
}

export interface CellarMap {
  location_id: string;
  location_code: string;
  location_name: string;
  zones: Array<{
    id: string;
    code: string;
    name: string;
    kind: ZoneKind;
    kind_label: string;
    plan_attachment_id: string | null;
    vessels: MapVessel[];
    holders: MapHolder[];
  }>;
  unplaced_vessels: MapVessel[];
}

interface Content {
  lot_id: string | null;
  lot_code: string | null;
  volume_ml: number;
  product_state: string | null;
}

interface VesselCore {
  id: string;
  code: string;
  name: string;
  kind: string;
  material: string;
  status: string;
  has_cooling_jacket: boolean;
  capacity_ml: number;
}

export async function getCellarMap(writer: Writer, request: Request): Promise<CellarMap> {
  const url = new URL(request.url);
  const location = await resolveLocation(writer, url);
  const zones = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name, kind, plan_attachment_id::VARCHAR AS plan_attachment_id
    FROM cellar.zone
    WHERE location_id = CAST(${location.id} AS UUID) AND is_active
    ORDER BY code
  `);
  const zoneIds = zones.map((row) => idOf(row.id));
  const positions = zoneIds.length === 0
    ? []
    : await writer.read<Record<string, unknown>>(`
      SELECT id::VARCHAR AS id, zone_id::VARCHAR AS zone_id,
             vessel_id::VARCHAR AS vessel_id, holder_id::VARCHAR AS holder_id,
             x, y, width, height, rotation
      FROM cellar.plan_position
      WHERE zone_id IN (${uuidList(zoneIds)})
    `);
  const vessels = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name, kind, material, status, has_cooling_jacket,
           capacity_ml::VARCHAR AS capacity_ml
    FROM cellar.vessel
    WHERE location_id = CAST(${location.id} AS UUID)
    ORDER BY code
  `);
  const vesselCores = vessels.map(vesselOf);
  const vesselIds = vesselCores.map((row) => row.id);
  const contents = await contentsFor(writer, vesselIds);
  const barrels = await barrelFlags(writer, vesselIds);
  const outdoors = await outdoorFlags(writer, vesselIds);
  const holders = await holdersAt(writer, location.id);
  const placedVessels = new Set<string>();
  const placedHolders = new Set<string>();
  const byZone = new Map<string, { vessels: MapVessel[]; holders: MapHolder[] }>();
  for (const id of zoneIds) byZone.set(id, { vessels: [], holders: [] });

  for (const position of positions) {
    const zoneId = idOf(position.zone_id);
    const bucket = byZone.get(zoneId);
    if (!bucket) continue;
    const geom = {
      position_id: idOf(position.id),
      x: doubleOf(position.x),
      y: doubleOf(position.y),
      width: doubleOf(position.width),
      height: doubleOf(position.height),
      rotation: doubleOf(position.rotation),
    };
    if (position.vessel_id != null) {
      const vesselId = idOf(position.vessel_id);
      const core = vesselCores.find((row) => row.id === vesselId);
      if (!core) continue;
      placedVessels.add(vesselId);
      bucket.vessels.push(toVessel(core, contents.get(vesselId), barrels.get(vesselId), outdoors.get(vesselId) === true, geom));
    }
    if (position.holder_id != null) {
      const holderId = idOf(position.holder_id);
      const holder = holders.get(holderId);
      if (!holder) continue;
      placedHolders.add(holderId);
      bucket.holders.push({ ...holder, ...geom });
    }
  }

  const unplaced = vesselCores
    .filter((row) => !placedVessels.has(row.id))
    .map((row) => toVessel(row, contents.get(row.id), barrels.get(row.id), outdoors.get(row.id) === true, null));

  return {
    location_id: location.id,
    location_code: location.code,
    location_name: location.name,
    zones: zones.map((row) => {
      const kind = textOf(row.kind) as ZoneKind;
      const bucket = byZone.get(idOf(row.id)) ?? { vessels: [], holders: [] };
      return {
        id: idOf(row.id),
        code: textOf(row.code),
        name: textOf(row.name),
        kind,
        kind_label: ZONE_LABELS[kind] ?? kind,
        plan_attachment_id: row.plan_attachment_id == null ? null : idOf(row.plan_attachment_id),
        vessels: bucket.vessels.sort((a, b) => a.code.localeCompare(b.code)),
        holders: bucket.holders.sort((a, b) => a.code.localeCompare(b.code)),
      };
    }),
    unplaced_vessels: unplaced,
  };
}

async function resolveLocation(writer: Writer, url: URL): Promise<{ id: string; code: string; name: string }> {
  const rawId = url.searchParams.get('location_id');
  const rawCode = url.searchParams.get('location');
  if ((rawId === null || rawId.trim() === '') && (rawCode === null || rawCode.trim() === '')) {
    invalid({ location_id: 'Indica location_id o location' });
  }
  const rows = await writer.read<Record<string, unknown>>(rawId && rawId.trim() !== ''
    ? sql`
      SELECT id::VARCHAR AS id, code, name FROM inventory.location
      WHERE id = CAST(${requireUuid(rawId, 'location_id')} AS UUID)
    `
    : sql`
      SELECT id::VARCHAR AS id, code, name FROM inventory.location
      WHERE code = ${requireCode(rawCode, 'location')}
    `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return { id: idOf(row.id), code: textOf(row.code), name: textOf(row.name) };
}

function vesselOf(row: Record<string, unknown>): VesselCore {
  return {
    id: idOf(row.id),
    code: textOf(row.code),
    name: textOf(row.name),
    kind: textOf(row.kind),
    material: textOf(row.material),
    status: textOf(row.status),
    has_cooling_jacket: row.has_cooling_jacket === true,
    capacity_ml: intOf(row.capacity_ml),
  };
}

function toVessel(
  core: VesselCore,
  content: Content | undefined,
  barrel: { status: string; use_count: number } | undefined,
  outdoor: boolean,
  geom: { position_id: string; x: number; y: number; width: number; height: number; rotation: number } | null,
): MapVessel {
  const volume = content?.volume_ml ?? 0;
  const productState = content?.product_state ?? null;
  const barrelStatus = barrel && isBarrelStatus(barrel.status) ? barrel.status : null;
  return {
    position_id: geom?.position_id ?? null,
    x: geom?.x ?? null,
    y: geom?.y ?? null,
    width: geom?.width ?? null,
    height: geom?.height ?? null,
    rotation: geom?.rotation ?? null,
    id: core.id,
    code: core.code,
    name: core.name,
    kind: core.kind,
    material: core.material,
    status: core.status,
    state: mapState(core, volume, productState),
    has_cooling_jacket: core.has_cooling_jacket,
    capacity_ml: core.capacity_ml,
    volume_ml: volume,
    litres: litresOf(volume),
    fill_pct: fillPct(volume, core.capacity_ml),
    lot_id: content?.lot_id ?? null,
    lot_code: content?.lot_code ?? null,
    product_state: productState,
    outdoor_aging: outdoor,
    aging_label: outdoor ? OUTDOOR_AGING_LABEL : null,
    barrel_status: barrelStatus,
    barrel_status_label: barrelStatus ? BARREL_STATUS_LABELS[barrelStatus] : null,
    barrel_use_count: barrel?.use_count ?? null,
  };
}

function mapState(core: VesselCore, volume: number, productState: string | null): string {
  if (core.status !== 'in_service') return core.status;
  if (volume <= 0) return 'empty';
  if (core.kind === 'barrel' && core.material === 'oak' && productState === 'wine') return 'aging';
  if (productState === 'must') return 'fermenting';
  return productState ?? 'empty';
}

function isBarrelStatus(value: string): value is BarrelStatus {
  return value in BARREL_STATUS_LABELS;
}

async function contentsFor(writer: Writer, vesselIds: readonly string[]): Promise<Map<string, Content>> {
  const map = new Map<string, Content>();
  if (vesselIds.length === 0) return map;
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT vessel_id::VARCHAR AS vessel_id, lot_id::VARCHAR AS lot_id, product_state,
           sum(volume_ml)::VARCHAR AS volume_ml
    FROM inventory.stock_move
    WHERE vessel_id IN (${uuidList(vesselIds)})
    GROUP BY vessel_id, lot_id, product_state
    HAVING sum(volume_ml) <> 0 OR sum(qty_units) <> 0 OR sum(mass_g) <> 0
  `);
  const lotIds = [...new Set(rows.map((row) => textOrNull(row.lot_id)).filter((id): id is string => id !== null))];
  const codes = new Map<string, string>();
  if (lotIds.length > 0) {
    const lots = await writer.read<{ id: string; code: string }>(`
      SELECT id::VARCHAR AS id, code FROM inventory.lot WHERE id IN (${uuidList(lotIds)})
    `);
    for (const lot of lots) codes.set(lot.id.toLowerCase(), lot.code);
  }
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const id = idOf(row.vessel_id);
    const list = grouped.get(id) ?? [];
    list.push(row);
    grouped.set(id, list);
  }
  for (const [vesselId, list] of grouped) {
    if (list.length === 1) {
      const row = list[0];
      if (!row) continue;
      const lotId = textOrNull(row.lot_id);
      map.set(vesselId, {
        lot_id: lotId === null ? null : lotId.toLowerCase(),
        lot_code: lotId ? codes.get(lotId.toLowerCase()) ?? null : null,
        volume_ml: intOf(row.volume_ml),
        product_state: textOrNull(row.product_state),
      });
      continue;
    }
    map.set(vesselId, {
      lot_id: null,
      lot_code: null,
      volume_ml: list.reduce((sum, row) => sum + intOf(row.volume_ml), 0),
      product_state: null,
    });
  }
  return map;
}

async function barrelFlags(
  writer: Writer,
  vesselIds: readonly string[],
): Promise<Map<string, { status: string; use_count: number }>> {
  const map = new Map<string, { status: string; use_count: number }>();
  if (vesselIds.length === 0) return map;
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT vessel_id::VARCHAR AS vessel_id, status, use_count
    FROM cellar.barrel
    WHERE vessel_id IN (${uuidList(vesselIds)})
  `);
  for (const row of rows) {
    map.set(idOf(row.vessel_id), { status: textOf(row.status), use_count: intOf(row.use_count) });
  }
  return map;
}

async function outdoorFlags(writer: Writer, vesselIds: readonly string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (vesselIds.length === 0) return map;
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT vessel_id::VARCHAR AS vessel_id, outdoor_aging
    FROM cellar.demijohn
    WHERE vessel_id IN (${uuidList(vesselIds)})
  `);
  for (const row of rows) map.set(idOf(row.vessel_id), row.outdoor_aging === true);
  return map;
}

async function holdersAt(writer: Writer, locationId: string): Promise<Map<string, Omit<MapHolder, 'position_id' | 'x' | 'y' | 'width' | 'height' | 'rotation'>>> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name, kind, cage_number, capacity_units,
           nominal_volume_ml, format_code
    FROM cellar.holder
    WHERE location_id = CAST(${locationId} AS UUID) AND is_active
  `);
  const ids = rows.map((row) => idOf(row.id));
  const balances = await holderBalances(writer, ids);
  const map = new Map<string, Omit<MapHolder, 'position_id' | 'x' | 'y' | 'width' | 'height' | 'rotation'>>();
  for (const row of rows) {
    const id = idOf(row.id);
    const balance = balances.get(id);
    const capacity = row.capacity_units == null ? null : intOf(row.capacity_units);
    const nominal = row.nominal_volume_ml == null ? null : intOf(row.nominal_volume_ml);
    const count = balance?.qty ?? 0;
    map.set(id, {
      id,
      code: textOf(row.code),
      name: textOf(row.name),
      kind: textOf(row.kind),
      kind_label: holderKindLabel(textOf(row.kind)),
      number: row.cage_number == null ? null : intOf(row.cage_number),
      capacity_bottles: capacity,
      nominal_volume_ml: nominal,
      format: textOrNull(row.format_code),
      count,
      litres: nominal == null ? null : litresOf(count * nominal),
      fill_pct: capacity === null ? null : fillPct(count, capacity),
      lot_id: balance?.lot_id ?? null,
      lot_code: balance?.lot_code ?? null,
      product_state: balance?.product_state ?? null,
      state: count > 0 ? (balance?.product_state ?? 'empty') : 'empty',
    });
  }
  return map;
}

async function holderBalances(
  writer: Writer,
  holderIds: readonly string[],
): Promise<Map<string, { qty: number; lot_id: string | null; lot_code: string | null; product_state: string | null }>> {
  const map = new Map<string, { qty: number; lot_id: string | null; lot_code: string | null; product_state: string | null }>();
  if (holderIds.length === 0) return map;
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT m.holder_id::VARCHAR AS holder_id, m.lot_id::VARCHAR AS lot_id, l.code AS lot_code,
           m.product_state, sum(m.qty_units)::VARCHAR AS qty_units
    FROM cellar.holder_move m
    JOIN inventory.lot l ON l.id = m.lot_id
    WHERE m.holder_id IN (${uuidList(holderIds)})
    GROUP BY m.holder_id, m.lot_id, l.code, m.product_state, m.owner_entity_id, m.product_id
    HAVING sum(m.qty_units) <> 0
  `);
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const id = idOf(row.holder_id);
    const list = grouped.get(id) ?? [];
    list.push(row);
    grouped.set(id, list);
  }
  for (const [holderId, list] of grouped) {
    const qty = list.reduce((sum, row) => sum + intOf(row.qty_units), 0);
    if (list.length === 1) {
      const row = list[0];
      if (!row) continue;
      map.set(holderId, {
        qty,
        lot_id: idOf(row.lot_id),
        lot_code: textOf(row.lot_code),
        product_state: textOf(row.product_state),
      });
      continue;
    }
    map.set(holderId, { qty, lot_id: null, lot_code: null, product_state: null });
  }
  return map;
}
