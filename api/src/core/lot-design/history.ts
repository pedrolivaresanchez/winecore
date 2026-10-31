import { FieldBag, isUuid, readObject, rejectUnknown } from '../catalog/fields';
import { uuidList } from '../cellar/service/http';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { isOpType } from './codes';
import { civilDaysBetween, instantToCivil } from './dates';
import {
  asArray,
  asInt,
  asNum,
  asRecord,
  asText,
  gramsPerHectolitre,
  roundTo,
  type SqlReader,
} from './rows';

const PARAM_KEYS = [
  'temperature_c',
  'temperature',
  'duration_hours',
  'duration_days',
  'plates',
  'method',
  'aging_method',
  'aging_duration_days',
  'notes',
] as const;

const DOSE_UNITS = ['g/hl', 'mg/l', 'g/l'] as const;
const QTY_UNITS = ['g', 'kg', 'ml', 'l'] as const;
const STEP_FIELDS = [
  'position', 'op_type', 'offset_days', 'duration_hours', 'temperature_c',
  'additions', 'blend_proportions', 'parameters', 'source_operation_id',
] as const;

export interface RecipeAddition {
  product_id: string | null;
  product_name: string | null;
  quantity: number | null;
  quantity_unit: string | null;
  dose: number;
  dose_unit: string;
  dose_g_per_hl: number | null;
  purpose: string | null;
}

export interface BlendShare {
  lot_id: string;
  lot_code: string;
  volume_ml: number;
  mass_g: number;
  percent: number;
}

export interface RecipeStep {
  position: number;
  op_type: string;
  offset_days: number;
  duration_hours: number | null;
  temperature_c: number | null;
  additions: RecipeAddition[];
  blend_proportions: BlendShare[];
  parameters: Record<string, unknown>;
  source_operation_id: string | null;
}

interface OpRow {
  id: string;
  op_type: string;
  occurred_at: unknown;
  details: unknown;
}

interface LineRow {
  operation_id: string;
  role: string;
  lot_id: string;
  lot_code: string;
  volume_ml: number;
  mass_g: number;
}

function pickParams(details: unknown): Record<string, unknown> {
  const record = asRecord(details);
  const out: Record<string, unknown> = {};
  for (const key of PARAM_KEYS) {
    if (record[key] !== undefined) out[key] = record[key];
  }
  const nested = asRecord(record.parameters);
  for (const key of PARAM_KEYS) {
    if (out[key] === undefined && nested[key] !== undefined) out[key] = nested[key];
  }
  return out;
}

function temperatureOf(params: Record<string, unknown>): number | null {
  const value = asNum(params.temperature_c ?? params.temperature);
  return value == null ? null : roundTo(value, 2);
}

function durationOf(params: Record<string, unknown>): number | null {
  const hours = asNum(params.duration_hours);
  if (hours != null) return roundTo(hours, 2);
  const days = asNum(params.duration_days);
  if (days != null) return roundTo(days * 24, 2);
  return null;
}

function shares(inputs: readonly LineRow[]): BlendShare[] {
  const volume = inputs.reduce((sum, line) => sum + line.volume_ml, 0);
  const mass = inputs.reduce((sum, line) => sum + line.mass_g, 0);
  const useMass = volume <= 0;
  const total = useMass ? mass : volume;
  return inputs.map((line) => {
    const part = useMass ? line.mass_g : line.volume_ml;
    return {
      lot_id: line.lot_id,
      lot_code: line.lot_code,
      volume_ml: line.volume_ml,
      mass_g: line.mass_g,
      percent: total > 0 ? roundTo((part / total) * 100, 2) : 0,
    };
  });
}

function mapAddition(row: Record<string, unknown>): RecipeAddition {
  const dose = asNum(row.dose) ?? 0;
  const unit = asText(row.dose_unit) ?? '';
  return {
    product_id: asText(row.product_id)?.toLowerCase() ?? null,
    product_name: asText(row.product_name),
    quantity: asNum(row.quantity),
    quantity_unit: asText(row.quantity_unit),
    dose,
    dose_unit: unit,
    dose_g_per_hl: gramsPerHectolitre(dose, unit),
    purpose: asText(row.purpose),
  };
}

