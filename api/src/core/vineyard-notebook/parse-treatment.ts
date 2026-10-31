import {
  enumValue,
  FieldBag,
  hasKey,
  isCalendarDate,
  isUuid,
  rejectUnknown,
  textValue,
} from '../catalog/fields';
import { domainError } from '../errors';
import { CUE_ELECTRONIC_FROM } from './dates';
import { parseQuantity } from './quantities';
import {
  APPLICATION_TIMINGS,
  DOSE_UNITS,
  PRODUCT_KINDS,
  type ApplicationTiming,
  type DoseUnit,
  type ProductKind,
} from './rows';

const CREATE_KEYS = [
  'kind',
  'parcel_ids',
  'parcels',
  'treated_area_ha',
  'applied_on',
  'product_id',
  'dose',
  'dose_unit',
  'total_quantity',
  'quantity_unit',
  'target',
  'operator_name',
  'applicator_ropo',
  'advisor_name',
  'equipment_roma',
  'method',
  'weather_notes',
  'crop',
  'variety',
  'efficacy',
  'supplier_invoice_id',
  'notes',
  'nutrient_npk',
  'application_timing',
] as const;

const PATCH_KEYS = ['efficacy', 'cue_recorded_at', 'notes', 'weather_notes', 'advisor_name'] as const;

export interface ParcelDose {
  parcelId: string;
  treatedAreaHa: string | null;
}

export interface TreatmentDraft {
  kind: ProductKind;
  parcels: ParcelDose[];
  appliedOn: string;
  productId: string;
  dose: string;
  doseUnit: DoseUnit;
  totalQuantity: string | null;
  quantityUnit: string | null;
  target: string | null;
  operatorName: string;
  applicatorRopo: string | null;
  advisorName: string | null;
  equipmentRoma: string | null;
  method: string;
  weatherNotes: string | null;
  crop: string;
  variety: string | null;
  efficacy: string | null;
  supplierInvoiceId: string | null;
  notes: string | null;
  nutrientNpk: string | null;
  applicationTiming: ApplicationTiming | null;
}

export interface TreatmentPatch {
  efficacy?: string | null;
  cueRecordedAt?: Date;
  notes?: string | null;
  weatherNotes?: string | null;
  advisorName?: string | null;
}

export function parseTreatmentCreate(body: unknown): TreatmentDraft {
  const record = objectBody(body);
  const errors = new FieldBag();
  rejectUnknown(record, CREATE_KEYS, errors);
  const kind = hasKey(record, 'kind')
    ? enumValue(record.kind, 'kind', PRODUCT_KINDS, errors) ?? 'phytosanitary'
    : 'phytosanitary';
  const parcels = parseParcels(record, errors);
  const appliedOn = textValue(record.applied_on, 'applied_on', errors, { required: true });
  if (appliedOn && !isCalendarDate(appliedOn)) errors.add('applied_on', 'Fecha no válida (AAAA-MM-DD)');
  const productId = textValue(record.product_id, 'product_id', errors, { required: true });
  if (productId && !isUuid(productId)) errors.add('product_id', 'Identificador no válido');
  const dose = parseQuantity(record.dose, 'dose', errors, 3, '9999999.999');
  const doseUnit = enumValue(record.dose_unit, 'dose_unit', DOSE_UNITS, errors);
  const total = hasKey(record, 'total_quantity')
    ? parseQuantity(record.total_quantity, 'total_quantity', errors, 4, '9999999999.9999')
    : null;
  const quantityUnit = textValue(record.quantity_unit, 'quantity_unit', errors, { max: 16 });
  if (total && !quantityUnit) errors.add('quantity_unit', 'Obligatorio si indicas la cantidad');
  if (!total && quantityUnit) errors.add('total_quantity', 'Obligatorio si indicas la unidad');
  const target = textValue(record.target, 'target', errors, { required: kind === 'phytosanitary', max: 200 });
  const operatorName = textValue(record.operator_name, 'operator_name', errors, { required: true, max: 120 });
  const ropo = textValue(record.applicator_ropo, 'applicator_ropo', errors, {
    required: kind === 'phytosanitary',
    min: kind === 'phytosanitary' ? 4 : undefined,
    max: 40,
  });
  const advisor = textValue(record.advisor_name, 'advisor_name', errors, { max: 120 });
  const equipmentRequired = kind === 'phytosanitary' && appliedOn != null && appliedOn >= CUE_ELECTRONIC_FROM;
  const equipment = textValue(record.equipment_roma, 'equipment_roma', errors, {
    required: equipmentRequired,
    max: 80,
  });
  const method = textValue(record.method, 'method', errors, { required: true, max: 120 });
  const weather = textValue(record.weather_notes, 'weather_notes', errors, { max: 500 });
  const crop = textValue(record.crop, 'crop', errors, { max: 80 }) ?? 'Vid';
  const variety = textValue(record.variety, 'variety', errors, { max: 80 });
  const efficacy = textValue(record.efficacy, 'efficacy', errors, { max: 500 });
  const invoice = textValue(record.supplier_invoice_id, 'supplier_invoice_id', errors, { max: 36 });
  if (invoice && !isUuid(invoice)) errors.add('supplier_invoice_id', 'Identificador no válido');
  const notes = textValue(record.notes, 'notes', errors, { max: 1000 });
  let nutrient: string | null = null;
  let timing: ApplicationTiming | null = null;
  if (kind === 'phytosanitary') {
    if (hasKey(record, 'nutrient_npk')) errors.add('nutrient_npk', 'Solo en fertilización');
    if (hasKey(record, 'application_timing')) errors.add('application_timing', 'Solo en fertilización');
  } else {
    nutrient = textValue(record.nutrient_npk, 'nutrient_npk', errors, { max: 40 });
    if (hasKey(record, 'application_timing') && record.application_timing != null && record.application_timing !== '') {
      timing = enumValue(record.application_timing, 'application_timing', APPLICATION_TIMINGS, errors);
    }
  }
  errors.fail();
  if (!appliedOn || !productId || !dose || !doseUnit || !operatorName || !method || !parcels) {
    throw domainError('WC_VALIDATION');
  }
  return {
    kind,
    parcels,
    appliedOn,
    productId,
    dose,
    doseUnit,
    totalQuantity: total,
    quantityUnit: quantityUnit,
    target,
    operatorName,
    applicatorRopo: ropo,
    advisorName: advisor,
    equipmentRoma: equipment,
    method,
    weatherNotes: weather,
    crop,
    variety,
    efficacy,
    supplierInvoiceId: invoice,
    notes,
    nutrientNpk: nutrient,
    applicationTiming: timing,
  };
}

