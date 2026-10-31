import {
  boolValue,
  enumValue,
  FieldBag,
  hasKey,
  intValue,
  rejectUnknown,
  requireUuid,
  textValue,
} from '../catalog/fields';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { parseQuantity } from './quantities';
import {
  DOSE_UNITS,
  PRODUCT_KINDS,
  productView,
  type DoseUnit,
  type ProductKind,
  type ProductView,
} from './rows';

const CREATE_KEYS = [
  'commercial_name',
  'registration_number',
  'active_substances',
  'is_organic_approved',
  'safety_interval_days',
  'max_dose',
  'max_dose_unit',
  'product_kind',
  'nutrient_npk',
  'notes',
] as const;

const PATCH_KEYS = [
  'commercial_name',
  'registration_number',
  'active_substances',
  'is_organic_approved',
  'safety_interval_days',
  'max_dose',
  'max_dose_unit',
  'nutrient_npk',
  'notes',
  'is_active',
] as const;

interface ProductInput {
  commercialName: string;
  registrationNumber: string | null;
  activeSubstances: string;
  isOrganicApproved: boolean;
  safetyIntervalDays: number;
  maxDose: string;
  maxDoseUnit: DoseUnit;
  productKind: ProductKind;
  nutrientNpk: string | null;
  notes: string | null;
}

export async function listNotebookProducts(writer: Writer, request: Request): Promise<{ items: ProductView[] }> {
  const url = new URL(request.url);
  const errors = new FieldBag();
  const kindRaw = url.searchParams.get('product_kind');
  let kind: ProductKind | null = null;
  if (kindRaw !== null && kindRaw !== '') {
    kind = enumValue(kindRaw, 'product_kind', PRODUCT_KINDS, errors);
  }
  const includeInactive = url.searchParams.get('include_inactive') === 'true';
  if (url.searchParams.get('include_inactive') !== null
    && url.searchParams.get('include_inactive') !== 'true'
    && url.searchParams.get('include_inactive') !== 'false') {
    errors.add('include_inactive', 'Debe ser true o false');
  }
  errors.fail();
  const filters = [includeInactive ? 'TRUE' : 'is_active'];
  if (kind) filters.push(sql`product_kind = ${kind}`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT id, commercial_name, registration_number, active_substances, is_organic_approved,
           safety_interval_days, max_dose, max_dose_unit, product_kind, nutrient_npk, notes,
           is_active, created_by, created_at
    FROM vineyard.notebook_product
    WHERE ${filters.join(' AND ')}
    ORDER BY commercial_name, id
  `);
  return { items: rows.map(productView) };
}

export async function getNotebookProduct(writer: Writer, id: string): Promise<ProductView> {
  requireUuid(id);
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id, commercial_name, registration_number, active_substances, is_organic_approved,
           safety_interval_days, max_dose, max_dose_unit, product_kind, nutrient_npk, notes,
           is_active, created_by, created_at
    FROM vineyard.notebook_product
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return productView(row);
}

export async function createNotebookProduct(writer: Writer, actor: Actor, body: unknown): Promise<ProductView> {
  const input = parseProduct(body);
  const id = newId();
  const now = new Date();
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      INSERT INTO vineyard.notebook_product (
        id, commercial_name, registration_number, active_substances, is_organic_approved,
        safety_interval_days, max_dose, max_dose_unit, product_kind, nutrient_npk, notes,
        is_active, created_by, created_at
      ) VALUES (
        CAST(${id} AS UUID), ${input.commercialName}, ${input.registrationNumber}, ${input.activeSubstances},
        ${input.isOrganicApproved}, ${input.safetyIntervalDays}, CAST(${input.maxDose} AS DECIMAL(12,4)),
        ${input.maxDoseUnit}, ${input.productKind}, ${input.nutrientNpk}, ${input.notes},
        TRUE, ${actor.id}, ${now}
      )
    `);
    tx.audit({
      table: 'vineyard.notebook_product',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: snapshot(id, input, true, actor.id, now),
    });
  });
  return getNotebookProduct(writer, id);
}

