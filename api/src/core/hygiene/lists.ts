import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import {
  countOf,
  decodeOpCursor,
  encodeOpCursor,
  intOf,
  parseLimit,
  invalid,
  slicePage,
  textOf,
  textOrNull,
  type ListBody,
} from '../cellar/service/http';
import { isBusinessDate } from '../inventory/periods';
import { decimalOut, idOf } from './parse';

const MADRID_DAY = (column: string) => `(${column} AT TIME ZONE 'Europe/Madrid')::DATE`;

interface Window {
  from: string | null;
  to: string | null;
}

/** Listados de higiene con filtro de fechas (Europe/Madrid) y paginación. */
export async function listCleaningLogs(writer: Writer, request: Request) {
  const url = new URL(request.url);
  const window = readWindow(url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = decodeOpCursor(url.searchParams.get('cursor'));
  const windowFilter = sqlAnd([dateSpan('l.occurred_on', window)]);
  const filter = sqlAnd([windowFilter, cursorClause('l.occurred_on', 'l.id', cursor, 'DATE')]);
  const total = await countOf(writer, `SELECT count(*)::VARCHAR AS total FROM hygiene.cleaning_log l WHERE ${windowFilter}`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT l.id::VARCHAR AS id, l.occurred_on::VARCHAR AS occurred_on, l.operator,
           l.procedure_id::VARCHAR AS procedure_id, p.code AS procedure_code, p.name AS procedure_name,
           l.actual_dose::VARCHAR AS actual_dose, l.actual_dose_unit, l.actual_contact_time_min,
           l.rinsed, l.notes, l.vessel_id::VARCHAR AS vessel_id, v.code AS vessel_code,
           l.equipment_id::VARCHAR AS equipment_id, e.code AS equipment_code,
           l.operation_id::VARCHAR AS operation_id, o.number AS operation_number
    FROM hygiene.cleaning_log l
    JOIN hygiene.cleaning_procedure p ON p.id = l.procedure_id
    LEFT JOIN cellar.vessel v ON v.id = l.vessel_id
    LEFT JOIN hygiene.equipment e ON e.id = l.equipment_id
    LEFT JOIN cellar.operation o ON o.id = l.operation_id
    WHERE ${filter}
    ORDER BY l.occurred_on DESC, l.id DESC
    LIMIT ${limit + 1}
  `);
  return page(rows.map(cleaningOf), limit, total, (row) => encodeOpCursor(row.occurred_on, row.id));
}

export async function listFiltrations(writer: Writer, request: Request) {
  return listByInstant(writer, request, {
    table: 'hygiene.filtration f',
    instant: 'f.occurred_at',
    id: 'f.id',
    joins: `
      LEFT JOIN hygiene.equipment e ON e.id = f.equipment_id
      LEFT JOIN party.contact c ON c.id = f.supplier_contact_id
    `,
    columns: `
      f.id::VARCHAR AS id, f.occurred_at, f.plate_grade, f.plate_format, f.plate_count,
      f.operator, f.notes, f.equipment_id::VARCHAR AS equipment_id, e.code AS equipment_code,
      f.supplier_contact_id::VARCHAR AS supplier_contact_id, c.legal_name AS supplier_name,
      f.location_id::VARCHAR AS location_id, f.owner_entity_id::VARCHAR AS owner_entity_id,
      f.operation_id::VARCHAR AS operation_id
    `,
    map: filtrationOf,
  });
}

export async function listBottlingChecks(writer: Writer, request: Request) {
  return listByInstant(writer, request, {
    table: 'hygiene.bottling_check c',
    instant: 'o.occurred_at',
    id: 'c.id',
    joins: `
      JOIN cellar.operation o ON o.id = c.operation_id
      JOIN hygiene.equipment e ON e.id = c.equipment_id
    `,
    columns: `
      c.id::VARCHAR AS id, o.occurred_at, o.number AS operation_number,
      c.operation_id::VARCHAR AS operation_id, c.operator, c.bottles_disinfected,
      c.fill_rejects, c.closure_rejects, c.label_rejects, c.closure_type, c.seal_type,
      c.notes, c.equipment_id::VARCHAR AS equipment_id, e.code AS equipment_code, e.name AS equipment_name
    `,
    map: checkOf,
  });
}

export async function listReceipts(writer: Writer, request: Request) {
  return listByInstant(writer, request, {
    table: 'hygiene.consumable_receipt r',
    instant: 'r.occurred_at',
    id: 'r.id',
    joins: 'JOIN catalog.product p ON p.id = r.product_id',
    columns: `
      r.id::VARCHAR AS id, r.occurred_at, r.quantity, r.supplier_name,
      r.product_id::VARCHAR AS product_id, p.sku, p.name,
      r.location_id::VARCHAR AS location_id, r.owner_entity_id::VARCHAR AS owner_entity_id
    `,
    map: receiptOf,
  });
}

export async function listMaintenance(writer: Writer, request: Request) {
  const equipment = optionalUuid(new URL(request.url).searchParams.get('equipment_id'));
  return listByInstant(writer, request, {
    table: 'hygiene.equipment_maintenance m',
    instant: 'm.performed_at',
    id: 'm.id',
    joins: 'JOIN hygiene.equipment e ON e.id = m.equipment_id',
    columns: `
      m.id::VARCHAR AS id, m.performed_at AS occurred_at, m.notes, m.operator,
      m.next_due_on::VARCHAR AS next_due_on, m.equipment_id::VARCHAR AS equipment_id,
      e.code AS equipment_code, e.name AS equipment_name, e.kind AS equipment_kind
    `,
    extra: equipment ? sql`m.equipment_id = CAST(${equipment} AS UUID)` : null,
    map: maintenanceOf,
  });
}

export async function listEquipmentLinks(writer: Writer, request: Request) {
  return listByInstant(writer, request, {
    table: 'hygiene.operation_equipment oe',
    instant: 'COALESCE(o.occurred_at, oe.created_at)',
    id: 'oe.equipment_id',
    joins: `
      JOIN hygiene.equipment e ON e.id = oe.equipment_id
      LEFT JOIN cellar.operation o ON o.id = oe.operation_id
    `,
    columns: `
      oe.operation_id::VARCHAR AS operation_id, oe.equipment_id::VARCHAR AS id,
      oe.equipment_id::VARCHAR AS equipment_id, oe.role, oe.created_at,
      COALESCE(o.occurred_at, oe.created_at) AS occurred_at,
      o.number AS operation_number, o.op_type, e.code AS equipment_code, e.name AS equipment_name
    `,
    map: linkOf,
  });
}

export async function listConsumableBalances(writer: Writer, request: Request): Promise<ListBody<Record<string, unknown>> & { period: Window }> {
  const url = new URL(request.url);
  const window = readWindow(url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const product = optionalUuid(url.searchParams.get('product_id'));
  const filters = ['TRUE'];
  if (product) filters.push(sql`c.product_id = CAST(${product} AS UUID)`);
  const where = filters.join(' AND ');
  const day = MADRID_DAY('m.occurred_at');
  const inCase = signedSum('m.qty_units > 0', 'm.qty_units', day, window);
  const outCase = signedSum('m.qty_units < 0', '-m.qty_units', day, window);
  const currentCase = window.to
    ? `CASE WHEN ${day} <= CAST(${sql`${window.to}`} AS DATE) THEN m.qty_units ELSE 0 END`
    : 'm.qty_units';
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT c.product_id::VARCHAR AS product_id, c.consumable_kind, p.sku, p.name, p.unit,
           COALESCE(SUM(${inCase}), 0)::VARCHAR AS in_units,
           COALESCE(SUM(${outCase}), 0)::VARCHAR AS out_units,
           COALESCE(SUM(${currentCase}), 0)::VARCHAR AS current_units
    FROM hygiene.consumable c
    JOIN catalog.product p ON p.id = c.product_id
    LEFT JOIN inventory.stock_move m
      ON m.product_id = c.product_id
     AND m.product_state = 'goods'
     AND m.vessel_id IS NULL
     AND m.lot_id IS NULL
    WHERE ${where}
    GROUP BY c.product_id, c.consumable_kind, p.sku, p.name, p.unit
    ORDER BY p.sku
    LIMIT ${limit + 1}
  `);
  const total = await countOf(writer, `SELECT count(*)::VARCHAR AS total FROM hygiene.consumable c WHERE ${where}`);
  const items = rows.map((row) => ({
    product_id: idOf(row.product_id),
    consumable_kind: textOf(row.consumable_kind),
    sku: textOf(row.sku),
    name: textOf(row.name),
    unit: textOf(row.unit),
    in_units: intOf(row.in_units),
    out_units: intOf(row.out_units),
    current_units: intOf(row.current_units),
  }));
  return { ...slicePage(items, limit, total, (row) => row.sku), period: window };
}

function signedSum(sign: string, expr: string, day: string, window: Window): string {
  const parts = [sign];
  if (window.from) parts.push(`${day} >= CAST(${sql`${window.from}`} AS DATE)`);
  if (window.to) parts.push(`${day} <= CAST(${sql`${window.to}`} AS DATE)`);
  return `CASE WHEN ${parts.join(' AND ')} THEN ${expr} ELSE 0 END`;
}

interface InstantList<T> {
  table: string;
  instant: string;
  id: string;
  joins: string;
  columns: string;
  extra?: string | null;
  map: (row: Record<string, unknown>) => T;
}

async function listByInstant<T extends { id: string }>(writer: Writer, request: Request, spec: InstantList<T>) {
  const url = new URL(request.url);
  const window = readWindow(url);
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = decodeOpCursor(url.searchParams.get('cursor'));
  const day = MADRID_DAY(spec.instant);
  const windowFilter = sqlAnd([spec.extra, dateSpan(day, window)]);
  const filter = sqlAnd([windowFilter, cursorClause(day, spec.id, cursor, 'DATE')]);
  const total = await countOf(writer, `
    SELECT count(*)::VARCHAR AS total
    FROM ${spec.table}
    ${spec.joins}
    WHERE ${windowFilter}
  `);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT ${spec.columns}, ${day}::VARCHAR AS sort_day
    FROM ${spec.table}
    ${spec.joins}
    WHERE ${filter}
    ORDER BY ${day} DESC, ${spec.id} DESC
    LIMIT ${limit + 1}
  `);
  const items = rows.map((row) => ({
    view: spec.map(row),
    sort_day: String(row.sort_day).slice(0, 10),
  }));
  const listed = slicePage(items, limit, total, (row) => encodeOpCursor(row.sort_day, row.view.id));
  return { ...listed, items: listed.items.map((row) => row.view) };
}

function page<T extends { id: string }>(
  rows: T[],
  limit: number,
  total: number,
  cursorOf: (row: T) => string,
): ListBody<T> {
  return slicePage(rows, limit, total, cursorOf);
}

function cleaningOf(row: Record<string, unknown>) {
  return {
    id: idOf(row.id),
    occurred_on: String(row.occurred_on).slice(0, 10),
    operator: textOf(row.operator),
    procedure_id: idOf(row.procedure_id),
    procedure_code: textOf(row.procedure_code),
    procedure_name: textOf(row.procedure_name),
    actual_dose: decimalOut(row.actual_dose),
    actual_dose_unit: textOf(row.actual_dose_unit),
    actual_contact_time_min: Number(row.actual_contact_time_min),
    rinsed: row.rinsed === true,
    notes: textOrNull(row.notes),
    vessel_id: row.vessel_id == null ? null : idOf(row.vessel_id),
    vessel_code: textOrNull(row.vessel_code),
    equipment_id: row.equipment_id == null ? null : idOf(row.equipment_id),
    equipment_code: textOrNull(row.equipment_code),
    operation_id: idOf(row.operation_id),
    operation_number: textOrNull(row.operation_number),
  };
}

function filtrationOf(row: Record<string, unknown>) {
  return {
    id: idOf(row.id),
    occurred_at: textOf(row.occurred_at),
    plate_grade: textOf(row.plate_grade),
    plate_format: textOf(row.plate_format),
    plate_count: Number(row.plate_count),
    operator: textOf(row.operator),
    notes: textOrNull(row.notes),
    equipment_id: row.equipment_id == null ? null : idOf(row.equipment_id),
    equipment_code: textOrNull(row.equipment_code),
    supplier_contact_id: idOf(row.supplier_contact_id),
    supplier_name: textOrNull(row.supplier_name),
    location_id: idOf(row.location_id),
    owner_entity_id: idOf(row.owner_entity_id),
    operation_id: row.operation_id == null ? null : idOf(row.operation_id),
  };
}

function checkOf(row: Record<string, unknown>) {
  return {
    id: idOf(row.id),
    occurred_at: textOf(row.occurred_at),
    operation_id: idOf(row.operation_id),
    operation_number: textOrNull(row.operation_number),
    operator: textOf(row.operator),
    bottles_disinfected: row.bottles_disinfected === true,
    fill_rejects: Number(row.fill_rejects),
    closure_rejects: Number(row.closure_rejects),
    label_rejects: Number(row.label_rejects),
    closure_type: textOf(row.closure_type),
    seal_type: textOf(row.seal_type),
    notes: textOrNull(row.notes),
    equipment_id: idOf(row.equipment_id),
    equipment_code: textOf(row.equipment_code),
    equipment_name: textOf(row.equipment_name),
  };
}

function receiptOf(row: Record<string, unknown>) {
  return {
    id: idOf(row.id),
    occurred_at: textOf(row.occurred_at),
    quantity: Number(row.quantity),
    supplier_name: textOrNull(row.supplier_name),
    product_id: idOf(row.product_id),
    sku: textOf(row.sku),
    name: textOf(row.name),
    location_id: idOf(row.location_id),
    owner_entity_id: idOf(row.owner_entity_id),
  };
}

function maintenanceOf(row: Record<string, unknown>) {
  return {
    id: idOf(row.id),
    performed_at: textOf(row.occurred_at),
    notes: textOf(row.notes),
    operator: textOf(row.operator),
    next_due_on: row.next_due_on == null ? null : String(row.next_due_on).slice(0, 10),
    equipment_id: idOf(row.equipment_id),
    equipment_code: textOf(row.equipment_code),
    equipment_name: textOf(row.equipment_name),
    equipment_kind: textOf(row.equipment_kind),
  };
}

function linkOf(row: Record<string, unknown>) {
  return {
    id: idOf(row.equipment_id),
    operation_id: idOf(row.operation_id),
    operation_number: textOrNull(row.operation_number),
    op_type: textOrNull(row.op_type),
    occurred_at: textOf(row.occurred_at),
    equipment_id: idOf(row.equipment_id),
    equipment_code: textOf(row.equipment_code),
    equipment_name: textOf(row.equipment_name),
    role: textOf(row.role),
    created_at: textOf(row.created_at),
  };
}

function readWindow(url: URL): Window {
  const from = optionalDay(url.searchParams.get('from'), 'from');
  const to = optionalDay(url.searchParams.get('to'), 'to');
  if (from && to && from > to) invalid({ to: 'El periodo está al revés' });
  return { from, to };
}

function optionalDay(value: string | null, field: string): string | null {
  if (value === null || value.trim() === '') return null;
  if (!isBusinessDate(value)) invalid({ [field]: 'Debe ser una fecha YYYY-MM-DD' });
  return value;
}

function optionalUuid(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    invalid({ id: 'Debe ser un UUID' });
  }
  return value.toLowerCase();
}

function sqlAnd(parts: Array<string | null | undefined>): string {
  const kept = parts.filter((part): part is string => Boolean(part) && part !== 'TRUE');
  return kept.length === 0 ? 'TRUE' : kept.join(' AND ');
}

function dateSpan(expr: string, window: Window): string {
  const parts: string[] = [];
  if (window.from) parts.push(`${expr} >= CAST(${sql`${window.from}`} AS DATE)`);
  if (window.to) parts.push(`${expr} <= CAST(${sql`${window.to}`} AS DATE)`);
  return parts.length === 0 ? 'TRUE' : parts.join(' AND ');
}

function cursorClause(
  dayExpr: string,
  idExpr: string,
  cursor: { occurredAt: string; id: string } | null,
  cast: 'DATE',
): string {
  if (!cursor) return 'TRUE';
  if (!isBusinessDate(cursor.occurredAt)) invalid({ cursor: 'Cursor no válido' });
  return `(${dayExpr} < CAST(${sql`${cursor.occurredAt}`} AS ${cast}) OR (${dayExpr} = CAST(${sql`${cursor.occurredAt}`} AS ${cast}) AND ${idExpr} < CAST(${sql`${cursor.id}`} AS UUID)))`;
}
