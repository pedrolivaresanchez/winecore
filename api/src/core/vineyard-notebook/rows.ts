import { businessDate } from '../time';
import { cueClock, type CueClock } from './dates';
import { decimalText } from './quantities';

export const DOSE_UNITS = ['kg/ha', 'l/ha', 'g/hl', 'ml/hl'] as const;
export type DoseUnit = (typeof DOSE_UNITS)[number];

export const PRODUCT_KINDS = ['phytosanitary', 'fertiliser', 'other'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const OPERATION_KINDS = ['cleaning', 'residue_analysis', 'irrigation', 'cover_crop', 'other'] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const APPLICATION_TIMINGS = ['fondo', 'cobertera', 'foliar', 'fertirrigacion', 'otro'] as const;
export type ApplicationTiming = (typeof APPLICATION_TIMINGS)[number];

export const QUANTITY_UNIT: Record<DoseUnit, string> = {
  'kg/ha': 'kg',
  'l/ha': 'l',
  'g/hl': 'g',
  'ml/hl': 'ml',
};

export const PER_HECTARE = new Set<DoseUnit>(['kg/ha', 'l/ha']);

export interface ProductView {
  id: string;
  commercial_name: string;
  registration_number: string | null;
  active_substances: string;
  is_organic_approved: boolean;
  safety_interval_days: number;
  max_dose: string;
  max_dose_unit: DoseUnit;
  product_kind: ProductKind;
  nutrient_npk: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

export interface NotebookWarning {
  code: 'SAFETY_INTERVAL' | 'PLANNED_HARVEST';
  message: string;
  parcel_id: string;
  parcel_code: string;
  event_on: string;
  source: 'harvest' | 'maturity';
  safety_interval_days: number;
  interval_ends_on: string;
}

export interface TreatmentView {
  id: string;
  group_id: string | null;
  parcel_id: string;
  parcel_code: string;
  sigpac: string;
  parcel_area_ha: string;
  parcel_is_organic: boolean;
  applied_on: string;
  campaign: number | null;
  kind: string;
  crop: string;
  variety: string | null;
  operator_name: string;
  applicator_ropo: string | null;
  advisor_name: string | null;
  product_id: string | null;
  product_name: string;
  product_registration: string | null;
  active_substances: string | null;
  is_organic_approved: boolean;
  dose: string;
  dose_unit: string;
  max_dose: string | null;
  max_dose_unit: string | null;
  total_quantity: string | null;
  quantity_unit: string | null;
  treated_area_ha: string;
  method: string;
  target: string | null;
  equipment_roma: string | null;
  safety_interval_days: number | null;
  weather_notes: string | null;
  efficacy: string | null;
  nutrient_npk: string | null;
  application_timing: string | null;
  supplier_invoice_id: string | null;
  cue_recorded_at: string | null;
  cue: CueClock;
  warnings: NotebookWarning[];
  notes: string | null;
  created_by: string;
  created_at: string;
}

export interface OperationView {
  id: string;
  parcel_id: string;
  parcel_code: string;
  sigpac: string;
  done_on: string;
  campaign: number;
  kind: OperationKind;
  operator_name: string | null;
  product_name: string | null;
  active_substance: string | null;
  quantity: string | null;
  quantity_unit: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export const TREATMENT_FROM = `
  FROM vineyard.treatment t
  JOIN vineyard.parcel p ON p.id = t.parcel_id
`;

export const TREATMENT_COLUMNS = `
  t.id, t.group_id, t.parcel_id, p.code AS parcel_code,
  p.area_ha AS parcel_area_ha, p.is_organic AS parcel_is_organic,
  p.sigpac_province, p.sigpac_municipality, p.sigpac_aggregate, p.sigpac_zone,
  p.sigpac_polygon, p.sigpac_parcel, p.sigpac_enclosure, p.organic_since, p.name AS parcel_name,
  t.applied_on, t.campaign, t.record_kind, t.crop, t.variety,
  t.operator_name, t.applicator_ropo, t.advisor_name,
  t.notebook_product_id, t.product_name, t.product_registration, t.active_substances,
  t.is_organic_approved, t.dose, t.dose_unit, t.max_dose, t.max_dose_unit,
  t.total_quantity, t.quantity_unit, t.treated_area_ha, t.method, t.target,
  t.equipment_roma, t.weather_notes, t.safety_interval_days, t.efficacy, t.nutrient_npk, t.application_timing,
  t.supplier_invoice_id, t.cue_recorded_at, t.notes, t.created_by, t.created_at
`;

export function productView(row: Record<string, unknown>): ProductView {
  return {
    id: uuidText(row.id),
    commercial_name: text(row.commercial_name),
    registration_number: textOrNull(row.registration_number),
    active_substances: text(row.active_substances),
    is_organic_approved: bool(row.is_organic_approved),
    safety_interval_days: asInt(row.safety_interval_days) ?? 0,
    max_dose: decimalText(row.max_dose, 4),
    max_dose_unit: text(row.max_dose_unit) as DoseUnit,
    product_kind: text(row.product_kind) as ProductKind,
    nutrient_npk: textOrNull(row.nutrient_npk),
    notes: textOrNull(row.notes),
    is_active: bool(row.is_active),
    created_by: text(row.created_by),
    created_at: asTimestamp(row.created_at) ?? '',
  };
}

export function treatmentView(row: Record<string, unknown>, asOf: string, warnings: NotebookWarning[]): TreatmentView {
  const appliedOn = asCivilDate(row.applied_on);
  const recorded = textOrNull(row.cue_recorded_at);
  const total = row.total_quantity == null ? null : decimalText(row.total_quantity, 4);
  return {
    id: uuidText(row.id),
    group_id: row.group_id == null ? null : uuidText(row.group_id),
    parcel_id: uuidText(row.parcel_id),
    parcel_code: text(row.parcel_code),
    sigpac: sigpacOf(row),
    parcel_area_ha: decimalText(row.parcel_area_ha, 4),
    parcel_is_organic: bool(row.parcel_is_organic),
    applied_on: appliedOn,
    campaign: asInt(row.campaign),
    kind: text(row.record_kind),
    crop: text(row.crop),
    variety: textOrNull(row.variety),
    operator_name: text(row.operator_name),
    applicator_ropo: textOrNull(row.applicator_ropo),
    advisor_name: textOrNull(row.advisor_name),
    product_id: row.notebook_product_id == null ? null : uuidText(row.notebook_product_id),
    product_name: text(row.product_name),
    product_registration: textOrNull(row.product_registration),
    active_substances: textOrNull(row.active_substances),
    is_organic_approved: bool(row.is_organic_approved),
    dose: decimalText(row.dose, 3),
    dose_unit: text(row.dose_unit),
    max_dose: row.max_dose == null ? null : decimalText(row.max_dose, 4),
    max_dose_unit: textOrNull(row.max_dose_unit),
    total_quantity: total,
    quantity_unit: textOrNull(row.quantity_unit),
    treated_area_ha: decimalText(row.treated_area_ha, 4),
    method: text(row.method),
    target: textOrNull(row.target),
    equipment_roma: textOrNull(row.equipment_roma),
    safety_interval_days: asInt(row.safety_interval_days),
    weather_notes: textOrNull(row.weather_notes),
    efficacy: textOrNull(row.efficacy),
    nutrient_npk: textOrNull(row.nutrient_npk),
    application_timing: textOrNull(row.application_timing),
    supplier_invoice_id: row.supplier_invoice_id == null ? null : uuidText(row.supplier_invoice_id),
    cue_recorded_at: recorded == null ? null : asTimestamp(row.cue_recorded_at),
    cue: cueClock({
      kind: text(row.record_kind),
      appliedOn,
      recorded: recorded != null,
      asOf,
    }),
    warnings,
    notes: textOrNull(row.notes),
    created_by: text(row.created_by),
    created_at: asTimestamp(row.created_at) ?? '',
  };
}

export function operationView(row: Record<string, unknown>): OperationView {
  return {
    id: uuidText(row.id),
    parcel_id: uuidText(row.parcel_id),
    parcel_code: text(row.parcel_code),
    sigpac: sigpacOf(row),
    done_on: asCivilDate(row.done_on),
    campaign: asInt(row.campaign) ?? calendarYearFrom(row.done_on),
    kind: text(row.kind) as OperationKind,
    operator_name: textOrNull(row.operator_name),
    product_name: textOrNull(row.product_name),
    active_substance: textOrNull(row.active_substance),
    quantity: row.quantity == null ? null : decimalText(row.quantity, 4),
    quantity_unit: textOrNull(row.quantity_unit),
    notes: textOrNull(row.notes),
    created_by: text(row.created_by),
    created_at: asTimestamp(row.created_at) ?? '',
  };
}

export function sigpacOf(row: Record<string, unknown>): string {
  const parts = [
    asInt(row.sigpac_province),
    asInt(row.sigpac_municipality),
    asInt(row.sigpac_aggregate),
    asInt(row.sigpac_zone),
    asInt(row.sigpac_polygon),
    asInt(row.sigpac_parcel),
  ];
  const head = parts.map((part) => (part == null ? '' : String(part))).join(':');
  const enclosure = asInt(row.sigpac_enclosure);
  return enclosure == null ? head : `${head}:${enclosure}`;
}

export function uuidText(value: unknown): string {
  return String(value).toLowerCase();
}

export function text(value: unknown): string {
  return value == null ? '' : String(value);
}

export function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

export function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

export function asInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}

export function asCivilDate(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    const midnight = value.getUTCHours() === 0
      && value.getUTCMinutes() === 0
      && value.getUTCSeconds() === 0
      && value.getUTCMilliseconds() === 0;
    if (midnight) return value.toISOString().slice(0, 10);
    return businessDate(value);
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match?.[1] ?? '';
}

export function asTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  let textValue = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} /.test(textValue)) textValue = textValue.replace(' ', 'T');
  if (textValue.endsWith('+00')) textValue = `${textValue.slice(0, -3)}Z`;
  const date = new Date(textValue);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function calendarYearFrom(value: unknown): number {
  const iso = asCivilDate(value);
  return iso.length >= 4 ? Number(iso.slice(0, 4)) : 0;
}