export async function updateNotebookProduct(
  writer: Writer,
  actor: Actor,
  id: string,
  body: unknown,
): Promise<ProductView> {
  requireUuid(id);
  const patch = parseProductPatch(body);
  await writer.withWrite(actor, async (tx) => {
    const current = await readProduct(tx, id);
    if (!current) throw domainError('WC_NOT_FOUND');
    const next = mergeProduct(current, patch);
    tx.write(sql`
      UPDATE vineyard.notebook_product
      SET commercial_name = ${next.commercial_name},
          registration_number = ${next.registration_number},
          active_substances = ${next.active_substances},
          is_organic_approved = ${next.is_organic_approved},
          safety_interval_days = ${next.safety_interval_days},
          max_dose = CAST(${next.max_dose} AS DECIMAL(12,4)),
          max_dose_unit = ${next.max_dose_unit},
          nutrient_npk = ${next.nutrient_npk},
          notes = ${next.notes},
          is_active = ${next.is_active}
      WHERE id = CAST(${id} AS UUID)
    `);
    tx.audit({
      table: 'vineyard.notebook_product',
      rowId: id,
      action: 'UPDATE',
      before: current,
      after: next,
    });
  });
  return getNotebookProduct(writer, id);
}

export async function readProduct(tx: Tx, id: string): Promise<ProductView | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, commercial_name, registration_number, active_substances, is_organic_approved,
           safety_interval_days, max_dose, max_dose_unit, product_kind, nutrient_npk, notes,
           is_active, created_by, created_at
    FROM vineyard.notebook_product
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  return row ? productView(row) : null;
}

function parseProduct(body: unknown): ProductInput {
  const record = objectBody(body);
  const errors = new FieldBag();
  rejectUnknown(record, CREATE_KEYS, errors);
  const commercialName = textValue(record.commercial_name, 'commercial_name', errors, { required: true, max: 160 });
  const productKind = enumValue(record.product_kind, 'product_kind', PRODUCT_KINDS, errors);
  const registration = textValue(record.registration_number, 'registration_number', errors, {
    required: productKind === 'phytosanitary',
    max: 80,
  });
  const substances = textValue(record.active_substances, 'active_substances', errors, { required: true, max: 500 });
  const organic = boolValue(record.is_organic_approved, 'is_organic_approved', errors);
  const days = intValue(record.safety_interval_days, 'safety_interval_days', errors, { min: 0, max: 3650 });
  const maxDose = parseQuantity(record.max_dose, 'max_dose', errors, 4, '99999999.9999');
  const unit = enumValue(record.max_dose_unit, 'max_dose_unit', DOSE_UNITS, errors);
  const nutrient = textValue(record.nutrient_npk, 'nutrient_npk', errors, { max: 40 });
  const notes = textValue(record.notes, 'notes', errors, { max: 1000 });
  errors.fail();
  if (!commercialName || !productKind || !substances || organic == null || days == null || !maxDose || !unit) {
    throw domainError('WC_VALIDATION');
  }
  return {
    commercialName,
    registrationNumber: registration,
    activeSubstances: substances,
    isOrganicApproved: organic,
    safetyIntervalDays: days,
    maxDose,
    maxDoseUnit: unit,
    productKind,
    nutrientNpk: nutrient,
    notes,
  };
}

