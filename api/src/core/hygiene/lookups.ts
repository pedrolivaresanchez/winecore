import { sql } from '../db/sql';

type Reader = { read<T = Record<string, unknown>>(statement: string): Promise<T[]> };
import { domainError } from '../errors';
import { businessDate } from '../time';
import { invalid, jsonObject, textOf, textOrNull } from '../cellar/service/http';
import type { ConsumableKind, DoseUnit, EquipmentKind, ProcedurePurpose } from './constants';
import { classesOf, decimalOut, flagOf, idOf } from './parse';

export interface ProcedureRow {
  id: string;
  code: string;
  name: string;
  purpose: ProcedurePurpose;
  product_name: string;
  product_id: string | null;
  active_substance: string;
  dose_min: string;
  dose_max: string;
  dose_unit: DoseUnit;
  concentration: string | null;
  contact_time_min: number;
  rinse_required: boolean;
  applicable_classes: string[];
  effluent_destination: string;
  effluent_note: string;
  is_active: boolean;
}

export interface EquipmentRow {
  id: string;
  code: string;
  name: string;
  kind: EquipmentKind;
  capacity: string | null;
  capacity_unit: string | null;
  maintenance_notes: string | null;
  status: string;
}

export interface OperationRow {
  id: string;
  op_type: string;
  status: string;
  occurred_at: string;
  legal_entity_id: string;
  performed_by: string;
  cleaning_vessel_id: string | null;
  cleaning_location_id: string | null;
}

export interface ConsumableRow {
  product_id: string;
  consumable_kind: ConsumableKind;
  sku: string;
  name: string;
}

function intOf(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  throw new Error('Entero de base de datos fuera de rango');
}

export async function loadProcedure(tx: Reader, id: string): Promise<ProcedureRow | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name, purpose, product_name, product_id::VARCHAR AS product_id,
           active_substance, dose_min::VARCHAR AS dose_min, dose_max::VARCHAR AS dose_max, dose_unit,
           concentration, contact_time_min, rinse_required, applicable_classes,
           effluent_destination, effluent_note, is_active
    FROM hygiene.cleaning_procedure
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: idOf(row.id),
    code: textOf(row.code),
    name: textOf(row.name),
    purpose: textOf(row.purpose) as ProcedurePurpose,
    product_name: textOf(row.product_name),
    product_id: row.product_id == null ? null : idOf(row.product_id),
    active_substance: textOf(row.active_substance),
    dose_min: decimalOut(row.dose_min),
    dose_max: decimalOut(row.dose_max),
    dose_unit: textOf(row.dose_unit) as DoseUnit,
    concentration: textOrNull(row.concentration),
    contact_time_min: intOf(row.contact_time_min),
    rinse_required: flagOf(row.rinse_required),
    applicable_classes: classesOf(row.applicable_classes),
    effluent_destination: textOf(row.effluent_destination),
    effluent_note: textOf(row.effluent_note),
    is_active: flagOf(row.is_active),
  };
}

export async function requireProcedure(tx: Reader, id: string, field: string): Promise<ProcedureRow> {
  const row = await loadProcedure(tx, id);
  if (!row) invalid({ [field]: 'El procedimiento no existe' });
  return row;
}

export async function loadEquipment(tx: Reader, id: string): Promise<EquipmentRow | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name, kind, capacity::VARCHAR AS capacity, capacity_unit,
           maintenance_notes, status
    FROM hygiene.equipment
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: idOf(row.id),
    code: textOf(row.code),
    name: textOf(row.name),
    kind: textOf(row.kind) as EquipmentKind,
    capacity: row.capacity == null ? null : decimalOut(row.capacity),
    capacity_unit: textOrNull(row.capacity_unit),
    maintenance_notes: textOrNull(row.maintenance_notes),
    status: textOf(row.status),
  };
}

export async function requireEquipment(tx: Reader, id: string, field: string, inService: boolean): Promise<EquipmentRow> {
  const row = await loadEquipment(tx, id);
  if (!row) invalid({ [field]: 'El equipo no existe' });
  if (row.status === 'retired') invalid({ [field]: 'El equipo está retirado' });
  if (inService && row.status !== 'in_service') invalid({ [field]: 'El equipo no está en servicio' });
  return row;
}

