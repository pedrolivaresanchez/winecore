// Catálogo de establecimientos (CAE). El CAE completo solo lo ve la dirección.
import { sql } from "../db/sql";
import type { Tx, Writer } from "../db/writer";
import { domainError } from "../errors";
import { newId } from "../ids";

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

const CAE = /^ES[0-9A-Z]{11}$/;

/** Forma de docs/04-regulatorio/silicie.md y del depósito: ES y 11 caracteres (13 en total). */
export function parseCae(raw: string): string {
  const cae = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!CAE.test(cae)) {
    throw domainError("WC_VALIDATION", { cae: "El CAE del establecimiento no tiene la forma ES y 11 caracteres" });
  }
  return cae;
}

export async function updateTaxWarehouseCae(
  writer: Writer,
  actor: { type: "user"; id: string; requestId: string; reason?: string },
  id: string,
  input: { cae: string; isTest?: boolean },
): Promise<{ id: string; name: string; cae: string; is_test: boolean }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw domainError("WC_NOT_FOUND");
  }
  const cae = parseCae(input.cae);
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, name, cae, is_test, legal_entity_id::VARCHAR AS legal_entity_id
    FROM inventory.tax_warehouse
    WHERE id = CAST(${id} AS UUID)
  `);
  const current = rows[0];
  if (!current) throw domainError("WC_NOT_FOUND");
  const beforeCae = String(current.cae);
  const beforeTest = flag(current.is_test);
  const isTest = input.isTest ?? beforeTest;
  const rowId = String(current.id).toLowerCase();
  if (beforeCae === cae && beforeTest === isTest) {
    return { id: rowId, name: String(current.name), cae, is_test: isTest };
  }
  const taken = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM inventory.tax_warehouse WHERE cae = ${cae} AND id <> CAST(${id} AS UUID)
  `);
  if (taken[0]) throw domainError("WC_VALIDATION", { cae: "Ya hay un depósito con este CAE" });
  const hold = await planHold(writer, id, String(current.legal_entity_id), cae);
  const parked = { moves: false, locations: false, fiscal: false };
  try {
    if (hold?.tempLocation) {
      await writer.withWrite(actor, async (tx) => parkMoves(tx, hold));
      parked.moves = true;
    }
    if (hold && hold.locationIds.length > 0) {
      await writer.withWrite(actor, async (tx) => detachLocations(tx, hold));
      parked.locations = true;
    }
    if (hold?.tempWarehouse) {
      await writer.withWrite(actor, async (tx) => parkFiscal(tx, id, hold));
      parked.fiscal = true;
    }
    await writer.withWrite(actor, async (tx) => {
      tx.write(sql`
        UPDATE inventory.tax_warehouse SET cae = ${cae}, is_test = ${isTest} WHERE id = CAST(${id} AS UUID)
      `);
      tx.audit({
        table: "inventory.tax_warehouse",
        rowId,
        action: "UPDATE",
        before: { cae: beforeCae, is_test: beforeTest },
        after: { cae, is_test: isTest },
      });
    });
  } finally {
    const parkedHold = hold;
    if (parkedHold && parked.fiscal) {
      await writer.withWrite(actor, async (tx) => moveFiscalBack(tx, id, parkedHold));
      await writer.withWrite(actor, async (tx) => {
        if (parkedHold.tempWarehouse) tx.write(sql`DELETE FROM inventory.tax_warehouse WHERE id = CAST(${parkedHold.tempWarehouse} AS UUID)`);
      });
    }
    if (parkedHold && parked.locations) await writer.withWrite(actor, async (tx) => reattachLocations(tx, id, parkedHold));
    if (parkedHold && parked.moves) {
      await writer.withWrite(actor, async (tx) => restoreMoves(tx, parkedHold));
      await writer.withWrite(actor, async (tx) => {
        if (parkedHold.tempLocation) tx.write(sql`DELETE FROM inventory.location WHERE id = CAST(${parkedHold.tempLocation} AS UUID)`);
      });
    }
  }
  return { id: rowId, name: String(current.name), cae, is_test: isTest };
}

type Hold = {
  locationIds: string[];
  stock: { id: string; locationId: string }[];
  lines: { id: string; locationId: string }[];
  reversals: { id: string; reverses: string }[];
  tempLocation: string | null;
  tempWarehouse: string | null;
  scratch: string | null;
  entityId: string;
};

