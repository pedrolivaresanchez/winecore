import {
  actorFor,
  auditInsert,
  auditUpdate,
  boolOf,
  intOf,
  invalid,
  oneOf,
  optionalText,
  positiveInt,
  readJson,
  requireBool,
  requireText,
  textOf,
  textOrNull,
} from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { DomainError, domainError } from '../errors';
import { newId } from '../ids';
import {
  BARREL_STATUSES,
  BARREL_STATUS_LABELS,
  OAK_LABELS,
  OAK_ORIGINS,
  OUTDOOR_AGING_LABEL,
  TOAST_LABELS,
  TOAST_LEVELS,
  type BarrelStatus,
  type OakOrigin,
  type ToastLevel,
} from './constants';
import { dateOf, idOf, moneyOf, optionalDate, optionalMoney, requireYear } from './parse';

interface VesselCore {
  id: string;
  code: string;
  kind: string;
  material: string;
  capacity_ml: number;
  has_cooling_jacket: boolean;
  status: string;
}

export interface BarrelView {
  vessel_id: string;
  vessel_code: string;
  oak_origin: OakOrigin;
  oak_origin_label: string;
  forest: string | null;
  toast: ToastLevel;
  toast_label: string;
  head_toast: boolean;
  cooper: string;
  year_made: number;
  nominal_volume_ml: number;
  purchase_date: string | null;
  purchase_price: string | null;
  use_count: number;
  status: BarrelStatus;
  status_label: string;
  retired_on: string | null;
}

export interface DemijohnView {
  vessel_id: string;
  vessel_code: string;
  outdoor_aging: boolean;
  aging_label: string | null;
}

export interface CapacityView {
  vessel_id: string;
  vessel_code: string;
  capacity_ml: number;
  has_cooling_jacket: boolean;
  history: Array<{
    id: string;
    capacity_ml: number;
    reason: string | null;
    recorded_by: string;
    recorded_at: string;
  }>;
}

type Reader = Pick<Writer, 'read'>;

export async function getBarrel(writer: Writer, _request: Request, code: string): Promise<BarrelView> {
  const vessel = await vesselByCode(writer, code);
  return barrelOf(writer, vessel);
}

export async function createBarrel(writer: Writer, request: Request, code: string): Promise<BarrelView> {
  const body = await readJson(request);
  rejectUseCount(body);
  const draft = parseBarrelCreate(body);
  const actor = actorFor(request, 'alta de ficha de barrica');
  await writer.withWrite(actor, async (tx) => {
    const vessel = await vesselByCode(tx, code);
    assertBarrel(vessel);
    const existing = await tx.read(sql`SELECT vessel_id FROM cellar.barrel WHERE vessel_id = CAST(${vessel.id} AS UUID)`);
    if (existing.length > 0) invalid({ vessel_code: 'La barrica ya tiene ficha' });
    const fills = await tx.read<{ total: string }>(sql`
      SELECT count(*)::VARCHAR AS total FROM cellar.barrel_fill WHERE vessel_id = CAST(${vessel.id} AS UUID)
    `);
    const useCount = intOf(fills[0]?.total ?? 0);
    const status = draft.status;
    const retiredOn = status === 'retired' ? draft.retired_on : null;
    if (status === 'retired' && retiredOn === null) invalid({ retired_on: 'La retirada exige fecha' });
    auditInsert(tx, 'cellar.barrel', vessel.id, { vessel_id: vessel.id, ...draft, use_count: useCount, retired_on: retiredOn }, sql`
      INSERT INTO cellar.barrel (
        vessel_id, oak_origin, forest, toast, head_toast, cooper, year_made, nominal_volume_ml,
        purchase_date, purchase_price, use_count, status, retired_on
      ) VALUES (
        CAST(${vessel.id} AS UUID),
        ${draft.oak_origin},
        ${draft.forest},
        ${draft.toast},
        ${draft.head_toast},
        ${draft.cooper},
        ${draft.year_made},
        ${draft.nominal_volume_ml},
        CAST(${draft.purchase_date} AS DATE),
        CAST(${draft.purchase_price} AS DECIMAL(12,2)),
        ${useCount},
        ${status},
        CAST(${retiredOn} AS DATE)
      )
    `);
  });
  return getBarrel(writer, request, code);
}