/** Confirmed elaboration of one lot, in cellar order. Rectifications are left out. */
export async function loadHistory(reader: SqlReader, lotId: string): Promise<RecipeStep[]> {
  if (!isUuid(lotId)) throw domainError('WC_NOT_FOUND');
  const ops = await reader.read<Record<string, unknown>>(sql`
    SELECT
      o.id::VARCHAR AS id,
      o.op_type,
      o.occurred_at,
      o.details
    FROM cellar.operation o
    WHERE o.status = 'confirmed'
      AND o.rectifies_operation_id IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM cellar.operation_line l
          WHERE l.operation_id = o.id AND l.lot_id = CAST(${lotId} AS UUID)
        )
        OR EXISTS (
          SELECT 1 FROM cellar.addition a
          WHERE a.operation_id = o.id AND a.lot_id = CAST(${lotId} AS UUID)
        )
        OR EXISTS (
          SELECT 1 FROM inventory.lot_edge e
          WHERE e.operation_id = o.id AND e.child_lot_id = CAST(${lotId} AS UUID)
        )
        OR o.id = (SELECT created_by_operation_id FROM inventory.lot WHERE id = CAST(${lotId} AS UUID))
      )
    ORDER BY o.occurred_at, o.id
  `);
  if (ops.length === 0) return [];
  const operationIds = ops.map((row) => String(row.id));
  const lines = await reader.read<Record<string, unknown>>(`
    SELECT
      l.operation_id::VARCHAR AS operation_id,
      l.role,
      l.lot_id::VARCHAR AS lot_id,
      p.code AS lot_code,
      l.volume_ml::VARCHAR AS volume_ml,
      l.mass_g::VARCHAR AS mass_g
    FROM cellar.operation_line l
    LEFT JOIN inventory.lot p ON p.id = l.lot_id
    WHERE l.operation_id IN (${uuidList(operationIds)})
  `);
  const additions = await reader.read<Record<string, unknown>>(`
    SELECT
      a.operation_id::VARCHAR AS operation_id,
      a.additive_product_id::VARCHAR AS product_id,
      pr.name AS product_name,
      a.quantity::VARCHAR AS quantity,
      a.quantity_unit,
      a.dose::VARCHAR AS dose,
      a.dose_unit,
      a.purpose
    FROM cellar.addition a
    LEFT JOIN catalog.product pr ON pr.id = a.additive_product_id
    WHERE a.lot_id = CAST('${lotId.toLowerCase()}' AS UUID)
      AND a.operation_id IN (${uuidList(operationIds)})
  `);
  const linesByOp = new Map<string, LineRow[]>();
  for (const row of lines) {
    const operationId = String(row.operation_id);
    const list = linesByOp.get(operationId) ?? [];
    list.push({
      operation_id: operationId,
      role: String(row.role),
      lot_id: String(row.lot_id).toLowerCase(),
      lot_code: asText(row.lot_code) ?? String(row.lot_id),
      volume_ml: asInt(row.volume_ml) ?? 0,
      mass_g: asInt(row.mass_g) ?? 0,
    });
    linesByOp.set(operationId, list);
  }
  const additionsByOp = new Map<string, RecipeAddition[]>();
  for (const row of additions) {
    const operationId = String(row.operation_id);
    const list = additionsByOp.get(operationId) ?? [];
    list.push(mapAddition(row));
    additionsByOp.set(operationId, list);
  }
  const ordered: OpRow[] = ops.map((row) => ({
    id: String(row.id).toLowerCase(),
    op_type: String(row.op_type),
    occurred_at: row.occurred_at,
    details: row.details,
  }));
  const firstCivil = ordered.map((op) => instantToCivil(op.occurred_at)).find((day) => day !== null) ?? null;
  return ordered.map((op, index) => {
    const params = pickParams(op.details);
    const day = instantToCivil(op.occurred_at);
    const offset = firstCivil && day ? Math.max(0, civilDaysBetween(firstCivil, day)) : 0;
    const inputs = (linesByOp.get(op.id) ?? []).filter((line) => line.role === 'input');
    return {
      position: index + 1,
      op_type: op.op_type,
      offset_days: offset,
      duration_hours: durationOf(params),
      temperature_c: temperatureOf(params),
      additions: additionsByOp.get(op.id) ?? [],
      blend_proportions: op.op_type === 'blend' ? shares(inputs) : [],
      parameters: params,
      source_operation_id: op.id,
    };
  });
}

