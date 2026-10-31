import { Decimal } from 'decimal.js';
import type { Actor, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { requireFormat } from './formats';
import {
  FieldBag,
  enumValue,
  hasKey,
  isUuid,
  readObject,
  rejectUnknown,
  requireUuid,
  scale,
} from './fields';
import { asString } from './rows';

const PER = ['unit', 'case', 'pallet'] as const;
const FIELDS = ['material_product_id', 'per', 'quantity'] as const;

export type MaterialPer = (typeof PER)[number];

export interface FormatMaterial {
  id: string;
  format_id: string;
  material_product_id: string;
  sku: string;
  name: string;
  per: MaterialPer;
  quantity: string;
}

interface MaterialState {
  material_product_id: string;
  per: MaterialPer;
  quantity: string;
}

export async function listFormatMaterials(writer: Writer, formatId: string): Promise<{ items: FormatMaterial[] }> {
  await requireFormat(writer, formatId);
  const rows = await writer.read(sql`
    SELECT m.id, m.format_id, m.material_product_id, m.per, CAST(m.quantity AS VARCHAR) AS quantity,
           p.sku, p.name
    FROM catalog.format_material m
    JOIN catalog.product p ON p.id = m.material_product_id
    WHERE m.format_id = CAST(${formatId} AS UUID)
    ORDER BY p.sku, CASE m.per WHEN 'unit' THEN 1 WHEN 'case' THEN 2 ELSE 3 END, m.id
  `);
  return { items: rows.map(toMaterial) };
}

export async function createFormatMaterial(
  writer: Writer,
  actor: Actor,
  formatId: string,
  body: unknown,
): Promise<FormatMaterial> {
  await requireFormat(writer, formatId);
  const input = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(input, FIELDS, errors);
  const state = parseMaterial(input, null, errors);
  errors.fail();
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    await assertPackaging(tx, state.material_product_id);
    const clash = await tx.read<{ id: string }>(sql`
      SELECT id FROM catalog.format_material
      WHERE format_id = CAST(${formatId} AS UUID)
        AND material_product_id = CAST(${state.material_product_id} AS UUID)
        AND per = ${state.per}
    `);
    if (clash.length > 0) {
      throw domainError('WC_VALIDATION', { material_product_id: 'Ese material ya está en la lista para esa base' });
    }
    tx.write(sql`
      INSERT INTO catalog.format_material (id, format_id, material_product_id, per, quantity)
      VALUES (
        CAST(${id} AS UUID),
        CAST(${formatId} AS UUID),
        CAST(${state.material_product_id} AS UUID),
        ${state.per},
        ${new Decimal(state.quantity)}
      )
    `);
    tx.audit({
      table: 'catalog.format_material',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { id, format_id: formatId, ...state },
    });
  });
  return requireMaterial(writer, formatId, id);
}

export async function updateFormatMaterial(
  writer: Writer,
  actor: Actor,
  formatId: string,
  materialId: string,
  body: unknown,
): Promise<FormatMaterial> {
  requireUuid(formatId, 'format_id');
  requireUuid(materialId, 'id');
  const current = await requireMaterial(writer, formatId, materialId);
  const input = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(input, FIELDS, errors);
  if (Object.keys(input).length === 0) errors.add('body', 'Nada que actualizar');
  const state = parseMaterial(input, current, errors);
  errors.fail();
  await writer.withWrite(actor, async (tx) => {
    await assertPackaging(tx, state.material_product_id);
    const clash = await tx.read<{ id: string }>(sql`
      SELECT id FROM catalog.format_material
      WHERE format_id = CAST(${formatId} AS UUID)
        AND material_product_id = CAST(${state.material_product_id} AS UUID)
        AND per = ${state.per}
        AND id <> CAST(${materialId} AS UUID)
    `);
    if (clash.length > 0) {
      throw domainError('WC_VALIDATION', { material_product_id: 'Ese material ya está en la lista para esa base' });
    }
    tx.write(sql`
      UPDATE catalog.format_material SET
        material_product_id = CAST(${state.material_product_id} AS UUID),
        per = ${state.per},
        quantity = ${new Decimal(state.quantity)}
      WHERE id = CAST(${materialId} AS UUID)
        AND format_id = CAST(${formatId} AS UUID)
    `);
    tx.audit({
      table: 'catalog.format_material',
      rowId: materialId,
      action: 'UPDATE',
      before: current,
      after: { ...current, ...state },
    });
  });
  return requireMaterial(writer, formatId, materialId);
}

