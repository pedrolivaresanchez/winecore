import { DomainError } from "../../errors";
import { sql } from "../../db/sql";
import { isBusinessDate, isInstant } from "../periods";
import type {
  CountMethod,
  CountProductState,
  FiscalMove,
  FiscalMoveType,
  FiscalTrigger,
  JustificationType,
  LedgerName,
  LossKind,
  PeriodLock,
  PhysicalMoveType,
  ProductClass,
  ProductState,
  StockMove,
} from "../types";

export const LEDGER_START = "2027-01-01";
export const LEDGER_START_NOTICE = "WineCore no tiene datos antes del aforo de arranque";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PHYSICAL_TYPES = new Set<PhysicalMoveType>([
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

const FISCAL_TYPES = new Set<FiscalMoveType>([
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

const PRODUCT_STATES = new Set<ProductState>([
  "grape",
  "must",
  "wine",
  "packaged_unlabeled",
  "packaged_labeled",
  "goods",
]);

const COUNT_STATES = new Set<CountProductState>([
  "must",
  "wine",
  "packaged_unlabeled",
  "packaged_labeled",
  "goods",
]);

const COUNT_METHODS = new Set<CountMethod>([
  "dipstick",
  "flowmeter",
  "level_gauge",
  "unit_count",
  "weight",
  "estimate",
]);

const PRODUCT_CLASSES = new Set<ProductClass>(["bulk", "bulk_wood", "packaged"]);

const JUSTIFICATIONS = new Set<JustificationType>([
  "invoice",
  "delivery_note",
  "e_ad",
  "customs_declaration",
  "internal",
  "count_record",
]);

export interface Reader {
  read<T = Record<string, unknown>>(statement: string): Promise<T[]>;
}

export function invalid(message: string, fields?: Record<string, string>, details?: unknown): never {
  throw new DomainError("WC_VALIDATION", 422, message, fields, details);
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function uuidSql(value: string): string {
  const id = value.trim().toLowerCase();
  if (!UUID_RE.test(id)) invalid("Identificador no válido.", { id: "UUID no válido" });
  return `CAST('${id}' AS UUID)`;
}

export function uuidOrNull(value: string | null): string {
  if (value === null) return "NULL";
  return uuidSql(value);
}

export function uuidArraySql(ids: readonly string[]): string {
  if (ids.length === 0) invalid("Hay que indicar al menos una ubicación.", { location_ids: "Vacío" });
  return `[${ids.map((id) => uuidSql(id)).join(", ")}]`;
}

export function lit(value: string | number | boolean | null): string {
  return sql`${value}`;
}

export function intSql(value: number, field: string): string {
  if (!Number.isSafeInteger(value)) invalid("La cantidad debe ser un entero.", { [field]: String(value) });
  return String(value);
}

export function asInt(value: unknown): number {
  if (typeof value === "bigint") {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) invalid("Cantidad fuera de rango.");
    return number;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) invalid("La cantidad debe ser un entero.", { value: String(value) });
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) invalid("Cantidad fuera de rango.");
    return number;
  }
  if (value == null) return 0;
  invalid("La cantidad debe ser un entero.", { value: String(value) });
}

export function asId(value: unknown): string {
  return String(value).toLowerCase();
}

export function asIdOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (text === "") return null;
  return text.toLowerCase();
}

export function asInstant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (isInstant(text)) return text;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) invalid("Fecha no válida.", { value: text });
  return new Date(parsed).toISOString();
}

export function asDate(value: unknown): string {
  if (value instanceof Date) {
    const iso = value.toISOString().slice(0, 10);
    if (!isBusinessDate(iso)) invalid("Fecha no válida.", { value: iso });
    return iso;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  const date = match?.[1];
  if (!date || !isBusinessDate(date)) invalid("Fecha no válida.", { value: String(value) });
  return date;
}

export function asTextOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length === 0 ? null : text;
}

function asEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, field: string): T {
  const text = String(value);
  if (!allowed.has(text as T)) invalid("Valor no válido.", { [field]: text });
  return text as T;
}

export function mapStockMove(row: Record<string, unknown>): StockMove {
  return {
    id: asId(row.id),
    occurred_at: asInstant(row.occurred_at),
    move_type: asEnum(row.move_type, PHYSICAL_TYPES, "move_type"),
    location_id: asId(row.location_id),
    vessel_id: asIdOrNull(row.vessel_id),
    owner_entity_id: asId(row.owner_entity_id),
    lot_id: asIdOrNull(row.lot_id),
    product_id: asIdOrNull(row.product_id),
    product_state: asEnum(row.product_state, PRODUCT_STATES, "product_state"),
    qty_units: asInt(row.qty_units),
    volume_ml: asInt(row.volume_ml),
    mass_g: asInt(row.mass_g),
    loss_kind: row.loss_kind == null ? null : asEnum<LossKind>(row.loss_kind, new Set<LossKind>(["authorized", "incident"]), "loss_kind"),
    source_table: String(row.source_table),
    source_id: asId(row.source_id),
    source_line_id: asIdOrNull(row.source_line_id),
    reverses_move_id: asIdOrNull(row.reverses_move_id),
    created_by: String(row.created_by),
    created_at: row.created_at == null ? undefined : asInstant(row.created_at),
  };
}

