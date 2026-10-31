import { canonicalJson } from "../../db/audit";
import { sha256Hex } from "../../hash";
import type { Writer } from "../../db/writer";
import { fiscalBalanceAt, stockAt } from "../balances";
import { inspectionReport, type InspectionFilters, type InspectionTotals } from "../inspection";
import { isBusinessDate, resolveBusinessDate } from "../periods";
import {
  FISCAL_LEDGER_KEYS,
  STOCK_GROUP_KEYS,
  type Balance,
  type FiscalBalance,
  type FiscalMoveType,
  type PhysicalMoveType,
  type ProductState,
} from "../types";
import { INSPECTION_CSV_HEADER, inspectionHtml, toCsv, type ReportItem } from "./inspection-doc";
import {
  FISCAL_MOVE_COLUMNS,
  LEDGER_START,
  LEDGER_START_NOTICE,
  STOCK_MOVE_COLUMNS,
  invalid,
  isUuid,
  lit,
  loadFiscalMoves,
  loadLocks,
  loadStockMoves,
  opaque,
  resolveEntity,
  slicePage,
  uuidSql,
  type Reader,
} from "./rows";

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  total: number;
}

export interface BalanceQuery {
  at: string;
  locationId: string | null;
  vesselId: string | null;
  owner: string | null;
  productId: string | null;
  lotId: string | null;
  state: ProductState | null;
  limit: number;
  cursor: string | null;
}

export interface FiscalQuery {
  at: string;
  taxWarehouseId: string | null;
  productId: string | null;
  lotId: string | null;
  limit: number;
  cursor: string | null;
}

export interface MoveQuery {
  book: "physical" | "fiscal";
  from: string | null;
  to: string | null;
  moveType: string | null;
  lotId: string | null;
  productId: string | null;
  locationId: string | null;
  vesselId: string | null;
  owner: string | null;
  sourceId: string | null;
  sourceTable: string | null;
  silicieEntryId: string | null;
  limit: number;
  cursor: string | null;
}

const PHYSICAL_TYPES = new Set<string>([
  "opening",
  "cellar_in",
  "cellar_out",
  "loss",
  "delivery_out",
  "transfer_in",
  "return_in",
  "ownership_out",
  "ownership_in",
  "purchase_in",
  "count_adjust_in",
  "count_adjust_out",
  "reversal",
]);

const FISCAL_TYPES = new Set<string>([
  "opening",
  "production",
  "bulk_receipt",
  "packaging_out_bulk",
  "packaging_in_packaged",
  "loss",
  "destruction",
  "exit_domestic",
  "exit_export",
  "exit_intra_eu",
  "exit_canary",
  "ledger_change_out",
  "ledger_change_in",
  "return_in",
  "regularization_in",
  "regularization_out",
  "reversal",
]);

const STATES = new Set<ProductState>(["grape", "must", "wine", "packaged_unlabeled", "packaged_labeled", "goods"]);

function noticeFor(at: string): string | null {
  return resolveBusinessDate(at) < LEDGER_START ? LEDGER_START_NOTICE : null;
}

function and(parts: string[]): string {
  return parts.length === 0 ? "TRUE" : parts.join(" AND ");
}

function balanceKey(row: Balance): string {
  return opaque(JSON.stringify([
    row.location_id,
    row.vessel_id,
    row.owner_entity_id,
    row.lot_id,
    row.product_state,
    row.product_id,
  ]));
}

function fiscalKey(row: FiscalBalance): string {
  return opaque(JSON.stringify([row.tax_warehouse_id, row.product_class, row.excise_product_key]));
}

async function ownerId(reader: Reader, owner: string | null): Promise<string | null> {
  if (owner === null || owner.trim() === "") return null;
  if (isUuid(owner)) return owner.trim().toLowerCase();
  return resolveEntity(reader, owner, "owner");
}

function stockWhere(query: BalanceQuery, owner: string | null): string {
  const parts = ["TRUE"];
  if (query.locationId) parts.push(`location_id = ${uuidSql(query.locationId)}`);
  if (query.vesselId) parts.push(`vessel_id = ${uuidSql(query.vesselId)}`);
  if (owner) parts.push(`owner_entity_id = ${uuidSql(owner)}`);
  if (query.productId) parts.push(`product_id = ${uuidSql(query.productId)}`);
  if (query.lotId) parts.push(`lot_id = ${uuidSql(query.lotId)}`);
  if (query.state) parts.push(`product_state = ${lit(query.state)}`);
  return and(parts);
}

