import {
  fillPct,
  intOf,
  textOf,
  textOrNull,
} from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { litresOf } from './parse';

const KIND_LABELS: Record<string, string> = {
  tank_storage: 'Depósito',
  tank_fermenter: 'Fermentador',
  barrel: 'Barrica',
  demijohn: 'Damajuana',
  ibc: 'IBC',
  other: 'Otro',
};

const STATUS_LABELS: Record<string, string> = {
  in_service: 'En servicio',
  out_of_service: 'Fuera de servicio',
  retired: 'Baja',
};

const STATE_LABELS: Record<string, string> = {
  empty: 'Vacío',
  wine: 'Con vino',
  holding: 'Con vino',
  must: 'Fermentando',
  fermenting: 'Fermentando',
  aging: 'Crianza',
  out_of_service: 'Fuera de servicio',
  retired: 'Baja',
};

const OP_LABELS: Record<string, string> = {
  reception: 'Recepción',
  bulk_reception: 'Recepción a granel',
  crushing_pressing: 'Estrujado',
  fermentation_start: 'Inicio de fermentación',
  fermentation_end: 'Fin de fermentación',
  malolactic_start: 'Inicio de maloláctica',
  racking: 'Trasiego',
  blend: 'Ensamblaje',
  filtration: 'Filtración',
  addition: 'Adición',
  stabilization: 'Estabilización',
  cleaning: 'Limpieza',
  sampling: 'Muestra',
  bottling: 'Envasado',
  labeling: 'Etiquetado',
  loss: 'Merma',
  destruction: 'Destrucción',
  bleeding: 'Sangrado',
  pressing_off: 'Descube',
  delestage: 'Délestage',
  temperature_control: 'Temperatura',
};

export interface PlanCardOperation {
  op_type: string;
  op_type_label: string;
  occurred_at: string;
  status: string;
}

export interface PlanCardMetric {
  parameter_code: string;
  name: string;
  value: string;
  unit: string;
}

export interface PlanCardAnalysis {
  sampled_at: string;
  kind: string;
  results: PlanCardMetric[];
}

export interface PlanCard {
  code: string;
  name: string;
  kind: string;
  kind_label: string;
  capacity_ml: number;
  capacity_litres: string;
  volume_ml: number;
  litres: string;
  fill_pct: string;
  status: string;
  status_label: string;
  state: string;
  state_label: string;
  lot_id: string | null;
  lot_code: string | null;
  wine_name: string | null;
  vintage: number | null;
  product_state: string | null;
  last_operation: PlanCardOperation | null;
  last_analysis: PlanCardAnalysis | null;
}

interface VesselRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  material: string;
  status: string;
  capacity_ml: number;
}

/** Ficha del plano: una llamada con lote, vino, llenado, última operación y analítica. */
export async function getPlanCard(writer: Writer, _request: Request, code: string): Promise<PlanCard> {
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name, kind, material, status, capacity_ml::VARCHAR AS capacity_ml
    FROM cellar.vessel
    WHERE code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const vessel: VesselRow = {
    id: textOf(row.id).toLowerCase(),
    code: textOf(row.code),
    name: textOf(row.name),
    kind: textOf(row.kind),
    material: textOf(row.material),
    status: textOf(row.status),
    capacity_ml: intOf(row.capacity_ml),
  };
  const content = await contentOf(writer, vessel.id);
  const state = mapState(vessel, content.volume_ml, content.product_state);
  const [lastOperation, lastAnalysis] = await Promise.all([
    operationOf(writer, vessel.id),
    analysisOf(writer, vessel.id, content.lot_id),
  ]);
  return {
    code: vessel.code,
    name: vessel.name,
    kind: vessel.kind,
    kind_label: KIND_LABELS[vessel.kind] ?? vessel.kind,
    capacity_ml: vessel.capacity_ml,
    capacity_litres: litresOf(vessel.capacity_ml),
    volume_ml: content.volume_ml,
    litres: litresOf(content.volume_ml),
    fill_pct: fillPct(content.volume_ml, vessel.capacity_ml),
    status: vessel.status,
    status_label: STATUS_LABELS[vessel.status] ?? vessel.status,
    state,
    state_label: STATE_LABELS[state] ?? state,
    lot_id: content.lot_id,
    lot_code: content.lot_code,
    wine_name: content.wine_name,
    vintage: content.vintage,
    product_state: content.product_state,
    last_operation: lastOperation,
    last_analysis: lastAnalysis,
  };
}

function mapState(vessel: VesselRow, volume: number, productState: string | null): string {
  if (vessel.status !== 'in_service') return vessel.status;
  if (volume <= 0) return 'empty';
  if (vessel.kind === 'barrel' && vessel.material === 'oak' && productState === 'wine') return 'aging';
  if (productState === 'must') return 'fermenting';
  return productState ?? 'empty';
}

