import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createLocalClient } from '../../src/core/db/local';
import { buildManifest } from '../../db/migration/manifest';
import { parseDate, normalizePhone } from '../../db/migration/money';
import { runMigration } from '../../db/migration/run';
import { readHoldedXlsx } from '../../db/migration/xlsx';
import { verifyManifest } from '../../db/migration/verify';
import { buildXlsx, zipStore, type Cell } from '../fixtures/synthetic/migration/workbook';

const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

function personNif(seed: number): string {
  const digits = String(seed).padStart(8, '0');
  return digits + (LETTERS[seed % 23] ?? 'T');
}

const CONTACT_HEADERS = [
  'Creado', 'Nombre', 'ID', 'Email', 'Teléfono', 'Móvil', 'Dirección', 'Población', 'Código postal',
  'Provincia', 'País', 'Código país', 'Idioma', 'Moneda', 'Dto. %', 'Cuenta', 'Referencia', 'Régimen',
  'F.Pago', 'IBAN', 'Swift', 'Ref. mandato', 'Tags', 'Cuenta de ventas', 'Cuenta de compras', 'Tipo',
  'Visibilidad Portal', 'Tipo de contacto', 'Acumula en modelo 347',
];

const INVOICE_HEADERS = [
  'Fecha', 'Num', 'Fecha operación', 'Vencimiento', 'Cliente', 'Descripción', 'Tags', 'Cuenta', 'F.Pago',
  'Proyecto', 'Subtotal', 'IVA', 'Retención', 'Empleados', 'Rec. de eq.', 'Total', 'Cobrado', 'Pendiente',
  'Estado', 'Fecha de cobro', 'FACe',
];

let tail: Promise<unknown> = Promise.resolve();
function serial(name: string, fn: () => Promise<void>): void {
  test(name, () => {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  });
}

describe('migration extract', () => {
  test('finds the header, renames duplicate columns and drops the stamp', async () => {
    const bytes = buildXlsx([
      ['Empresa Ejemplo'],
      ['Informe'],
      ['2024'],
      ['Fecha', 'Num', 'IVA', 'IVA', 'Total'],
      ['2024-01-02', 'F240001', '1.00', '2.00', '3.00'],
      ['Generado - 31/10/2026 09:30'],
    ]);
    const table = readHoldedXlsx(bytes);
    expect(table.headers).toEqual(['Fecha', 'Num', 'IVA', 'IVA_2', 'Total']);
    expect(table.rows).toHaveLength(1);
    expect(table.exportGeneratedAt).toBe('2026-10-31T09:30:00.000Z');
    expect(table.rows[0]?.IVA_2).toBe('2.00');
  });

  test('does not let an empty cell swallow the next column', () => {
    const shared = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<si><t>Fecha</t></si><si><t>Num</t></si><si><t>Tags</t></si><si><t>Total</t></si>
<si><t>2024-01-02</t></si><si><t>F1</t></si><si><t>9.50</t></si>
</sst>`;
    const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2"/><c r="D2" t="s"><v>6</v></c></row>
</sheetData></worksheet>`;
    const bytes = zipStore([
      { name: 'xl/sharedStrings.xml', data: Buffer.from(shared) },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
    ]);
    const table = readHoldedXlsx(bytes);
    expect(table.rows[0]?.Tags).toBe('');
    expect(table.rows[0]?.Total).toBe('9.50');
    expect(table.rows[0]?.Num).toBe('F1');
  });

  test('reads an excel serial as a date', () => {
    expect(parseDate('25569')).toBe('1970-01-01');
    expect(parseDate('2024-05-06')).toBe('2024-05-06');
  });

  test('normalizes a synthetic 9-digit phone', () => {
    const digits = ['6', '0', '0', '0', '0', '0', '0', '0', '1'].join('');
    expect(normalizePhone(digits).phone).toBe(`+34${digits}`);
    expect(normalizePhone('abc').warning).toBe(true);
  });

  test('committed fixtures do not contain personal identifiers', async () => {
    const dir = join(import.meta.dir, '../fixtures/synthetic/migration');
    const files = await readdir(dir);
    const nif = /\b\d{8}[A-Z]\b/;
    const cif = /\b[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-Z]\b/;
    const iban = /\bES\d{22}\b/;
    const phone = /(?:\+34)?\d{9}/;
    for (const name of files) {
      if (!name.endsWith('.csv') && !name.endsWith('.ts')) continue;
      const text = await readFile(join(dir, name), 'utf8');
      expect(nif.test(text)).toBe(false);
      expect(cif.test(text)).toBe(false);
      expect(iban.test(text)).toBe(false);
      expect(phone.test(text)).toBe(false);
    }
  });
});

