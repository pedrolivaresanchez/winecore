import { Decimal } from 'decimal.js';

import { grossToBase } from '../catalog/vat-price';
import { money } from '../money';

/** Tarifas que la valoración ofrece, en el orden de la pantalla. */
export const VALUATION_LISTS = [
  { code: 'distributor', label: 'Distribución' },
  { code: 'shop', label: 'Tienda' },
  { code: 'custom-horeca', label: 'Restaurante' },
  { code: 'final', label: 'PVP' },
] as const;

export type ValuationListCode = (typeof VALUATION_LISTS)[number]['code'];

const LIST_CODES = new Set<string>(VALUATION_LISTS.map((list) => list.code));

export function isValuationList(code: string): code is ValuationListCode {
  return LIST_CODES.has(code);
}

export function valuationListLabel(code: ValuationListCode): string {
  return VALUATION_LISTS.find((list) => list.code === code)?.label ?? code;
}

export type TariffStatus = 'draft' | 'active' | 'retired';

export type TariffVersion = {
  id: string;
  version: number;
  validFrom: string;
  /** Exclusivo. Null = abierta. */
  validTo: string | null;
  status: TariffStatus;
};

export type TariffPrice = {
  productId: string;
  unitPrice: string;
  minQty: string;
  versionId: string;
  version: number;
  validFrom: string;
  status: TariffStatus;
};

export type ChosenPrice = {
  /** Precio guardado en la tarifa, aún con IVA si la lista lo incluye. */
  stored: string;
  version: number;
  validFrom: string;
  origin: 'current' | 'previous';
};

const WAREHOUSE_ORDER = new Map<string, number>([
  ['BOD', 0],
  ['TFRP', 1],
]);

/** Color de la ficha del vino → etiqueta de la valoración. */
const WINE_TYPES: Record<string, string> = {
  red: 'Tinto',
  white: 'Blanco',
  rose: 'Rosado',
  orange: 'Naranja',
  sweet: 'Dulce',
  sparkling: 'Espumoso',
  other: 'Otro',
  tinto: 'Tinto',
  blanco: 'Blanco',
  rosado: 'Rosado',
  naranja: 'Naranja',
  otro: 'Otro',
};

const WINE_TYPE_CODE: Record<string, string> = {
  tinto: 'red',
  blanco: 'white',
  rosado: 'rose',
  naranja: 'orange',
  otro: 'other',
};

const WINE_TYPE_ORDER = ['red', 'white', 'rose', 'orange', 'sweet', 'sparkling', 'other', 'unknown'];

/** Tipo según el color de la ficha (o el del hueco, si el vino no está ligado). */
export function wineTypeOf(color: string | null): { code: string; label: string } {
  if (!color) return { code: 'unknown', label: 'Sin tipo' };
  const key = color.trim().toLowerCase();
  const code = WINE_TYPE_CODE[key] ?? key;
  return { code, label: WINE_TYPES[key] ?? WINE_TYPES[code] ?? 'Sin tipo' };
}

export function compareWineTypes(left: string, right: string): number {
  const rank = (code: string) => {
    const index = WINE_TYPE_ORDER.indexOf(code);
    return index < 0 ? WINE_TYPE_ORDER.length : index;
  };
  return rank(left) - rank(right);
}

/**
 * El mapa (huecos) y el libro físico guardan las mismas botellas con claves
 * distintas: una fila trae la referencia y otra el lote, o una no trae ni
 * referencia ni lote. Son el mismo stock si comparten almacén y, o bien la
 * referencia, o bien el lote, o bien la cantidad cuando a alguna le falta
 * un dato. Dos referencias distintas del mismo lote no se juntan.
 */
export type PackIdentity = {
  location_code: string;
  product_id: string | null;
  lot_id: string | null;
  bottles: number;
  volume_ml: number;
};

export function samePhysicalPack(left: PackIdentity, right: PackIdentity): boolean {
  if (left.location_code !== right.location_code) return false;
  const sameLot = Boolean(left.lot_id && right.lot_id && left.lot_id === right.lot_id);
  const sameProduct = Boolean(left.product_id && right.product_id && left.product_id === right.product_id);
  if (sameLot && left.product_id && right.product_id && left.product_id !== right.product_id) return false;
  if (sameProduct && left.lot_id && right.lot_id && left.lot_id !== right.lot_id) return false;
  if (sameLot || sameProduct) return true;
  if (left.bottles !== right.bottles) return false;
  if (left.volume_ml > 0 && right.volume_ml > 0 && left.volume_ml !== right.volume_ml) return false;
  if (left.product_id && right.product_id && left.product_id !== right.product_id) return false;
  const leftGap = !left.product_id || !left.lot_id;
  const rightGap = !right.product_id || !right.lot_id;
  if (!leftGap && !rightGap) return false;
  return true;
}

/** Une mapa y libro. La cantidad del mapa manda; del libro solo se rellena la referencia o el lote que faltaba. */
export function mergePackaged<T extends PackIdentity>(mapRows: readonly T[], bookRows: readonly T[]): T[] {
  const rows: T[] = [];
  for (const row of [...mapRows, ...bookRows]) {
    const index = rows.findIndex((existing) => samePhysicalPack(existing, row));
    if (index < 0) {
      rows.push({ ...row });
      continue;
    }
    const current = rows[index];
    if (!current) continue;
    rows[index] = fillPack(current, row);
  }
  return rows;
}

function fillPack<T extends PackIdentity>(base: T, extra: T): T {
  const filled = { ...base };
  for (const key of Object.keys(extra) as (keyof T)[]) {
    if (key === 'bottles' || key === 'volume_ml' || key === 'location_code') continue;
    const value = extra[key];
    const current = filled[key];
    if ((current == null || current === '') && value != null && value !== '') filled[key] = value;
  }
  filled.bottles = base.bottles;
  filled.volume_ml = base.volume_ml > 0 ? base.volume_ml : extra.volume_ml;
  return filled;
}