export async function patchBarrel(writer: Writer, request: Request, code: string): Promise<BarrelView> {
  const body = await readJson(request);
  rejectUseCount(body);
  const patch = parseBarrelPatch(body);
  const actor = actorFor(request, 'edición de ficha de barrica');
  await writer.withWrite(actor, async (tx) => {
    const vessel = await vesselByCode(tx, code);
    const current = await barrelOf(tx, vessel);
    const next = {
      oak_origin: patch.oak_origin ?? current.oak_origin,
      forest: patch.forest === undefined ? current.forest : patch.forest,
      toast: patch.toast ?? current.toast,
      head_toast: patch.head_toast ?? current.head_toast,
      cooper: patch.cooper ?? current.cooper,
      year_made: patch.year_made ?? current.year_made,
      nominal_volume_ml: patch.nominal_volume_ml ?? current.nominal_volume_ml,
      purchase_date: patch.purchase_date === undefined ? current.purchase_date : patch.purchase_date,
      purchase_price: patch.purchase_price === undefined ? current.purchase_price : patch.purchase_price,
      status: patch.status ?? current.status,
      retired_on: patch.retired_on === undefined ? current.retired_on : patch.retired_on,
    };
    if (next.status !== 'retired') next.retired_on = null;
    if (next.status === 'retired' && next.retired_on === null) invalid({ retired_on: 'La retirada exige fecha' });
    auditUpdate(tx, 'cellar.barrel', vessel.id, current, { ...next, use_count: current.use_count }, sql`
      UPDATE cellar.barrel SET
        oak_origin = ${next.oak_origin},
        forest = ${next.forest},
        toast = ${next.toast},
        head_toast = ${next.head_toast},
        cooper = ${next.cooper},
        year_made = ${next.year_made},
        nominal_volume_ml = ${next.nominal_volume_ml},
        purchase_date = CAST(${next.purchase_date} AS DATE),
        purchase_price = CAST(${next.purchase_price} AS DECIMAL(12,2)),
        status = ${next.status},
        retired_on = CAST(${next.retired_on} AS DATE)
      WHERE vessel_id = CAST(${vessel.id} AS UUID)
    `);
  });
  return getBarrel(writer, request, code);
}

export async function getDemijohn(writer: Writer, _request: Request, code: string): Promise<DemijohnView> {
  const vessel = await vesselByCode(writer, code);
  assertDemijohn(vessel);
  const rows = await writer.read<{ outdoor_aging: boolean }>(sql`
    SELECT outdoor_aging FROM cellar.demijohn WHERE vessel_id = CAST(${vessel.id} AS UUID)
  `);
  const outdoor = rows[0]?.outdoor_aging === true;
  return viewDemijohn(vessel, outdoor);
}

export async function upsertDemijohn(writer: Writer, request: Request, code: string): Promise<DemijohnView> {
  const body = await readJson(request);
  const outdoor = requireBool(body.outdoor_aging, 'outdoor_aging');
  const actor = actorFor(request, 'crianza a la intemperie');
  await writer.withWrite(actor, async (tx) => {
    const vessel = await vesselByCode(tx, code);
    assertDemijohn(vessel);
    if (outdoor && vessel.material !== 'glass') {
      invalid({ outdoor_aging: 'La crianza a la intemperie es para damajuanas de cristal' });
    }
    const rows = await tx.read<{ outdoor_aging: boolean }>(sql`
      SELECT outdoor_aging FROM cellar.demijohn WHERE vessel_id = CAST(${vessel.id} AS UUID)
    `);
    const current = rows[0];
    if (!current) {
      auditInsert(tx, 'cellar.demijohn', vessel.id, { vessel_id: vessel.id, outdoor_aging: outdoor }, sql`
        INSERT INTO cellar.demijohn (vessel_id, outdoor_aging) VALUES (CAST(${vessel.id} AS UUID), ${outdoor})
      `);
      return;
    }
    auditUpdate(tx, 'cellar.demijohn', vessel.id, { outdoor_aging: current.outdoor_aging === true }, { outdoor_aging: outdoor }, sql`
      UPDATE cellar.demijohn SET outdoor_aging = ${outdoor} WHERE vessel_id = CAST(${vessel.id} AS UUID)
    `);
  });
  return getDemijohn(writer, request, code);
}

export async function getCapacity(writer: Writer, _request: Request, code: string): Promise<CapacityView> {
  const vessel = await vesselByCode(writer, code);
  return capacityView(writer, vessel);
}