describe('migration load', () => {
  serial('dry-run rolls back and load is idempotent', async () => {
    const ctx = await session();
    try {
      const file = join(ctx.dir, 'contacts.xlsx');
      await writeFile(file, buildXlsx(contactSheet([
        contactRow('Bodega Ejemplo Norte', { email: 'norte@example.com', postal: '28013', account: '43000021', tipo: 'Cliente' }),
        contactRow('Otra Bodega Norte', { email: 'norte@example.com', postal: '28014', tipo: 'Cliente' }),
        contactRow('Bodega Ejemplo Norte', { email: 'otro@example.com', postal: '28013', tipo: 'Cliente' }),
        contactRow('Lead Ejemplo', { tipo: 'Lead', kind: 'Persona' }),
      ])));
      const dry = await runMigration(base(ctx, { dataset: 'contacts', file, mode: 'dry-run' }));
      expect(dry.report.created).toBe(2);
      expect(dry.report.merged_duplicates).toBe(2);
      expect(dry.report.nif_warnings).toBe(0);
      expect(await liveContacts(ctx.db)).toBe(0);
      expect(await batches(ctx.db)).toBe(0);
      const loaded = await runMigration(base(ctx, {
        dataset: 'contacts', file, mode: 'load', approvedReport: dry.reportSha256,
      }));
      expect(loaded.report.created).toBe(2);
      expect(await liveContacts(ctx.db)).toBe(2);
      const again = await runMigration(base(ctx, {
        dataset: 'contacts', file, mode: 'load', approvedReport: dry.reportSha256,
      }));
      expect(again.alreadyLoaded).toBe(true);
      expect(await liveContacts(ctx.db)).toBe(2);
      expect(await batches(ctx.db)).toBe(1);
      const reportText = JSON.stringify(loaded.report);
      expect(reportText.includes('norte@example.com')).toBe(false);
      expect(reportText.includes('Bodega Ejemplo')).toBe(false);
      await expect(runMigration(base(ctx, {
        dataset: 'contacts', file, mode: 'load', approvedReport: '0'.repeat(64),
      }))).rejects.toThrow('APPROVED_REPORT_MISMATCH');
    } finally {
      await ctx.close();
    }
  });

  serial('deduplicates the same tax id and proposes a similar name', async () => {
    const ctx = await session();
    try {
      const shared = personNif(20_000_111);
      const other = personNif(20_000_222);
      const cvpo = join(ctx.dir, 'cvpo.xlsx');
      const po = join(ctx.dir, 'po.xlsx');
      await writeFile(cvpo, buildXlsx(contactSheet([
        contactRow('Bodega Ejemplo Norte', { taxId: shared, email: 'ada.ejemplo@example.com', postal: '28013', account: '43000021', tipo: 'Cliente' }),
        contactRow('Proveedor Ejemplo', { taxId: 'NOT-A-CODE', postal: '46001', tipo: 'Proveedor', account: '40000021' }),
      ])));
      await writeFile(po, buildXlsx(contactSheet([
        contactRow('Bodega Ejemplo Norte S.L.', { taxId: shared, postal: '28013', account: '40000022', tipo: 'Proveedor' }),
        contactRow('Bodega Ejemplo Norte', { taxId: other, email: 'distinto@example.com', postal: '28013', tipo: 'Cliente', account: '43000022' }),
      ])));
      const dryCvpo = await runMigration(base(ctx, { entity: 'CVPO', dataset: 'contacts', file: cvpo, mode: 'dry-run' }));
      expect(dryCvpo.report.nif_warnings).toBe(1);
      expect(dryCvpo.report.created).toBe(2);
      await runMigration(base(ctx, { entity: 'CVPO', dataset: 'contacts', file: cvpo, mode: 'load', approvedReport: dryCvpo.reportSha256 }));
      const dryPo = await runMigration(base(ctx, { entity: 'PO', dataset: 'contacts', file: po, mode: 'dry-run' }));
      expect(dryPo.report.merged_duplicates).toBe(1);
      expect(dryPo.report.proposals_pending).toBe(1);
      expect(dryPo.report.created).toBe(1);
      await runMigration(base(ctx, { entity: 'PO', dataset: 'contacts', file: po, mode: 'load', approvedReport: dryPo.reportSha256 }));
      expect(await liveContacts(ctx.db)).toBe(3);
      const terms = await scalar(ctx.db, 'SELECT COUNT(*) AS n FROM party.contact_entity_terms');
      expect(terms).toBe(4);
      const tax = await scalar(ctx.db, `SELECT COUNT(*) AS n FROM party.contact WHERE tax_id = '${shared}' AND merged_into_id IS NULL`);
      expect(tax).toBe(1);
      const invalid = await scalar(ctx.db, `SELECT COUNT(*) AS n FROM party.contact WHERE legal_name = 'Proveedor Ejemplo' AND tax_id IS NULL`);
      expect(invalid).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  serial('selects shopify customers and merges a shared email', async () => {
    const ctx = await session();
    try {
      const holded = join(ctx.dir, 'holded.xlsx');
      await writeFile(holded, buildXlsx(contactSheet([
        contactRow('Ada Ejemplo', { email: 'ada.ejemplo@example.com', postal: '28013', tipo: 'Cliente', account: '43000021' }),
      ])));
      const dryHolded = await runMigration(base(ctx, { dataset: 'contacts', file: holded, mode: 'dry-run' }));
      await runMigration(base(ctx, { dataset: 'contacts', file: holded, mode: 'load', approvedReport: dryHolded.reportSha256 }));
      const file = join(import.meta.dir, '../fixtures/synthetic/migration/shopify-customers.csv');
      const dry = await runMigration(base(ctx, { source: 'shopify', dataset: 'contacts', file, mode: 'dry-run' }));
      expect(dry.report.rows_read).toBe(3);
      expect(dry.report.skipped.not_selected).toBe(1);
      expect(dry.report.merged_duplicates).toBe(1);
      expect(dry.report.created).toBe(1);
      await runMigration(base(ctx, { source: 'shopify', dataset: 'contacts', file, mode: 'load', approvedReport: dry.reportSha256 }));
      expect(await liveContacts(ctx.db)).toBe(2);
      const consent = await scalar(ctx.db, `SELECT COUNT(*) AS n FROM party.contact WHERE marketing_consent AND marketing_consent_source = 'shopify'`);
      expect(consent).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  serial('proposes a catalog and loads it once', async () => {
    const ctx = await session();
    try {
      const file = join(import.meta.dir, '../fixtures/synthetic/migration/shopify-products.csv');
      const dry = await runMigration(base(ctx, { source: 'shopify', dataset: 'catalog', file, mode: 'dry-run' }));
      expect(dry.report.created).toBe(2);
      expect(dry.report.skipped.sin_correspondencia).toBe(1);
      const proposal = await readFile(join(ctx.out, 'catalog_proposal.csv'), 'utf8');
      expect(proposal.includes('Porte de muestras')).toBe(true);
      expect(proposal.includes('sin_correspondencia')).toBe(true);
      await runMigration(base(ctx, { source: 'shopify', dataset: 'catalog', file, mode: 'load', approvedReport: dry.reportSha256 }));
      expect(await scalar(ctx.db, 'SELECT COUNT(*) AS n FROM catalog.product')).toBe(2);
      expect(await scalar(ctx.db, `SELECT COUNT(*) AS n FROM catalog.price_list_version WHERE status = 'draft' AND notes = 'migration'`)).toBe(1);
      const again = await runMigration(base(ctx, { source: 'shopify', dataset: 'catalog', file, mode: 'load', approvedReport: dry.reportSha256 }));
      expect(again.alreadyLoaded).toBe(true);
      expect(await scalar(ctx.db, 'SELECT COUNT(*) AS n FROM catalog.product')).toBe(2);
    } finally {
      await ctx.close();
    }
  });

  serial('open items match the file to the cent and ignore cancelled rows', async () => {
    const ctx = await session();
    try {
      const file = join(ctx.dir, 'invoices.xlsx');
      await writeFile(file, buildXlsx(invoiceSheet()));
      const dry = await runMigration(base(ctx, { dataset: 'open_items', file, mode: 'dry-run' }));
      expect(dry.report.totals.open_amount).toBe('16.50');
      expect(dry.report.created).toBe(4);
      expect(dry.report.skipped.cancelled).toBe(1);
      expect(dry.report.skipped.negative_pending).toBe(1);
      expect(dry.report.warnings.number_suffix).toBeGreaterThan(0);
      expect(dry.report.warnings.number_year_mismatch).toBeGreaterThan(0);
      expect(dry.report.warnings.number_gap).toBeGreaterThan(0);
      expect(dry.report.warnings.number_duplicate).toBeGreaterThan(0);
      expect(dry.report.warnings.SUSPICIOUS_DATE).toBeGreaterThan(0);
      expect(dry.report.resulting.aged_open).toBeGreaterThan(0);
      expect(JSON.stringify(dry.report).includes('Cliente Uno')).toBe(false);
      expect(await scalar(ctx.db, 'SELECT COUNT(*) AS n FROM legacy.open_item')).toBe(0);
      await runMigration(base(ctx, { dataset: 'open_items', file, mode: 'load', approvedReport: dry.reportSha256 }));
      expect(await scalar(ctx.db, 'SELECT COALESCE(SUM(amount), 0) AS n FROM legacy.open_item')).toBe(16.5);
      const withholding = await scalar(ctx.db, 'SELECT COALESCE(SUM(withholding), 0) AS n FROM legacy.holded_invoice');
      expect(withholding).toBe(1.5);
      await mkdir(join(ctx.dir, 'holded', 'cvpo', 'ventas'), { recursive: true });
      await writeFile(join(ctx.dir, 'holded', 'cvpo', 'ventas', 'invoices.xlsx'), await readFile(file));
      const manifestPath = join(ctx.out, 'expected_totals.json');
      const manifest = await buildManifest(ctx.dir);
      await writeFile(manifestPath, JSON.stringify(manifest));
      const verified = await verifyManifest(ctx.db, manifestPath);
      expect(verified.ok).toBe(true);
      const second = await runMigration(base(ctx, { dataset: 'open_items', file, mode: 'load', approvedReport: dry.reportSha256 }));
      expect(second.alreadyLoaded).toBe(true);
      expect(await scalar(ctx.db, 'SELECT COUNT(*) AS n FROM legacy.holded_invoice')).toBe(9);
    } finally {
      await ctx.close();
    }
  });
});

function contactRow(name: string, options: {
  taxId?: string;
  email?: string;
  postal?: string;
  account?: string;
  tipo?: string;
  kind?: string;
}): Cell[] {
  const row = CONTACT_HEADERS.map(() => '');
  const set = (header: string, value: string) => {
    row[CONTACT_HEADERS.indexOf(header)] = value;
  };
  set('Creado', '2024-01-01');
  set('Nombre', name);
  set('ID', options.taxId ?? '');
  set('Email', options.email ?? '');
  set('Dirección', 'Calle Ejemplo 1');
  set('Población', 'Ejemplo');
  set('Código postal', options.postal ?? '28013');
  set('Provincia', 'Ejemplo');
  set('Código país', 'ES');
  set('Idioma', 'Español');
  set('Moneda', 'Euro');
  set('Dto. %', '0');
  set('Cuenta', options.account ?? '');
  set('Régimen', 'Régimen general');
  set('Tipo', options.tipo ?? 'Cliente');
  set('Visibilidad Portal', 'Por defecto');
  set('Tipo de contacto', options.kind ?? 'Empresa');
  set('Acumula en modelo 347', 'Sí');
  return row;
}

function contactSheet(rows: Cell[][]): Cell[][] {
  return [['Empresa Ejemplo'], ['Contactos'], ['2024'], CONTACT_HEADERS, ...rows, ['Generado - 31/10/2026 09:30']];
}

function invoiceSheet(): Cell[][] {
  const row = (values: Record<string, string>): Cell[] => INVOICE_HEADERS.map((header) => values[header] ?? '');
  const baseInvoice = (extra: Record<string, string>): Record<string, string> => ({
    'Fecha operación': extra.Fecha ?? '',
    Vencimiento: extra.Fecha ?? '',
    Descripción: 'Partida ejemplo',
    Cuenta: '70000000',
    'F.Pago': 'Transferencia bancaria',
    Empleados: '0',
    'Rec. de eq.': '0',
    FACe: 'No enviado',
    ...extra,
  });
  return [
    ['Empresa Ejemplo'],
    ['Facturas'],
    ['2024'],
    INVOICE_HEADERS,
    row(baseInvoice({ Fecha: '2024-01-10', Num: 'F240001', Cliente: 'Cliente Uno', Subtotal: '100.00', IVA: '21.00', 'Retención': '-1.50', Total: '119.50', Cobrado: '109.00', Pendiente: '10.50', Estado: 'Pendiente' })),
    row(baseInvoice({ Fecha: '2024-01-11', Num: 'F240003', Cliente: 'Cliente Dos', Subtotal: '50.00', IVA: '0.00', 'Retención': '0', Total: '50.00', Cobrado: '50.00', Pendiente: '0', Estado: 'Pagado', 'Fecha de cobro': '2035-01-01' })),
    row(baseInvoice({ Fecha: '2024-02-01', Num: 'F240003-1', Cliente: 'Cliente Dos', Subtotal: '20.00', IVA: '0', 'Retención': '0', Total: '20.00', Cobrado: '20.00', Pendiente: '0', Estado: 'Pagado' })),
    row(baseInvoice({ Fecha: '2025-03-01', Num: 'F260010', Cliente: 'Cliente Tres', Subtotal: '30.00', IVA: '0', 'Retención': '0', Total: '30.00', Cobrado: '30.00', Pendiente: '0', Estado: 'Pagado' })),
    row(baseInvoice({ Fecha: '2024-03-01', Num: 'F240010', Cliente: 'Cliente Uno', Subtotal: '5.00', IVA: '0', 'Retención': '0', Total: '5.00', Cobrado: '0', Pendiente: '5.00', Estado: 'Anulado' })),
    row(baseInvoice({ Fecha: '2024-03-02', Num: 'F240011', Cliente: 'Cliente Uno', Subtotal: '2.00', IVA: '0', 'Retención': '0', Total: '2.00', Cobrado: '4.00', Pendiente: '-2.00', Estado: 'Vencido' })),
    row(baseInvoice({ Fecha: '2024-04-01', Num: 'F240012', Cliente: 'Cliente Cuatro', Subtotal: '4.00', IVA: '0', 'Retención': '0', Total: '4.00', Cobrado: '3.00', Pendiente: '1.00', Estado: 'Pendiente' })),
    row(baseInvoice({ Fecha: '2024-04-01', Num: 'F240012', Cliente: 'Cliente Cuatro', Subtotal: '6.00', IVA: '0', 'Retención': '0', Total: '6.00', Cobrado: '4.00', Pendiente: '2.00', Estado: 'Pendiente' })),
    row(baseInvoice({ Fecha: '2022-01-15', Num: 'F220001', Cliente: 'Cliente Cinco', Subtotal: '3.00', IVA: '0', 'Retención': '0', Total: '3.00', Cobrado: '0', Pendiente: '3.00', Estado: 'Pendiente' })),
    ['Generado - 31/10/2026 09:30'],
  ];
}

function base(ctx: { db: string; out: string }, extra: {
  dataset: 'contacts' | 'catalog' | 'open_items';
  file: string;
  mode: 'dry-run' | 'load';
  source?: 'holded' | 'shopify';
  entity?: string;
  approvedReport?: string;
}) {
  return {
    source: extra.source ?? 'holded' as const,
    entity: extra.entity ?? 'CVPO',
    dataset: extra.dataset,
    file: extra.file,
    mode: extra.mode,
    approvedReport: extra.approvedReport,
    dbPath: ctx.db,
    outDir: ctx.out,
    operator: 'test',
    dataKey: null,
  };
}

async function session() {
  const dir = await mkdtemp(join(tmpdir(), 'wc-mig-'));
  const out = join(dir, 'out');
  await mkdir(out);
  return {
    dir,
    db: join(dir, 'scratch.duckdb'),
    out,
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

async function scalar(dbPath: string, statement: string): Promise<number> {
  const client = await createLocalClient(dbPath);
  try {
    const rows = await client.query<{ n: number | string }>(statement);
    return Number(rows[0]?.n ?? 0);
  } finally {
    await client.close?.();
  }
}

function liveContacts(dbPath: string): Promise<number> {
  return scalar(dbPath, 'SELECT COUNT(*) AS n FROM party.contact WHERE merged_into_id IS NULL');
}

function batches(dbPath: string): Promise<number> {
  return scalar(dbPath, `SELECT COUNT(*) AS n FROM legacy.import_batch WHERE mode = 'load'`);
}