/** Bodega y TFRP primero; el resto por código. */
export function compareWarehouses(left: string, right: string): number {
  const rank = (code: string) => WAREHOUSE_ORDER.get(code) ?? 2;
  const byRank = rank(left) - rank(right);
  if (byRank !== 0) return byRank;
  return left.localeCompare(right, 'es');
}

/**
 * Versión vigente: activa, ya empezada y no cerrada. Si hay más de una,
 * manda la de valid_from más reciente y, a igualdad, el número mayor.
 */
export function currentVersion(versions: readonly TariffVersion[], today: string): TariffVersion | null {
  const open = versions.filter((version) =>
    version.status === 'active'
    && version.validFrom <= today
    && (version.validTo == null || version.validTo > today),
  );
  open.sort((left, right) => right.validFrom.localeCompare(left.validFrom) || right.version - left.version);
  return open[0] ?? null;
}

/**
 * Precio de la referencia en la tarifa. Primero la versión vigente.
 * Si no está, la versión anterior más reciente (activa o retirada, ya empezada)
 * que tenga precio. Un borrador no es una tarifa que haya estado en vigor.
 * Devuelve null solo cuando ninguna versión publicada tiene precio.
 */
export function chooseStoredPrice(
  rows: readonly TariffPrice[],
  productId: string,
  current: TariffVersion | null,
  today: string,
): ChosenPrice | null {
  const mine = rows.filter((row) =>
    row.productId === productId
    && row.status !== 'draft'
    && row.validFrom <= today,
  );
  if (current) {
    const live = breakPrice(mine.filter((row) => row.versionId === current.id));
    if (live) {
      return { stored: live.unitPrice, version: live.version, validFrom: live.validFrom, origin: 'current' };
    }
  }
  const byVersion = new Map<string, TariffPrice[]>();
  for (const row of mine) {
    if (current && row.versionId === current.id) continue;
    const list = byVersion.get(row.versionId) ?? [];
    list.push(row);
    byVersion.set(row.versionId, list);
  }
  const versions = [...byVersion.values()].sort((left, right) => {
    const a = left[0];
    const b = right[0];
    if (!a || !b) return 0;
    return b.validFrom.localeCompare(a.validFrom) || b.version - a.version;
  });
  for (const version of versions) {
    const price = breakPrice(version);
    if (price) {
      return { stored: price.unitPrice, version: price.version, validFrom: price.validFrom, origin: 'previous' };
    }
  }
  return null;
}

/** El escalón de menor cantidad es el precio de la referencia. */
function breakPrice(rows: readonly TariffPrice[]): TariffPrice | null {
  let chosen: TariffPrice | null = null;
  for (const row of rows) {
    if (!chosen || new Decimal(row.minQty).lt(chosen.minQty)) chosen = row;
  }
  return chosen;
}

/** Base sin IVA, con 2 decimales. Si la tarifa ya es sin IVA, solo redondea. */
export function exVatUnit(stored: string, taxIncluded: boolean, ratePct: string): string {
  if (taxIncluded) return grossToBase(stored, ratePct).toFixed(2);
  return money.toString(money.fromString(stored));
}

export function unitsValue(units: number, unitPrice: string): string {
  return money.toString(money.round2(money.fromString(unitPrice).mul(units)));
}

/** Litros a 2 decimales y su valor, para que litros × precio cuadre con el importe. */
export function litresValue(volumeMl: number, eurPerLitre: string): { litres: string; value: string } {
  const litres = money.round2(new Decimal(volumeMl).div(1000));
  const value = money.round2(litres.mul(money.fromString(eurPerLitre)));
  return { litres: money.toString(litres), value: money.toString(value) };
}

export function sumMoney(values: readonly string[]): string {
  const total = values.reduce((acc, item) => money.add(acc, money.fromString(item)), money.fromString('0'));
  return money.toString(total);
}

export function previousPriceNote(version: number, validFrom: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(validFrom);
  const date = match ? `${match[3]}/${match[2]}/${match[1]}` : validFrom;
  return `Precio de tarifa anterior · v${version} · ${date}`;
}

/**
 * Importe editable: `50`, `50,00`, `50.00` o `1.234,56`.
 * Devuelve siempre dos decimales con punto. Más de 2 decimales no se acepta.
 */
export function parseEur(raw: unknown, field: string): string {
  const text = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw;
  if (typeof text !== 'string') fail(field, 'Indica un importe');
  let normalized = text.trim().replace(/\s/g, '');
  const thousands = /^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(normalized) || /^\d{1,3}(\.\d{3}){2,}$/.test(normalized);
  if (thousands) {
    normalized = normalized.replaceAll('.', '').replace(',', '.');
  } else if (/^\d+(,\d{1,2})?$/.test(normalized)) {
    normalized = normalized.replace(',', '.');
  } else if (!/^\d+\.\d{1,2}$/.test(normalized)) {
    fail(field, 'Usa como mucho 2 decimales');
  }
  const value = money.fromString(normalized.includes('.') ? normalized : `${normalized}.00`);
  if (value.gt('999999.99')) fail(field, 'El importe es demasiado alto');
  return money.toString(value);
}

function fail(field: string, message: string): never {
  const error = new Error(message);
  (error as Error & { field: string }).field = field;
  throw error;
}

export function eurField(error: unknown): { field: string; message: string } | null {
  if (!(error instanceof Error) || !('field' in error)) return null;
  const field = (error as Error & { field?: unknown }).field;
  if (typeof field !== 'string') return null;
  return { field, message: error.message };
}
