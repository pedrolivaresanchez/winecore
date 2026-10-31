/**
 * ISO 13616 IBAN check (mod 97) restricted to SEPA scheme countries.
 * Lengths follow the IBAN registry. Albania, Moldova, Montenegro, North
 * Macedonia and Serbia are included: the EPC admitted them to the SEPA
 * geographical scope and they are operational as of October 2026.
 */

const SEPA_IBAN_LENGTH: Readonly<Record<string, number>> = {
  AD: 24,
  AL: 28,
  AT: 20,
  BE: 16,
  BG: 22,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GI: 23,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IS: 26,
  IT: 27,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  RS: 22,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  VA: 22,
};

export function normalizeIban(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-–—]+/g, '');
}

export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const expected = SEPA_IBAN_LENGTH[iban.slice(0, 2)];
  if (expected === undefined || iban.length !== expected) return false;
  return ibanMod97(iban) === 1;
}

export function ibanLast4(raw: string): string {
  return normalizeIban(raw).slice(-4);
}

function ibanMod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= 'A' && char <= 'Z' ? char.charCodeAt(0) - 55 : char.charCodeAt(0) - 48;
    if (value >= 10) {
      remainder = (remainder * 10 + Math.trunc(value / 10)) % 97;
      remainder = (remainder * 10 + (value % 10)) % 97;
    } else {
      remainder = (remainder * 10 + value) % 97;
    }
  }
  return remainder;
}
