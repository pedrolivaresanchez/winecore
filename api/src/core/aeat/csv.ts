export function esDate(iso: string | null): string {
  if (!iso) return '';
  const [year, month, day] = iso.slice(0, 10).split('-');
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

/** Decimal con coma y sin separador de miles, como el libro de recibidas. */
export function esAmount(value: string): string {
  const negative = value.startsWith('-');
  const raw = negative ? value.slice(1) : value;
  const [whole, frac = '00'] = raw.split('.');
  return `${negative ? '-' : ''}${whole ?? '0'},${frac.padEnd(2, '0').slice(0, 2)}`;
}

export function csvCell(value: string): string {
  if (/[;"\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function toCsv(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [columns, ...rows].map((line) => line.map(csvCell).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
