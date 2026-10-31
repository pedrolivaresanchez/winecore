/**
 * Duplicate key for the `same_name_postal_code` rule.
 * The key is `normalized name + '|' + postal code` so the two parts cannot collide.
 * Numeric postal codes of 1 to 5 digits are left-padded to 5 (Spanish CP).
 */

const LEGAL_TOKENS = new Set([
  'sl', 'slu', 'sll', 'slp', 'slne',
  'sa', 'sau',
  'scoop',
  'sca', 'sc', 'scp',
  'cb', 'sat',
]);

/** Letter-by-letter writings of the same forms (S. L. U., S. COOP.). */
const LEGAL_PHRASES: readonly (readonly string[])[] = [
  ['s', 'c', 'o', 'o', 'p'],
  ['s', 'l', 'n', 'e'],
  ['s', 'l', 'u'],
  ['s', 'l', 'l'],
  ['s', 'l', 'p'],
  ['s', 'a', 'u'],
  ['s', 'c', 'a'],
  ['s', 'c', 'p'],
  ['s', 'a', 't'],
  ['s', 'coop'],
  ['s', 'l'],
  ['s', 'a'],
  ['s', 'c'],
  ['c', 'b'],
];

export function normalizeName(name: string): string {
  const folded = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  // Dots and apostrophes join letters (S.L. → sl, O'Brien → obrien).
  // Every other separator splits tokens.
  // Diacritics are already gone, so only ASCII letters and digits remain.
  // Symbols such as "º" are separators, not part of a token.
  const tokens = folded
    .replace(/[.'’´`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/ +/)
    .filter((token) => token.length > 0);

  const kept: string[] = [];
  for (let i = 0; i < tokens.length;) {
    const span = legalSpan(tokens, i);
    if (span > 0) {
      i += span;
      continue;
    }
    const token = tokens[i];
    if (token === undefined) break;
    kept.push(token);
    i += 1;
  }
  return kept.join(' ');
}

export function duplicateKey(input: { name: string; postalCode?: string | null }): string {
  return `${normalizeName(input.name)}|${normalizePostalCode(input.postalCode)}`;
}

function normalizePostalCode(postalCode: string | null | undefined): string {
  if (postalCode == null) return '';
  const compact = postalCode
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
  if (/^\d{1,5}$/.test(compact)) return compact.padStart(5, '0');
  return compact;
}

function legalSpan(tokens: readonly string[], index: number): number {
  const token = tokens[index];
  if (token === undefined) return 0;
  if (LEGAL_TOKENS.has(token)) return 1;

  let best = 0;
  for (const phrase of LEGAL_PHRASES) {
    if (phrase.length <= best || index + phrase.length > tokens.length) continue;
    let matches = true;
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (tokens[index + offset] !== phrase[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) best = phrase.length;
  }
  return best;
}