async function contentOf(writer: Writer, vesselId: string): Promise<{
  lot_id: string | null;
  lot_code: string | null;
  wine_name: string | null;
  vintage: number | null;
  volume_ml: number;
  product_state: string | null;
}> {
  const empty = {
    lot_id: null,
    lot_code: null,
    wine_name: null,
    vintage: null,
    volume_ml: 0,
    product_state: null,
  };
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT lot_id::VARCHAR AS lot_id, product_state, sum(volume_ml)::VARCHAR AS volume_ml
    FROM inventory.stock_move
    WHERE vessel_id = CAST(${vesselId} AS UUID)
    GROUP BY lot_id, product_state
    HAVING sum(volume_ml) <> 0 OR sum(qty_units) <> 0 OR sum(mass_g) <> 0
  `);
  if (rows.length !== 1) {
    const volume = rows.reduce((sum, row) => sum + intOf(row.volume_ml), 0);
    return { ...empty, volume_ml: volume };
  }
  const row = rows[0];
  if (!row) return empty;
  const lotId = textOrNull(row.lot_id);
  const volume = intOf(row.volume_ml);
  if (!lotId) {
    return { ...empty, volume_ml: volume, product_state: textOrNull(row.product_state) };
  }
  const lots = await writer.read<Record<string, unknown>>(sql`
    SELECT l.code, w.name AS wine_name, l.vintage
    FROM inventory.lot l
    LEFT JOIN catalog.wine w ON w.id = l.wine_id
    WHERE l.id = CAST(${lotId} AS UUID)
  `);
  const lot = lots[0];
  return {
    lot_id: lotId.toLowerCase(),
    lot_code: lot ? textOf(lot.code) : null,
    wine_name: lot ? textOrNull(lot.wine_name) : null,
    vintage: lot?.vintage == null ? null : intOf(lot.vintage),
    volume_ml: volume,
    product_state: textOrNull(row.product_state),
  };
}

async function operationOf(writer: Writer, vesselId: string): Promise<PlanCardOperation | null> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT o.op_type, o.occurred_at, o.status
    FROM cellar.operation o
    WHERE o.status <> 'discarded'
      AND (
        EXISTS (
          SELECT 1 FROM cellar.operation_line l
          WHERE l.operation_id = o.id AND l.vessel_id = CAST(${vesselId} AS UUID)
        )
        OR EXISTS (
          SELECT 1 FROM cellar.cleaning_record c
          WHERE c.operation_id = o.id AND c.vessel_id = CAST(${vesselId} AS UUID)
        )
      )
    ORDER BY o.occurred_at DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  const opType = textOf(row.op_type);
  return {
    op_type: opType,
    op_type_label: OP_LABELS[opType] ?? opType,
    occurred_at: instant(row.occurred_at),
    status: textOf(row.status),
  };
}

async function analysisOf(writer: Writer, vesselId: string, lotId: string | null): Promise<PlanCardAnalysis | null> {
  const rows = await writer.read<Record<string, unknown>>(lotId
    ? sql`
      SELECT id::VARCHAR AS id, sampled_at, kind
      FROM cellar.analysis
      WHERE vessel_id = CAST(${vesselId} AS UUID) OR lot_id = CAST(${lotId} AS UUID)
      ORDER BY CASE WHEN vessel_id = CAST(${vesselId} AS UUID) THEN 0 ELSE 1 END, sampled_at DESC
      LIMIT 1
    `
    : sql`
      SELECT id::VARCHAR AS id, sampled_at, kind
      FROM cellar.analysis
      WHERE vessel_id = CAST(${vesselId} AS UUID)
      ORDER BY sampled_at DESC
      LIMIT 1
    `);
  const row = rows[0];
  if (!row) return null;
  const id = textOf(row.id);
  const metrics = await writer.read<Record<string, unknown>>(sql`
    SELECT r.parameter_code, p.name_es, r.value, p.unit
    FROM cellar.analysis_result r
    JOIN cellar.analysis_parameter p ON p.code = r.parameter_code
    WHERE r.analysis_id = CAST(${id} AS UUID)
    ORDER BY p.name_es
    LIMIT 4
  `);
  return {
    sampled_at: instant(row.sampled_at),
    kind: textOf(row.kind),
    results: metrics.map((metric) => ({
      parameter_code: textOf(metric.parameter_code),
      name: textOf(metric.name_es),
      value: metricValue(metric.value),
      unit: textOf(metric.unit),
    })),
  };
}

function instant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = textOf(value);
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return text;
}

function metricValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  return String(value);
}
