import { payloadSha256 } from "../../approvals/canonical";
import { loadApprovalPolicies } from "../../approvals/policy-store";
import { approvalServiceOn } from "../../approvals/sql-store";
import { DomainError, domainError } from "../../errors";
import { newId } from "../../ids";
import { sql } from "../../db/sql";
import type { Actor, Tx, Writer } from "../../db/writer";
import { findNegativeBalances, stockAt } from "../balances";
import { planCountAdjustments, planOpeningCount } from "../count";
import { assertPeriodOpen, isBusinessDate, isInstant, resolveBusinessDate } from "../periods";
import {
  STOCK_GROUP_KEYS,
  isFiscalMove,
  isStockMove,
  type AdjustmentDraft,
  type CountLine,
  type CountMethod,
  type CountPlanContext,
  type CountProductState,
  type FiscalMove,
  type NegativeBalance,
  type OpeningCountContext,
  type PeriodLock,
  type ProductClass,
  type StockMove,
} from "../types";
import {
  asId,
  asIdOrNull,
  asInstant,
  asInt,
  asTextOrNull,
  intSql,
  invalid,
  isCountMethod,
  isCountState,
  isUuid,
  lit,
  loadFiscalMoves,
  loadLocks,
  loadStockMoves,
  resolveEntity,
  uuidArraySql,
  uuidOrNull,
  uuidSql,
  uuidList,
  type Reader,
} from "./rows";

const OPENING_CUTOFF = "2026-12-31";
const OPENING_FISCAL_DATE = "2027-01-01";
const OPENING_AS_OF = "2027-01-01T00:00:00+01:00";
const SOURCE_TABLE = "inventory.inventory_count";

const KINDS = new Set(["opening", "periodic", "inspection", "spot"]);

export interface CountLineRow {
  id: string;
  count_id: string;
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: CountProductState;
  expected_qty_units: number;
  expected_volume_ml: number;
  counted_qty_units: number | null;
  counted_volume_ml: number | null;
  method: CountMethod | null;
  difference_reason: string | null;
  photo_attachment_id: string | null;
}

export interface InventoryCountRow {
  id: string;
  legal_entity_id: string;
  number: string | null;
  kind: "opening" | "periodic" | "inspection" | "spot";
  counted_at: string;
  location_ids: string[];
  status: string;
  approval_request_id: string | null;
  signed_by: string | null;
  signed_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export interface InventoryCountView extends InventoryCountRow {
  lines: { items: CountLineRow[]; next_cursor: null; total: number };
}

export type AdjustmentPlan =
  | {
      approval_required: true;
      approval_kind: "inventory_adjustment";
      mode: "opening";
      physical: StockMove[];
      fiscal: FiscalMove[];
    }
  | {
      approval_required: true;
      approval_kind: "inventory_adjustment";
      mode: "adjustment";
      physical: AdjustmentDraft[];
      fiscal: AdjustmentDraft[];
    };

interface VesselInfo {
  id: string;
  location_id: string;
  kind: string;
  material: string;
  capacity_ml: number;
}

interface ProductInfo {
  excise: string | null;
  nc: string | null;
  abv: string | null;
  nominal: number | null;
}

interface LineInput {
  id: string | null;
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: CountProductState;
  counted_qty_units: number | null;
  counted_volume_ml: number | null;
  method: CountMethod | null;
  difference_reason: string | null;
  photo_attachment_id: string | null;
}

function kindOf(value: string): InventoryCountRow["kind"] {
  if (value === "regular") return "periodic";
  if (!KINDS.has(value)) invalid("El tipo de aforo no es válido.", { kind: value });
  return value as InventoryCountRow["kind"];
}

function mapCount(row: Record<string, unknown>): InventoryCountRow {
  const kind = String(row.kind);
  if (!KINDS.has(kind)) invalid("El tipo de aforo no es válido.", { kind });
  return {
    id: asId(row.id),
    legal_entity_id: asId(row.legal_entity_id),
    number: asTextOrNull(row.number),
    kind: kind as InventoryCountRow["kind"],
    counted_at: asInstant(row.counted_at),
    location_ids: uuidList(row.location_ids),
    status: String(row.status),
    approval_request_id: asIdOrNull(row.approval_request_id),
    signed_by: asIdOrNull(row.signed_by),
    signed_at: row.signed_at == null ? null : asInstant(row.signed_at),
    notes: asTextOrNull(row.notes),
    created_by: String(row.created_by),
    created_at: asInstant(row.created_at),
  };
}

function mapLine(row: Record<string, unknown>): CountLineRow {
  const state = String(row.product_state);
  if (!isCountState(state)) invalid("El estado de producto del aforo no es válido.", { product_state: state });
  const method = row.method == null ? null : String(row.method);
  if (method !== null && !isCountMethod(method)) invalid("El método de aforo no es válido.", { method });
  return {
    id: asId(row.id),
    count_id: asId(row.count_id),
    location_id: asId(row.location_id),
    vessel_id: asIdOrNull(row.vessel_id),
    owner_entity_id: asId(row.owner_entity_id),
    lot_id: asIdOrNull(row.lot_id),
    product_id: asIdOrNull(row.product_id),
    product_state: state,
    expected_qty_units: asInt(row.expected_qty_units),
    expected_volume_ml: asInt(row.expected_volume_ml),
    counted_qty_units: row.counted_qty_units == null ? null : asInt(row.counted_qty_units),
    counted_volume_ml: row.counted_volume_ml == null ? null : asInt(row.counted_volume_ml),
    method: method as CountMethod | null,
    difference_reason: asTextOrNull(row.difference_reason),
    photo_attachment_id: asIdOrNull(row.photo_attachment_id),
  };
}

async function readCount(reader: Reader, id: string): Promise<InventoryCountRow> {
  if (!isUuid(id)) invalid("Identificador de aforo no válido.", { id: "UUID no válido" });
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT id, legal_entity_id, number, kind, counted_at, location_ids, status,
           approval_request_id, signed_by, signed_at, notes, created_by, created_at
    FROM inventory.inventory_count
    WHERE id = ${uuidSql(id)}
  `);
  const row = rows[0];
  if (!row) throw domainError("WC_NOT_FOUND");
  return mapCount(row);
}

async function readLines(reader: Reader, countId: string): Promise<CountLineRow[]> {
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT id, count_id, location_id, vessel_id, owner_entity_id, lot_id, product_id, product_state,
           expected_qty_units, expected_volume_ml, counted_qty_units, counted_volume_ml, method,
           difference_reason, photo_attachment_id
    FROM inventory.inventory_count_line
    WHERE count_id = ${uuidSql(countId)}
    ORDER BY location_id, vessel_id NULLS FIRST, lot_id NULLS FIRST, product_id NULLS FIRST, id
  `);
  return rows.map(mapLine);
}

