import { DomainError } from "../errors";
import { instantMs, isBusinessDate, isInstant, resolveBusinessDate } from "./periods";
import {
  isFiscalMove,
  isStockMove,
  type Balance,
  type FiscalBalance,
  type FiscalLedgerKey,
  type FiscalMove,
  type NegativeBalance,
  type StockGroupKey,
  type StockMove,
} from "./types";

function invalid(message: string, fields?: Record<string, string>): never {
  throw new DomainError("WC_VALIDATION", 422, message, fields);
}

const KEY_SEP = "\u001f";

interface RunningPhysical {
  qty_units: number;
  volume_ml: number;
  mass_g: number;
}

interface RunningFiscal {
  volume_ml: number;
  units: number;
}

function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    invalid(`${label} debe ser un entero.`, { value: String(value) });
  }
}

function addInt(left: number, right: number, label: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    invalid(`${label} se sale del rango de enteros seguros.`);
  }
  return sum;
}

function cmpNullable(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left < right ? -1 : 1;
}

/** Null is distinct from an empty string so fiscal keys do not collapse. */
function encodePart(value: string | null): string {
  return value === null ? "\u0000" : `\u0001${value}`;
}

/** True when the physical move is included in a balance taken at `at`. */
export function moveOnOrBefore(occurredAt: string, at: string): boolean {
  if (isBusinessDate(at)) return resolveBusinessDate(occurredAt) <= at;
  if (!isInstant(at)) {
    invalid("La fecha de existencias debe ser un día o un instante con zona horaria.", { value: at });
  }
  return instantMs(occurredAt) <= instantMs(at);
}

function fiscalOnOrBefore(fiscalDate: string, at: string): boolean {
  if (!isBusinessDate(fiscalDate)) {
    invalid("La fecha fiscal debe ser un día (YYYY-MM-DD).", { value: fiscalDate });
  }
  return fiscalDate <= resolveBusinessDate(at);
}

function stockField(move: StockMove, key: StockGroupKey): string | null {
  switch (key) {
    case "location":
      return move.location_id;
    case "vessel":
      return move.vessel_id;
    case "owner_entity":
      return move.owner_entity_id;
    case "lot":
      return move.lot_id;
    case "product_state":
      return move.product_state;
    case "product":
      return move.product_id;
  }
}

function fiscalField(move: FiscalMove, key: FiscalLedgerKey): string | null {
  switch (key) {
    case "tax_warehouse":
      return move.tax_warehouse_id;
    case "product_class":
      return move.product_class;
    case "excise_product_key":
      return move.excise_product_key;
  }
}

function applyStockDimensions(balance: Balance, move: StockMove, keys: readonly StockGroupKey[]): void {
  for (const key of keys) {
    switch (key) {
      case "location":
        balance.location_id = move.location_id;
        break;
      case "vessel":
        balance.vessel_id = move.vessel_id;
        break;
      case "owner_entity":
        balance.owner_entity_id = move.owner_entity_id;
        break;
      case "lot":
        balance.lot_id = move.lot_id;
        break;
      case "product_state":
        balance.product_state = move.product_state;
        break;
      case "product":
        balance.product_id = move.product_id;
        break;
    }
  }
}

function physicalIdentity(move: StockMove): string {
  return [
    move.location_id,
    encodePart(move.vessel_id),
    move.owner_entity_id,
    encodePart(move.lot_id),
    encodePart(move.product_id),
    move.product_state,
  ].join(KEY_SEP);
}

function fiscalIdentity(move: FiscalMove): string {
  return [move.tax_warehouse_id, move.product_class, encodePart(move.excise_product_key)].join(KEY_SEP);
}

function validateStockMove(move: StockMove, index: number): void {
  if (!isInstant(move.occurred_at)) {
    invalid("La fecha del movimiento físico no es un instante válido.", { index: String(index) });
  }
  assertInteger(move.qty_units, "Las unidades");
  assertInteger(move.volume_ml, "El volumen");
  assertInteger(move.mass_g, "La masa");
}

function validateFiscalMove(move: FiscalMove, index: number): void {
  if (!isBusinessDate(move.fiscal_date)) {
    invalid("La fecha fiscal del movimiento no es válida.", { index: String(index) });
  }
  assertInteger(move.volume_ml, "El volumen fiscal");
  assertInteger(move.units, "Las unidades fiscales");
}

function blankBalance(): Balance {
  return {
    location_id: null,
    vessel_id: null,
    owner_entity_id: null,
    lot_id: null,
    product_id: null,
    product_state: null,
    qty_units: 0,
    volume_ml: 0,
    mass_g: 0,
  };
}

function blankFiscal(): FiscalBalance {
  return {
    tax_warehouse_id: null,
    product_class: null,
    excise_product_key: null,
    volume_ml: 0,
    units: 0,
  };
}

