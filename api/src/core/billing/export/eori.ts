/**
 * EORI format checks only. No registry lookup and no national check digits.
 *
 * Structure, not a census:
 * - UCC-DA Annex 12-01 and DG TAXUD EORI guidance DIH/2018/005 rev 3.1:
 *   issuer ISO alpha-2 + up to 15 alphanumeric characters (17 in total).
 *   Greece is EL. Northern Ireland is XI.
 * - AEAT: ES + NIF (9 characters), or ES + K + 11 alphanumeric characters
 *   for operators not established in the EU who have no Spanish NIF.
 * - HMRC: GB + 12 digits; XI + those same 12 digits.
 * - TAXUD "EORI National implementation" (June 2022), only where that note
 *   states a structure: Belgium (10 digits, 12 digits, or ISO alpha-2 + 6
 *   digits), France (SIRET, 14 digits, or ISO alpha-2 + identifier), Croatia
 *   (OIB, 11 digits), Portugal (NIF, 9 digits, or ISO alpha-2 + 7 digits).
 * Other member states stay on the Annex 12-01 pattern.
 */

export type EoriResult =
  | { ok: true; normalized: string; country: string }
  | { ok: false; empty: boolean; message: string };

interface Rule {
  test: RegExp;
  message: string;
}

const SEPARATORS = /[\s./-]+/g;

const GENERIC: ReadonlyArray<readonly [string, string]> = [
  ['AT', 'Austria'],
  ['BG', 'Bulgaria'],
  ['CY', 'Chipre'],
  ['CZ', 'Chequia'],
  ['DE', 'Alemania'],
  ['DK', 'Dinamarca'],
  ['EE', 'Estonia'],
  ['EL', 'Grecia'],
  ['FI', 'Finlandia'],
  ['HU', 'Hungría'],
  ['IE', 'Irlanda'],
  ['IT', 'Italia'],
  ['LT', 'Lituania'],
  ['LU', 'Luxemburgo'],
  ['LV', 'Letonia'],
  ['MT', 'Malta'],
  ['NL', 'Países Bajos'],
  ['PL', 'Polonia'],
  ['RO', 'Rumanía'],
  ['SE', 'Suecia'],
  ['SI', 'Eslovenia'],
  ['SK', 'Eslovaquia'],
];

function generic(code: string, name: string): Rule {
  return {
    test: new RegExp(`^${code}[A-Z0-9]{1,15}$`),
    message: `El EORI de ${name} debe ser ${code} seguido de 1 a 15 caracteres alfanuméricos.`,
  };
}

const RULES = new Map<string, Rule>(GENERIC.map(([code, name]) => [code, generic(code, name)]));

RULES.set('BE', {
  test: /^BE(?:\d{10}|\d{12}|[A-Z]{2}\d{6})$/,
  message: 'El EORI de Bélgica debe ser BE y 10 dígitos, BE y 12 dígitos, o BE, un país ISO y 6 dígitos.',
});
RULES.set('ES', {
  test: /^ES(?:[A-Z0-9]{9}|K[A-Z0-9]{11})$/,
  message: 'El EORI de España debe ser ES seguido del NIF (9 caracteres) o ESK seguido de 11 caracteres.',
});
RULES.set('FR', {
  test: /^FR(?:\d{14}|[A-Z]{2}[A-Z0-9]{1,13})$/,
  message: 'El EORI de Francia debe ser FR y el SIRET (14 dígitos), o FR, un país ISO y un identificador.',
});
RULES.set('HR', {
  test: /^HR\d{11}$/,
  message: 'El EORI de Croacia debe ser HR seguido del OIB (11 dígitos).',
});
RULES.set('PT', {
  test: /^PT(?:\d{9}|[A-Z]{2}\d{7})$/,
  message: 'El EORI de Portugal debe ser PT y el NIF (9 dígitos), o PT, un país ISO y 7 dígitos.',
});
RULES.set('GB', {
  test: /^GB\d{12}$/,
  message: 'El EORI de Gran Bretaña debe ser GB seguido de 12 dígitos.',
});
RULES.set('XI', {
  test: /^XI\d{12}$/,
  message: 'El EORI de Irlanda del Norte debe ser XI seguido de 12 dígitos.',
});

const ISSUER_ORDER = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR',
  'GB', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT',
  'RO', 'SE', 'SI', 'SK', 'XI',
] as const;

export const EORI_ISSUERS: readonly string[] = ISSUER_ORDER;

function fail(message: string, empty = false): EoriResult {
  return { ok: false, empty, message };
}

export function validateEori(raw: string): EoriResult {
  const cleaned = raw.toUpperCase().replace(SEPARATORS, '');
  if (cleaned.length === 0) return fail('El EORI está vacío.', true);
  if (!/^[A-Z0-9]+$/.test(cleaned)) return fail('El EORI solo puede contener letras y números.');
  const country = cleaned.slice(0, 2);
  if (country === 'GR') return fail('El EORI de Grecia usa el prefijo EL, no GR.');
  const rule = RULES.get(country);
  if (!rule) return fail('El prefijo del EORI no es un país emisor reconocido (UE, GB o XI).');
  if (cleaned.length < 3 || cleaned.length > 17) return fail('El EORI debe tener entre 3 y 17 caracteres.');
  if (!rule.test.test(cleaned)) return fail(rule.message);
  return { ok: true, normalized: cleaned, country };
}
