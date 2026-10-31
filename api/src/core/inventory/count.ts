import { fiscalBalanceAt, stockAt } from "./balances";
import { isBusinessDate, isInstant } from "./periods";
import {
  DomainError,
  FISCAL_LEDGER_KEYS,
  STOCK_GROUP_KEYS,
  isFiscalMove,
  isStockMove,
  type AdjustmentDraft,
  type Balance,
  type CountLine,
  type CountPlanContext,
  type CountProductState,
  type FiscalBalance,
  type FiscalMove,
  type OpeningCountContext,
  type OpeningCountPlan,
  type ProductClass,
  type StockMove,
} from "./types";

const SOURCE_TABLE = "inventory.inventory_count";
const KEY_SEP = "\u001f";

const COUNT_STATES: readonly CountProductState[] = [
  "must",
  "wine",
  "packaged_unlabeled",
  "packaged_labeled",
  "goods",
];

interface Quantities {
  qty: number;
  volume: number;
  mass: number;
}

interface PhysicalBucket {
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: CountProductState;
  qty: number;
  volume: number;
  mass: number;
  lineIds: string[];
  reasons: Set<string>;
  missingReason: boolean;
  nominal: number | null;
}

interface FiscalBucket {
  tax_warehouse_id: string;
  product_class: ProductClass;
  excise_product_key: string | null;
  volume: number;
  units: number;
  productIds: Set<string | null>;
  lotIds: Set<string | null>;
  abvs: Set<string | null>;
  ncs: Set<string | null>;
  lineIds: string[];
  reasons: Set<string>;
  missingReason: boolean;
}

function fail(message: string, details?: unknown): never {
  throw new DomainError("WC_VALIDATION", message, 422, details);
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) fail(message);
  return trimmed;
}

function assertInteger(value: number, message: string): void {
  if (!Number.isSafeInteger(value)) fail(message, { value });
}

function subtract(left: number, right: number, message: string): number {
  const value = left - right;
  if (!Number.isSafeInteger(value)) fail(message);
  return value;
}