function compareBalances(left: Balance, right: Balance): number {
  return (
    cmpNullable(left.location_id, right.location_id) ||
    cmpNullable(left.vessel_id, right.vessel_id) ||
    cmpNullable(left.owner_entity_id, right.owner_entity_id) ||
    cmpNullable(left.lot_id, right.lot_id) ||
    cmpNullable(left.product_state, right.product_state) ||
    cmpNullable(left.product_id, right.product_id)
  );
}

function compareFiscal(left: FiscalBalance, right: FiscalBalance): number {
  return (
    cmpNullable(left.tax_warehouse_id, right.tax_warehouse_id) ||
    cmpNullable(left.product_class, right.product_class) ||
    cmpNullable(left.excise_product_key, right.excise_product_key)
  );
}

/**
 * Physical balances at `at`, summed per the chosen keys.
 * Signs are taken from the stored quantities (outflows are already negative);
 * `move_type` does not flip them. A date-only `at` includes the whole Madrid
 * civil day. An instant includes moves with `occurred_at <= at`.
 * Rows that net to zero in units, millilitres and grams are omitted.
 */
export function stockAt(moves: readonly StockMove[], at: string, groupBy: readonly StockGroupKey[]): Balance[] {
  const keys = uniqueStockKeys(groupBy);
  const groups = new Map<string, Balance>();
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (move === undefined) continue;
    validateStockMove(move, index);
    if (!moveOnOrBefore(move.occurred_at, at)) continue;
    const groupKey = keys.map((key) => encodePart(stockField(move, key))).join(KEY_SEP);
    const current = groups.get(groupKey) ?? blankBalance();
    if (!groups.has(groupKey)) applyStockDimensions(current, move, keys);
    current.qty_units = addInt(current.qty_units, move.qty_units, "Las unidades");
    current.volume_ml = addInt(current.volume_ml, move.volume_ml, "El volumen");
    current.mass_g = addInt(current.mass_g, move.mass_g, "La masa");
    groups.set(groupKey, current);
  }
  const rows: Balance[] = [];
  for (const row of groups.values()) {
    if (row.qty_units === 0 && row.volume_ml === 0 && row.mass_g === 0) continue;
    rows.push(row);
  }
  rows.sort(compareBalances);
  return rows;
}