export async function loadOperation(tx: Reader, id: string): Promise<OperationRow | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, op_type, status, occurred_at, legal_entity_id::VARCHAR AS legal_entity_id,
           performed_by, details
    FROM cellar.operation
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  const details = jsonObject(row.details);
  const cleaning = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as { cleaning?: { vessel_id?: unknown; location_id?: unknown } }).cleaning
    : undefined;
  return {
    id: idOf(row.id),
    op_type: textOf(row.op_type),
    status: textOf(row.status),
    occurred_at: textOf(row.occurred_at),
    legal_entity_id: idOf(row.legal_entity_id),
    performed_by: textOf(row.performed_by),
    cleaning_vessel_id: typeof cleaning?.vessel_id === 'string' ? cleaning.vessel_id.toLowerCase() : null,
    cleaning_location_id: typeof cleaning?.location_id === 'string' ? cleaning.location_id.toLowerCase() : null,
  };
}

export async function requireOperation(tx: Reader, id: string): Promise<OperationRow> {
  const row = await loadOperation(tx, id);
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

export async function requireVessel(tx: Reader, id: string, field: string): Promise<{ id: string; kind: string; status: string }> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, kind, status FROM cellar.vessel WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) invalid({ [field]: 'El recipiente no existe' });
  if (textOf(row.status) === 'retired') invalid({ [field]: 'El recipiente está retirado' });
  return { id: idOf(row.id), kind: textOf(row.kind), status: textOf(row.status) };
}

export async function requireProductPackaging(tx: Reader, id: string): Promise<{ id: string; sku: string; name: string; unit: string }> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, sku, name, kind, unit, is_stock_tracked, requires_lot, is_active
    FROM catalog.product
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) invalid({ product_id: 'El producto no existe' });
  if (!flagOf(row.is_active)) invalid({ product_id: 'El producto no está activo' });
  if (textOf(row.kind) !== 'packaging_material') {
    invalid({ kind: 'El consumible usa el tipo de catálogo packaging_material' });
  }
  if (!flagOf(row.is_stock_tracked)) invalid({ is_stock_tracked: 'El consumible lleva stock' });
  if (flagOf(row.requires_lot)) invalid({ requires_lot: 'El consumible no lleva lote' });
  if (textOf(row.unit) !== 'ud') invalid({ unit: 'El stock del consumible son unidades enteras' });
  return { id: idOf(row.id), sku: textOf(row.sku), name: textOf(row.name), unit: textOf(row.unit) };
}

export async function requireConsumable(tx: Reader, productId: string, field: string): Promise<ConsumableRow> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT c.product_id::VARCHAR AS product_id, c.consumable_kind, p.sku, p.name, p.is_active
    FROM hygiene.consumable c
    JOIN catalog.product p ON p.id = c.product_id
    WHERE c.product_id = CAST(${productId} AS UUID)
  `);
  const row = rows[0];
  if (!row) invalid({ [field]: 'El producto no está dado de alta como consumible' });
  if (!flagOf(row.is_active)) invalid({ [field]: 'El consumible no está activo' });
  return {
    product_id: idOf(row.product_id),
    consumable_kind: textOf(row.consumable_kind) as ConsumableKind,
    sku: textOf(row.sku),
    name: textOf(row.name),
  };
}

export async function requireLocation(tx: Reader, id: string, field: string): Promise<void> {
  const rows = await tx.read(sql`
    SELECT id FROM inventory.location WHERE id = CAST(${id} AS UUID) AND is_active
  `);
  if (rows.length === 0) invalid({ [field]: 'La ubicación no existe' });
}

export async function requireEntity(tx: Reader, id: string, field: string): Promise<void> {
  const rows = await tx.read(sql`
    SELECT id FROM core.legal_entity WHERE id = CAST(${id} AS UUID) AND is_active
  `);
  if (rows.length === 0) invalid({ [field]: 'La entidad no existe' });
}

export async function requireContact(tx: Reader, id: string, field: string): Promise<{ id: string; legal_name: string }> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, legal_name
    FROM party.contact
    WHERE id = CAST(${id} AS UUID) AND archived_at IS NULL
  `);
  const row = rows[0];
  if (!row) invalid({ [field]: 'El contacto no existe' });
  return { id: idOf(row.id), legal_name: textOf(row.legal_name) };
}

export async function requireAnyProduct(tx: Reader, id: string, field: string): Promise<void> {
  const rows = await tx.read(sql`SELECT id FROM catalog.product WHERE id = CAST(${id} AS UUID) AND is_active`);
  if (rows.length === 0) invalid({ [field]: 'El producto no existe' });
}

export function occurredDay(occurredAt: string): string {
  return businessDate(new Date(occurredAt));
}
