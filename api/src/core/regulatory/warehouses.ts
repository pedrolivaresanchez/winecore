// Catálogo de establecimientos (CAE). El CAE completo solo lo ve la dirección.
import { sql } from "../db/sql";
import type { Writer } from "../db/writer";

export interface WarehouseEntity {
  id: string;
  code: string;
  legal_name: string;
}

export interface TaxWarehouseView {
  id: string;
  code: string;
  name: string;
  cae: string;
  activity: string;
  entity: WarehouseEntity;
  is_active: boolean;
  is_test: boolean;
}

/** Lo que una obligación necesita para preparar el envío, sin el CAE. */
export interface ObligationWarehouse {
  id: string;
  code: string;
  name: string;
  activity: string;
  entity_id: string;
}

interface WarehouseRow {
  id: string;
  name: string;
  cae: string;
  activity_code: string;
  legal_entity_id: string;
  entity_code: string;
  legal_name: string;
  is_active: boolean;
  is_test: boolean;
  created_at: string;
}

export function maskCae(cae: string, reveal: boolean): string {
  if (reveal) return cae;
  if (cae.length <= 4) return cae;
  return `${"*".repeat(cae.length - 4)}${cae.slice(-4)}`;
}

export async function listTaxWarehouses(
  writer: Writer,
  input: { revealCae: boolean; entityIds?: readonly string[] | null },
): Promise<TaxWarehouseView[]> {
  if (input.entityIds && input.entityIds.length === 0) return [];
  const where = ["w.is_active"];
  if (input.entityIds) {
    const list = input.entityIds.map((id) => sql`CAST(${id} AS UUID)`).join(", ");
    where.push(`w.legal_entity_id IN (${list})`);
  }
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT w.id::VARCHAR AS id, w.name, w.cae, w.activity_code,
           w.legal_entity_id::VARCHAR AS legal_entity_id,
           e.code AS entity_code, e.legal_name,
           w.is_active, w.is_test, w.created_at::VARCHAR AS created_at
    FROM inventory.tax_warehouse w
    JOIN core.legal_entity e ON e.id = w.legal_entity_id
    WHERE ${where.join(" AND ")}
    ORDER BY e.code, w.created_at, w.id
  `);
  return assignCodes(rows.map(asRow)).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    cae: maskCae(row.cae, input.revealCae),
    activity: row.activity,
    entity: row.entity,
    is_active: row.is_active,
    is_test: row.is_test,
  }));
}

export async function warehousesByEntity(writer: Writer): Promise<Map<string, ObligationWarehouse[]>> {
  const rows = await listTaxWarehouses(writer, { revealCae: false, entityIds: null });
  const map = new Map<string, ObligationWarehouse[]>();
  for (const row of rows) {
    const list = map.get(row.entity.id) ?? [];
    list.push({
      id: row.id,
      code: row.code,
      name: row.name,
      activity: row.activity,
      entity_id: row.entity.id,
    });
    map.set(row.entity.id, list);
  }
  return map;
}

interface CodedRow {
  id: string;
  code: string;
  name: string;
  cae: string;
  activity: string;
  entity: WarehouseEntity;
  is_active: boolean;
  is_test: boolean;
}

function assignCodes(rows: WarehouseRow[]): CodedRow[] {
  const used = new Set<string>();
  return rows.map((row) => {
    const base = `${row.entity_code}-${row.activity_code}`;
    let code = base;
    if (used.has(code)) code = `${base}-${row.id.replaceAll("-", "").slice(0, 4)}`;
    used.add(code);
    return {
      id: row.id,
      code,
      name: row.name,
      cae: row.cae,
      activity: row.activity_code,
      entity: { id: row.legal_entity_id, code: row.entity_code, legal_name: row.legal_name },
      is_active: row.is_active,
      is_test: row.is_test,
    };
  });
}

function asRow(row: Record<string, unknown>): WarehouseRow {
  return {
    id: String(row.id).toLowerCase(),
    name: String(row.name),
    cae: String(row.cae),
    activity_code: String(row.activity_code),
    legal_entity_id: String(row.legal_entity_id).toLowerCase(),
    entity_code: String(row.entity_code),
    legal_name: String(row.legal_name),
    is_active: row.is_active === true || row.is_active === 1 || row.is_active === "true",
    is_test: row.is_test === true || row.is_test === 1 || row.is_test === "true",
    created_at: String(row.created_at ?? ""),
  };
}
