import { Decimal } from 'decimal.js';

const CENTS = 2;

export function money(raw: string | null | undefined): Decimal | null {
  const parsed = parseLooseDecimal(raw);
  if (parsed === null) return null;
  return parsed.toDecimalPlaces(CENTS, Decimal.ROUND_HALF_UP);
}

export function moneyOrZero(raw: string | null | undefined): Decimal {
  return money(raw) ?? new Decimal(0);
}

export function parseLooseDecimal(raw: string | null | undefined): Decimal | null {
  if (raw == null) return null;
  let text = raw.trim().replace(/\s/g, '').replace(/%$/, '');
  if (text === '' || text === '-') return null;
  if (/^-?\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, '');
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replaceAll('.', '').replace(',', '.');
    else text = text.replaceAll(',', '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return new Decimal(text);
}

/** Excel 1900 date system (serial 25569 = 1970-01-01) plus ISO and dd/mm/yyyy. */
export function parseDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (text === '') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso?.[1] && iso[2] && iso[3]) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const spanish = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (spanish?.[1] && spanish[2] && spanish[3]) return `${spanish[3]}-${spanish[2]}-${spanish[1]}`;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const serial = Math.round(Number(text));
    if (serial < 20_000 || serial > 80_000) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}

export function cleanText(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function integerText(raw: string | null | undefined): string {
  const text = cleanText(raw);
  if (/^-?\d+\.0+$/.test(text)) return text.replace(/\.0+$/, '');
  if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(text)) {
    const decimal = new Decimal(text);
    if (decimal.isInt()) return decimal.toFixed(0);
  }
  return text;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmails(raw: string | null | undefined): { emails: string[]; invalid: boolean } {
  const text = cleanText(raw);
  if (text === '') return { emails: [], invalid: false };
  const parts = text.split(/[;,]/).map((part) => part.trim().toLowerCase()).filter((part) => part !== '');
  const emails = parts.filter((part) => EMAIL.test(part));
  return { emails, invalid: emails.length !== parts.length };
}

export function normalizePhone(raw: string | null | undefined): { phone: string | null; warning: boolean } {
  let text = integerText(raw);
  if (text === '') return { phone: null, warning: false };
  text = text.replace(/[^\d+]/g, '');
  if (text.startsWith('00')) text = `+${text.slice(2)}`;
  if (text.startsWith('+')) {
    const digits = text.slice(1);
    if (/^\d{8,15}$/.test(digits)) return { phone: `+${digits}`, warning: false };
    return { phone: null, warning: true };
  }
  if (/^\d{9}$/.test(text)) return { phone: `+34${text}`, warning: false };
  if (/^\d{11}$/.test(text) && text.startsWith('34')) return { phone: `+${text}`, warning: false };
  return { phone: null, warning: true };
}

export function normalizePostal(raw: string | null | undefined, country: string): string | null {
  const text = integerText(raw);
  if (text === '') return null;
  if (country === 'ES' && /^\d{1,5}$/.test(text)) return text.padStart(5, '0');
  return text;
}

export function normalizeAccount(raw: string | null | undefined): string {
  return integerText(raw);
}

export function fixedMoney(value: Decimal): string {
  return value.toDecimalPlaces(CENTS, Decimal.ROUND_HALF_UP).toFixed(CENTS);
}

export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

export function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(`${later.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${earlier.slice(0, 10)}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}
