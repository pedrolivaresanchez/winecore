/** RFC 4180 reader and writer. Values stay in memory only for the caller to project. */

export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === undefined) break;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

export function writeCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(escapeCell).join(',')).join('\n')}\n`;
}

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function csvRecords(text: string): Record<string, string>[] {
  const matrix = parseCsv(text);
  const header = matrix[0];
  if (!header) return [];
  const records: Record<string, string>[] = [];
  for (const row of matrix.slice(1)) {
    const record: Record<string, string> = {};
    for (let index = 0; index < header.length; index += 1) {
      const name = header[index];
      if (name === undefined || name === '') continue;
      record[name] = row[index] ?? '';
    }
    records.push(record);
  }
  return records;
}