function viewOf(count: InventoryCountRow, lines: CountLineRow[]): InventoryCountView {
  return { ...count, lines: { items: lines, next_cursor: null, total: lines.length } };
}

async function loadView(writer: Writer, id: string): Promise<InventoryCountView> {
  const count = await readCount(writer, id);
  const lines = await readLines(writer, id);
  return viewOf(count, lines);
}

function requireCounting(count: InventoryCountRow): void {
  if (count.status === "posted") {
    invalid("El aforo ya está contabilizado.", { status: count.status });
  }
  if (count.status !== "counting") {
    invalid("El aforo no admite esta acción en su estado actual.", { status: count.status });
  }
}

function seriesYear(kind: InventoryCountRow["kind"], countedAt: string): number {
  const date = resolveBusinessDate(countedAt);
  if (kind === "opening" && date <= OPENING_CUTOFF) return 2027;
  return Number(date.slice(0, 4));
}

async function nextNumber(tx: Tx, entityId: string, year: number): Promise<string> {
  const prefix = `AF-${year}-`;
  const rows = await tx.read<{ number: string | null }>(`
    SELECT number FROM inventory.inventory_count
    WHERE legal_entity_id = ${uuidSql(entityId)} AND number LIKE ${lit(`${prefix}%`)}
  `);
  let max = 0;
  for (const row of rows) {
    const number = row.number;
    if (!number || !number.startsWith(prefix)) continue;
    const suffix = number.slice(prefix.length);
    if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function objectOf(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(message, { body: "Objeto esperado" });
  return value as Record<string, unknown>;
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !isUuid(value)) invalid("Identificador no válido.", { [field]: "UUID no válido" });
  return value.toLowerCase();
}

function parseInteger(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    invalid("La cantidad debe ser un entero de mililitros o de unidades.", { [field]: "Entero" });
  }
  if (value < 0) invalid("El recuento no puede ser negativo.", { [field]: String(value) });
  return value;
}

function isPackaged(state: CountProductState): boolean {
  return state === "packaged_unlabeled" || state === "packaged_labeled";
}

function isBulk(state: CountProductState): boolean {
  return state === "must" || state === "wine";
}

async function parseLine(reader: Reader, raw: unknown, owners: Map<string, string>): Promise<LineInput> {
  const body = objectOf(raw, "La línea de aforo no es válida.");
  const stateText = typeof body.product_state === "string" ? body.product_state : "";
  if (!isCountState(stateText)) invalid("El estado de producto del aforo no es válido.", { product_state: stateText || "vacío" });
  const locationId = optionalUuid(body.location_id, "location_id");
  if (!locationId) invalid("Falta la ubicación de la línea.", { location_id: "Obligatorio" });
  const ownerRaw = typeof body.owner_entity_id === "string" ? body.owner_entity_id : "";
  if (ownerRaw.trim() === "") invalid("Falta el propietario de la línea.", { owner_entity_id: "Obligatorio" });
  const cached = owners.get(ownerRaw.trim().toUpperCase());
  const owner = cached ?? await resolveEntity(reader, ownerRaw, "owner_entity_id");
  owners.set(ownerRaw.trim().toUpperCase(), owner);
  let qty = parseInteger(body.counted_qty_units, "counted_qty_units");
  let volume = parseInteger(body.counted_volume_ml, "counted_volume_ml");
  if (isBulk(stateText) && volume !== null && qty === null) qty = 0;
  if (isBulk(stateText) && qty !== null && qty !== 0) {
    invalid("El granel (mosto o vino) no lleva unidades.", { counted_qty_units: String(qty) });
  }
  if ((qty === null) !== (volume === null)) {
    invalid("Hay que indicar unidades y volumen, o dejar la línea sin contar.", {
      counted_qty_units: qty === null ? "Falta" : "Sobra",
      counted_volume_ml: volume === null ? "Falta" : "Sobra",
    });
  }
  const methodText = body.method == null || body.method === "" ? null : String(body.method);
  if (methodText !== null && !isCountMethod(methodText)) invalid("El método de aforo no es válido.", { method: methodText });
  if ((qty !== null || volume !== null) && methodText === null) {
    invalid("El recuento exige un método.", { method: "Obligatorio" });
  }
  const reasonRaw = body.difference_reason == null ? null : String(body.difference_reason).trim();
  if (reasonRaw && reasonRaw.length > 500) invalid("El motivo es demasiado largo.", { difference_reason: "Máximo 500 caracteres" });
  return {
    id: optionalUuid(body.id, "id"),
    location_id: locationId,
    vessel_id: optionalUuid(body.vessel_id, "vessel_id"),
    owner_entity_id: owner,
    lot_id: optionalUuid(body.lot_id, "lot_id"),
    product_id: optionalUuid(body.product_id, "product_id"),
    product_state: stateText,
    counted_qty_units: qty,
    counted_volume_ml: volume,
    method: methodText,
    difference_reason: reasonRaw && reasonRaw.length > 0 ? reasonRaw : null,
    photo_attachment_id: optionalUuid(body.photo_attachment_id, "photo_attachment_id"),
  };
}

function sameKey(left: LineInput | CountLineRow, right: LineInput | CountLineRow): boolean {
  return left.location_id === right.location_id
    && left.vessel_id === right.vessel_id
    && left.owner_entity_id === right.owner_entity_id
    && left.lot_id === right.lot_id
    && left.product_id === right.product_id
    && left.product_state === right.product_state;
}

async function idsIn(reader: Reader, table: string, ids: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  if (table !== "inventory.location" && table !== "inventory.lot" && table !== "catalog.product" && table !== "cellar.vessel") {
    invalid("Tabla no válida.");
  }
  const rows = await reader.read<{ id: string }>(`
    SELECT id FROM ${table} WHERE id IN (${unique.map((id) => uuidSql(id)).join(", ")})
  `);
  return new Set(rows.map((row) => String(row.id).toLowerCase()));
}

