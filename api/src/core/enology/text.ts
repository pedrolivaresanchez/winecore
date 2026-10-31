export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/** Acepta el texto de TIMESTAMPTZ de DuckDB (`2026-02-10 10:00:00+00`). */
export function parseInstant(value: string): Date {
  let text = value.trim();
  if (!text.includes('T')) text = text.replace(' ', 'T');
  text = text.replace(/([+-]\d{2})(\d{2})$/u, '$1:$2');
  text = text.replace(/([+-]\d{2})$/u, '$1:00');
  return new Date(text);
}

export function dayText(value: unknown): string | null {
  const text = String(value ?? '');
  const match = /^(\d{4}-\d{2}-\d{2})/u.exec(text);
  return match?.[1] ?? null;
}

export function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}