export async function deleteFormatMaterial(
  writer: Writer,
  actor: Actor,
  formatId: string,
  materialId: string,
): Promise<FormatMaterial> {
  requireUuid(formatId, 'format_id');
  const current = await requireMaterial(writer, formatId, materialId);
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      DELETE FROM catalog.format_material
      WHERE id = CAST(${materialId} AS UUID)
        AND format_id = CAST(${formatId} AS UUID)
    `);
    tx.audit({
      table: 'catalog.format_material',
      rowId: materialId,
      action: 'DELETE',
      before: current,
      after: null,
    });
  });
  return current;
}

async function requireMaterial(writer: Writer, formatId: string, materialId: string): Promise<FormatMaterial> {
  requireUuid(materialId, 'id');
  const rows = await writer.read(sql`
    SELECT m.id, m.format_id, m.material_product_id, m.per, CAST(m.quantity AS VARCHAR) AS quantity,
           p.sku, p.name
    FROM catalog.format_material m
    JOIN catalog.product p ON p.id = m.material_product_id
    WHERE m.id = CAST(${materialId} AS UUID)
      AND m.format_id = CAST(${formatId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return toMaterial(row);
}

async function assertPackaging(
  tx: { read<T = Record<string, unknown>>(statement: string): Promise<T[]> },
  productId: string,
): Promise<void> {
  const rows = await tx.read<{ kind: string; is_active: boolean; is_stock_tracked: boolean }>(sql`
    SELECT kind, is_active, is_stock_tracked
    FROM catalog.product
    WHERE id = CAST(${productId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_VALIDATION', { material_product_id: 'El producto no existe' });
  if (row.kind !== 'packaging_material') {
    throw domainError('WC_VALIDATION', { material_product_id: 'Tiene que ser un material de envasado' });
  }
  if (row.is_active !== true) {
    throw domainError('WC_VALIDATION', { material_product_id: 'El material está archivado' });
  }
  if (row.is_stock_tracked !== true) {
    throw domainError('WC_VALIDATION', { material_product_id: 'El material no lleva stock' });
  }
}

function parseMaterial(
  input: Record<string, unknown>,
  current: FormatMaterial | null,
  errors: FieldBag,
): MaterialState {
  let productId = current?.material_product_id ?? '';
  if (hasKey(input, 'material_product_id')) {
    if (typeof input.material_product_id !== 'string' || !isUuid(input.material_product_id)) {
      errors.add('material_product_id', 'Identificador no válido');
    } else {
      productId = input.material_product_id;
    }
  } else if (!current) {
    errors.add('material_product_id', 'Obligatorio');
  }
  let per = current?.per ?? 'unit';
  if (hasKey(input, 'per')) {
    const parsed = enumValue(input.per, 'per', PER, errors);
    if (parsed) per = parsed;
  } else if (!current) {
    errors.add('per', 'Obligatorio');
  }
  let quantity = current?.quantity ?? '0.000';
  if (hasKey(input, 'quantity')) {
    const parsed = parseQuantity(input.quantity, errors);
    if (parsed) quantity = parsed;
  } else if (!current) {
    errors.add('quantity', 'Obligatorio');
  }
  return { material_product_id: productId, per, quantity };
}

function parseQuantity(value: unknown, errors: FieldBag): string | null {
  if (typeof value !== 'string') {
    errors.add('quantity', 'Debe ser una cadena decimal');
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    errors.add('quantity', 'Cantidad no válida');
    return null;
  }
  const fraction = trimmed.split('.')[1];
  if (fraction && fraction.length > 3) {
    errors.add('quantity', 'Máximo 3 decimales');
    return null;
  }
  const parsed = new Decimal(trimmed);
  if (!parsed.isFinite() || parsed.lte(0)) {
    errors.add('quantity', 'Debe ser mayor que 0');
    return null;
  }
  return parsed.toDecimalPlaces(3).toFixed(3);
}

function toMaterial(row: Record<string, unknown>): FormatMaterial {
  const per = asString(row.per);
  return {
    id: asString(row.id),
    format_id: asString(row.format_id),
    material_product_id: asString(row.material_product_id),
    sku: asString(row.sku),
    name: asString(row.name),
    per: per === 'case' || per === 'pallet' ? per : 'unit',
    quantity: scale(row.quantity, 3),
  };
}