async function loadVessels(reader: Reader, ids: readonly string[]): Promise<Map<string, VesselInfo>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, VesselInfo>();
  if (unique.length === 0) return map;
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT id, location_id, kind, material, capacity_ml
    FROM cellar.vessel
    WHERE id IN (${unique.map((id) => uuidSql(id)).join(", ")})
  `);
  for (const row of rows) {
    const id = asId(row.id);
    map.set(id, {
      id,
      location_id: asId(row.location_id),
      kind: String(row.kind),
      material: String(row.material),
      capacity_ml: asInt(row.capacity_ml),
    });
  }
  return map;
}

function abvText(value: unknown): string | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return number.toFixed(2);
}

async function loadProducts(reader: Reader, ids: readonly string[]): Promise<Map<string, ProductInfo>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, ProductInfo>();
  if (unique.length === 0) return map;
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT p.id, p.excise_product_key, p.nc_code, p.alcohol_pct, f.nominal_volume_ml
    FROM catalog.product p
    LEFT JOIN catalog.format f ON f.id = p.format_id
    WHERE p.id IN (${unique.map((id) => uuidSql(id)).join(", ")})
  `);
  for (const row of rows) {
    const excise = asTextOrNull(row.excise_product_key);
    map.set(asId(row.id), {
      excise: excise && excise.trim() !== "" ? excise.trim() : null,
      nc: asTextOrNull(row.nc_code),
      abv: abvText(row.alcohol_pct),
      nominal: row.nominal_volume_ml == null ? null : asInt(row.nominal_volume_ml),
    });
  }
  return map;
}

function productClass(state: CountProductState, vessel: VesselInfo | undefined): ProductClass | null {
  if (isPackaged(state)) return "packaged";
  if (isBulk(state)) {
    if (vessel && (vessel.kind === "barrel" || vessel.material === "oak")) return "bulk_wood";
    return "bulk";
  }
  return null;
}

async function annotate(reader: Reader, lines: readonly CountLineRow[]): Promise<CountLine[]> {
  const vessels = await loadVessels(reader, lines.flatMap((line) => (line.vessel_id ? [line.vessel_id] : [])));
  const products = await loadProducts(reader, lines.flatMap((line) => (line.product_id ? [line.product_id] : [])));
  const locationIds = [...new Set(lines.map((line) => line.location_id))];
  const locations = new Map<string, string | null>();
  if (locationIds.length > 0) {
    const rows = await reader.read<{ id: string; tax_warehouse_id: string | null }>(`
      SELECT id, tax_warehouse_id FROM inventory.location
      WHERE id IN (${locationIds.map((id) => uuidSql(id)).join(", ")})
    `);
    for (const row of rows) locations.set(String(row.id).toLowerCase(), row.tax_warehouse_id ? String(row.tax_warehouse_id).toLowerCase() : null);
  }
  return lines.map((line) => {
    const vessel = line.vessel_id ? vessels.get(line.vessel_id) : undefined;
    const product = line.product_id ? products.get(line.product_id) : undefined;
    const warehouse = locations.get(line.location_id) ?? null;
    const fiscalClass = productClass(line.product_state, vessel);
    const inPerimeter = warehouse !== null && fiscalClass !== null;
    return {
      id: line.id,
      location_id: line.location_id,
      vessel_id: line.vessel_id,
      owner_entity_id: line.owner_entity_id,
      lot_id: line.lot_id,
      product_id: line.product_id,
      product_state: line.product_state,
      expected_qty_units: line.expected_qty_units,
      expected_volume_ml: line.expected_volume_ml,
      counted_qty_units: line.counted_qty_units,
      counted_volume_ml: line.counted_volume_ml,
      method: line.method,
      difference_reason: line.difference_reason,
      photo_attachment_id: line.photo_attachment_id,
      tax_warehouse_id: inPerimeter ? warehouse : null,
      product_class: inPerimeter ? fiscalClass : null,
      excise_product_key: product?.excise ?? null,
      nominal_volume_ml: product?.nominal ?? null,
      abv_pct: product?.abv ?? null,
      nc_code: product?.nc ?? null,
    };
  });
}

function openingContext(count: InventoryCountRow, actor: Actor): OpeningCountContext {
  const physical = resolveBusinessDate(count.counted_at);
  const cutoff = physical <= OPENING_CUTOFF;
  return {
    count_id: count.id,
    count_number: count.number ?? "",
    as_of: cutoff ? OPENING_AS_OF : count.counted_at,
    fiscal_date: cutoff ? OPENING_FISCAL_DATE : physical,
    physical_date: physical,
    created_by: actor.id,
  };
}

function adjustmentContext(count: InventoryCountRow, actor: Actor, ledger: "physical" | "fiscal"): CountPlanContext {
  return {
    ledger,
    count_id: count.id,
    count_number: count.number ?? "",
    counted_at: count.counted_at,
    fiscal_date: resolveBusinessDate(count.counted_at),
    created_by: actor.id,
  };
}

async function buildPlan(
  reader: Reader,
  count: InventoryCountRow,
  lines: readonly CountLineRow[],
  actor: Actor,
): Promise<AdjustmentPlan> {
  if (!count.number) invalid("El aforo no tiene número.", { number: "Falta" });
  const annotated = await annotate(reader, lines);
  if (count.kind === "opening") {
    const plan = planOpeningCount(annotated, openingContext(count, actor));
    return {
      approval_required: true,
      approval_kind: "inventory_adjustment",
      mode: "opening",
      physical: plan.physical,
      fiscal: plan.fiscal,
    };
  }
  const stock = await loadStockMoves(reader, "TRUE");
  const fiscal = await loadFiscalMoves(reader, "TRUE");
  return {
    approval_required: true,
    approval_kind: "inventory_adjustment",
    mode: "adjustment",
    physical: planCountAdjustments(stock, annotated, adjustmentContext(count, actor, "physical")),
    fiscal: planCountAdjustments(fiscal, annotated, adjustmentContext(count, actor, "fiscal")),
  };
}

async function assertAdjustmentHash(
  tx: Tx,
  count: InventoryCountRow,
  plan: AdjustmentPlan,
): Promise<{ requestId: string; hash: string }> {
  if (!count.approval_request_id) throw domainError("WC_NOT_APPROVED");
  const rows = await tx.read<{ payload_sha256: string }>(sql`
    SELECT payload_sha256
    FROM ops.approval_request
    WHERE id = CAST(${count.approval_request_id} AS UUID)
  `);
  const frozen = rows[0]?.payload_sha256;
  if (!frozen) throw domainError("WC_NOT_APPROVED");
  const hash = payloadSha256(plan);
  if (hash !== frozen) throw domainError("WC040");
  return { requestId: count.approval_request_id, hash };
}

