import { domainError } from '../../errors';
import { money } from '../../money';
import type { InvoiceLang } from './types';

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const COUNTRIES: Record<string, { es: string; en: string }> = {
  ES: { es: 'España', en: 'Spain' },
  GB: { es: 'Reino Unido', en: 'United Kingdom' },
  FR: { es: 'Francia', en: 'France' },
  DE: { es: 'Alemania', en: 'Germany' },
  PT: { es: 'Portugal', en: 'Portugal' },
  IT: { es: 'Italia', en: 'Italy' },
  NL: { es: 'Países Bajos', en: 'Netherlands' },
  DK: { es: 'Dinamarca', en: 'Denmark' },
  BE: { es: 'Bélgica', en: 'Belgium' },
  IE: { es: 'Irlanda', en: 'Ireland' },
  AT: { es: 'Austria', en: 'Austria' },
  US: { es: 'Estados Unidos', en: 'United States' },
};

const PAYMENTS: Record<string, { es: string; en: string }> = {
  transfer: { es: 'Transferencia', en: 'Bank transfer' },
  direct_debit: { es: 'Domiciliación', en: 'Direct debit' },
  card: { es: 'Tarjeta', en: 'Card' },
  cash: { es: 'Efectivo', en: 'Cash' },
  stripe: { es: 'Tarjeta', en: 'Card' },
  other: { es: 'Otro', en: 'Other' },
};

export function assertLang(lang: string): asserts lang is InvoiceLang {
  if (lang !== 'es' && lang !== 'en') {
    throw domainError('WC_VALIDATION', { language: 'El idioma debe ser es o en' });
  }
}

export function parseCivilDate(iso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw domainError('WC_VALIDATION', { date: 'Fecha no válida' });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw domainError('WC_VALIDATION', { date: 'Fecha no válida' });
  }
  return { year, month, day };
}

export function utcMidnight(iso: string): Date {
  const { year, month, day } = parseCivilDate(iso);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

export function formatDate(iso: string, lang: InvoiceLang): string {
  const { year, month, day } = parseCivilDate(iso);
  if (lang === 'en') {
    const name = MONTHS_EN[month - 1];
    return `${day} ${name} ${year}`;
  }
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${dd}/${mm}/${year}`;
}

export function countryName(code: string, lang: InvoiceLang): string {
  const found = COUNTRIES[code.toUpperCase()];
  return found ? found[lang] : code.toUpperCase();
}

export function paymentLabel(method: string, lang: InvoiceLang): string {
  const found = PAYMENTS[method];
  if (!found) throw domainError('WC_VALIDATION', { payment_method: 'Forma de pago desconocida' });
  return found[lang];
}

export function taxIdLabel(type: string, lang: InvoiceLang): string {
  if (type === 'vat_eu') return lang === 'es' ? 'NIF-IVA' : 'EU VAT';
  if (type === 'passport') return lang === 'es' ? 'Pasaporte' : 'Passport';
  if (type === 'foreign_id') return 'ID';
  return 'NIF';
}

function group(digits: string, separator: string): string {
  const parts: string[] = [];
  for (let index = digits.length; index > 0; index -= 3) {
    parts.unshift(digits.slice(Math.max(0, index - 3), index));
  }
  return parts.join(separator);
}

function splitAmount(value: string, scale: number): { sign: string; whole: string; frac: string } {
  const fixed = money.fromString(value).toFixed(scale);
  const sign = fixed.startsWith('-') ? '-' : '';
  const body = sign ? fixed.slice(1) : fixed;
  const [whole, frac] = body.split('.');
  return { sign, whole: whole ?? '0', frac: frac ?? '' };
}

/** Trimmed decimal. Thousands separator follows the language. */
export function formatPlain(value: string, lang: InvoiceLang): string {
  const { sign, whole, frac } = splitAmount(value, 6);
  const trimmed = frac.replace(/0+$/u, '');
  const grouped = group(whole, lang === 'es' ? '.' : ',');
  if (trimmed.length === 0) return `${sign}${grouped}`;
  return `${sign}${grouped}${lang === 'es' ? ',' : '.'}${trimmed}`;
}

export function formatMoney(value: string, lang: InvoiceLang, currency: string): string {
  const { sign, whole, frac } = splitAmount(value, 2);
  const grouped = group(whole, lang === 'es' ? '.' : ',');
  return `${sign}${grouped}${lang === 'es' ? ',' : '.'}${frac} ${currency}`;
}

/** Unit price: at least two decimals, up to six, without trailing zeros beyond the cents. */
export function formatPrice(value: string, lang: InvoiceLang, currency: string): string {
  const { sign, whole, frac } = splitAmount(value, 6);
  const trimmed = frac.replace(/0+$/u, '');
  const decimals = trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed;
  const grouped = group(whole, lang === 'es' ? '.' : ',');
  return `${sign}${grouped}${lang === 'es' ? ',' : '.'}${decimals} ${currency}`;
}

export function isZeroAmount(value: string): boolean {
  return money.fromString(value).isZero();
}

export function sameAmount(left: string, right: string): boolean {
  return money.toString(money.fromString(left)) === money.toString(money.fromString(right));
}

export function addAmounts(values: readonly string[]): string {
  let total = money.fromString('0');
  for (const value of values) total = money.add(total, money.fromString(value));
  return money.toString(total);
}

export function subAmounts(left: string, right: string): string {
  return money.toString(money.sub(money.fromString(left), money.fromString(right)));
}