function optionalNumber(value: unknown, field: string, errors: FieldBag, min: number, max: number): number | null {
  if (value == null || value === '') return null;
  const parsed = asNum(value);
  if (parsed == null || parsed < min || parsed > max) {
    errors.add(field, `Debe ser un número entre ${min} y ${max}`);
    return null;
  }
  return roundTo(parsed, 3);
}

function parseAddition(value: unknown, field: string, errors: FieldBag): RecipeAddition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.add(field, 'Adición no válida');
    return null;
  }
  const record = value as Record<string, unknown>;
  rejectUnknown(record, [
    'product_id', 'product_name', 'quantity', 'quantity_unit', 'dose', 'dose_unit', 'dose_g_per_hl', 'purpose',
  ], errors);
  const dose = asNum(record.dose);
  const unit = typeof record.dose_unit === 'string' ? record.dose_unit : '';
  if (dose == null || dose <= 0) errors.add(`${field}.dose`, 'Dosis no válida');
  if (!(DOSE_UNITS as readonly string[]).includes(unit)) errors.add(`${field}.dose_unit`, 'Unidad de dosis no válida');
  let productId: string | null = null;
  if (record.product_id != null && record.product_id !== '') {
    if (typeof record.product_id !== 'string' || !isUuid(record.product_id)) {
      errors.add(`${field}.product_id`, 'Debe ser un UUID');
    } else productId = record.product_id.toLowerCase();
  }
  const quantityUnit = record.quantity_unit == null || record.quantity_unit === ''
    ? null
    : String(record.quantity_unit);
  if (quantityUnit && !(QTY_UNITS as readonly string[]).includes(quantityUnit)) {
    errors.add(`${field}.quantity_unit`, 'Unidad no válida');
  }
  if (dose == null || !unit) return null;
  return {
    product_id: productId,
    product_name: typeof record.product_name === 'string' ? record.product_name.trim().slice(0, 120) : null,
    quantity: asNum(record.quantity),
    quantity_unit: quantityUnit,
    dose: roundTo(dose, 3),
    dose_unit: unit,
    dose_g_per_hl: gramsPerHectolitre(dose, unit),
    purpose: typeof record.purpose === 'string' ? record.purpose.trim().slice(0, 40) : null,
  };
}

function parseShare(value: unknown, field: string, errors: FieldBag): BlendShare | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.add(field, 'Proporción no válida');
    return null;
  }
  const record = value as Record<string, unknown>;
  rejectUnknown(record, ['lot_id', 'lot_code', 'volume_ml', 'mass_g', 'percent'], errors);
  if (typeof record.lot_id !== 'string' || !isUuid(record.lot_id)) {
    errors.add(`${field}.lot_id`, 'Debe ser un UUID');
    return null;
  }
  const percent = asNum(record.percent);
  if (percent == null || percent < 0 || percent > 100) errors.add(`${field}.percent`, 'Porcentaje no válido');
  return {
    lot_id: record.lot_id.toLowerCase(),
    lot_code: typeof record.lot_code === 'string' ? record.lot_code.slice(0, 40) : '',
    volume_ml: asInt(record.volume_ml) ?? 0,
    mass_g: asInt(record.mass_g) ?? 0,
    percent: percent ?? 0,
  };
}

function parseParameters(value: unknown, field: string, errors: FieldBag): Record<string, unknown> {
  if (value == null) return {};
  const record = asRecord(value);
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    errors.add(field, 'Parámetros no válidos');
    return {};
  }
  const keys = Object.keys(record);
  if (keys.length > 30) errors.add(field, 'Demasiados parámetros');
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (!/^[a-z_][a-z0-9_]{0,40}$/.test(key)) {
      errors.add(field, 'Parámetro no reconocido');
      continue;
    }
    const item = record[key];
    if (item == null || typeof item === 'number' || typeof item === 'boolean') out[key] = item;
    else if (typeof item === 'string' && item.length <= 200) out[key] = item;
    else errors.add(field, 'Parámetro no válido');
  }
  return out;
}

