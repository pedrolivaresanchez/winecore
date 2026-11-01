// NumSerieFactura (verifactu.md §5) y el alta de series (UI-34):
// ASCII 32–126, sin " ' < > =. El número completo (prefijo + dígitos) cabe en 60.

const FORBIDDEN = new Set(['"', "'", '<', '>', '=']);

export function seriesPrefixError(prefix: string, padding: number): string | null {
  if (prefix.length === 0) return 'El prefijo es obligatorio';
  for (const char of prefix) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code > 126 || FORBIDDEN.has(char)) {
      const shown = code >= 32 && code <= 126 ? char : `U+${code.toString(16).toUpperCase()}`;
      return `El prefijo contiene un carácter no válido («${shown}»). Solo se admite ASCII 32–126, sin " ' < > ni =`;
    }
  }
  if (prefix.length > 12) return 'El prefijo debe tener entre 1 y 12 caracteres';
  if (!Number.isInteger(padding) || padding < 1) return 'El relleno no es válido';
  if (prefix.length + padding > 60) {
    return 'El número completo no puede superar 60 caracteres';
  }
  return null;
}

export function formatSeriesNumber(prefix: string, padding: number, value: number): string {
  return `${prefix}${String(value).padStart(padding, '0')}`;
}

/**
 * `CF26-` en 2027 pasa a `CF27-`, el `F-2026-` de Holded a `F-2027-` y `2026/` a `2027/`.
 * Si el prefijo no lleva el año, no se inventa.
 */
export function derivePrefix(prefix: string, year: number): string | null {
  const match = /^([A-Z]{0,4})([-/ ]?)(\d{4}|\d{2})(\D*)$/.exec(prefix);
  const letters = match?.[1];
  const digits = match?.[3];
  if (letters === undefined || !digits) return null;
  const shown = digits.length === 4 ? String(year) : String(year % 100).padStart(2, '0');
  const next = `${letters}${match?.[2] ?? ''}${shown}${match?.[4] ?? ''}`;
  if (next.length < 1 || next.length > 12) return null;
  return next;
}