function plannedMoves(plan: AdjustmentPlan): { physical: StockMove[]; fiscal: FiscalMove[] } {
  if (plan.mode === "opening") return { physical: plan.physical, fiscal: plan.fiscal };
  const physical: StockMove[] = [];
  for (const draft of plan.physical) {
    if (!isStockMove(draft.move)) invalid("El ajuste físico no es válido.");
    physical.push(draft.move);
  }
  const fiscal: FiscalMove[] = [];
  for (const draft of plan.fiscal) {
    if (!isFiscalMove(draft.move)) invalid("El ajuste fiscal no es válido.");
    fiscal.push(draft.move);
  }
  return { physical, fiscal };
}

function bookBalance(
  moves: readonly StockMove[],
  at: string,
  key: LineInput,
): { qty_units: number; volume_ml: number } {
  const rows = stockAt(moves, at, STOCK_GROUP_KEYS);
  const found = rows.find((row) =>
    row.location_id === key.location_id
    && row.vessel_id === key.vessel_id
    && row.owner_entity_id === key.owner_entity_id
    && row.lot_id === key.lot_id
    && row.product_id === key.product_id
    && row.product_state === key.product_state);
  return { qty_units: found?.qty_units ?? 0, volume_ml: found?.volume_ml ?? 0 };
}

function lineAudit(line: CountLineRow): Record<string, unknown> {
  return { ...line };
}

function countAudit(count: InventoryCountRow, extra?: Record<string, unknown>): Record<string, unknown> {
  return { ...count, ...extra };
}

function insertCountSql(count: InventoryCountRow): string {
  return `
    INSERT INTO inventory.inventory_count (
      id, legal_entity_id, number, kind, counted_at, location_ids, status, notes, created_by, created_at
    ) VALUES (
      ${uuidSql(count.id)},
      ${uuidSql(count.legal_entity_id)},
      ${lit(count.number)},
      ${lit(count.kind)},
      ${instantSql(count.counted_at)},
      ${uuidArraySql(count.location_ids)},
      ${lit(count.status)},
      ${lit(count.notes)},
      ${lit(count.created_by)},
      ${instantSql(count.created_at)}
    )
  `;
}

function insertLineSql(line: CountLineRow): string {
  return `
    INSERT INTO inventory.inventory_count_line (
      id, count_id, location_id, vessel_id, owner_entity_id, lot_id, product_id, product_state,
      expected_qty_units, expected_volume_ml, counted_qty_units, counted_volume_ml, method,
      difference_reason, photo_attachment_id
    ) VALUES (
      ${uuidSql(line.id)},
      ${uuidSql(line.count_id)},
      ${uuidSql(line.location_id)},
      ${uuidOrNull(line.vessel_id)},
      ${uuidSql(line.owner_entity_id)},
      ${uuidOrNull(line.lot_id)},
      ${uuidOrNull(line.product_id)},
      ${lit(line.product_state)},
      ${intSql(line.expected_qty_units, "expected_qty_units")},
      ${intSql(line.expected_volume_ml, "expected_volume_ml")},
      ${line.counted_qty_units === null ? "NULL" : intSql(line.counted_qty_units, "counted_qty_units")},
      ${line.counted_volume_ml === null ? "NULL" : intSql(line.counted_volume_ml, "counted_volume_ml")},
      ${lit(line.method)},
      ${lit(line.difference_reason)},
      ${uuidOrNull(line.photo_attachment_id)}
    )
  `;
}

function updateLineSql(line: CountLineRow): string {
  return `
    UPDATE inventory.inventory_count_line SET
      counted_qty_units = ${line.counted_qty_units === null ? "NULL" : intSql(line.counted_qty_units, "counted_qty_units")},
      counted_volume_ml = ${line.counted_volume_ml === null ? "NULL" : intSql(line.counted_volume_ml, "counted_volume_ml")},
      method = ${lit(line.method)},
      difference_reason = ${lit(line.difference_reason)},
      photo_attachment_id = ${uuidOrNull(line.photo_attachment_id)}
    WHERE id = ${uuidSql(line.id)} AND count_id = ${uuidSql(line.count_id)}
  `;
}

function instantSql(value: string): string {
  if (!isInstant(value)) invalid("La fecha debe ser un instante con zona horaria.", { counted_at: value });
  return `CAST(${lit(value)} AS TIMESTAMPTZ)`;
}

function dateSql(value: string): string {
  if (!isBusinessDate(value)) invalid("Fecha no válida.", { value });
  return `CAST(${lit(value)} AS DATE)`;
}

function abvSql(value: string | null): string {
  if (value === null) return "NULL";
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) invalid("El grado alcohólico no es válido.", { abv_pct: value });
  return `CAST(${lit(value)} AS DECIMAL(5,2))`;
}

function ncSql(value: string | null): string {
  if (value === null) return "NULL";
  if (!/^[0-9]{8}$/.test(value)) invalid("El código NC debe tener 8 dígitos.", { nc_code: value });
  return lit(value);
}

function insertStockSql(move: StockMove, now: string): string {
  return `
    INSERT INTO inventory.stock_move (
      id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
      product_state, qty_units, volume_ml, mass_g, loss_kind, source_table, source_id,
      source_line_id, reverses_move_id, created_by, created_at
    ) VALUES (
      ${uuidSql(move.id ?? newId())},
      ${instantSql(move.occurred_at)},
      ${lit(move.move_type)},
      ${uuidSql(move.location_id)},
      ${uuidOrNull(move.vessel_id)},
      ${uuidSql(move.owner_entity_id)},
      ${uuidOrNull(move.lot_id)},
      ${uuidOrNull(move.product_id)},
      ${lit(move.product_state)},
      ${intSql(move.qty_units, "qty_units")},
      ${intSql(move.volume_ml, "volume_ml")},
      ${intSql(move.mass_g, "mass_g")},
      ${lit(move.loss_kind)},
      ${lit(move.source_table)},
      ${uuidSql(move.source_id)},
      ${uuidOrNull(move.source_line_id)},
      ${uuidOrNull(move.reverses_move_id)},
      ${lit(move.created_by)},
      ${instantSql(now)}
    )
  `;
}