export function parseSteps(value: unknown): RecipeStep[] {
  if (!Array.isArray(value)) throw domainError('WC_VALIDATION', { steps: 'Debe ser una lista' });
  if (value.length > 100) throw domainError('WC_VALIDATION', { steps: 'Máximo 100 pasos' });
  const errors = new FieldBag();
  const steps: RecipeStep[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const field = `steps[${index}]`;
    const record = readObject(value[index]);
    rejectUnknown(record, STEP_FIELDS, errors);
    const opType = typeof record.op_type === 'string' ? record.op_type : '';
    if (!isOpType(opType)) errors.add(`${field}.op_type`, 'Tipo de operación no válido');
    const offset = asInt(record.offset_days);
    if (offset == null || offset < 0 || offset > 3650) errors.add(`${field}.offset_days`, 'Desfase no válido');
    const additions = asArray(record.additions).map((item, additionIndex) => (
      parseAddition(item, `${field}.additions[${additionIndex}]`, errors)
    ));
    const blends = asArray(record.blend_proportions).map((item, blendIndex) => (
      parseShare(item, `${field}.blend_proportions[${blendIndex}]`, errors)
    ));
    let source: string | null = null;
    if (record.source_operation_id != null && record.source_operation_id !== '') {
      if (typeof record.source_operation_id !== 'string' || !isUuid(record.source_operation_id)) {
        errors.add(`${field}.source_operation_id`, 'Debe ser un UUID');
      } else source = record.source_operation_id.toLowerCase();
    }
    steps.push({
      position: index + 1,
      op_type: opType,
      offset_days: offset ?? 0,
      duration_hours: optionalNumber(record.duration_hours, `${field}.duration_hours`, errors, 0, 100_000),
      temperature_c: optionalNumber(record.temperature_c, `${field}.temperature_c`, errors, -10, 50),
      additions: additions.filter((item): item is RecipeAddition => item !== null),
      blend_proportions: blends.filter((item): item is BlendShare => item !== null),
      parameters: parseParameters(record.parameters, `${field}.parameters`, errors),
      source_operation_id: source,
    });
  }
  errors.fail();
  return steps;
}

export function stepFromRow(row: Record<string, unknown>): RecipeStep {
  return {
    position: asInt(row.position) ?? 0,
    op_type: String(row.op_type),
    offset_days: asInt(row.offset_days) ?? 0,
    duration_hours: asNum(row.duration_hours),
    temperature_c: asNum(row.temperature_c),
    additions: asArray(row.additions).map((item) => normalizeAddition(item)),
    blend_proportions: asArray(row.blend_proportions).map((item) => normalizeShare(item)),
    parameters: asRecord(row.parameters),
    source_operation_id: asText(row.source_operation_id)?.toLowerCase() ?? null,
  };
}

function normalizeAddition(value: unknown): RecipeAddition {
  const record = asRecord(value);
  const dose = asNum(record.dose) ?? 0;
  const unit = asText(record.dose_unit) ?? '';
  return {
    product_id: asText(record.product_id)?.toLowerCase() ?? null,
    product_name: asText(record.product_name),
    quantity: asNum(record.quantity),
    quantity_unit: asText(record.quantity_unit),
    dose,
    dose_unit: unit,
    dose_g_per_hl: asNum(record.dose_g_per_hl) ?? gramsPerHectolitre(dose, unit),
    purpose: asText(record.purpose),
  };
}

function normalizeShare(value: unknown): BlendShare {
  const record = asRecord(value);
  return {
    lot_id: asText(record.lot_id)?.toLowerCase() ?? '',
    lot_code: asText(record.lot_code) ?? '',
    volume_ml: asInt(record.volume_ml) ?? 0,
    mass_g: asInt(record.mass_g) ?? 0,
    percent: asNum(record.percent) ?? 0,
  };
}