export function parseTreatmentPatch(body: unknown): TreatmentPatch {
  const record = objectBody(body);
  const errors = new FieldBag();
  rejectUnknown(record, PATCH_KEYS, errors);
  if (Object.keys(record).length === 0) errors.add('body', 'No hay cambios');
  const patch: TreatmentPatch = {};
  if (hasKey(record, 'efficacy')) patch.efficacy = textValue(record.efficacy, 'efficacy', errors, { max: 500 });
  if (hasKey(record, 'notes')) patch.notes = textValue(record.notes, 'notes', errors, { max: 1000 });
  if (hasKey(record, 'weather_notes')) {
    patch.weatherNotes = textValue(record.weather_notes, 'weather_notes', errors, { max: 500 });
  }
  if (hasKey(record, 'advisor_name')) {
    patch.advisorName = textValue(record.advisor_name, 'advisor_name', errors, { max: 120 });
  }
  if (hasKey(record, 'cue_recorded_at')) patch.cueRecordedAt = parseCue(record.cue_recorded_at, errors);
  errors.fail();
  if (patch.cueRecordedAt === undefined && !hasAny(patch)) throw domainError('WC_VALIDATION');
  return patch;
}

function parseParcels(record: Record<string, unknown>, errors: FieldBag): ParcelDose[] | null {
  const hasIds = hasKey(record, 'parcel_ids');
  const hasParcels = hasKey(record, 'parcels');
  if (hasIds && hasParcels) {
    errors.add('parcels', 'Indica parcel_ids o parcels, no las dos');
    return null;
  }
  if (!hasIds && !hasParcels) {
    errors.add('parcel_ids', 'Obligatorio');
    return null;
  }
  if (hasParcels) return parcelObjects(record.parcels, errors);
  if (!Array.isArray(record.parcel_ids) || record.parcel_ids.length === 0) {
    errors.add('parcel_ids', 'Indica al menos una parcela');
    return null;
  }
  const shared = hasKey(record, 'treated_area_ha')
    ? parseQuantity(record.treated_area_ha, 'treated_area_ha', errors, 4, '9999.9999')
    : null;
  const doses: ParcelDose[] = [];
  const seen = new Set<string>();
  if (record.parcel_ids.length > 50) errors.add('parcel_ids', 'Máximo 50 parcelas');
  for (const item of record.parcel_ids) {
    if (typeof item !== 'string' || !isUuid(item)) {
      errors.add('parcel_ids', 'Identificador no válido');
      return null;
    }
    const id = item.toLowerCase();
    if (seen.has(id)) errors.add('parcel_ids', 'Parcela repetida');
    seen.add(id);
    doses.push({ parcelId: id, treatedAreaHa: shared });
  }
  return doses;
}

function parcelObjects(value: unknown, errors: FieldBag): ParcelDose[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    errors.add('parcels', 'Indica al menos una parcela');
    return null;
  }
  if (value.length > 50) errors.add('parcels', 'Máximo 50 parcelas');
  const doses: ParcelDose[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.add('parcels', 'Cada parcela es un objeto');
      return null;
    }
    const row = item as Record<string, unknown>;
    rejectUnknown(row, ['parcel_id', 'treated_area_ha'], errors);
    const id = textValue(row.parcel_id, 'parcel_id', errors, { required: true });
    if (!id || !isUuid(id)) {
      errors.add('parcel_id', 'Identificador no válido');
      return null;
    }
    const key = id.toLowerCase();
    if (seen.has(key)) errors.add('parcel_id', 'Parcela repetida');
    seen.add(key);
    const area = hasKey(row, 'treated_area_ha')
      ? parseQuantity(row.treated_area_ha, 'treated_area_ha', errors, 4, '9999.9999')
      : null;
    doses.push({ parcelId: key, treatedAreaHa: area });
  }
  return doses;
}

function parseCue(value: unknown, errors: FieldBag): Date | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.add('cue_recorded_at', 'Indica la fecha en que se anotó en el CUE');
    return undefined;
  }
  const trimmed = value.trim();
  if (isCalendarDate(trimmed)) return new Date(`${trimmed}T12:00:00.000Z`);
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    errors.add('cue_recorded_at', 'Fecha no válida');
    return undefined;
  }
  return date;
}

function hasAny(patch: TreatmentPatch): boolean {
  return patch.efficacy !== undefined
    || patch.notes !== undefined
    || patch.weatherNotes !== undefined
    || patch.advisorName !== undefined;
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw domainError('WC_VALIDATION', { body: 'Se esperaba un objeto' });
  }
  return body as Record<string, unknown>;
}