function parseProductPatch(body: unknown): Partial<ProductInput> & { isActive?: boolean } {
  const record = objectBody(body);
  const errors = new FieldBag();
  rejectUnknown(record, PATCH_KEYS, errors);
  if (Object.keys(record).length === 0) errors.add('body', 'No hay cambios');
  const patch: Partial<ProductInput> & { isActive?: boolean } = {};
  if (hasKey(record, 'commercial_name')) {
    const value = textValue(record.commercial_name, 'commercial_name', errors, { required: true, max: 160 });
    if (value) patch.commercialName = value;
  }
  if (hasKey(record, 'registration_number')) {
    patch.registrationNumber = textValue(record.registration_number, 'registration_number', errors, { max: 80 });
  }
  if (hasKey(record, 'active_substances')) {
    const value = textValue(record.active_substances, 'active_substances', errors, { required: true, max: 500 });
    if (value) patch.activeSubstances = value;
  }
  if (hasKey(record, 'is_organic_approved')) {
    const value = boolValue(record.is_organic_approved, 'is_organic_approved', errors);
    if (value != null) patch.isOrganicApproved = value;
  }
  if (hasKey(record, 'safety_interval_days')) {
    const value = intValue(record.safety_interval_days, 'safety_interval_days', errors, { min: 0, max: 3650 });
    if (value != null) patch.safetyIntervalDays = value;
  }
  if (hasKey(record, 'max_dose')) {
    const value = parseQuantity(record.max_dose, 'max_dose', errors, 4, '99999999.9999');
    if (value) patch.maxDose = value;
  }
  if (hasKey(record, 'max_dose_unit')) {
    const value = enumValue(record.max_dose_unit, 'max_dose_unit', DOSE_UNITS, errors);
    if (value) patch.maxDoseUnit = value;
  }
  if (hasKey(record, 'nutrient_npk')) {
    patch.nutrientNpk = textValue(record.nutrient_npk, 'nutrient_npk', errors, { max: 40 });
  }
  if (hasKey(record, 'notes')) {
    patch.notes = textValue(record.notes, 'notes', errors, { max: 1000 });
  }
  if (hasKey(record, 'is_active')) {
    const value = boolValue(record.is_active, 'is_active', errors);
    if (value != null) patch.isActive = value;
  }
  errors.fail();
  return patch;
}

function mergeProduct(current: ProductView, patch: Partial<ProductInput> & { isActive?: boolean }): ProductView {
  const next: ProductView = {
    ...current,
    commercial_name: patch.commercialName ?? current.commercial_name,
    registration_number: owns(patch, 'registrationNumber') ? patch.registrationNumber ?? null : current.registration_number,
    active_substances: patch.activeSubstances ?? current.active_substances,
    is_organic_approved: patch.isOrganicApproved ?? current.is_organic_approved,
    safety_interval_days: patch.safetyIntervalDays ?? current.safety_interval_days,
    max_dose: patch.maxDose ?? current.max_dose,
    max_dose_unit: patch.maxDoseUnit ?? current.max_dose_unit,
    nutrient_npk: owns(patch, 'nutrientNpk') ? patch.nutrientNpk ?? null : current.nutrient_npk,
    notes: owns(patch, 'notes') ? patch.notes ?? null : current.notes,
    is_active: patch.isActive ?? current.is_active,
  };
  if (next.product_kind === 'phytosanitary' && !next.registration_number) {
    throw domainError('WC_VALIDATION', { registration_number: 'Obligatorio en fitosanitarios' });
  }
  return next;
}

function snapshot(id: string, input: ProductInput, active: boolean, createdBy: string, now: Date) {
  return {
    id,
    commercial_name: input.commercialName,
    registration_number: input.registrationNumber,
    active_substances: input.activeSubstances,
    is_organic_approved: input.isOrganicApproved,
    safety_interval_days: input.safetyIntervalDays,
    max_dose: input.maxDose,
    max_dose_unit: input.maxDoseUnit,
    product_kind: input.productKind,
    nutrient_npk: input.nutrientNpk,
    notes: input.notes,
    is_active: active,
    created_by: createdBy,
    created_at: now.toISOString(),
  };
}

function owns(patch: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw domainError('WC_VALIDATION', { body: 'Se esperaba un objeto' });
  }
  return body as Record<string, unknown>;
}