export async function listBalances(writer: Writer, query: BalanceQuery): Promise<Page<Balance> & { at: string; notice: string | null }> {
  const owner = await ownerId(writer, query.owner);
  const moves = await loadStockMoves(writer, stockWhere(query, owner));
  const rows = stockAt(moves, query.at, STOCK_GROUP_KEYS);
  return { at: query.at, notice: noticeFor(query.at), ...slicePage(rows, query.limit, query.cursor, balanceKey) };
}

export async function listFiscalBalances(
  writer: Writer,
  query: FiscalQuery,
): Promise<Page<FiscalBalance> & { at: string; notice: string | null }> {
  const parts = ["TRUE"];
  if (query.taxWarehouseId) parts.push(`tax_warehouse_id = ${uuidSql(query.taxWarehouseId)}`);
  if (query.productId) parts.push(`product_id = ${uuidSql(query.productId)}`);
  if (query.lotId) parts.push(`lot_id = ${uuidSql(query.lotId)}`);
  const moves = await loadFiscalMoves(writer, and(parts));
  const rows = fiscalBalanceAt(moves, query.at, FISCAL_LEDGER_KEYS);
  return { at: query.at, notice: noticeFor(query.at), ...slicePage(rows, query.limit, query.cursor, fiscalKey) };
}

interface NameRow {
  id: string;
  code?: string | null;
  sku?: string | null;
  vintage?: number | null;
}

const LOOKUP: Record<string, string> = {
  "inventory.location": "code",
  "cellar.vessel": "code",
  "inventory.lot": "code, vintage",
  "core.legal_entity": "code",
  "catalog.product": "sku",
};

async function names(reader: Reader, table: string, ids: readonly string[]): Promise<Map<string, NameRow>> {
  const columns = LOOKUP[table];
  const unique = [...new Set(ids)];
  const map = new Map<string, NameRow>();
  if (!columns || unique.length === 0) return map;
  const list = unique.map((id) => uuidSql(id)).join(", ");
  const rows = await reader.read<NameRow>(`
    SELECT id, ${columns}
    FROM ${table}
    WHERE id IN (${list})
  `);
  for (const row of rows) map.set(String(row.id).toLowerCase(), row);
  return map;
}

export interface InspectionDocument {
  at: string;
  business_date: string;
  hash: string;
  notice: string | null;
  items: ReportItem[];
  next_cursor: null;
  total: number;
  totals: InspectionTotals;
  filters: InspectionFilters;
}

export async function buildInspection(writer: Writer, query: BalanceQuery): Promise<InspectionDocument> {
  const owner = await ownerId(writer, query.owner);
  const filters: InspectionFilters = {};
  if (query.locationId) filters.location_id = query.locationId;
  if (owner) filters.owner_entity_id = owner;
  if (query.productId) filters.product_id = query.productId;
  if (query.lotId) filters.lot_id = query.lotId;
  if (query.state) filters.product_state = query.state;
  const moves = await loadStockMoves(writer, "TRUE");
  const report = inspectionReport(moves, query.at, filters);
  const [locations, vessels, lots, owners, products] = await Promise.all([
    names(writer, "inventory.location", report.rows.map((row) => row.location_id)),
    names(writer, "cellar.vessel", report.rows.flatMap((row) => (row.vessel_id ? [row.vessel_id] : []))),
    names(writer, "inventory.lot", report.rows.flatMap((row) => (row.lot_id ? [row.lot_id] : []))),
    names(writer, "core.legal_entity", report.rows.map((row) => row.owner_entity_id)),
    names(writer, "catalog.product", report.rows.flatMap((row) => (row.product_id ? [row.product_id] : []))),
  ]);
  const items: ReportItem[] = report.rows.map((row) => {
    const lot = row.lot_id ? lots.get(row.lot_id) : undefined;
    return {
      ...row,
      location_code: locations.get(row.location_id)?.code ?? null,
      vessel_code: row.vessel_id ? vessels.get(row.vessel_id)?.code ?? null : null,
      owner_code: owners.get(row.owner_entity_id)?.code ?? null,
      lot_code: lot?.code ?? null,
      vintage: lot?.vintage == null ? null : Number(lot.vintage),
      product_sku: row.product_id ? products.get(row.product_id)?.sku ?? null : null,
    };
  });
  const payload = {
    at: report.at,
    business_date: report.business_date,
    items,
    totals: report.totals,
    filters,
  };
  return {
    ...payload,
    hash: sha256Hex(canonicalJson(payload)),
    notice: noticeFor(query.at),
    next_cursor: null,
    total: items.length,
  };
}

