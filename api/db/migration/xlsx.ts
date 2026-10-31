import { readZip } from './zip';

const STAMP = /-\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s*$/;

/**
 * Column titles Holded uses. The header row is the one that matches these
 * names, not a fixed position (06-migracion.md §1).
 */
export const HOLDED_VOCABULARY: ReadonlySet<string> = new Set([
  'Creado', 'Nombre', 'ID', 'Email', 'Teléfono', 'Móvil', 'Dirección', 'Población',
  'Código postal', 'Provincia', 'País', 'Código país', 'Idioma', 'Moneda', 'Dto. %',
  'Cuenta', 'Referencia', 'Régimen', 'F.Pago', 'IBAN', 'Swift', 'Ref. mandato', 'Tags',
  'Cuenta de ventas', 'Cuenta de compras', 'Tipo', 'Visibilidad Portal', 'Tipo de contacto',
  'Acumula en modelo 347', 'Fecha', 'Num', 'Fecha operación', 'Vencimiento', 'Cliente',
  'Descripción', 'Proyecto', 'Subtotal', 'IVA', 'Retención', 'Empleados', 'Rec. de eq.',
  'Total', 'Cobrado', 'Pendiente', 'Estado', 'Fecha de cobro', 'FACe', 'Fecha emisión',
  'Num interno', 'Fecha contable', 'Proveedor', 'Pagado', 'Fecha de pago', 'Num factura',
  'Fecha de vencimiento', 'Borrador', 'Contacto', 'ID Contacto', 'SKU', 'Item', 'Impuestos',
  'Importe Impuestos', 'Unidades', 'Destino', 'Envío', 'Canal', 'Almacén', 'Facturado',
  'Etapa', 'Total facturado', 'Pagos a cuenta', 'Actualizado', 'Código', 'Variante', 'Stock',
  'Stock virtual', 'Stock Disponible', 'Coste', 'Precio compra', 'Valor coste', 'Valor venta',
  'Concepto', 'Grupo', 'Subgrupo 1', 'Subgrupo 2', 'Subgrupo 3', 'Debe', 'Haber', 'Saldo',
]);

export interface HoldedTable {
  headers: string[];
  rows: Record<string, string>[];
  /** ISO timestamp from the generation stamp, when the sheet has one. */
  exportGeneratedAt: string | null;
}

export function readHoldedXlsx(buffer: Buffer): HoldedTable {
  return readHoldedSheet(buffer).table;
}

export function readHoldedSheet(buffer: Buffer): { table: HoldedTable; preambleYear: number | null } {
  const entries = readZip(buffer);
  const sharedXml = entries.find((entry) => entry.name.endsWith('sharedStrings.xml'))?.data.toString('utf8') ?? '';
  const sheetXml = entries.find((entry) => /xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))?.data.toString('utf8');
  if (!sheetXml) throw new Error('XLSX_SHEET');
  const matrix = sheetRows(sheetXml, sharedStrings(sharedXml));
  const headerAt = headerIndex(matrix);
  const years = new Set<number>();
  for (const row of matrix.slice(0, headerAt)) {
    for (const cell of row) {
      for (const match of cell.matchAll(/\b(20\d{2})\b/g)) {
        const year = match[1];
        if (year) years.add(Number(year));
      }
    }
  }
  const preambleYear = years.size === 1 ? [...years][0] ?? null : null;
  return { table: tableFromMatrix(matrix), preambleYear };
}

export function tableFromMatrix(matrix: readonly (readonly string[])[]): HoldedTable {
  const headerAt = headerIndex(matrix);
  const headers = disambiguateHeaders((matrix[headerAt] ?? []).map((cell) => cell.trim()));
  const records: Record<string, string>[] = [];
  for (const raw of matrix.slice(headerAt + 1)) {
    if (raw.every((cell) => cell.trim() === '')) continue;
    const record: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      const name = headers[index];
      if (name === undefined) continue;
      record[name] = (raw[index] ?? '').trim();
    }
    records.push(record);
  }
  let exportGeneratedAt: string | null = null;
  const last = records.at(-1);
  if (last && isStampRecord(last, headers)) {
    exportGeneratedAt = stampTimestamp(Object.values(last).find((value) => value.trim() !== '') ?? '');
    records.pop();
  }
  return { headers, rows: records, exportGeneratedAt };
}

export function disambiguateHeaders(headers: readonly string[]): string[] {
  const seen = new Map<string, number>();
  const prelim = headers.map((raw, index) => {
    const name = raw.trim() === '' ? `__col_${index}` : raw.trim();
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
  let facturado = 0;
  const facturadoCount = prelim.filter((name) => name === 'Facturado' || name.startsWith('Facturado_')).length;
  if (facturadoCount < 2) return prelim;
  return prelim.map((name) => {
    if (name !== 'Facturado' && !name.startsWith('Facturado_')) return name;
    facturado += 1;
    return facturado === 1 ? 'Facturado_importe' : 'Facturado_estado';
  });
}

function headerIndex(matrix: readonly (readonly string[])[]): number {
  let best = -1;
  let score = 0;
  const limit = Math.min(matrix.length, 40);
  for (let index = 0; index < limit; index += 1) {
    const row = matrix[index] ?? [];
    let hits = 0;
    for (const cell of row) {
      if (HOLDED_VOCABULARY.has(cell.trim())) hits += 1;
    }
    if (hits > score) {
      score = hits;
      best = index;
    }
  }
  if (best < 0 || score < 2) throw new Error('HEADER_NOT_FOUND');
  return best;
}

function isStampRecord(record: Record<string, string>, headers: readonly string[]): boolean {
  const filled = Object.values(record).filter((value) => value.trim() !== '');
  if (filled.length !== 1) return false;
  const firstHeader = headers[0];
  const first = firstHeader ? (record[firstHeader] ?? '') : '';
  return STAMP.test(first.trim());
}

function stampTimestamp(value: string): string | null {
  const match = STAMP.exec(value.trim());
  if (!match) return null;
  const day = match[1];
  const month = match[2];
  const year = match[3];
  const hour = match[4];
  const minute = match[5];
  if (!day || !month || !year || !hour || !minute) return null;
  return `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;
}

function sharedStrings(xml: string): string[] {
  const values: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const inner = match[1] ?? '';
    const texts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => unescapeXml(part[1] ?? ''));
    values.push(texts.join(''));
  }
  return values;
}

function sheetRows(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const inner = rowMatch[1] ?? '';
    const cells = new Map<number, string>();
    // Self-closing <c r="S5"/> must not swallow the next cell. Empty columns are common in Holded.
    for (const cell of inner.matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1] ?? cell[2] ?? '';
      const body = cell[3] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref || cell[1] !== undefined) continue;
      const index = columnIndex(ref);
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      const rawValue = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      if (type === 's' && rawValue !== undefined) {
        cells.set(index, shared[Number(rawValue)] ?? '');
      } else if (type === 'inlineStr') {
        const texts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => unescapeXml(part[1] ?? ''));
        cells.set(index, texts.join(''));
      } else if (rawValue !== undefined) {
        cells.set(index, unescapeXml(rawValue));
      }
    }
    if (cells.size === 0) continue;
    const width = Math.max(...cells.keys()) + 1;
    rows.push(Array.from({ length: width }, (_, index) => cells.get(index) ?? ''));
  }
  return rows;
}

function columnIndex(letters: string): number {
  let value = 0;
  for (const char of letters) value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}
