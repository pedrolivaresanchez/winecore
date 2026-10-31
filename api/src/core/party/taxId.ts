/**
 * Normalizes and classifies a tax identifier.
 *
 * Spanish personal NIFs (8 digits, and K/L/M) and NIEs use the mod-23 letter.
 * Entity NIFs (CIF) use the AEAT weighted sum. EU VAT numbers are checked
 * against the country format only (no VIES lookup). `passport` is part of the
 * stored enum but is not inferred: nothing in the input distinguishes it from
 * another foreign identifier.
 */

export type TaxIdType = 'nif' | 'nie' | 'vat_eu' | 'passport' | 'foreign_id' | 'none';

export interface TaxIdResult {
  normalized: string | null;
  type: TaxIdType;
  country: string | null;
  valid: boolean;
  warning?: string;
}

const NIF_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const CIF_LETTERS = 'JABCDEFGHI';
const ENTITY_FIRST = 'ABCDEFGHJNPQRSUVW';
const ENTITY_DIGIT_ONLY = new Set(['A', 'B', 'E', 'H']);
const ENTITY_LETTER_ONLY = new Set(['N', 'P', 'Q', 'R', 'S', 'W']);

const STORED = /^[A-Z0-9]{2,20}$/;
const SEPARATORS = /[\s.\\/\u2013\u2014\u2212-]+/gu;

const PERSON_NIF = /^(\d{8})([A-Z])$/;
const NIE = /^([XYZ])(\d{7})([A-Z])$/;
const SPECIAL_NIF = /^([KLM])(\d{7})([A-Z])$/;
const ENTITY_NIF = new RegExp(`^([${ENTITY_FIRST}])(\\d{7})([A-Z0-9])$`);

/** ISO members plus the VAT prefixes EL (Greece) and XI (Northern Ireland). */
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR',
  'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT',
  'RO', 'SE', 'SI', 'SK', 'XI',
]);

const EU_VAT: Readonly<Record<string, RegExp>> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE[01]\d{9}$/,
  BG: /^BG\d{9,10}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[0-9A-HJ-NP-Z]{2}\d{9}$/,
  HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/,
  // Historical PPS forms with "+" or "*" cannot be stored: tax_id is [A-Z0-9]{2,20}.
  IE: /^IE(?:\d{7}[A-Z]{1,2}|\d[A-Z]\d{5}[A-Z])$/,
  IT: /^IT\d{11}$/,
  LT: /^LT(?:\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/,
  SK: /^SK\d{10}$/,
  XI: /^XI(?:\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};

const WARN_NIF = 'La letra de control del NIF no coincide';
const WARN_NIE = 'La letra de control del NIE no coincide';
const WARN_CIF = 'El dígito de control del CIF no coincide';

export function normalizeTaxId(raw: string, countryHint?: string): TaxIdResult {
  const hint = normalizeHint(countryHint);
  const cleaned = raw.toUpperCase().replace(SEPARATORS, '');
  if (cleaned.length === 0) {
    return { normalized: null, type: 'none', country: null, valid: true };
  }

  // Spanish VAT numbers are the national id with an ES prefix. Drop it only
  // when exactly 9 characters remain, then classify that national id.
  const national = cleaned.startsWith('ES') && cleaned.length === 11 ? cleaned.slice(2) : cleaned;
  if (!STORED.test(national)) {
    return { normalized: null, type: 'none', country: null, valid: false };
  }

  const spanish = classifySpanish(national);
  if (spanish) return spanish;

  const vatCountry = euVatCountry(national);
  if (vatCountry) {
    return { normalized: national, type: 'vat_eu', country: vatCountry, valid: true };
  }

  if (hint && !EU_COUNTRIES.has(hint)) {
    return { normalized: national, type: 'foreign_id', country: hint, valid: true };
  }

  return { normalized: national, type: 'none', country: null, valid: false };
}

function normalizeHint(countryHint: string | undefined): string | null {
  if (countryHint == null) return null;
  const code = countryHint.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function classifySpanish(value: string): TaxIdResult | null {
  const person = value.match(PERSON_NIF);
  if (person) {
    const digits = group(person, 1);
    const letter = group(person, 2);
    return letter === nifLetter(digits)
      ? ok(value, 'nif')
      : bad(value, WARN_NIF);
  }

  const nie = value.match(NIE);
  if (nie) {
    const prefix = group(nie, 1);
    const digits = group(nie, 2);
    const letter = group(nie, 3);
    const head = prefix === 'X' ? '0' : prefix === 'Y' ? '1' : '2';
    return letter === nifLetter(head + digits)
      ? ok(value, 'nie')
      : bad(value, WARN_NIE);
  }

  const special = value.match(SPECIAL_NIF);
  if (special) {
    const digits = group(special, 2);
    const letter = group(special, 3);
    return letter === nifLetter(digits)
      ? ok(value, 'nif')
      : bad(value, WARN_NIF);
  }

  const entity = value.match(ENTITY_NIF);
  if (entity) {
    const org = group(entity, 1);
    const digits = group(entity, 2);
    const control = group(entity, 3);
    return entityControlOk(org, digits, control) ? ok(value, 'nif') : bad(value, WARN_CIF);
  }

  return null;
}

function euVatCountry(value: string): string | null {
  const prefix = value.slice(0, 2);
  const pattern = EU_VAT[prefix];
  if (!pattern) return null;
  return pattern.test(value) ? prefix : null;
}

function nifLetter(digits: string): string {
  const letter = NIF_LETTERS[Number(digits) % 23];
  if (letter === undefined) throw new RangeError('NIF control index out of range');
  return letter;
}

function entityControlOk(org: string, digits: string, actual: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const n = digits.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      const doubled = n * 2;
      sum += Math.trunc(doubled / 10) + (doubled % 10);
    } else {
      sum += n;
    }
  }
  const digit = (10 - (sum % 10)) % 10;
  const letter = CIF_LETTERS[digit];
  if (letter === undefined) throw new RangeError('CIF control index out of range');
  const digitChar = String(digit);
  if (ENTITY_DIGIT_ONLY.has(org)) return actual === digitChar;
  if (ENTITY_LETTER_ONLY.has(org)) return actual === letter;
  return actual === digitChar || actual === letter;
}

function group(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new RangeError('Missing tax id group');
  return value;
}

function ok(normalized: string, type: 'nif' | 'nie'): TaxIdResult {
  return { normalized, type, country: 'ES', valid: true };
}

function bad(normalized: string, warning: string): TaxIdResult {
  return { normalized, type: 'none', country: 'ES', valid: false, warning };
}