export function inspectionCsv(document: InspectionDocument): string {
  return toCsv([...INSPECTION_CSV_HEADER], document.items);
}

export function inspectionPage(document: InspectionDocument): string {
  return inspectionHtml(document);
}

function datePredicate(column: "physical" | "fiscal", from: string | null, to: string | null): string[] {
  const parts: string[] = [];
  const expr = column === "physical"
    ? "(occurred_at AT TIME ZONE 'Europe/Madrid')::DATE"
    : "fiscal_date";
  if (from) parts.push(`${expr} >= CAST(${lit(from)} AS DATE)`);
  if (to) parts.push(`${expr} <= CAST(${lit(to)} AS DATE)`);
  return parts;
}

function moveFilters(query: MoveQuery, owner: string | null): string[] {
  const parts: string[] = [];
  if (query.from || query.to) {
    if ((query.from && !isBusinessDate(query.from)) || (query.to && !isBusinessDate(query.to))) {
      invalid("El periodo debe ser un día (YYYY-MM-DD).", { from: query.from ?? "", to: query.to ?? "" });
    }
  }
  parts.push(...datePredicate(query.book, query.from, query.to));
  if (query.moveType) {
    const allowed = query.book === "physical" ? PHYSICAL_TYPES : FISCAL_TYPES;
    if (!allowed.has(query.moveType)) invalid("Tipo de movimiento no válido.", { move_type: query.moveType });
    parts.push(`move_type = ${lit(query.moveType)}`);
  }
  if (query.lotId) parts.push(`lot_id = ${uuidSql(query.lotId)}`);
  if (query.productId) parts.push(`product_id = ${uuidSql(query.productId)}`);
  if (query.sourceId) parts.push(`source_id = ${uuidSql(query.sourceId)}`);
  if (query.sourceTable) parts.push(`source_table = ${lit(query.sourceTable)}`);
  if (query.book === "physical") {
    if (query.locationId) parts.push(`location_id = ${uuidSql(query.locationId)}`);
    if (query.vesselId) parts.push(`vessel_id = ${uuidSql(query.vesselId)}`);
    if (owner) parts.push(`owner_entity_id = ${uuidSql(owner)}`);
  } else if (query.silicieEntryId) {
    parts.push(`silicie_entry_id = ${uuidSql(query.silicieEntryId)}`);
  }
  return parts;
}

interface MoveCursor {
  at: string;
  id: string;
}

function parseMoveCursor(cursor: string | null): MoveCursor | null {
  if (cursor === null || cursor.trim() === "") return null;
  let text: string;
  try {
    text = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    invalid("Cursor no válido.", { cursor: "Cursor no válido" });
  }
  const split = text.indexOf("|");
  if (split < 0) invalid("Cursor no válido.", { cursor: "Cursor no válido" });
  const at = text.slice(0, split);
  const id = text.slice(split + 1);
  if (!isUuid(id)) invalid("Cursor no válido.", { cursor: "Cursor no válido" });
  return { at, id };
}

function encodeMoveCursor(at: string, id: string): string {
  return opaque(`${at}|${id}`);
}

function periodClosed(book: "physical" | "fiscal", at: string, locks: { ledger: string; locked_until: string }[]): boolean {
  const lock = locks.find((item) => item.ledger === book);
  if (!lock) return false;
  const date = book === "physical" ? resolveBusinessDate(at) : at.slice(0, 10);
  return date <= lock.locked_until;
}

export async function listMoves(
  writer: Writer,
  query: MoveQuery,
): Promise<Page<Record<string, unknown>> & { book: "physical" | "fiscal" }> {
  const owner = query.book === "physical" ? await ownerId(writer, query.owner) : null;
  const filters = moveFilters(query, owner);
  const cursor = parseMoveCursor(query.cursor);
  const pageFilters = [...filters];
  if (cursor) {
    const timeColumn = query.book === "physical" ? "occurred_at" : "fiscal_date";
    const cast = query.book === "physical" ? "TIMESTAMPTZ" : "DATE";
    pageFilters.push(`(${timeColumn} < CAST(${lit(cursor.at)} AS ${cast}) OR (${timeColumn} = CAST(${lit(cursor.at)} AS ${cast}) AND id < ${uuidSql(cursor.id)}))`);
  }
  const table = query.book === "physical" ? "inventory.stock_move" : "inventory.fiscal_move";
  const columns = query.book === "physical" ? STOCK_MOVE_COLUMNS : FISCAL_MOVE_COLUMNS;
  const order = query.book === "physical" ? "occurred_at DESC, id DESC" : "fiscal_date DESC, id DESC";
  const where = and(filters);
  const [countRows, locks, rows] = await Promise.all([
    writer.read<{ total: unknown }>(`SELECT count(*)::BIGINT AS total FROM ${table} WHERE ${where}`),
    loadLocks(writer),
    writer.read<Record<string, unknown>>(`
      SELECT ${columns}
      FROM ${table}
      WHERE ${and(pageFilters)}
      ORDER BY ${order}
      LIMIT ${query.limit + 1}
    `),
  ]);
  const total = Number(countRows[0]?.total ?? 0);
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const items = page.map((row) => {
    const at = query.book === "physical" ? String(row.occurred_at) : String(row.fiscal_date);
    return {
      ...normalizeMove(query.book, row),
      period_closed: periodClosed(query.book, at, locks),
    };
  });
  const last = page[page.length - 1];
  const lastAt = last
    ? query.book === "physical"
      ? String(last.occurred_at)
      : String(last.fiscal_date).slice(0, 10)
    : null;
  return {
    book: query.book,
    items,
    next_cursor: hasMore && last && lastAt ? encodeMoveCursor(lastAt, String(last.id).toLowerCase()) : null,
    total,
  };
}