function insertFiscalSql(move: FiscalMove, now: string): string {
  return `
    INSERT INTO inventory.fiscal_move (
      id, tax_warehouse_id, fiscal_date, physical_date, move_type, product_class, lot_id, product_id,
      volume_ml, units, abv_pct, excise_product_key, nc_code, justification_type, justification_ref,
      counterparty_contact_id, counterparty_excise_number, fiscal_trigger, source_table, source_id,
      source_line_id, silicie_entry_id, reverses_move_id, reason, created_by, created_at
    ) VALUES (
      ${uuidSql(move.id ?? newId())},
      ${uuidSql(move.tax_warehouse_id)},
      ${dateSql(move.fiscal_date)},
      ${move.physical_date === null ? "NULL" : dateSql(move.physical_date)},
      ${lit(move.move_type)},
      ${lit(move.product_class)},
      ${uuidOrNull(move.lot_id)},
      ${uuidOrNull(move.product_id)},
      ${intSql(move.volume_ml, "volume_ml")},
      ${intSql(move.units, "units")},
      ${abvSql(move.abv_pct)},
      ${lit(move.excise_product_key)},
      ${ncSql(move.nc_code)},
      ${lit(move.justification_type)},
      ${lit(move.justification_ref)},
      ${uuidOrNull(move.counterparty_contact_id)},
      ${lit(move.counterparty_excise_number)},
      ${lit(move.fiscal_trigger)},
      ${lit(move.source_table)},
      ${uuidSql(move.source_id)},
      ${uuidOrNull(move.source_line_id)},
      ${uuidOrNull(move.silicie_entry_id)},
      ${uuidOrNull(move.reverses_move_id)},
      ${lit(move.reason)},
      ${lit(move.created_by)},
      ${instantSql(now)}
    )
  `;
}

function negSignature(finding: NegativeBalance): string {
  return [
    finding.code,
    finding.at,
    finding.location_id,
    finding.vessel_id,
    finding.owner_entity_id,
    finding.lot_id,
    finding.product_id,
    finding.product_state,
    finding.tax_warehouse_id,
    finding.product_class,
    finding.excise_product_key,
    finding.qty_units,
    finding.volume_ml,
    finding.mass_g,
    finding.units,
  ].join("\u001f");
}

function assertNoNewNegatives(existing: readonly StockMove[], added: readonly StockMove[]): void;
function assertNoNewNegatives(existing: readonly FiscalMove[], added: readonly FiscalMove[]): void;
function assertNoNewNegatives(
  existing: readonly StockMove[] | readonly FiscalMove[],
  added: readonly StockMove[] | readonly FiscalMove[],
): void {
  if (added.length === 0) return;
  const before = new Set(findNegativeBalances(existing as StockMove[]).map(negSignature));
  const after = findNegativeBalances([...(existing as StockMove[]), ...(added as StockMove[])]);
  const caused = after.filter((finding) => !before.has(negSignature(finding)));
  const first = caused[0];
  if (!first) return;
  throw new DomainError(first.code, 422, first.message, undefined, caused.map((finding) => ({
    code: finding.code,
    message: finding.message,
    at: finding.at,
    location_id: finding.location_id,
    vessel_id: finding.vessel_id,
    owner_entity_id: finding.owner_entity_id,
    lot_id: finding.lot_id,
    product_id: finding.product_id,
    product_state: finding.product_state,
    tax_warehouse_id: finding.tax_warehouse_id,
    product_class: finding.product_class,
    excise_product_key: finding.excise_product_key,
    volume_ml: finding.volume_ml,
    qty_units: finding.qty_units,
    units: finding.units,
  })));
}

async function assertVessels(reader: Reader, existing: readonly StockMove[], added: readonly StockMove[]): Promise<void> {
  const touched = [...new Set(added.flatMap((move) => (move.vessel_id ? [move.vessel_id] : [])))];
  if (touched.length === 0) return;
  const vessels = await loadVessels(reader, touched);
  const totals = new Map<string, number>();
  const lots = new Map<string, Map<string, number>>();
  const apply = (move: StockMove) => {
    if (!move.vessel_id || !touched.includes(move.vessel_id)) return;
    totals.set(move.vessel_id, (totals.get(move.vessel_id) ?? 0) + move.volume_ml);
    const byLot = lots.get(move.vessel_id) ?? new Map<string, number>();
    const lot = move.lot_id ?? "";
    byLot.set(lot, (byLot.get(lot) ?? 0) + move.volume_ml);
    lots.set(move.vessel_id, byLot);
  };
  for (const move of existing) apply(move);
  for (const move of added) apply(move);
  for (const vesselId of touched) {
    const vessel = vessels.get(vesselId);
    if (!vessel) invalid("El recipiente no existe.", { vessel_id: vesselId });
    const total = totals.get(vesselId) ?? 0;
    if (total > vessel.capacity_ml) {
      throw new DomainError(
        "WC025",
        422,
        `WC025: el recipiente supera su capacidad (${total} mL > ${vessel.capacity_ml} mL)`,
        { vessel_id: vesselId },
      );
    }
    const positive = [...(lots.get(vesselId)?.values() ?? [])].filter((volume) => volume > 0).length;
    if (positive > 1) {
      throw new DomainError("WC026", 422, "WC026: el recipiente contendría más de un lote.", { vessel_id: vesselId });
    }
  }
}