function uniqueStockKeys(groupBy: readonly StockGroupKey[]): StockGroupKey[] {
  const seen = new Set<StockGroupKey>();
  const keys: StockGroupKey[] = [];
  for (const key of groupBy) {
    if (!isStockGroupKey(key)) {
      invalid("La agrupación de existencias no es válida.", { key });
    }
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function isStockGroupKey(value: string): value is StockGroupKey {
  return (
    value === "location" ||
    value === "vessel" ||
    value === "owner_entity" ||
    value === "lot" ||
    value === "product_state" ||
    value === "product"
  );
}

function uniqueFiscalKeys(ledgerKey: readonly FiscalLedgerKey[]): FiscalLedgerKey[] {
  const seen = new Set<FiscalLedgerKey>();
  const keys: FiscalLedgerKey[] = [];
  for (const key of ledgerKey) {
    if (key !== "tax_warehouse" && key !== "product_class" && key !== "excise_product_key") {
      invalid("La clave del libro fiscal no es válida.", { key });
    }
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/**
 * Fiscal balances at `at`, summed per the chosen ledger key.
 * `at` as a date compares `fiscal_date` directly. `at` as an instant uses the
 * Madrid business date of that instant as the cutoff (the whole fiscal day
 * counts once that date is reached). Zero rows are omitted.
 */
export function fiscalBalanceAt(
  fiscalMoves: readonly FiscalMove[],
  at: string,
  ledgerKey: readonly FiscalLedgerKey[],
): FiscalBalance[] {
  const keys = uniqueFiscalKeys(ledgerKey);
  const groups = new Map<string, FiscalBalance>();
  for (let index = 0; index < fiscalMoves.length; index += 1) {
    const move = fiscalMoves[index];
    if (move === undefined) continue;
    validateFiscalMove(move, index);
    if (!fiscalOnOrBefore(move.fiscal_date, at)) continue;
    const groupKey = keys.map((key) => encodePart(fiscalField(move, key))).join(KEY_SEP);
    const current = groups.get(groupKey) ?? blankFiscal();
    if (!groups.has(groupKey)) {
      for (const key of keys) {
        if (key === "tax_warehouse") current.tax_warehouse_id = move.tax_warehouse_id;
        if (key === "product_class") current.product_class = move.product_class;
        if (key === "excise_product_key") current.excise_product_key = move.excise_product_key;
      }
    }
    current.volume_ml = addInt(current.volume_ml, move.volume_ml, "El volumen fiscal");
    current.units = addInt(current.units, move.units, "Las unidades fiscales");
    groups.set(groupKey, current);
  }
  const rows: FiscalBalance[] = [];
  for (const row of groups.values()) {
    if (row.volume_ml === 0 && row.units === 0) continue;
    rows.push(row);
  }
  rows.sort(compareFiscal);
  return rows;
}

function nullPhysicalFinding(): Pick<
  NegativeBalance,
  | "location_id"
  | "vessel_id"
  | "owner_entity_id"
  | "lot_id"
  | "product_id"
  | "product_state"
  | "tax_warehouse_id"
  | "product_class"
  | "excise_product_key"
> {
  return {
    location_id: null,
    vessel_id: null,
    owner_entity_id: null,
    lot_id: null,
    product_id: null,
    product_state: null,
    tax_warehouse_id: null,
    product_class: null,
    excise_product_key: null,
  };
}

function dash(value: string | null): string {
  return value ?? "—";
}

/**
 * Chronological running balances. Physical moves are checked per full stock key
 * (WC024: units, millilitres or grams below zero). Fiscal moves are checked per
 * warehouse, product class and excise key (WC027: millilitres below zero, the
 * same quantity the SQL trigger watches). Every move that leaves a negative
 * balance is reported, including a dip that a later move repairs. Ties on the
 * same instant or fiscal date keep input order.
 */
export function findNegativeBalances(moves: readonly StockMove[]): NegativeBalance[];
export function findNegativeBalances(moves: readonly FiscalMove[]): NegativeBalance[];
export function findNegativeBalances(moves: readonly (StockMove | FiscalMove)[]): NegativeBalance[] {
  if (moves.length === 0) return [];
  const first = moves[0];
  if (first !== undefined && isFiscalMove(first)) {
    return findNegativeFiscal(moves as readonly FiscalMove[]);
  }
  if (first !== undefined && isStockMove(first)) {
    return findNegativePhysical(moves as readonly StockMove[]);
  }
  invalid("El libro de movimientos no tiene un formato reconocible.");
}

function findNegativePhysical(moves: readonly StockMove[]): NegativeBalance[] {
  const ordered = moves.map((move, index) => ({ move, index }));
  for (const item of ordered) validateStockMove(item.move, item.index);
  ordered.sort((left, right) => instantMs(left.move.occurred_at) - instantMs(right.move.occurred_at) || left.index - right.index);
  const running = new Map<string, RunningPhysical>();
  const findings: NegativeBalance[] = [];
  for (const item of ordered) {
    const key = physicalIdentity(item.move);
    const current = running.get(key) ?? { qty_units: 0, volume_ml: 0, mass_g: 0 };
    current.qty_units = addInt(current.qty_units, item.move.qty_units, "Las unidades");
    current.volume_ml = addInt(current.volume_ml, item.move.volume_ml, "El volumen");
    current.mass_g = addInt(current.mass_g, item.move.mass_g, "La masa");
    running.set(key, current);
    if (current.qty_units < 0 || current.volume_ml < 0 || current.mass_g < 0) {
      findings.push({
        code: "WC024",
        message: `WC024: saldo negativo (ubicación ${dash(item.move.location_id)}, recipiente ${dash(item.move.vessel_id)}, lote ${dash(item.move.lot_id)}, producto ${dash(item.move.product_id)}, estado ${item.move.product_state}): ${current.qty_units} ud, ${current.volume_ml} mL, ${current.mass_g} g`,
        move_index: item.index,
        at: item.move.occurred_at,
        ...nullPhysicalFinding(),
        location_id: item.move.location_id,
        vessel_id: item.move.vessel_id,
        owner_entity_id: item.move.owner_entity_id,
        lot_id: item.move.lot_id,
        product_id: item.move.product_id,
        product_state: item.move.product_state,
        qty_units: current.qty_units,
        volume_ml: current.volume_ml,
        mass_g: current.mass_g,
        units: current.qty_units,
      });
    }
  }
  return findings;
}

function findNegativeFiscal(moves: readonly FiscalMove[]): NegativeBalance[] {
  const ordered = moves.map((move, index) => ({ move, index }));
  for (const item of ordered) validateFiscalMove(item.move, item.index);
  ordered.sort((left, right) => {
    if (left.move.fiscal_date !== right.move.fiscal_date) {
      return left.move.fiscal_date < right.move.fiscal_date ? -1 : 1;
    }
    return left.index - right.index;
  });
  const running = new Map<string, RunningFiscal>();
  const findings: NegativeBalance[] = [];
  for (const item of ordered) {
    const key = fiscalIdentity(item.move);
    const current = running.get(key) ?? { volume_ml: 0, units: 0 };
    current.volume_ml = addInt(current.volume_ml, item.move.volume_ml, "El volumen fiscal");
    current.units = addInt(current.units, item.move.units, "Las unidades fiscales");
    running.set(key, current);
    if (current.volume_ml < 0) {
      findings.push({
        code: "WC027",
        message: `WC027: saldo fiscal negativo (${item.move.product_class} / ${dash(item.move.excise_product_key)}): ${current.volume_ml} mL`,
        move_index: item.index,
        at: item.move.fiscal_date,
        ...nullPhysicalFinding(),
        tax_warehouse_id: item.move.tax_warehouse_id,
        product_class: item.move.product_class,
        excise_product_key: item.move.excise_product_key,
        qty_units: 0,
        volume_ml: current.volume_ml,
        mass_g: 0,
        units: current.units,
      });
    }
  }
  return findings;
}