export async function recordCapacity(writer: Writer, request: Request, code: string): Promise<CapacityView> {
  const body = await readJson(request);
  const capacity = positiveInt(body.capacity_ml, 'capacity_ml');
  const reason = optionalText(body.reason, 'reason', 500);
  const actor = actorFor(request, 'cambio de capacidad');
  await writer.withWrite(actor, async (tx) => {
    const vessel = await vesselByCode(tx, code);
    if (vessel.status === 'retired') {
      throw new DomainError('WC_ILLEGAL_TRANSITION', 409, 'El recipiente está dado de baja');
    }
    const volume = await contentVolume(tx, vessel.id);
    if (volume > capacity) {
      throw new DomainError(
        'WC025',
        422,
        `El recipiente supera su capacidad (${volume} mL > ${capacity} mL)`,
        { capacity_ml: 'La capacidad no cubre el volumen actual' },
      );
    }
    const historyId = newId();
    auditInsert(tx, 'cellar.vessel_capacity', historyId, {
      id: historyId,
      vessel_id: vessel.id,
      capacity_ml: capacity,
      reason,
    }, sql`
      INSERT INTO cellar.vessel_capacity (id, vessel_id, capacity_ml, reason, recorded_by)
      VALUES (CAST(${historyId} AS UUID), CAST(${vessel.id} AS UUID), ${capacity}, ${reason}, ${actor.id})
    `);
    if (vessel.capacity_ml !== capacity) {
      auditUpdate(tx, 'cellar.vessel', vessel.id, { capacity_ml: vessel.capacity_ml }, { capacity_ml: capacity }, sql`
        UPDATE cellar.vessel SET capacity_ml = ${capacity} WHERE id = CAST(${vessel.id} AS UUID)
      `);
    }
  });
  return getCapacity(writer, request, code);
}