function normalizeMove(book: "physical" | "fiscal", row: Record<string, unknown>): Record<string, unknown> {
  if (book === "physical") {
    const move = {
      id: String(row.id).toLowerCase(),
      occurred_at: String(row.occurred_at),
      move_type: String(row.move_type) as PhysicalMoveType,
      location_id: String(row.location_id).toLowerCase(),
      vessel_id: row.vessel_id == null ? null : String(row.vessel_id).toLowerCase(),
      owner_entity_id: String(row.owner_entity_id).toLowerCase(),
      lot_id: row.lot_id == null ? null : String(row.lot_id).toLowerCase(),
      product_id: row.product_id == null ? null : String(row.product_id).toLowerCase(),
      product_state: String(row.product_state),
      qty_units: Number(row.qty_units),
      volume_ml: Number(row.volume_ml),
      mass_g: Number(row.mass_g),
      loss_kind: row.loss_kind == null ? null : String(row.loss_kind),
      source_table: String(row.source_table),
      source_id: String(row.source_id).toLowerCase(),
      source_line_id: row.source_line_id == null ? null : String(row.source_line_id).toLowerCase(),
      reverses_move_id: row.reverses_move_id == null ? null : String(row.reverses_move_id).toLowerCase(),
      created_by: String(row.created_by),
      created_at: String(row.created_at),
    };
    return move;
  }
  return {
    id: String(row.id).toLowerCase(),
    tax_warehouse_id: String(row.tax_warehouse_id).toLowerCase(),
    fiscal_date: String(row.fiscal_date).slice(0, 10),
    physical_date: row.physical_date == null ? null : String(row.physical_date).slice(0, 10),
    move_type: String(row.move_type) as FiscalMoveType,
    product_class: String(row.product_class),
    lot_id: row.lot_id == null ? null : String(row.lot_id).toLowerCase(),
    product_id: row.product_id == null ? null : String(row.product_id).toLowerCase(),
    volume_ml: Number(row.volume_ml),
    units: Number(row.units),
    abv_pct: row.abv_pct == null ? null : String(row.abv_pct),
    excise_product_key: row.excise_product_key == null ? null : String(row.excise_product_key),
    nc_code: row.nc_code == null ? null : String(row.nc_code),
    justification_type: String(row.justification_type),
    justification_ref: String(row.justification_ref),
    counterparty_contact_id: row.counterparty_contact_id == null ? null : String(row.counterparty_contact_id).toLowerCase(),
    counterparty_excise_number: row.counterparty_excise_number == null ? null : String(row.counterparty_excise_number),
    fiscal_trigger: String(row.fiscal_trigger),
    source_table: String(row.source_table),
    source_id: String(row.source_id).toLowerCase(),
    source_line_id: row.source_line_id == null ? null : String(row.source_line_id).toLowerCase(),
    silicie_entry_id: row.silicie_entry_id == null ? null : String(row.silicie_entry_id).toLowerCase(),
    reverses_move_id: row.reverses_move_id == null ? null : String(row.reverses_move_id).toLowerCase(),
    reason: row.reason == null ? null : String(row.reason),
    created_by: String(row.created_by),
    created_at: String(row.created_at),
  };
}

export function assertState(value: string | null): ProductState | null {
  if (value === null || value.trim() === "") return null;
  if (!STATES.has(value as ProductState)) invalid("Estado de producto no válido.", { state: value });
  return value as ProductState;
}
