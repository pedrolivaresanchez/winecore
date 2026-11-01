import { domainError } from '../errors';
import { countryName } from '../billing/pdf/format';
import type { PdfLang } from './holded-layout';

/**
 * Dirección de envío de un documento. Se guarda congelada en `ship_to` (JSON) con las claves
 * `name`, `line1`, `line2`, `postal_code`, `city`, `province` y `country_code`; el pedido y el
 * albarán ya la guardaban así (el motor de reglas lee `country_code`).
 */
export interface ShipToView {
  name: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string | null;
}

const KEYS = ['name', 'line1', 'line2', 'postal_code', 'city', 'province', 'country_code'] as const;
const MAX_FIELD = 160;

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/gu, ' ').replace(/ {2,}/gu, ' ').trim();
  return text === '' ? null : text;
}

/** Lee el JSON guardado sin protestar: un dato viejo con otras claves se imprime con lo que tenga. */
export function shipToFrom(value: unknown): ShipToView | null {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source) as unknown;
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const row = source as Record<string, unknown>;
  const view: ShipToView = {
    name: clean(row.name),
    line1: clean(row.line1),
    line2: clean(row.line2),
    postalCode: clean(row.postal_code),
    city: clean(row.city),
    province: clean(row.province),
    countryCode: clean(row.country_code)?.toUpperCase() ?? null,
  };
  const printable = view.name ?? view.line1 ?? view.line2 ?? view.city ?? view.postalCode;
  return printable ? view : null;
}

/**
 * Valida la dirección que llega por la API y la devuelve lista para guardar. `null` o un
 * objeto vacío quitan la dirección.
 */
export function parseShipTo(value: unknown, field = 'ship_to'): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Debe ser un objeto con la dirección' });
  }
  const row = value as Record<string, unknown>;
  const stored: Record<string, string> = {};
  for (const key of KEYS) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw !== 'string') {
      throw domainError('WC_VALIDATION', { [`${field}.${key}`]: 'Debe ser texto' });
    }
    const text = clean(raw);
    if (!text) continue;
    if (text.length > MAX_FIELD) {
      throw domainError('WC_VALIDATION', { [`${field}.${key}`]: `Máximo ${MAX_FIELD} caracteres` });
    }
    if (key === 'country_code') {
      if (!/^[A-Za-z]{2}$/u.test(text)) {
        throw domainError('WC_VALIDATION', { [`${field}.country_code`]: 'Código de país de dos letras' });
      }
      stored[key] = text.toUpperCase();
    } else {
      stored[key] = text;
    }
  }
  if (!stored.name && !stored.line1 && !stored.line2 && !stored.city && !stored.postal_code) return null;
  return stored;
}

/** `CIUDAD (CP), Provincia, País`, como lo imprime Holded. */
export function townLine(
  address: { city: string | null; postalCode: string | null; province: string | null; countryCode: string | null },
  lang: PdfLang,
  options: { country: boolean },
): string {
  const parts: string[] = [];
  const city = address.city?.trim() ?? '';
  const code = address.postalCode?.trim() ?? '';
  if (city !== '' && code !== '') parts.push(`${city} (${code})`);
  else if (city !== '') parts.push(city);
  else if (code !== '') parts.push(code);
  if (address.province && address.province.trim() !== '') parts.push(address.province.trim());
  if (options.country && address.countryCode) parts.push(countryName(address.countryCode, lang));
  return parts.join(', ');
}

export function shipToLines(view: ShipToView, lang: PdfLang): string[] {
  const lines = [view.name, view.line1, view.line2].filter((line): line is string => Boolean(line));
  const town = townLine(view, lang, { country: view.countryCode !== null });
  if (town !== '') lines.push(town);
  return lines;
}