async function planHold(writer: Writer, id: string, entityId: string, cae: string): Promise<Hold | null> {
  const locations = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM inventory.location WHERE tax_warehouse_id = CAST(${id} AS UUID)
  `);
  const fiscal = await writer.read<{ id: string; reverses_move_id: string | null }>(sql`
    SELECT id::VARCHAR AS id, reverses_move_id::VARCHAR AS reverses_move_id
    FROM inventory.fiscal_move WHERE tax_warehouse_id = CAST(${id} AS UUID)
  `);
  if (locations.length === 0 && fiscal.length === 0) return null;
  const locationIds = locations.map((row) => row.id.toLowerCase());
  const stock = locationIds.length === 0 ? [] : await writer.read<{ id: string; location_id: string }>(
    inList("SELECT id::VARCHAR AS id, location_id::VARCHAR AS location_id FROM inventory.stock_move WHERE location_id IN (", locationIds),
  );
  const lines = locationIds.length === 0 ? [] : await writer.read<{ id: string; location_id: string }>(
    inList("SELECT id::VARCHAR AS id, location_id::VARCHAR AS location_id FROM inventory.inventory_count_line WHERE location_id IN (", locationIds),
  );
  const parkedStock = stock.map((row) => ({ id: row.id.toLowerCase(), locationId: row.location_id.toLowerCase() }));
  const parkedLines = lines.map((row) => ({ id: row.id.toLowerCase(), locationId: row.location_id.toLowerCase() }));
  const tempLocation = parkedStock.length + parkedLines.length > 0 ? newId() : null;
  const tempWarehouse = fiscal.length > 0 ? newId() : null;
  return {
    locationIds,
    stock: parkedStock,
    lines: parkedLines,
    reversals: fiscal.flatMap((row) => row.reverses_move_id ? [{ id: row.id.toLowerCase(), reverses: row.reverses_move_id.toLowerCase() }] : []),
    tempLocation,
    tempWarehouse,
    scratch: tempWarehouse ? scratchCae(tempWarehouse, cae) : null,
    entityId,
  };
}

function parkMoves(tx: Tx, hold: Hold): void {
  if (!hold.tempLocation) return;
  tx.write(sql`
    INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
    VALUES (CAST(${hold.tempLocation} AS UUID), ${tempCode(hold.tempLocation)}, 'Temporal', 'cellar', CAST(${hold.entityId} AS UUID))
  `);
  for (const row of hold.stock) {
    tx.write(sql`UPDATE inventory.stock_move SET location_id = CAST(${hold.tempLocation} AS UUID) WHERE id = CAST(${row.id} AS UUID)`);
  }
  for (const row of hold.lines) {
    tx.write(sql`UPDATE inventory.inventory_count_line SET location_id = CAST(${hold.tempLocation} AS UUID) WHERE id = CAST(${row.id} AS UUID)`);
  }
}

function detachLocations(tx: Tx, hold: Hold): void {
  for (const locationId of hold.locationIds) {
    tx.write(sql`UPDATE inventory.location SET tax_warehouse_id = NULL WHERE id = CAST(${locationId} AS UUID)`);
  }
}

function parkFiscal(tx: Tx, id: string, hold: Hold): void {
  if (!hold.tempWarehouse || !hold.scratch) return;
  tx.write(sql`
    INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test, is_active)
    VALUES (CAST(${hold.tempWarehouse} AS UUID), CAST(${hold.entityId} AS UUID), ${hold.scratch}, 'V1', 'Temporal', TRUE, FALSE)
  `);
  for (const row of hold.reversals) {
    tx.write(sql`UPDATE inventory.fiscal_move SET reverses_move_id = NULL WHERE id = CAST(${row.id} AS UUID)`);
  }
  tx.write(sql`
    UPDATE inventory.fiscal_move SET tax_warehouse_id = CAST(${hold.tempWarehouse} AS UUID)
    WHERE tax_warehouse_id = CAST(${id} AS UUID)
  `);
}

function moveFiscalBack(tx: Tx, id: string, hold: Hold): void {
  if (!hold.tempWarehouse) return;
  tx.write(sql`
    UPDATE inventory.fiscal_move SET tax_warehouse_id = CAST(${id} AS UUID)
    WHERE tax_warehouse_id = CAST(${hold.tempWarehouse} AS UUID)
  `);
  for (const row of hold.reversals) {
    tx.write(sql`
      UPDATE inventory.fiscal_move SET reverses_move_id = CAST(${row.reverses} AS UUID) WHERE id = CAST(${row.id} AS UUID)
    `);
  }
}

function reattachLocations(tx: Tx, id: string, hold: Hold): void {
  for (const locationId of hold.locationIds) {
    tx.write(sql`UPDATE inventory.location SET tax_warehouse_id = CAST(${id} AS UUID) WHERE id = CAST(${locationId} AS UUID)`);
  }
}

function restoreMoves(tx: Tx, hold: Hold): void {
  for (const row of hold.stock) {
    tx.write(sql`UPDATE inventory.stock_move SET location_id = CAST(${row.locationId} AS UUID) WHERE id = CAST(${row.id} AS UUID)`);
  }
  for (const row of hold.lines) {
    tx.write(sql`UPDATE inventory.inventory_count_line SET location_id = CAST(${row.locationId} AS UUID) WHERE id = CAST(${row.id} AS UUID)`);
  }
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "t";
}


function inList(prefix: string, ids: string[]): string {
  const list = ids.map((item) => {
    if (!/^[0-9a-f-]{36}$/i.test(item)) throw domainError("WC_VALIDATION", { cae: "No se ha podido actualizar el CAE" });
    return `CAST('${item.toLowerCase()}' AS UUID)`;
  }).join(", ");
  return `${prefix}${list})`;
}

function scratchCae(id: string, avoid: string): string {
  const body = id.replaceAll("-", "").slice(0, 11).toUpperCase();
  const cae = `ES${body}`;
  return cae === avoid ? `ES${body.slice(0, 10)}Y` : cae;
}

function tempCode(id: string): string {
  return `T${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
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
