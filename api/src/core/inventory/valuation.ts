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