function cmp(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function cmpNull(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left < right ? -1 : 1;
}

function physicalKey(parts: {
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: string;
}): string {
  return [
    parts.location_id,
    parts.vessel_id ?? "",
    parts.owner_entity_id,
    parts.lot_id ?? "",
    parts.product_id ?? "",
    parts.product_state,
  ].join(KEY_SEP);
}

function balanceKey(row: Balance): string {
  return [
    row.location_id ?? "",
    row.vessel_id ?? "",
    row.owner_entity_id ?? "",
    row.lot_id ?? "",
    row.product_id ?? "",
    row.product_state ?? "",
  ].join(KEY_SEP);
}

function fiscalKey(warehouse: string, productClass: string, excise: string | null): string {
  return [warehouse, productClass, excise ?? ""].join(KEY_SEP);
}

function fiscalBalanceKey(row: FiscalBalance): string {
  return [row.tax_warehouse_id ?? "", row.product_class ?? "", row.excise_product_key ?? ""].join(KEY_SEP);
}

function isCountState(value: string): value is CountProductState {
  return (COUNT_STATES as readonly string[]).includes(value);
}

function isPackaged(state: CountProductState): boolean {
  return state === "packaged_unlabeled" || state === "packaged_labeled";
}

function isBulk(state: CountProductState): boolean {
  return state === "must" || state === "wine";
}

function reasonOf(line: CountLine): string | null {
  if (line.difference_reason === null) return null;
  const trimmed = line.difference_reason.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function joinReasons(reasons: Set<string>, missingReason: boolean): string {
  if (missingReason || reasons.size === 0) {
    fail("La diferencia de aforo exige un motivo.");
  }
  return [...reasons].sort().join("; ");
}

function nominalOf(line: CountLine): number | null {
  if (line.nominal_volume_ml === undefined || line.nominal_volume_ml === null) return null;
  assertInteger(line.nominal_volume_ml, "El volumen nominal debe ser un entero de mililitros.");
  if (line.nominal_volume_ml < 0) fail("El volumen nominal no puede ser negativo.");
  return line.nominal_volume_ml;
}

function countedMass(line: CountLine): number {
  const mass = line.counted_mass_g ?? 0;
  assertInteger(mass, "La masa contada debe ser un entero de gramos.");
  if (mass < 0) fail("El recuento no puede ser negativo.");
  return mass;
}

/** A line still being counted (a quantity is null) does not generate moves. */
function countedQuantities(line: CountLine): Quantities | null {
  if (line.counted_qty_units === null || line.counted_volume_ml === null) return null;
  assertInteger(line.counted_qty_units, "Las unidades contadas deben ser un entero.");
  assertInteger(line.counted_volume_ml, "El volumen contado debe ser un entero de mililitros.");
  if (line.counted_qty_units < 0 || line.counted_volume_ml < 0) {
    fail("El recuento no puede ser negativo.");
  }
  return { qty: line.counted_qty_units, volume: line.counted_volume_ml, mass: countedMass(line) };
}

function optionalId(value: string | null, message: string): string | null {
  if (value === null) return null;
  return requireText(value, message);
}

function parseAbv(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const text = value.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) fail("El grado alcohólico no es válido.");
  const numeric = Number(text);
  if (numeric < 0 || numeric > 25) fail("El grado alcohólico debe estar entre 0 y 25.");
  return text;
}

function parseNc(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const text = value.trim();
  if (!/^[0-9]{8}$/.test(text)) fail("El código NC debe tener 8 dígitos.");
  return text;
}

function parseExcise(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  if (text.length === 0) fail("La clave de producto de SILICIE está vacía.");
  return text;
}

function parseClass(value: ProductClass | null | undefined, required: boolean): ProductClass | null {
  if (value === undefined || value === null) {
    if (required) fail("Falta la clase de producto fiscal del perímetro.");
    return null;
  }
  if (value !== "bulk" && value !== "bulk_wood" && value !== "packaged") {
    fail("La clase de producto fiscal no es válida.");
  }
  return value;
}

function perimeterWarehouse(line: CountLine): string | null {
  if (line.tax_warehouse_id === undefined || line.tax_warehouse_id === null) return null;
  return requireText(line.tax_warehouse_id, "El establecimiento fiscal está vacío.");
}

function assertLine(line: CountLine): void {
  requireText(line.id, "Falta el identificador de la línea de aforo.");
  requireText(line.location_id, "Falta la ubicación de la línea de aforo.");
  requireText(line.owner_entity_id, "Falta el propietario de la línea de aforo.");
  if (!isCountState(line.product_state)) fail("El estado de producto del aforo no es válido.");
  optionalId(line.vessel_id, "El recipiente de la línea de aforo está vacío.");
  optionalId(line.lot_id, "El lote de la línea de aforo está vacío.");
  optionalId(line.product_id, "El producto de la línea de aforo está vacío.");
}

function assertCountContext(ctx: CountPlanContext): void {
  requireText(ctx.count_id, "Falta el identificador del aforo.");
  requireText(ctx.count_number, "Falta el número del aforo.");
  requireText(ctx.created_by, "Falta quien contabiliza el aforo.");
  if (!isInstant(ctx.counted_at)) fail("La fecha del aforo debe ser un instante con zona horaria.");
  if (!isBusinessDate(ctx.fiscal_date)) fail("La fecha fiscal del aforo debe ser un día (YYYY-MM-DD).");
  if (ctx.ledger !== "physical" && ctx.ledger !== "fiscal") fail("El libro del aforo no es válido.");
}

function assertOpeningContext(ctx: OpeningCountContext): void {
  requireText(ctx.count_id, "Falta el identificador del aforo.");
  requireText(ctx.count_number, "Falta el número del aforo.");
  requireText(ctx.created_by, "Falta quien contabiliza el aforo.");
  if (!isInstant(ctx.as_of)) fail("La fecha de apertura debe ser un instante con zona horaria.");
  if (!isBusinessDate(ctx.fiscal_date)) fail("La fecha fiscal de apertura debe ser un día (YYYY-MM-DD).");
  if (ctx.physical_date !== undefined && ctx.physical_date !== null && !isBusinessDate(ctx.physical_date)) {
    fail("La fecha física del aforo de arranque no es válida.");
  }
}

function asPhysicalBook(book: readonly (StockMove | FiscalMove)[]): readonly StockMove[] {
  for (const move of book) {
    if (!isStockMove(move)) fail("El libro físico no admite movimientos fiscales.");
  }
  return book as readonly StockMove[];
}

function asFiscalBook(book: readonly (StockMove | FiscalMove)[]): readonly FiscalMove[] {
  for (const move of book) {
    if (!isFiscalMove(move)) fail("El libro fiscal no admite movimientos físicos.");
  }
  return book as readonly FiscalMove[];
}

function sourceLineId(lineIds: readonly string[]): string | null {
  if (lineIds.length !== 1) return null;
  return lineIds[0] ?? null;
}

function rememberNominal(current: number | null, incoming: number | null, started: boolean): number | null {
  if (!started) return incoming;
  if (current !== incoming) fail("El volumen nominal del formato no coincide en el mismo saldo.");
  return current;
}

function addReason(bucket: { reasons: Set<string>; missingReason: boolean }, line: CountLine): void {
  const reason = reasonOf(line);
  if (reason === null) bucket.missingReason = true;
  else bucket.reasons.add(reason);
}

function collectPhysical(counted: readonly CountLine[]): PhysicalBucket[] {
  const buckets = new Map<string, PhysicalBucket>();
  for (const line of counted) {
    assertLine(line);
    const quantities = countedQuantities(line);
    if (quantities === null) continue;
    const nominal = nominalOf(line);
    const key = physicalKey(line);
    const existing = buckets.get(key);
    if (!existing) {
      const created: PhysicalBucket = {
        location_id: line.location_id,
        vessel_id: line.vessel_id,
        owner_entity_id: line.owner_entity_id,
        lot_id: line.lot_id,
        product_id: line.product_id,
        product_state: line.product_state,
        qty: quantities.qty,
        volume: quantities.volume,
        mass: quantities.mass,
        lineIds: [line.id],
        reasons: new Set(),
        missingReason: false,
        nominal,
      };
      addReason(created, line);
      buckets.set(key, created);
      continue;
    }
    existing.qty += quantities.qty;
    existing.volume += quantities.volume;
    existing.mass += quantities.mass;
    existing.lineIds.push(line.id);
    existing.nominal = rememberNominal(existing.nominal, nominal, true);
    addReason(existing, line);
  }
  return [...buckets.values()].sort(
    (left, right) =>
      cmp(left.owner_entity_id, right.owner_entity_id) ||
      cmp(left.location_id, right.location_id) ||
      cmpNull(left.vessel_id, right.vessel_id) ||
      cmpNull(left.lot_id, right.lot_id) ||
      cmpNull(left.product_id, right.product_id) ||
      cmp(left.product_state, right.product_state),
  );
}

function collectFiscal(counted: readonly CountLine[]): FiscalBucket[] {
  const buckets = new Map<string, FiscalBucket>();
  for (const line of counted) {
    assertLine(line);
    const quantities = countedQuantities(line);
    if (quantities === null) continue;
    const warehouse = perimeterWarehouse(line);
    if (warehouse === null) continue;
    const zero = quantities.qty === 0 && quantities.volume === 0;
    if (zero && (line.product_class === undefined || line.product_class === null)) continue;
    const productClass = parseClass(line.product_class, true);
    if (productClass === null) fail("Falta la clase de producto fiscal del perímetro.");
    const excise = parseExcise(line.excise_product_key);
    const abv = parseAbv(line.abv_pct);
    const nc = parseNc(line.nc_code);
    const key = fiscalKey(warehouse, productClass, excise);
    const existing = buckets.get(key);
    if (!existing) {
      const created: FiscalBucket = {
        tax_warehouse_id: warehouse,
        product_class: productClass,
        excise_product_key: excise,
        volume: quantities.volume,
        units: quantities.qty,
        productIds: new Set([line.product_id]),
        lotIds: new Set([line.lot_id]),
        abvs: new Set([abv]),
        ncs: new Set([nc]),
        lineIds: [line.id],
        reasons: new Set(),
        missingReason: false,
      };
      addReason(created, line);
      buckets.set(key, created);
      continue;
    }
    existing.volume += quantities.volume;
    existing.units += quantities.qty;
    existing.productIds.add(line.product_id);
    existing.lotIds.add(line.lot_id);
    existing.abvs.add(abv);
    existing.ncs.add(nc);
    existing.lineIds.push(line.id);
    addReason(existing, line);
  }
  return [...buckets.values()].sort(
    (left, right) =>
      cmp(left.tax_warehouse_id, right.tax_warehouse_id) ||
      cmp(left.product_class, right.product_class) ||
      cmpNull(left.excise_product_key, right.excise_product_key),
  );
}

function sole(values: Set<string | null>): string | null | undefined {
  if (values.size !== 1) return undefined;
  const value = values.values().next().value;
  return value ?? null;
}

function classifyIds(bucket: FiscalBucket): { product_id: string | null; lot_id: string | null } {
  const product = sole(bucket.productIds);
  const lot = sole(bucket.lotIds);
  if (bucket.product_class === "packaged") {
    if (product === undefined || product === null) {
      fail("El envasado fiscal exige un único producto.");
    }
    return { product_id: product, lot_id: lot ?? null };
  }
  return {
    product_id: product === undefined ? null : product,
    lot_id: lot === undefined ? null : lot,
  };
}

function classifyText(values: Set<string | null>): string | null {
  const value = sole(values);
  if (value === undefined) return null;
  return value;
}

function assertPiece(
  state: CountProductState,
  vesselId: string | null,
  lotId: string | null,
  productId: string | null,
  qty: number,
  volume: number,
  mass: number,
  nominal: number | null,
): void {
  if (qty === 0 && volume === 0 && mass === 0) fail("El ajuste no puede ser cero.");
  if (isBulk(state)) {
    if (vesselId === null || lotId === null) fail("El granel exige recipiente y lote.");
    if (qty !== 0) fail("El granel (mosto o vino) no lleva unidades.");
  }
  if (isPackaged(state)) {
    if (productId === null || lotId === null) fail("El envasado exige producto y lote.");
    if (vesselId !== null) fail("El envasado no va en un recipiente.");
    if (qty === 0) fail("El envasado no puede regularizarse sin unidades.");
    if (nominal !== null) {
      const expected = qty * nominal;
      if (!Number.isSafeInteger(expected) || volume !== expected) {
        throw new DomainError(
          "WC023",
          `WC023: volumen ${volume} mL incoherente con ${qty} unidades del formato (${nominal} mL)`,
          422,
        );
      }
    }
  }
  if (state === "goods") {
    if (productId === null) fail("La mercancía exige un producto.");
    if (qty === 0) fail("La mercancía no puede regularizarse sin unidades.");
  }
}

function physicalMove(
  ctx: { count_id: string; created_by: string; occurred_at: string },
  bucket: PhysicalBucket,
  moveType: StockMove["move_type"],
  qty: number,
  volume: number,
  mass: number,
): StockMove {
  return {
    occurred_at: ctx.occurred_at,
    move_type: moveType,
    location_id: bucket.location_id,
    vessel_id: bucket.vessel_id,
    owner_entity_id: bucket.owner_entity_id,
    lot_id: bucket.lot_id,
    product_id: bucket.product_id,
    product_state: bucket.product_state,
    qty_units: qty,
    volume_ml: volume,
    mass_g: mass,
    loss_kind: null,
    source_table: SOURCE_TABLE,
    source_id: ctx.count_id,
    source_line_id: sourceLineId(bucket.lineIds),
    reverses_move_id: null,
    created_by: ctx.created_by,
  };
}

function assertFiscalShape(bucket: FiscalBucket, volume: number, units: number): {
  product_id: string | null;
  lot_id: string | null;
} {
  if (volume === 0) fail("La regularización fiscal no puede cambiar las unidades sin un volumen del mismo signo.");
  if ((volume > 0 && units < 0) || (volume < 0 && units > 0)) {
    fail("La regularización fiscal no puede cambiar las unidades sin un volumen del mismo signo.");
  }
  const ids = classifyIds(bucket);
  if (bucket.product_class === "packaged" && units === 0) {
    fail("El envasado fiscal no puede regularizarse sin unidades.");
  }
  return ids;
}

function fiscalMove(
  ctx: { count_id: string; count_number: string; fiscal_date: string; created_by: string; physical_date: string | null },
  bucket: FiscalBucket,
  moveType: FiscalMove["move_type"],
  volume: number,
  units: number,
  reason: string | null,
): FiscalMove {
  const ids = assertFiscalShape(bucket, volume, units);
  return {
    tax_warehouse_id: bucket.tax_warehouse_id,
    fiscal_date: ctx.fiscal_date,
    physical_date: ctx.physical_date,
    move_type: moveType,
    product_class: bucket.product_class,
    lot_id: ids.lot_id,
    product_id: ids.product_id,
    volume_ml: volume,
    units,
    abv_pct: classifyText(bucket.abvs),
    excise_product_key: bucket.excise_product_key,
    nc_code: classifyText(bucket.ncs),
    justification_type: "count_record",
    justification_ref: ctx.count_number,
    counterparty_contact_id: null,
    counterparty_excise_number: null,
    fiscal_trigger: "count",
    source_table: SOURCE_TABLE,
    source_id: ctx.count_id,
    source_line_id: sourceLineId(bucket.lineIds),
    silicie_entry_id: null,
    reverses_move_id: null,
    reason,
    created_by: ctx.created_by,
  };
}

function splitDelta(delta: Quantities): Array<{ direction: "in" | "out" } & Quantities> {
  const inbound = {
    direction: "in" as const,
    qty: Math.max(0, delta.qty),
    volume: Math.max(0, delta.volume),
    mass: Math.max(0, delta.mass),
  };
  const outbound = {
    direction: "out" as const,
    qty: Math.min(0, delta.qty),
    volume: Math.min(0, delta.volume),
    mass: Math.min(0, delta.mass),
  };
  const parts: Array<{ direction: "in" | "out" } & Quantities> = [];
  if (inbound.qty !== 0 || inbound.volume !== 0 || inbound.mass !== 0) parts.push(inbound);
  if (outbound.qty !== 0 || outbound.volume !== 0 || outbound.mass !== 0) parts.push(outbound);
  return parts;
}

function bookMap(rows: readonly Balance[]): Map<string, Balance> {
  const map = new Map<string, Balance>();
  for (const row of rows) map.set(balanceKey(row), row);
  return map;
}

function planPhysical(book: readonly StockMove[], counted: readonly CountLine[], ctx: CountPlanContext): AdjustmentDraft[] {
  const balances = bookMap(stockAt(book, ctx.counted_at, STOCK_GROUP_KEYS));
  const drafts: AdjustmentDraft[] = [];
  for (const bucket of collectPhysical(counted)) {
    const current = balances.get(physicalKey(bucket));
    const delta: Quantities = {
      qty: subtract(bucket.qty, current?.qty_units ?? 0, "La diferencia de unidades no es entera."),
      volume: subtract(bucket.volume, current?.volume_ml ?? 0, "La diferencia de volumen no es entera."),
      mass: subtract(bucket.mass, current?.mass_g ?? 0, "La diferencia de masa no es entera."),
    };
    if (delta.qty === 0 && delta.volume === 0 && delta.mass === 0) continue;
    const reason = joinReasons(bucket.reasons, bucket.missingReason);
    const posted = { count_id: ctx.count_id, created_by: ctx.created_by, occurred_at: ctx.counted_at };
    for (const part of splitDelta(delta)) {
      assertPiece(
        bucket.product_state,
        bucket.vessel_id,
        bucket.lot_id,
        bucket.product_id,
        part.qty,
        part.volume,
        part.mass,
        bucket.nominal,
      );
      const moveType = part.direction === "in" ? "count_adjust_in" : "count_adjust_out";
      drafts.push({
        approval_required: true,
        approval_kind: "inventory_adjustment",
        reason,
        move: physicalMove(posted, bucket, moveType, part.qty, part.volume, part.mass),
      });
    }
  }
  return drafts;
}

function planFiscal(book: readonly FiscalMove[], counted: readonly CountLine[], ctx: CountPlanContext): AdjustmentDraft[] {
  const balances = new Map<string, FiscalBalance>();
  for (const row of fiscalBalanceAt(book, ctx.fiscal_date, FISCAL_LEDGER_KEYS)) {
    balances.set(fiscalBalanceKey(row), row);
  }
  const drafts: AdjustmentDraft[] = [];
  const posted = {
    count_id: ctx.count_id,
    count_number: ctx.count_number,
    fiscal_date: ctx.fiscal_date,
    created_by: ctx.created_by,
    physical_date: null,
  };
  for (const bucket of collectFiscal(counted)) {
    const current = balances.get(fiscalKey(bucket.tax_warehouse_id, bucket.product_class, bucket.excise_product_key));
    const volume = subtract(bucket.volume, current?.volume_ml ?? 0, "La diferencia de volumen fiscal no es entera.");
    const units = subtract(bucket.units, current?.units ?? 0, "La diferencia de unidades fiscales no es entera.");
    if (volume === 0 && units === 0) continue;
    const reason = joinReasons(bucket.reasons, bucket.missingReason);
    const moveType = volume > 0 ? "regularization_in" : "regularization_out";
    drafts.push({
      approval_required: true,
      approval_kind: "inventory_adjustment",
      reason,
      move: fiscalMove(posted, bucket, moveType, volume, units, reason),
    });
  }
  return drafts;
}

/**
 * Drafts that make the book equal the counted quantities for every completed
 * line. Physical drafts use `count_adjust_in` / `count_adjust_out`. Fiscal
 * drafts use `regularization_in` / `regularization_out` and only lines inside
 * the fiscal perimeter. Equal positions produce no draft. Posting still needs
 * approval `inventory_adjustment`.
 */
export function planCountAdjustments(
  book: readonly StockMove[] | readonly FiscalMove[],
  counted: readonly CountLine[],
  ctx: CountPlanContext,
): AdjustmentDraft[] {
  assertCountContext(ctx);
  if (ctx.ledger === "physical") return planPhysical(asPhysicalBook(book), counted, ctx);
  return planFiscal(asFiscalBook(book), counted, ctx);
}

function openingPhysical(ctx: OpeningCountContext, bucket: PhysicalBucket): StockMove | null {
  if (bucket.qty === 0 && bucket.volume === 0 && bucket.mass === 0) return null;
  assertPiece(
    bucket.product_state,
    bucket.vessel_id,
    bucket.lot_id,
    bucket.product_id,
    bucket.qty,
    bucket.volume,
    bucket.mass,
    bucket.nominal,
  );
  return physicalMove(
    { count_id: ctx.count_id, created_by: ctx.created_by, occurred_at: ctx.as_of },
    bucket,
    "opening",
    bucket.qty,
    bucket.volume,
    bucket.mass,
  );
}

function openingFiscal(ctx: OpeningCountContext, bucket: FiscalBucket): FiscalMove | null {
  if (bucket.volume === 0 && bucket.units === 0) return null;
  if (bucket.volume <= 0) {
    fail("La apertura fiscal exige un volumen positivo en mililitros.");
  }
  return fiscalMove(
    {
      count_id: ctx.count_id,
      count_number: ctx.count_number,
      fiscal_date: ctx.fiscal_date,
      created_by: ctx.created_by,
      physical_date: ctx.physical_date ?? null,
    },
    bucket,
    "opening",
    bucket.volume,
    bucket.units,
    null,
  );
}

/**
 * Opening moves for a signed start-up count. Physical: one `opening` per stock
 * key, so each owner keeps its own balance. Fiscal: one `opening` per fiscal
 * ledger key, and only for locations inside the factory perimeter. Does not
 * net against an existing book.
 */
export function planOpeningCount(counted: readonly CountLine[], ctx: OpeningCountContext): OpeningCountPlan {
  assertOpeningContext(ctx);
  const physical: StockMove[] = [];
  for (const bucket of collectPhysical(counted)) {
    const move = openingPhysical(ctx, bucket);
    if (move) physical.push(move);
  }
  const fiscal: FiscalMove[] = [];
  for (const bucket of collectFiscal(counted)) {
    const move = openingFiscal(ctx, bucket);
    if (move) fiscal.push(move);
  }
  return {
    approval_required: true,
    approval_kind: "inventory_adjustment",
    physical,
    fiscal,
  };
}