async function assertOpeningOnce(reader: Reader, count: InventoryCountRow, lines: readonly CountLineRow[]): Promise<void> {
  const posted = await reader.read<{ id: string }>(`
    SELECT id FROM inventory.inventory_count
    WHERE kind = 'opening' AND status = 'posted' AND legal_entity_id = ${uuidSql(count.legal_entity_id)}
    LIMIT 1
  `);
  if (posted.length > 0) {
    invalid("El aforo de arranque ya está contabilizado para esta entidad.", { legal_entity_id: count.legal_entity_id });
  }
  const owners = [...new Set(lines.map((line) => line.owner_entity_id))];
  if (owners.length === 0) return;
  const moves = await reader.read<{ id: string }>(`
    SELECT id FROM inventory.stock_move
    WHERE move_type = 'opening' AND owner_entity_id IN (${owners.map((id) => uuidSql(id)).join(", ")})
    LIMIT 1
  `);
  if (moves.length > 0) {
    invalid("El aforo de arranque ya está contabilizado para esta entidad.", { owner_entity_id: owners[0] ?? "" });
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function storedPlan(reader: Reader, countId: string): Promise<unknown | null> {
  const rows = await reader.read<{ after_data: unknown }>(`
    SELECT after_data
    FROM audit.audit_log
    WHERE table_name = 'inventory.inventory_count' AND row_id = ${lit(countId)} AND action = 'UPDATE'
    ORDER BY id DESC
  `);
  for (const row of rows) {
    const after = parseJson(row.after_data);
    if (after && typeof after === "object" && "adjustment_plan" in after) {
      return (after as { adjustment_plan: unknown }).adjustment_plan;
    }
  }
  return null;
}

function assertLineShape(input: LineInput, vessels: Map<string, VesselInfo>, products: Map<string, ProductInfo>): void {
  if (isBulk(input.product_state)) {
    if (!input.vessel_id || !input.lot_id) invalid("El granel exige recipiente y lote.", { product_state: input.product_state });
  }
  if (isPackaged(input.product_state)) {
    if (!input.product_id || !input.lot_id) invalid("El envasado exige producto y lote.", { product_state: input.product_state });
    if (input.vessel_id) invalid("El envasado no va en un recipiente.", { vessel_id: input.vessel_id });
    const nominal = input.product_id ? products.get(input.product_id)?.nominal : null;
    if (
      nominal != null
      && input.counted_qty_units !== null
      && input.counted_volume_ml !== null
      && input.counted_volume_ml !== input.counted_qty_units * nominal
    ) {
      throw new DomainError(
        "WC023",
        422,
        `WC023: volumen ${input.counted_volume_ml} mL incoherente con ${input.counted_qty_units} unidades del formato (${nominal} mL)`,
        { product_id: input.product_id ?? "" },
      );
    }
  }
  if (input.product_state === "goods" && !input.product_id) {
    invalid("La mercancía exige un producto.", { product_id: "Obligatorio" });
  }
  if (input.vessel_id) {
    const vessel = vessels.get(input.vessel_id);
    if (!vessel) invalid("El recipiente no existe.", { vessel_id: input.vessel_id });
    if (vessel.location_id !== input.location_id) {
      invalid("El recipiente no está en la ubicación de la línea.", { vessel_id: input.vessel_id, location_id: input.location_id });
    }
  }
}

function assertCapacity(lines: readonly CountLineRow[], vessels: Map<string, VesselInfo>): void {
  const totals = new Map<string, number>();
  const lots = new Map<string, Set<string>>();
  for (const line of lines) {
    if (!line.vessel_id || line.counted_volume_ml === null) continue;
    totals.set(line.vessel_id, (totals.get(line.vessel_id) ?? 0) + line.counted_volume_ml);
    if (line.counted_volume_ml > 0 && line.lot_id) {
      const set = lots.get(line.vessel_id) ?? new Set<string>();
      set.add(line.lot_id);
      lots.set(line.vessel_id, set);
    }
  }
  for (const [vesselId, volume] of totals) {
    const vessel = vessels.get(vesselId);
    if (!vessel) invalid("El recipiente no existe.", { vessel_id: vesselId });
    if (volume > vessel.capacity_ml) {
      throw new DomainError(
        "WC025",
        422,
        `WC025: el volumen contado supera la capacidad del recipiente (${volume} mL > ${vessel.capacity_ml} mL)`,
        { vessel_id: vesselId },
      );
    }
    if ((lots.get(vesselId)?.size ?? 0) > 1) {
      throw new DomainError("WC026", 422, "WC026: el recipiente contendría más de un lote.", { vessel_id: vesselId });
    }
  }
}

export async function createInventoryCount(writer: Writer, actor: Actor, body: unknown): Promise<InventoryCountView> {
  const input = objectOf(body, "El aforo no es válido.");
  const entityRaw = typeof input.legal_entity_id === "string" ? input.legal_entity_id : "";
  if (entityRaw.trim() === "") invalid("Falta la entidad del aforo.", { legal_entity_id: "Obligatorio" });
  const countedAt = typeof input.counted_at === "string" ? input.counted_at.trim() : "";
  if (!isInstant(countedAt)) {
    invalid("La fecha del aforo debe ser un instante con zona horaria.", { counted_at: countedAt || "vacío" });
  }
  const kind = kindOf(typeof input.kind === "string" ? input.kind : "");
  if (!Array.isArray(input.location_ids) || input.location_ids.length === 0) {
    invalid("Hay que indicar al menos una ubicación.", { location_ids: "Vacío" });
  }
  const locationIds = [...new Set(input.location_ids.map((value, index) => {
    if (typeof value !== "string" || !isUuid(value)) {
      invalid("Identificador de ubicación no válido.", { location_ids: String(index) });
    }
    return value.toLowerCase();
  }))];
  const notes = input.notes == null || input.notes === "" ? null : String(input.notes).trim();
  if (notes && notes.length > 2000) invalid("Las notas son demasiado largas.", { notes: "Máximo 2000 caracteres" });
  if (!isUuid(actor.id)) invalid("El actor no es un usuario.", { created_by: actor.id });
  const id = newId();
  const now = new Date().toISOString();
  await writer.withWrite(actor, async (tx) => {
    const entityId = await resolveEntity(tx, entityRaw, "legal_entity_id");
    const found = await idsIn(tx, "inventory.location", locationIds);
    if (found.size !== locationIds.length) invalid("Alguna ubicación no existe.", { location_ids: "No existe" });
    const number = await nextNumber(tx, entityId, seriesYear(kind, countedAt));
    const count: InventoryCountRow = {
      id,
      legal_entity_id: entityId,
      number,
      kind,
      counted_at: countedAt,
      location_ids: locationIds,
      status: "counting",
      approval_request_id: null,
      signed_by: null,
      signed_at: null,
      notes,
      created_by: actor.id,
      created_at: now,
    };
    const moves = await loadStockMoves(tx, `location_id IN (${locationIds.map((item) => uuidSql(item)).join(", ")})`);
    const balances = stockAt(moves, countedAt, STOCK_GROUP_KEYS);
    const lines: CountLineRow[] = [];
    for (const balance of balances) {
      if (!balance.location_id || !balance.owner_entity_id || !balance.product_state) continue;
      if (!locationIds.includes(balance.location_id) || !isCountState(balance.product_state)) continue;
      lines.push({
        id: newId(),
        count_id: id,
        location_id: balance.location_id,
        vessel_id: balance.vessel_id,
        owner_entity_id: balance.owner_entity_id,
        lot_id: balance.lot_id,
        product_id: balance.product_id,
        product_state: balance.product_state,
        expected_qty_units: balance.qty_units,
        expected_volume_ml: balance.volume_ml,
        counted_qty_units: null,
        counted_volume_ml: null,
        method: null,
        difference_reason: null,
        photo_attachment_id: null,
      });
    }
    tx.write(insertCountSql(count));
    tx.audit({ table: "inventory.inventory_count", rowId: id, action: "INSERT", before: null, after: countAudit(count) });
    for (const line of lines) {
      tx.write(insertLineSql(line));
      tx.audit({ table: "inventory.inventory_count_line", rowId: line.id, action: "INSERT", before: null, after: lineAudit(line) });
    }
  });
  return loadView(writer, id);
}

export async function putInventoryCountLines(writer: Writer, actor: Actor, countId: string, body: unknown): Promise<InventoryCountView> {
  const input = objectOf(body, "Las líneas de aforo no son válidas.");
  const rawLines = Array.isArray(input.lines) ? input.lines : Array.isArray(body) ? body : null;
  if (!rawLines) invalid("Faltan las líneas.", { lines: "Lista esperada" });
  if (rawLines.length > 500) invalid("Demasiadas líneas en una sola petición.", { lines: "Máximo 500" });
  const owners = new Map<string, string>();
  const parsed: LineInput[] = [];
  for (const raw of rawLines) parsed.push(await parseLine(writer, raw, owners));
  await writer.withWrite(actor, async (tx) => {
    const count = await readCount(tx, countId);
    requireCounting(count);
    const existing = await readLines(tx, countId);
    const vesselIds = [
      ...existing.flatMap((line) => (line.vessel_id ? [line.vessel_id] : [])),
      ...parsed.flatMap((line) => (line.vessel_id ? [line.vessel_id] : [])),
    ];
    const productIds = [
      ...parsed.flatMap((line) => (line.product_id ? [line.product_id] : [])),
    ];
    const lotIds = parsed.flatMap((line) => (line.lot_id ? [line.lot_id] : []));
    const [vessels, products, lots, locations] = await Promise.all([
      loadVessels(tx, vesselIds),
      loadProducts(tx, productIds),
      idsIn(tx, "inventory.lot", lotIds),
      idsIn(tx, "inventory.location", parsed.map((line) => line.location_id)),
    ]);
    const moves = await loadStockMoves(tx, `location_id IN (${count.location_ids.map((id) => uuidSql(id)).join(", ")})`);
    const working = existing.map((line) => ({ ...line }));
    for (const line of parsed) {
      if (!count.location_ids.includes(line.location_id)) {
        invalid("La ubicación no pertenece a este aforo.", { location_id: line.location_id });
      }
      if (!locations.has(line.location_id)) invalid("La ubicación no existe.", { location_id: line.location_id });
      if (line.lot_id && !lots.has(line.lot_id)) invalid("El lote no existe.", { lot_id: line.lot_id });
      if (line.product_id && !products.has(line.product_id)) invalid("El producto no existe.", { product_id: line.product_id });
      assertLineShape(line, vessels, products);
      const byId = line.id ? working.find((item) => item.id === line.id) : undefined;
      const byKey = working.find((item) => sameKey(item, line));
      if (byId && byKey && byId.id !== byKey.id) {
        invalid("La línea no coincide con la clave de existencias.", { id: line.id ?? "" });
      }
      const target = byId ?? byKey;
      if (byId && !sameKey(byId, line)) invalid("No se cambia la clave de una línea ya guardada.", { id: byId.id });
      const expected = target
        ? { qty_units: target.expected_qty_units, volume_ml: target.expected_volume_ml }
        : bookBalance(moves, count.counted_at, line);
      if (target) {
        target.counted_qty_units = line.counted_qty_units;
        target.counted_volume_ml = line.counted_volume_ml;
        target.method = line.method;
        target.difference_reason = line.difference_reason;
        target.photo_attachment_id = line.photo_attachment_id;
      } else {
        working.push({
          id: line.id ?? newId(),
          count_id: countId,
          location_id: line.location_id,
          vessel_id: line.vessel_id,
          owner_entity_id: line.owner_entity_id,
          lot_id: line.lot_id,
          product_id: line.product_id,
          product_state: line.product_state,
          expected_qty_units: expected.qty_units,
          expected_volume_ml: expected.volume_ml,
          counted_qty_units: line.counted_qty_units,
          counted_volume_ml: line.counted_volume_ml,
          method: line.method,
          difference_reason: line.difference_reason,
          photo_attachment_id: line.photo_attachment_id,
        });
      }
    }
    assertCapacity(working, vessels);
    const existingIds = new Set(existing.map((line) => line.id));
    for (const line of working) {
      const previous = existing.find((item) => item.id === line.id) ?? null;
      if (previous && JSON.stringify(previous) === JSON.stringify(line)) continue;
      if (existingIds.has(line.id)) {
        tx.write(updateLineSql(line));
        tx.audit({
          table: "inventory.inventory_count_line",
          rowId: line.id,
          action: "UPDATE",
          before: previous ? lineAudit(previous) : null,
          after: lineAudit(line),
        });
      } else {
        tx.write(insertLineSql(line));
        tx.audit({ table: "inventory.inventory_count_line", rowId: line.id, action: "INSERT", before: null, after: lineAudit(line) });
      }
    }
  });
  return loadView(writer, countId);
}

function differenceItems(lines: readonly CountLineRow[]) {
  return lines.map((line) => ({
    id: line.id,
    location_id: line.location_id,
    vessel_id: line.vessel_id,
    owner_entity_id: line.owner_entity_id,
    lot_id: line.lot_id,
    product_id: line.product_id,
    product_state: line.product_state,
    expected_qty_units: line.expected_qty_units,
    expected_volume_ml: line.expected_volume_ml,
    counted_qty_units: line.counted_qty_units,
    counted_volume_ml: line.counted_volume_ml,
    difference_qty_units: (line.counted_qty_units ?? 0) - line.expected_qty_units,
    difference_volume_ml: (line.counted_volume_ml ?? 0) - line.expected_volume_ml,
    difference_reason: line.difference_reason,
  }));
}

export async function closeInventoryCount(writer: Writer, actor: Actor, countId: string) {
  let payload: ReturnType<typeof differenceItems> = [];
  await writer.withWrite(actor, async (tx) => {
    const count = await readCount(tx, countId);
    requireCounting(count);
    const lines = await readLines(tx, countId);
    if (lines.length === 0) invalid("El aforo no tiene líneas.", { lines: "Vacío" });
    if (lines.some((line) => line.counted_qty_units === null || line.counted_volume_ml === null || line.method === null)) {
      invalid("Faltan líneas por contar.", { lines: "Todas las líneas deben tener cantidad y método" });
    }
    payload = differenceItems(lines);
    if (count.kind !== "opening") {
      const missing = payload.filter((line) =>
        (line.difference_qty_units !== 0 || line.difference_volume_ml !== 0)
        && (line.difference_reason === null || line.difference_reason.trim() === ""));
      if (missing.length > 0) {
        invalid("La diferencia de aforo exige un motivo.", {
          difference_reason: "Obligatorio cuando el contado no coincide con el libro",
        }, { line_ids: missing.map((line) => line.id) });
      }
    }
    await buildPlan(tx, count, lines, actor);
    const next = { ...count, status: "review" };
    tx.write(`UPDATE inventory.inventory_count SET status = 'review' WHERE id = ${uuidSql(countId)}`);
    tx.audit({
      table: "inventory.inventory_count",
      rowId: countId,
      action: "UPDATE",
      before: countAudit(count),
      after: countAudit(next),
    });
  });
  const count = await readCount(writer, countId);
  return {
    id: count.id,
    status: count.status,
    kind: count.kind,
    counted_at: count.counted_at,
    differences: { items: payload, next_cursor: null, total: payload.length },
  };
}

export async function submitInventoryCount(writer: Writer, actor: Actor, countId: string) {
  const existingPlan = await storedPlan(writer, countId);
  const current = await readCount(writer, countId);
  if (current.status === "posted") invalid("El aforo ya está contabilizado.", { status: current.status });
  if (current.status !== "review") {
    invalid("El aforo no admite esta acción en su estado actual.", { status: current.status });
  }
  if (existingPlan) {
    return {
      ...current,
      approval_status: "pending" as const,
      approval_kind: "inventory_adjustment" as const,
      adjustment_plan: existingPlan,
    };
  }
  let plan: AdjustmentPlan | null = null;
  const policies = await loadApprovalPolicies(writer);
  await writer.withWrite(actor, async (tx) => {
    const count = await readCount(tx, countId);
    if (count.status !== "review") {
      invalid("El aforo no admite esta acción en su estado actual.", { status: count.status });
    }
    const lines = await readLines(tx, countId);
    plan = await buildPlan(tx, count, lines, actor);
    const approval = await approvalServiceOn(tx, policies).requestApproval({
      kind: "inventory_adjustment",
      legalEntityId: count.legal_entity_id,
      subjectTable: "inventory.inventory_count",
      subjectId: countId,
      payload: plan,
      summary: `Contabilizar aforo ${count.number ?? countId}`,
      requestedBy: actor.id,
    });
    tx.write(`
      UPDATE inventory.inventory_count
      SET approval_request_id = ${uuidSql(approval.id)}
      WHERE id = ${uuidSql(countId)}
    `);
    tx.audit({
      table: "inventory.inventory_count",
      rowId: countId,
      action: "UPDATE",
      before: countAudit(count),
      after: countAudit(count, {
        approval_status: "pending",
        approval_kind: "inventory_adjustment",
        approval_request_id: approval.id,
        adjustment_plan: plan,
      }),
    });
  });
  if (!plan) invalid("No se ha podido calcular el plan de ajuste.");
  const count = await readCount(writer, countId);
  return {
    ...count,
    approval_status: "pending" as const,
    approval_kind: "inventory_adjustment" as const,
    adjustment_plan: plan,
  };
}

/**
 * Contabiliza un aforo en revisión. Recalcula el plan y exige que su hash
 * coincida con la aprobación `inventory_adjustment` (`WC040` si cambió).
 * Consume esa aprobación en la misma escritura que los movimientos.
 */
export async function postInventoryCount(
  writer: Writer,
  actor: Actor,
  countId: string,
): Promise<{ id: string; status: "posted"; physical_move_ids: string[]; fiscal_move_ids: string[] }> {
  if (!isUuid(actor.id)) invalid("El actor no es un usuario.", { created_by: actor.id });
  const policies = await loadApprovalPolicies(writer);
  return writer.withWrite(actor, async (tx) => {
    const count = await readCount(tx, countId);
    if (count.status === "posted") invalid("El aforo ya está contabilizado.", { status: "posted" });
    if (count.status !== "review") {
      invalid("El aforo no admite esta acción en su estado actual.", { status: count.status });
    }
    const saved = await storedPlan(tx, countId);
    if (!saved) invalid("Falta la solicitud de contabilización.", { approval_status: "pending" });
    const lines = await readLines(tx, countId);
    if (count.kind === "opening") await assertOpeningOnce(tx, count, lines);
    const plan = await buildPlan(tx, count, lines, actor);
    const approvalHash = await assertAdjustmentHash(tx, count, plan);
    const drafted = plannedMoves(plan);
    if (count.kind === "opening" && drafted.physical.length === 0 && drafted.fiscal.length === 0) {
      invalid("El aforo de arranque no tiene cantidades.", { lines: "Vacío" });
    }
    const now = new Date().toISOString();
    const physical = drafted.physical.map((move) => ({ ...move, id: newId(), created_by: actor.id }));
    const fiscal = drafted.fiscal.map((move) => ({ ...move, id: newId(), created_by: actor.id }));
    const locks = await loadLocks(tx);
    const physicalLocks = locks.filter((lock) => lock.ledger === "physical");
    const fiscalLocks = locks.filter((lock): lock is PeriodLock => lock.ledger === "fiscal");
    for (const move of physical) assertPeriodOpen(move.occurred_at, physicalLocks);
    for (const move of fiscal) assertPeriodOpen(move.fiscal_date, fiscalLocks);
    const stockBook = await loadStockMoves(tx, "TRUE");
    const fiscalBook = await loadFiscalMoves(tx, "TRUE");
    assertNoNewNegatives(stockBook, physical);
    assertNoNewNegatives(fiscalBook, fiscal);
    await assertVessels(tx, stockBook, physical);
    await approvalServiceOn(tx, policies).consume({
      requestId: approvalHash.requestId,
      payloadSha256: approvalHash.hash,
    });
    for (const move of physical) {
      tx.write(insertStockSql(move, now));
      tx.audit({ table: "inventory.stock_move", rowId: move.id ?? null, action: "INSERT", before: null, after: move });
    }
    for (const move of fiscal) {
      tx.write(insertFiscalSql(move, now));
      tx.audit({ table: "inventory.fiscal_move", rowId: move.id ?? null, action: "INSERT", before: null, after: move });
    }
    const posted = { ...count, status: "posted", signed_by: actor.id, signed_at: now };
    tx.write(`
      UPDATE inventory.inventory_count
      SET status = 'posted', signed_by = ${uuidSql(actor.id)}, signed_at = ${instantSql(now)}
      WHERE id = ${uuidSql(countId)}
    `);
    tx.audit({
      table: "inventory.inventory_count",
      rowId: countId,
      action: "UPDATE",
      before: countAudit(count),
      after: countAudit(posted),
    });
    return {
      id: countId,
      status: "posted" as const,
      physical_move_ids: physical.flatMap((move) => (move.id ? [move.id] : [])),
      fiscal_move_ids: fiscal.flatMap((move) => (move.id ? [move.id] : [])),
    };
  });
}
