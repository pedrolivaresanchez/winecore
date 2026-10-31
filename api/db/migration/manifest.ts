import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { entityFromPath, roleOf, type FileRole } from './classify';
import { readShopifyTable } from './extract/shopifyCsv';
import { fixedMoney, moneyOrZero, parseDate, yearOf } from './money';
import { canonicalJson } from '../../src/core/db/audit';
import { measureInvoices } from './datasets/open_items';
import { readHoldedSheet } from './xlsx';

export interface ManifestFile {
  sha256: string;
  entity: string;
  role: FileRole;
  rows: number;
  informational: boolean;
  unmapped_columns: string[];
  by_year: Record<string, YearTotals>;
  lines?: { subtotal: string; total: string };
  open_items?: { direction: 'receivable' | 'payable'; count: number; amount: string };
  outstanding?: string;
}

export interface YearTotals {
  documents: number;
  subtotal: string;
  vat: string;
  vat_2: string;
  total: string;
  pending: string;
}

export interface Manifest {
  version: 1;
  files: ManifestFile[];
}

const REQUIRED: ReadonlySet<FileRole> = new Set(['sales_invoice', 'purchase_invoice']);

export async function buildManifest(inputDir: string): Promise<Manifest> {
  const files: ManifestFile[] = [];
  for (const path of await listSources(inputDir)) {
    const bytes = await readFile(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const lower = path.toLowerCase();
    if (lower.endsWith('.xlsx')) {
      const sheet = readHoldedSheet(bytes);
      files.push(holdedEntry(sheet.table.headers, sheet.table.rows, sheet.preambleYear, sha256, entityFromPath(path)));
    } else {
      const rows = await readShopifyTable(path);
      files.push(shopifyEntry(rows, sha256, entityFromPath(path)));
    }
  }
  files.sort((left, right) => left.sha256.localeCompare(right.sha256));
  return { version: 1, files };
}

function holdedEntry(
  headers: string[],
  rows: Record<string, string>[],
  preambleYear: number | null,
  sha256: string,
  entity: string,
): ManifestFile {
  const role = roleOf(headers);
  const entry: ManifestFile = {
    sha256,
    entity,
    role,
    rows: rows.length,
    informational: !REQUIRED.has(role),
    unmapped_columns: unmapped(role, headers),
    by_year: {},
  };
  if (role === 'sales_invoice' || role === 'purchase_invoice') {
    const measured = measureInvoices({ headers, rows, exportGeneratedAt: null });
    entry.by_year = measured.byYear;
    entry.open_items = {
      direction: role === 'purchase_invoice' ? 'payable' : 'receivable',
      count: measured.openCount,
      amount: measured.openAmount,
    };
    entry.rows = measured.rows;
  } else if (role === 'lines' || role === 'delivery_note' || role === 'quote') {
    entry.lines = sumLines(rows);
  } else if ((role === 'trial_balance' || role === 'pnl') && preambleYear !== null) {
    const total = rows.reduce((sum, row) => sum.plus(moneyOrZero(row.Total ?? row.Debe)), new Decimal(0));
    entry.by_year[String(preambleYear)] = {
      documents: rows.length,
      subtotal: '0.00',
      vat: '0.00',
      vat_2: '0.00',
      total: fixedMoney(total),
      pending: '0.00',
    };
  }
  return entry;
}

function shopifyEntry(rows: Record<string, string>[], sha256: string, entity: string): ManifestFile {
  const headers = Object.keys(rows[0] ?? {});
  const role = roleOf(headers);
  const entry: ManifestFile = {
    sha256,
    entity,
    role,
    rows: rows.length,
    informational: true,
    unmapped_columns: [],
    by_year: {},
  };
  if (role === 'shopify_orders') {
    const seen = new Set<string>();
    let subtotal = new Decimal(0);
    let total = new Decimal(0);
    for (const row of rows) {
      const name = row.Name ?? '';
      if (name !== '' && !seen.has(name)) {
        seen.add(name);
        subtotal = subtotal.plus(moneyOrZero(row.Subtotal));
        total = total.plus(moneyOrZero(row.Total));
      }
    }
    entry.lines = { subtotal: fixedMoney(subtotal), total: fixedMoney(total) };
    entry.by_year.all = {
      documents: seen.size,
      subtotal: fixedMoney(subtotal),
      vat: '0.00',
      vat_2: '0.00',
      total: fixedMoney(total),
      pending: '0.00',
    };
  }
  if (role === 'shopify_gift_cards') {
    let outstanding = new Decimal(0);
    for (const row of rows) {
      const balance = moneyOrZero(row['Current Balance']);
      if (balance.gt(0)) outstanding = outstanding.plus(balance);
    }
    entry.outstanding = fixedMoney(outstanding);
  }
  return entry;
}

function sumLines(rows: readonly Record<string, string>[]): { subtotal: string; total: string } {
  let subtotal = new Decimal(0);
  let total = new Decimal(0);
  for (const row of rows) {
    if (row.Fecha && !parseDate(row.Fecha) && !parseDate(row['Fecha emisión'])) continue;
    subtotal = subtotal.plus(moneyOrZero(row.Subtotal));
    total = total.plus(moneyOrZero(row.Total));
    if (row.Fecha) yearOfSafe(row.Fecha);
  }
  return { subtotal: fixedMoney(subtotal), total: fixedMoney(total) };
}

function yearOfSafe(raw: string): void {
  const date = parseDate(raw);
  if (date) yearOf(date);
}

function unmapped(role: FileRole, headers: readonly string[]): string[] {
  const expected = EXPECTED[role];
  if (!expected) return [];
  return headers.filter((header) => !expected.has(header) && !header.startsWith('__col_'));
}

const EXPECTED: Partial<Record<FileRole, ReadonlySet<string>>> = {
  contacts: new Set(['Creado', 'Nombre', 'ID', 'Email', 'Teléfono', 'Móvil', 'Dirección', 'Población', 'Código postal', 'Provincia', 'País', 'Código país', 'Idioma', 'Moneda', 'Dto. %', 'Cuenta', 'Referencia', 'Régimen', 'F.Pago', 'IBAN', 'Swift', 'Ref. mandato', 'Tags', 'Cuenta de ventas', 'Cuenta de compras', 'Tipo', 'Visibilidad Portal', 'Tipo de contacto', 'Acumula en modelo 347']),
  product: new Set(['Creado', 'Nombre', 'Descripción', 'SKU', 'Código', 'Variante', 'Tags', 'Tipo', 'Almacén', 'Canal', 'Cuenta', 'Stock', 'Coste', 'Precio compra', 'Valor coste', 'Valor venta', 'Subtotal', 'IVA', 'IVA_2', 'Retención', 'Rec. de eq.', 'Impuestos', 'Total']),
  sales_invoice: new Set(['Fecha', 'Num', 'Fecha operación', 'Vencimiento', 'Cliente', 'Descripción', 'Tags', 'Cuenta', 'F.Pago', 'Proyecto', 'Subtotal', 'IVA', 'IVA_2', 'Retención', 'Empleados', 'Rec. de eq.', 'Total', 'Cobrado', 'Pendiente', 'Estado', 'Fecha de cobro', 'FACe']),
  purchase_invoice: new Set(['Fecha emisión', 'Num', 'Num interno', 'Fecha contable', 'Vencimiento', 'Proveedor', 'Descripción', 'Tags', 'Cuenta', 'F.Pago', 'Proyecto', 'Subtotal', 'IVA', 'IVA_2', 'Retención', 'Empleados', 'Rec. de eq.', 'Total', 'Pagado', 'Pendiente', 'Estado', 'Fecha de pago']),
};

async function listSources(inputDir: string): Promise<string[]> {
  const roots: string[] = [];
  const holded = join(inputDir, 'holded');
  const shopify = join(inputDir, 'shopify');
  if (await exists(holded) || await exists(shopify)) {
    if (await exists(holded)) roots.push(holded);
    if (await exists(shopify)) roots.push(shopify);
  } else {
    roots.push(inputDir);
  }
  const files: string[] = [];
  for (const root of roots) await walk(root, files);
  return files;
}

async function walk(dir: string, files: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, files);
    else if (/\.(xlsx|csv|zip)$/i.test(entry.name)) files.push(path);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const input = argument('--input') ?? 'data';
  const out = argument('--out') ?? 'data/migration/expected_totals.json';
  const manifest = await buildManifest(input);
  const { mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, canonicalJson(manifest), 'utf8');
  const required = manifest.files.filter((file) => !file.informational);
  process.stdout.write(`${JSON.stringify({
    files: manifest.files.length,
    required: required.length,
    roles: countRoles(manifest.files),
  })}\n`);
}

function countRoles(files: readonly ManifestFile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) counts[file.role] = (counts[file.role] ?? 0) + 1;
  return counts;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'MIGRATION_FAILED';
    process.stderr.write(`${message.startsWith('CUADRE') || message === 'INVOICE_KEY' || message === 'HEADER_NOT_FOUND' ? message.split('\n')[0] : 'MIGRATION_FAILED'}\n`);
    process.exit(1);
  });
}