async function capacityView(reader: Reader, vessel: VesselCore): Promise<CapacityView> {
  const rows = await reader.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, capacity_ml::VARCHAR AS capacity_ml, reason, recorded_by, recorded_at
    FROM cellar.vessel_capacity
    WHERE vessel_id = CAST(${vessel.id} AS UUID)
    ORDER BY recorded_at, id
  `);
  const fresh = await vesselByCode(reader, vessel.code);
  return {
    vessel_id: fresh.id,
    vessel_code: fresh.code,
    capacity_ml: fresh.capacity_ml,
    has_cooling_jacket: fresh.has_cooling_jacket,
    history: rows.map((row) => ({
      id: idOf(row.id),
      capacity_ml: intOf(row.capacity_ml),
      reason: textOrNull(row.reason),
      recorded_by: textOf(row.recorded_by),
      recorded_at: textOf(row.recorded_at),
    })),
  };
}

async function contentVolume(reader: Reader, vesselId: string): Promise<number> {
  const rows = await reader.read<{ volume_ml: string }>(sql`
    SELECT coalesce(sum(volume_ml), 0)::VARCHAR AS volume_ml
    FROM inventory.stock_move
    WHERE vessel_id = CAST(${vesselId} AS UUID)
  `);
  return intOf(rows[0]?.volume_ml ?? 0);
}

interface BarrelDraft {
  oak_origin?: OakOrigin;
  forest?: string | null;
  toast?: ToastLevel;
  head_toast?: boolean;
  cooper?: string;
  year_made?: number;
  nominal_volume_ml?: number;
  purchase_date?: string | null;
  purchase_price?: string | null;
  status?: BarrelStatus;
  retired_on?: string | null;
}

interface BarrelCreate {
  oak_origin: OakOrigin;
  forest: string | null;
  toast: ToastLevel;
  head_toast: boolean;
  cooper: string;
  year_made: number;
  nominal_volume_ml: number;
  purchase_date: string | null;
  purchase_price: string | null;
  status: BarrelStatus;
  retired_on: string | null;
}

function parseBarrelCreate(body: Record<string, unknown>): BarrelCreate {
  const status = body.status === undefined ? 'in_use' : oneOf(body.status, 'status', BARREL_STATUSES);
  const retired = optionalDate(body.retired_on, 'retired_on');
  if (status === 'retired' && retired === null) invalid({ retired_on: 'La retirada exige fecha' });
  return {
    oak_origin: oneOf(body.oak_origin, 'oak_origin', OAK_ORIGINS),
    forest: optionalText(body.forest, 'forest', 120),
    toast: oneOf(body.toast, 'toast', TOAST_LEVELS),
    head_toast: body.head_toast === undefined ? false : requireBool(body.head_toast, 'head_toast'),
    cooper: requireText(body.cooper, 'cooper', 120),
    year_made: requireYear(body.year_made),
    nominal_volume_ml: positiveInt(body.nominal_volume_ml, 'nominal_volume_ml'),
    purchase_date: optionalDate(body.purchase_date, 'purchase_date'),
    purchase_price: optionalMoney(body.purchase_price, 'purchase_price'),
    status,
    retired_on: status === 'retired' ? retired : null,
  };
}

function parseBarrelPatch(body: Record<string, unknown>): BarrelDraft {
  const patch: BarrelDraft = {};
  if ('oak_origin' in body) patch.oak_origin = oneOf(body.oak_origin, 'oak_origin', OAK_ORIGINS);
  if ('forest' in body) patch.forest = optionalText(body.forest, 'forest', 120);
  if ('toast' in body) patch.toast = oneOf(body.toast, 'toast', TOAST_LEVELS);
  if ('head_toast' in body) patch.head_toast = requireBool(body.head_toast, 'head_toast');
  if ('cooper' in body) patch.cooper = requireText(body.cooper, 'cooper', 120);
  if ('year_made' in body) patch.year_made = requireYear(body.year_made);
  if ('nominal_volume_ml' in body) patch.nominal_volume_ml = positiveInt(body.nominal_volume_ml, 'nominal_volume_ml');
  if ('purchase_date' in body) patch.purchase_date = optionalDate(body.purchase_date, 'purchase_date');
  if ('purchase_price' in body) patch.purchase_price = optionalMoney(body.purchase_price, 'purchase_price');
  if ('status' in body) patch.status = oneOf(body.status, 'status', BARREL_STATUSES);
  if ('retired_on' in body) patch.retired_on = optionalDate(body.retired_on, 'retired_on');
  if (Object.keys(patch).length === 0) invalid({ body: 'No hay cambios' });
  return patch;
}

function rejectUseCount(body: Record<string, unknown>): void {
  if ('use_count' in body) invalid({ use_count: 'El número de usos lo calcula el llenado' });
}

async function barrelOf(reader: Reader, vessel: VesselCore): Promise<BarrelView> {
  assertBarrel(vessel);
  const rows = await reader.read<Record<string, unknown>>(sql`
    SELECT oak_origin, forest, toast, head_toast, cooper, year_made,
           nominal_volume_ml::VARCHAR AS nominal_volume_ml,
           purchase_date, purchase_price::VARCHAR AS purchase_price,
           use_count, status, retired_on
    FROM cellar.barrel
    WHERE vessel_id = CAST(${vessel.id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const oak = textOf(row.oak_origin) as OakOrigin;
  const toast = textOf(row.toast) as ToastLevel;
  const status = textOf(row.status) as BarrelStatus;
  return {
    vessel_id: vessel.id,
    vessel_code: vessel.code,
    oak_origin: oak,
    oak_origin_label: OAK_LABELS[oak],
    forest: textOrNull(row.forest),
    toast,
    toast_label: TOAST_LABELS[toast],
    head_toast: boolOf(row.head_toast),
    cooper: textOf(row.cooper),
    year_made: intOf(row.year_made),
    nominal_volume_ml: intOf(row.nominal_volume_ml),
    purchase_date: dateOf(row.purchase_date),
    purchase_price: moneyOf(row.purchase_price),
    use_count: intOf(row.use_count),
    status,
    status_label: BARREL_STATUS_LABELS[status],
    retired_on: dateOf(row.retired_on),
  };
}

function viewDemijohn(vessel: VesselCore, outdoor: boolean): DemijohnView {
  return {
    vessel_id: vessel.id,
    vessel_code: vessel.code,
    outdoor_aging: outdoor,
    aging_label: outdoor ? OUTDOOR_AGING_LABEL : null,
  };
}

function assertBarrel(vessel: VesselCore): void {
  if (vessel.kind !== 'barrel') invalid({ code: 'Solo una barrica tiene esta ficha' });
}

function assertDemijohn(vessel: VesselCore): void {
  if (vessel.kind !== 'demijohn') invalid({ code: 'Solo una damajuana admite crianza a la intemperie' });
}

async function vesselByCode(source: Reader, code: string): Promise<VesselCore> {
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await source.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, kind, material, capacity_ml::VARCHAR AS capacity_ml,
           has_cooling_jacket, status
    FROM cellar.vessel
    WHERE code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return {
    id: idOf(row.id),
    code: textOf(row.code),
    kind: textOf(row.kind),
    material: textOf(row.material),
    capacity_ml: intOf(row.capacity_ml),
    has_cooling_jacket: row.has_cooling_jacket === true,
    status: textOf(row.status),
  };
}