export function mapFiscalMove(row: Record<string, unknown>): FiscalMove {
  return {
    id: asId(row.id),
    tax_warehouse_id: asId(row.tax_warehouse_id),
    fiscal_date: asDate(row.fiscal_date),
    physical_date: row.physical_date == null ? null : asDate(row.physical_date),
    move_type: asEnum(row.move_type, FISCAL_TYPES, "move_type"),
    product_class: asEnum(row.product_class, PRODUCT_CLASSES, "product_class"),
    lot_id: asIdOrNull(row.lot_id),
    product_id: asIdOrNull(row.product_id),
    volume_ml: asInt(row.volume_ml),
    units: asInt(row.units),
    abv_pct: row.abv_pct == null ? null : String(row.abv_pct),
    excise_product_key: asTextOrNull(row.excise_product_key),
    nc_code: asTextOrNull(row.nc_code),
    justification_type: asEnum(row.justification_type, JUSTIFICATIONS, "justification_type"),
    justification_ref: String(row.justification_ref),
    counterparty_contact_id: asIdOrNull(row.counterparty_contact_id),
    counterparty_excise_number: asTextOrNull(row.counterparty_excise_number),
    fiscal_trigger: asEnum<FiscalTrigger>(
      row.fiscal_trigger,
      new Set<FiscalTrigger>(["invoice", "delivery_note", "operation", "count", "manual"]),
      "fiscal_trigger",
    ),
    source_table: String(row.source_table),
    source_id: asId(row.source_id),
    source_line_id: asIdOrNull(row.source_line_id),
    silicie_entry_id: asIdOrNull(row.silicie_entry_id),
    reverses_move_id: asIdOrNull(row.reverses_move_id),
    reason: asTextOrNull(row.reason),
    created_by: String(row.created_by),
    created_at: row.created_at == null ? undefined : asInstant(row.created_at),
  };
}

export function mapLock(row: Record<string, unknown>): PeriodLock {
  const ledger = String(row.ledger);
  if (ledger !== "physical" && ledger !== "fiscal") invalid("Libro de cierre no válido.", { ledger });
  return {
    ledger: ledger as LedgerName,
    locked_until: asDate(row.locked_until),
    locked_by: String(row.locked_by),
    locked_at: asInstant(row.locked_at),
    reason: String(row.reason),
  };
}

export function uuidList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).toLowerCase());
  if (typeof value === "string") {
    return value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)?.map((id) => id.toLowerCase()) ?? [];
  }
  return [];
}

export function isCountState(value: string): value is CountProductState {
  return COUNT_STATES.has(value as CountProductState);
}

export function isCountMethod(value: string): value is CountMethod {
  return COUNT_METHODS.has(value as CountMethod);
}

export const STOCK_MOVE_COLUMNS = `
  id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
  product_state, qty_units, volume_ml, mass_g, loss_kind, source_table, source_id,
  source_line_id, reverses_move_id, created_by, created_at
`;

export const FISCAL_MOVE_COLUMNS = `
  id, tax_warehouse_id, fiscal_date, physical_date, move_type, product_class, lot_id, product_id,
  volume_ml, units, abv_pct, excise_product_key, nc_code, justification_type, justification_ref,
  counterparty_contact_id, counterparty_excise_number, fiscal_trigger, source_table, source_id,
  source_line_id, silicie_entry_id, reverses_move_id, reason, created_by, created_at
`;

export async function loadStockMoves(reader: Reader, where: string): Promise<StockMove[]> {
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT ${STOCK_MOVE_COLUMNS}
    FROM inventory.stock_move
    WHERE ${where}
  `);
  return rows.map(mapStockMove);
}

export async function loadFiscalMoves(reader: Reader, where: string): Promise<FiscalMove[]> {
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT ${FISCAL_MOVE_COLUMNS}
    FROM inventory.fiscal_move
    WHERE ${where}
  `);
  return rows.map(mapFiscalMove);
}

export async function loadLocks(reader: Reader): Promise<PeriodLock[]> {
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT ledger, locked_until, locked_by, locked_at, reason
    FROM inventory.period_lock
  `);
  return rows.map(mapLock);
}

export async function resolveEntity(reader: Reader, raw: string, field: string): Promise<string> {
  const text = raw.trim();
  if (text === "") invalid("Falta la entidad.", { [field]: "Obligatorio" });
  if (isUuid(text)) {
    const id = text.toLowerCase();
    const rows = await reader.read<{ id: string }>(sql`
      SELECT id FROM core.legal_entity WHERE id = CAST(${id} AS UUID)
    `);
    const found = rows[0]?.id;
    if (!found) invalid("La entidad no existe.", { [field]: "No existe" });
    return found.toLowerCase();
  }
  const code = text.toUpperCase().replace(/\./g, "");
  const rows = await reader.read<{ id: string }>(sql`
    SELECT id FROM core.legal_entity WHERE code = ${code}
  `);
  const found = rows[0]?.id;
  if (!found) invalid("La entidad no existe.", { [field]: code });
  return found.toLowerCase();
}

export function opaque(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function slicePage<T>(
  rows: readonly T[],
  limit: number,
  cursor: string | null,
  keyOf: (row: T) => string,
): { items: T[]; next_cursor: string | null; total: number } {
  let start = 0;
  if (cursor !== null) {
    const index = rows.findIndex((row) => keyOf(row) === cursor);
    if (index < 0) invalid("Cursor no válido.", { cursor: "Cursor no válido" });
    start = index + 1;
  }
  const items = rows.slice(start, start + limit);
  const last = items[items.length - 1];
  const more = start + items.length < rows.length;
  return {
    items: [...items],
    next_cursor: more && last !== undefined ? keyOf(last) : null,
    total: rows.length,
  };
}
