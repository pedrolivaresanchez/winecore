import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Decimal } from 'decimal.js';
import { seedDemo } from '../../db/seed-demo';
import { sql } from '../../src/core/db/sql';
import { money } from '../../src/core/money';
import type { ReportBody } from '../../src/core/reports/types';
import { createTestApp } from '../helpers';

const ID = {
  customer: '019b1000-0000-7000-8000-000000000001',
  supplier: '019b1000-0000-7000-8000-000000000002',
  wineA: '019b1000-0000-7000-8000-000000000011',
  wineB: '019b1000-0000-7000-8000-000000000012',
  fmt75: '019b1000-0000-7000-8000-000000000021',
  fmt150: '019b1000-0000-7000-8000-000000000022',
  prodA: '019b1000-0000-7000-8000-000000000031',
  prodB: '019b1000-0000-7000-8000-000000000032',
  lotA: '019b1000-0000-7000-8000-000000000041',
  lotB: '019b1000-0000-7000-8000-000000000042',
  locPo: '019b1000-0000-7000-8000-000000000051',
  locCv: '019b1000-0000-7000-8000-000000000052',
  vessel: '019b1000-0000-7000-8000-000000000061',
  seriesF26: '019b1000-0000-7000-8000-000000000071',
  seriesR26: '019b1000-0000-7000-8000-000000000072',
  seriesF25: '019b1000-0000-7000-8000-000000000073',
  seriesC26: '019b1000-0000-7000-8000-000000000074',
  invOrig: '019b1000-0000-7000-8000-000000000081',
  invRect: '019b1000-0000-7000-8000-000000000082',
  invSubOld: '019b1000-0000-7000-8000-000000000083',
  invSubNew: '019b1000-0000-7000-8000-000000000084',
  invVoid: '019b1000-0000-7000-8000-000000000085',
  invDraft: '019b1000-0000-7000-8000-000000000086',
  invCv: '019b1000-0000-7000-8000-000000000087',
  invPrev: '019b1000-0000-7000-8000-000000000088',
  invHSub: '019b1000-0000-7000-8000-000000000089',
  batch: '019b1000-0000-7000-8000-000000000091',
  hSale: '019b1000-0000-7000-8000-000000000092',
  hVoid: '019b1000-0000-7000-8000-000000000093',
  hDup: '019b1000-0000-7000-8000-000000000094',
  hSub: '019b1000-0000-7000-8000-000000000095',
  expPo: '019b1000-0000-7000-8000-0000000000a1',
  expCv: '019b1000-0000-7000-8000-0000000000a2',
  expAbono: '019b1000-0000-7000-8000-0000000000a3',
  expValidated: '019b1000-0000-7000-8000-0000000000a4',
  expRejected: '019b1000-0000-7000-8000-0000000000a5',
  expPrev: '019b1000-0000-7000-8000-0000000000a6',
  expAcct: '019b1000-0000-7000-8000-0000000000a7',
  approver: '019b1000-0000-7000-8000-0000000000b1',
  approverRole: '019b1000-0000-7000-8000-0000000000b2',
  scoped: '019b1000-0000-7000-8000-0000000000b3',
  scopedRole: '019b1000-0000-7000-8000-0000000000b4',
} as const;

type App = Awaited<ReturnType<typeof createTestApp>>;

interface Book {
  amount: string;
  base: string;
  tax: string;
  units: string;
  volume_ml: string;
}

let ctx: App;
let po = '';
let cvpo = '';
let owner = '';
let poTax = '';

async function exec(statement: string): Promise<void> {
  await ctx.client.query(statement);
}

async function one<T>(statement: string): Promise<T> {
  const rows = await ctx.writer.read<T>(statement);
  const row = rows[0];
  if (!row) throw new Error('sin filas');
  return row;
}

function moneyText(value: string): string {
  return money.toString(money.fromString(value));
}

function sameQty(actual: string, expected: string): void {
  expect(new Decimal(actual).eq(new Decimal(expected))).toBe(true);
}

async function report(path: string, user?: string): Promise<ReportBody> {
  const response = await ctx.app.handle(new Request(`http://localhost${path}`, {
    headers: user ? { 'X-Dev-User': user } : {},
  }));
  expect(response.status).toBe(200);
  return response.json() as Promise<ReportBody>;
}

function salesBook(from: string, to: string, entity: 'PO' | 'CVPO' | 'both'): string {
  const codes = entity === 'both' ? `'PO', 'CVPO'` : `'${entity}'`;
  return `
    WITH billing_docs AS (
      SELECT i.id, i.total, i.subtotal, i.tax_total
      FROM billing.invoice i
      JOIN core.legal_entity e ON e.id = i.legal_entity_id
      WHERE i.status = 'issued'
        AND i.issue_date BETWEEN DATE '${from}' AND DATE '${to}'
        AND e.code IN (${codes})
        AND NOT EXISTS (
          SELECT 1 FROM billing.invoice_rectification r
          JOIN billing.invoice rect ON rect.id = r.rectifying_invoice_id
          WHERE r.relation = 'substituted' AND rect.status = 'issued'
            AND (
              r.rectified_invoice_id = i.id
              OR (r.rectified_number = i.number AND r.rectified_issue_date = i.issue_date AND rect.legal_entity_id = i.legal_entity_id)
            )
        )
    ),
    holded_docs AS (
      SELECT h.id, h.entity_id, h.number, h.issue_date, h.total, h.subtotal,
             (h.vat + COALESCE(h.vat_2, 0)) AS tax_total
      FROM legacy.holded_invoice h
      JOIN core.legal_entity e ON e.id = h.entity_id
      WHERE h.kind = 'sale'
        AND h.issue_date BETWEEN DATE '${from}' AND DATE '${to}'
        AND e.code IN (${codes})
        AND lower(trim(h.status_holded)) NOT IN ('anulado', 'anulada', 'voided', 'cancelled', 'cancelada')
        AND NOT EXISTS (
          SELECT 1 FROM billing.invoice bi
          WHERE bi.legal_entity_id = h.entity_id AND bi.number = h.number AND bi.issue_date = h.issue_date
            AND bi.status IN ('issued', 'voided')
        )
        AND NOT EXISTS (
          SELECT 1 FROM billing.invoice_rectification r
          JOIN billing.invoice rect ON rect.id = r.rectifying_invoice_id
          WHERE r.relation = 'substituted' AND rect.status = 'issued'
            AND r.rectified_number = h.number AND r.rectified_issue_date = h.issue_date
            AND rect.legal_entity_id = h.entity_id
        )
    )
    SELECT
      CAST(COALESCE((SELECT sum(total) FROM billing_docs), 0) + COALESCE((SELECT sum(total) FROM holded_docs), 0) AS VARCHAR) AS amount,
      CAST(COALESCE((SELECT sum(subtotal) FROM billing_docs), 0) + COALESCE((SELECT sum(subtotal) FROM holded_docs), 0) AS VARCHAR) AS base,
      CAST(COALESCE((SELECT sum(tax_total) FROM billing_docs), 0) + COALESCE((SELECT sum(tax_total) FROM holded_docs), 0) AS VARCHAR) AS tax,
      CAST(
        COALESCE((
          SELECT sum(l.quantity) FROM billing.invoice_line l JOIN billing_docs d ON d.id = l.invoice_id
        ), 0) + COALESCE((
          SELECT sum(hl.units)
          FROM holded_docs h
          JOIN legacy.holded_invoice_line hl
            ON hl.entity_id = h.entity_id AND hl.kind = 'sale'
           AND hl.document_number = h.number AND hl.document_date = h.issue_date AND hl.is_draft = FALSE
        ), 0) AS VARCHAR
      ) AS units,
      CAST(
        COALESCE((
          SELECT sum(l.quantity * COALESCE(f.nominal_volume_ml, 0))
          FROM billing.invoice_line l
          JOIN billing_docs d ON d.id = l.invoice_id
          LEFT JOIN catalog.product p ON p.id = l.product_id
          LEFT JOIN catalog.format f ON f.id = p.format_id
        ), 0) + COALESCE((
          SELECT sum(hl.units * COALESCE(f.nominal_volume_ml, 0))
          FROM holded_docs h
          JOIN legacy.holded_invoice_line hl
            ON hl.entity_id = h.entity_id AND hl.kind = 'sale'
           AND hl.document_number = h.number AND hl.document_date = h.issue_date AND hl.is_draft = FALSE
          LEFT JOIN catalog.product p ON p.id = hl.matched_product_id
          LEFT JOIN catalog.format f ON f.id = p.format_id
        ), 0) AS VARCHAR
      ) AS volume_ml
  `;
}

function expenseBook(from: string, to: string, entity: 'PO' | 'CVPO' | 'both'): string {
  const codes = entity === 'both' ? `'PO', 'CVPO'` : `'${entity}'`;
  return `
    SELECT CAST(COALESCE(sum(s.total), 0) AS VARCHAR) AS amount,
           CAST(COALESCE(sum(s.subtotal), 0) AS VARCHAR) AS base,
           CAST(COALESCE(sum(s.tax_total), 0) AS VARCHAR) AS tax
    FROM purchasing.supplier_invoice s
    JOIN core.legal_entity e ON e.id = s.legal_entity_id
    WHERE s.status = 'approved'
      AND COALESCE(s.accounting_date, s.issue_date) BETWEEN DATE '${from}' AND DATE '${to}'
      AND e.code IN (${codes})
  `;
}

function stockAt(date: string, entity: 'PO' | 'CVPO' | 'both'): string {
  const codes = entity === 'both' ? `'PO', 'CVPO'` : `'${entity}'`;
  return `
    SELECT CAST(COALESCE(sum(m.volume_ml), 0) AS VARCHAR) AS volume_ml,
           CAST(COALESCE(sum(m.qty_units), 0) AS VARCHAR) AS units
    FROM inventory.stock_move m
    JOIN core.legal_entity e ON e.id = m.owner_entity_id
    WHERE CAST(m.occurred_at AT TIME ZONE 'Europe/Madrid' AS DATE) <= DATE '${date}'
      AND e.code IN (${codes})
  `;
}

function expectBook(body: ReportBody, book: Book): void {
  expect(body.totals.amount).toBe(moneyText(book.amount));
  expect(body.totals.base).toBe(moneyText(book.base));
  expect(body.totals.tax).toBe(moneyText(book.tax));
  sameQty(body.totals.units, book.units);
  sameQty(body.totals.volume_ml, book.volume_ml);
  const amount = body.series.reduce((acc, point) => money.add(acc, money.fromString(point.amount)), new Decimal(0));
  const base = body.series.reduce((acc, point) => money.add(acc, money.fromString(point.base)), new Decimal(0));
  const units = body.series.reduce((acc, point) => acc.plus(point.units), new Decimal(0));
  const volume = body.series.reduce((acc, point) => acc.plus(point.volume_ml), new Decimal(0));
  expect(money.toString(amount)).toBe(body.totals.amount);
  expect(money.toString(base)).toBe(body.totals.base);
  expect(units.eq(new Decimal(body.totals.units))).toBe(true);
  expect(volume.eq(new Decimal(body.totals.volume_ml))).toBe(true);
}

describe('informes', () => {
  beforeAll(async () => {
    ctx = await createTestApp();
    const entities = await ctx.writer.read<{ id: string; code: string; tax_id: string }>(
      `SELECT id, code, tax_id FROM core.legal_entity`,
    );
    po = entities.find((row) => row.code === 'PO')?.id ?? '';
    cvpo = entities.find((row) => row.code === 'CVPO')?.id ?? '';
    poTax = entities.find((row) => row.code === 'PO')?.tax_id ?? '';
    owner = (await one<{ id: string }>(`SELECT id FROM core.app_user WHERE email = 'owner@winecore.test'`)).id;
    await loadFixture();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('cuadra las ventas con el libro de emitidas y el histórico Holded', async () => {
    const body = await report('/v1/reports/sales?from=2026-01-01&to=2026-12-31&group_by=month&entity=P.O');
    const both = await report('/v1/reports/sales?from=2026-01-01&to=2026-12-31&group_by=product');
    const bookPo = await one<Book>(salesBook('2026-01-01', '2026-12-31', 'PO'));
    const bookBoth = await one<Book>(salesBook('2026-01-01', '2026-12-31', 'both'));
    expect(body.entity).toBe('PO');
    expectBook(body, bookPo);
    expectBook(both, bookBoth);

    const naive = await one<{ amount: string }>(`
      SELECT CAST(COALESCE(sum(i.total), 0) AS VARCHAR) AS amount
      FROM billing.invoice i
      WHERE i.status = 'issued' AND i.issue_date BETWEEN DATE '2026-01-01' AND DATE '2026-12-31'
    `);
    const billingBook = await one<{ amount: string }>(`
      SELECT CAST(COALESCE(sum(i.total), 0) AS VARCHAR) AS amount
      FROM billing.invoice i
      WHERE i.status = 'issued' AND i.issue_date BETWEEN DATE '2026-01-01' AND DATE '2026-12-31'
        AND NOT EXISTS (
          SELECT 1 FROM billing.invoice_rectification r
          JOIN billing.invoice rect ON rect.id = r.rectifying_invoice_id
          WHERE r.relation = 'substituted' AND rect.status = 'issued' AND r.rectified_invoice_id = i.id
        )
    `);
    const substituted = await one<{ amount: string }>(
      `SELECT CAST(total AS VARCHAR) AS amount FROM billing.invoice WHERE id = CAST('${ID.invSubOld}' AS UUID)`,
    );
    const rect = await one<{ amount: string }>(
      `SELECT CAST(total AS VARCHAR) AS amount FROM billing.invoice WHERE id = CAST('${ID.invRect}' AS UUID)`,
    );
    expect(money.fromString(rect.amount).isNegative()).toBe(true);
    expect(moneyText(substituted.amount)).toBe(money.toString(money.sub(money.fromString(naive.amount), money.fromString(billingBook.amount))));
    expect(money.fromString(both.totals.amount).lt(money.fromString(naive.amount))).toBe(true);
    const february = body.series.find((point) => point.key === '2026-02');
    const februaryBook = await one<Book>(salesBook('2026-02-01', '2026-02-28', 'PO'));
    expect(february?.amount).toBe(moneyText(februaryBook.amount));
  });

  it('filtra la entidad y compara con el año anterior', async () => {
    const cv = await report('/v1/reports/sales?from=2026-01-01&to=2026-12-31&entity=CVPO&group_by=product');
    const bookCv = await one<Book>(salesBook('2026-01-01', '2026-12-31', 'CVPO'));
    expectBook(cv, bookCv);
    expect(cv.series).toHaveLength(1);
    expect(cv.series[0]?.key).toBe(ID.prodB);

    const compared = await report('/v1/reports/sales?from=2026-01-01&to=2026-12-31&entity=PO&group_by=month&compare=previous_year');
    const previous = await one<Book>(salesBook('2025-01-01', '2025-12-31', 'PO'));
    expect(compared.previous_totals?.amount).toBe(moneyText(previous.amount));
    const february = compared.series.find((point) => point.key === '2026-02');
    const februaryPrev = await one<Book>(salesBook('2025-02-01', '2025-02-28', 'PO'));
    expect(february?.previous?.key).toBe('2025-02');
    expect(february?.previous?.amount).toBe(moneyText(februaryPrev.amount));
    expect(compared.series).toHaveLength(12);
  });

  it('cuadra los gastos con las facturas de proveedor aprobadas', async () => {
    const body = await report('/v1/reports/expenses?from=2026-01-01&to=2026-12-31&group_by=category');
    const book = await one<{ amount: string; base: string; tax: string }>(expenseBook('2026-01-01', '2026-12-31', 'both'));
    expect(body.totals.amount).toBe(moneyText(book.amount));
    expect(body.totals.base).toBe(moneyText(book.base));
    expect(body.totals.tax).toBe(moneyText(book.tax));
    const categories = body.series.reduce((acc, point) => money.add(acc, money.fromString(point.amount)), new Decimal(0));
    expect(money.toString(categories)).toBe(body.totals.amount);
    const issueOnly = await one<{ amount: string }>(`
      SELECT CAST(COALESCE(sum(total), 0) AS VARCHAR) AS amount
      FROM purchasing.supplier_invoice
      WHERE status = 'approved' AND issue_date BETWEEN DATE '2026-01-01' AND DATE '2026-12-31'
    `);
    expect(body.totals.amount).not.toBe(moneyText(issueOnly.amount));
    const validated = await one<{ amount: string }>(
      `SELECT CAST(total AS VARCHAR) AS amount FROM purchasing.supplier_invoice WHERE id = CAST('${ID.expValidated}' AS UUID)`,
    );
    expect(money.fromString(validated.amount).gt(0)).toBe(true);

    const compared = await report('/v1/reports/expenses?from=2026-01-01&to=2026-12-31&compare=previous_year&group_by=month');
    const previous = await one<{ amount: string }>(expenseBook('2025-01-01', '2025-12-31', 'both'));
    expect(compared.previous_totals?.amount).toBe(moneyText(previous.amount));
    const po = await report('/v1/reports/expenses?from=2026-01-01&to=2026-12-31&entity=PO&group_by=month');
    const bookPo = await one<{ amount: string }>(expenseBook('2026-01-01', '2026-12-31', 'PO'));
    expect(po.totals.amount).toBe(moneyText(bookPo.amount));
  });

  it('cuadra el stock físico en los fines de mes y por entidad', async () => {
    const body = await report('/v1/reports/stock?from=2026-01-01&to=2026-04-30&group_by=month&compare=previous_year');
    const dates = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'] as const;
    for (const date of dates) {
      const point = body.series.find((row) => row.as_of === date);
      const at = await one<{ volume_ml: string; units: string }>(stockAt(date, 'both'));
      expect(point?.volume_ml).toBe(new Decimal(at.volume_ml).toFixed(0));
      sameQty(point?.units ?? '', at.units);
    }
    const closing = await one<{ volume_ml: string; units: string }>(stockAt('2026-04-30', 'both'));
    expect(body.totals.volume_ml).toBe(new Decimal(closing.volume_ml).toFixed(0));
    const januaryPrev = await one<{ volume_ml: string }>(stockAt('2025-01-31', 'both'));
    expect(body.series.find((row) => row.key === '2026-01')?.previous?.volume_ml).toBe(new Decimal(januaryPrev.volume_ml).toFixed(0));
    const aprilPrev = await one<{ volume_ml: string }>(stockAt('2025-04-30', 'both'));
    expect(body.previous_totals?.volume_ml).toBe(new Decimal(aprilPrev.volume_ml).toFixed(0));

    expect(body.series.find((row) => row.as_of === '2026-03-31')?.volume_ml).toBe('918000');
    expect(body.series.find((row) => row.as_of === '2026-04-30')?.volume_ml).toBe('868000');

    const onlyPo = await report('/v1/reports/stock?from=2026-03-01&to=2026-03-31&entity=PO&group_by=month');
    const poAt = await one<{ volume_ml: string }>(stockAt('2026-03-31', 'PO'));
    expect(onlyPo.totals.volume_ml).toBe(new Decimal(poAt.volume_ml).toFixed(0));
    expect(onlyPo.totals.volume_ml).toBe('900000');

    const lots = await report('/v1/reports/stock?from=2026-01-01&to=2026-04-30&group_by=lot');
    const lotVolume = lots.series.reduce((acc, point) => acc.plus(point.volume_ml), new Decimal(0));
    expect(lotVolume.toFixed(0)).toBe(new Decimal(closing.volume_ml).toFixed(0));
    expect(lots.totals.volume_ml).toBe(new Decimal(closing.volume_ml).toFixed(0));
  });

  it('exporta la serie en CSV', async () => {
    const response = await ctx.app.handle(new Request(
      'http://localhost/v1/reports/sales.csv?from=2026-01-01&to=2026-12-31&group_by=month&entity=PO',
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('ventas.csv');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.subarray(3));
    const rows = text.trim().split('\r\n');
    const header = rows[0]?.split(';') ?? [];
    const amountIndex = header.indexOf('Importe');
    const amount = rows.slice(1).reduce(
      (acc, line) => money.add(acc, money.fromString(line.split(';')[amountIndex] ?? '0')),
      new Decimal(0),
    );
    const json = await report('/v1/reports/sales?from=2026-01-01&to=2026-12-31&group_by=month&entity=PO');
    expect(money.toString(amount)).toBe(json.totals.amount);

    const query = await ctx.app.handle(new Request(
      'http://localhost/v1/reports/expenses?from=2026-01-01&to=2026-12-31&format=csv',
    ));
    expect(query.headers.get('content-disposition')).toContain('gastos.csv');
  });

  it('exige reports.read y rechaza parámetros inválidos', async () => {
    const cellar = await ctx.app.handle(new Request('http://localhost/v1/reports/sales?from=2026-01-01&to=2026-01-31', {
      headers: { 'X-Dev-User': 'bodega@winecore.test' },
    }));
    expect(cellar.status).toBe(403);
    const advisor = await report('/v1/reports/stock?from=2026-04-01&to=2026-04-30', 'asesor@winecore.test');
    expect(advisor.report).toBe('stock');
    const admin = await report('/v1/reports/expenses?from=2026-01-01&to=2026-01-31&group_by=customer', 'admin@winecore.test');
    expect(admin.report).toBe('expenses');
    const approver = await report('/v1/reports/sales?from=2026-01-01&to=2026-01-31', 'aprobador@winecore.test');
    expect(approver.report).toBe('sales');

    const scoped = await ctx.app.handle(new Request('http://localhost/v1/reports/sales?from=2026-01-01&to=2026-12-31&entity=PO', {
      headers: { 'X-Dev-User': 'solo.cvpo@winecore.test' },
    }));
    expect(scoped.status).toBe(403);
    const narrowed = await report('/v1/reports/sales?from=2026-01-01&to=2026-12-31&entity=ambas', 'solo.cvpo@winecore.test');
    const bookCv = await one<Book>(salesBook('2026-01-01', '2026-12-31', 'CVPO'));
    expect(narrowed.entity).toBe('CVPO');
    expect(narrowed.totals.amount).toBe(moneyText(bookCv.amount));

    const bad = await ctx.app.handle(new Request('http://localhost/v1/reports/sales?from=2026-05-01&to=2026-01-01&group_by=canal'));
    expect(bad.status).toBe(422);
    const fields = (await bad.json() as { fields?: Record<string, string> }).fields ?? {};
    expect(fields.to).toBeDefined();
    expect(fields.group_by).toBeDefined();
  });
});

describe('informes · escala x10', () => {
  it('responde en menos de un segundo', async () => {
    const app = await createTestApp();
    try {
      const loaded = await seedDemo(app.writer, { nodeEnv: 'test', dbMode: 'local' }, 'x10');
      expect(loaded.contacts).toBe(1501);
      await app.client.query(`
        INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, year, prefix)
        SELECT '019b1000-0000-7000-8000-00000000c001', id, 'invoice', 'PF', 2026, 'PF26-'
        FROM core.legal_entity WHERE code = 'PO';
        INSERT INTO billing.invoice (
          id, legal_entity_id, series_id, number, status, invoice_type, issue_date, customer_id,
          customer_snapshot, subtotal, tax_total, surcharge_total, withholding_total, total, issued_at, created_by
        )
        SELECT p.id, e.id, s.id, printf('PF%06d', p.n), 'issued', 'F1', DATE '2026-06-15', c.id,
               '{"legal_name":"Cliente sintetico"}'::JSON,
               10.00, 2.10, 0, 0, 12.10, TIMESTAMPTZ '2026-06-15 10:00:00+00', 'synthetic'
        FROM (
          SELECT id, sku, name, row_number() OVER (ORDER BY sku) AS n FROM catalog.product
        ) p
        CROSS JOIN (SELECT id FROM core.legal_entity WHERE code = 'PO') e
        CROSS JOIN (SELECT id FROM core.number_series WHERE prefix = 'PF26-') s
        CROSS JOIN (SELECT id FROM party.contact WHERE is_customer LIMIT 1) c;
        INSERT INTO billing.invoice_line (
          id, invoice_id, line_no, product_id, sku, description, quantity, unit, unit_price, line_base, tax_code
        )
        SELECT gen_random_uuid(), p.id, 1, p.id, p.sku, substr(p.name, 1, 250), 2, 'ud', 5, 10.00, 'IVA21'
        FROM catalog.product p;
      `);
      const startedSales = performance.now();
      const sales = await app.app.handle(new Request(
        'http://localhost/v1/reports/sales?from=2026-01-01&to=2026-12-31&group_by=product',
      ));
      const salesBody = await sales.json() as ReportBody;
      const salesMs = performance.now() - startedSales;
      expect(sales.status).toBe(200);
      const expected = await app.writer.read<{ amount: string; products: number }>(`
        SELECT CAST(COALESCE(sum(total), 0) AS VARCHAR) AS amount, count(*)::INTEGER AS products
        FROM billing.invoice WHERE status = 'issued'
      `);
      expect(salesBody.totals.amount).toBe(moneyText(expected[0]?.amount ?? '0'));
      expect(salesBody.series.length).toBe(Number(expected[0]?.products ?? 0));

      const startedStock = performance.now();
      const stock = await app.app.handle(new Request(
        'http://localhost/v1/reports/stock?from=2026-01-01&to=2026-12-31&group_by=lot',
      ));
      const stockBody = await stock.json() as ReportBody;
      const stockMs = performance.now() - startedStock;
      expect(stock.status).toBe(200);
      const volume = await app.writer.read<{ volume_ml: string; lots: number }>(`
        SELECT CAST(COALESCE(sum(volume_ml), 0) AS VARCHAR) AS volume_ml, count(*)::INTEGER AS lots
        FROM inventory.stock_move
      `);
      expect(stockBody.totals.volume_ml).toBe(new Decimal(volume[0]?.volume_ml ?? '0').toFixed(0));
      expect(stockBody.series.length).toBe(Number(volume[0]?.lots ?? 0));
      expect(salesMs).toBeLessThan(1000);
      expect(stockMs).toBeLessThan(1000);
    } finally {
      await app.close();
    }
  }, 180_000);
});

async function loadFixture(): Promise<void> {
  await exec(sql`
    INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, is_customer, created_by)
    VALUES (CAST(${ID.customer} AS UUID), 'company', 'Vinoteca La Encina', 'A12345674', 'nif', TRUE, 'synthetic')
  `);
  await exec(sql`
    INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, is_supplier, created_by)
    VALUES (CAST(${ID.supplier} AS UUID), 'company', 'Corchos Ejemplo', 'B12345678', 'nif', TRUE, 'synthetic')
  `);
  await exec(sql`
    INSERT INTO catalog.wine (id, code, name, color, category) VALUES
      (CAST(${ID.wineA} AS UUID), 'ARCAL', 'Arcal', 'red', 'pdo_wine'),
      (CAST(${ID.wineB} AS UUID), 'ENTRE', 'Entredicho', 'white', 'wine')
  `);
  await exec(sql`
    INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml) VALUES
      (CAST(${ID.fmt75} AS UUID), 'B075', 'Botella 75 cl', 'bottle', 750),
      (CAST(${ID.fmt150} AS UUID), 'B150', 'Magnum 1,5 l', 'bottle', 1500)
  `);
  await exec(sql`
    INSERT INTO catalog.product (id, sku, name, kind, wine_id, vintage, format_id, requires_lot)
    VALUES
      (CAST(${ID.prodA} AS UUID), 'ARCAL-2025-B075', 'Arcal 2025 75 cl', 'wine', CAST(${ID.wineA} AS UUID), 2025, CAST(${ID.fmt75} AS UUID), TRUE),
      (CAST(${ID.prodB} AS UUID), 'ENTRE-2025-B150', 'Entredicho 2025 magnum', 'wine', CAST(${ID.wineB} AS UUID), 2025, CAST(${ID.fmt150} AS UUID), TRUE)
  `);
  await exec(sql`
    INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id) VALUES
      (CAST(${ID.locPo} AS UUID), 'BOD', 'Bodega', 'cellar', CAST(${po} AS UUID)),
      (CAST(${ID.locCv} AS UUID), 'VLC', 'Valencia', 'own_warehouse', CAST(${cvpo} AS UUID))
  `);
  await exec(sql`
    INSERT INTO cellar.vessel (id, code, name, kind, capacity_ml, material, location_id)
    VALUES (CAST(${ID.vessel} AS UUID), 'INOX-01', 'Deposito 1', 'tank_storage', 50000000, 'stainless_steel', CAST(${ID.locPo} AS UUID))
  `);
  await exec(sql`
    INSERT INTO inventory.lot (id, producer_entity_id, code, kind, wine_id, vintage, origin) VALUES
      (CAST(${ID.lotA} AS UUID), CAST(${po} AS UUID), 'L26-ARCAL-001', 'wine', CAST(${ID.wineA} AS UUID), 2025, 'opening_count'),
      (CAST(${ID.lotB} AS UUID), CAST(${cvpo} AS UUID), 'L26-ENTRE-001', 'bottled', CAST(${ID.wineB} AS UUID), 2025, 'opening_count')
  `);
  await exec(sql`
    INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, year, prefix) VALUES
      (CAST(${ID.seriesF26} AS UUID), CAST(${po} AS UUID), 'invoice', 'F', 2026, 'F26-'),
      (CAST(${ID.seriesR26} AS UUID), CAST(${po} AS UUID), 'invoice', 'R', 2026, 'R26-'),
      (CAST(${ID.seriesF25} AS UUID), CAST(${po} AS UUID), 'invoice', 'F', 2025, 'F25-'),
      (CAST(${ID.seriesC26} AS UUID), CAST(${cvpo} AS UUID), 'invoice', 'C', 2026, 'C26-')
  `);

  await invoice({
    id: ID.invOrig, entity: po, series: ID.seriesF26, number: 'F26-0001', status: 'issued', type: 'F1',
    date: '2026-02-10', base: '100.00', tax: '21.00', total: '121.00',
  });
  await line(ID.invOrig, 1, ID.prodA, 'ARCAL-2025-B075', '10', '10', '100.00', ID.lotA, 'L26-ARCAL-001');
  await invoice({
    id: ID.invRect, entity: po, series: ID.seriesR26, number: 'R26-0001', status: 'issued', type: 'R1',
    kind: 'I', date: '2026-02-20', base: '-20.00', tax: '-4.20', total: '-24.20',
  });
  await line(ID.invRect, 1, ID.prodA, 'ARCAL-2025-B075', '-2', '10', '-20.00', ID.lotA, 'L26-ARCAL-001');
  await rectification(ID.invRect, ID.invOrig, 'F26-0001', '2026-02-10', 'rectified');
  await invoice({
    id: ID.invSubOld, entity: po, series: ID.seriesF26, number: 'F26-0002', status: 'issued', type: 'F1',
    date: '2026-04-02', base: '80.00', tax: '16.80', total: '96.80',
  });
  await line(ID.invSubOld, 1, ID.prodA, 'ARCAL-2025-B075', '8', '10', '80.00', ID.lotA, 'L26-ARCAL-001');
  await invoice({
    id: ID.invSubNew, entity: po, series: ID.seriesR26, number: 'R26-0002', status: 'issued', type: 'R1',
    kind: 'S', date: '2026-05-04', base: '50.00', tax: '10.50', total: '60.50',
  });
  await line(ID.invSubNew, 1, ID.prodA, 'ARCAL-2025-B075', '5', '10', '50.00', ID.lotA, 'L26-ARCAL-001');
  await rectification(ID.invSubNew, ID.invSubOld, 'F26-0002', '2026-04-02', 'substituted');
  await invoice({
    id: ID.invVoid, entity: po, series: ID.seriesF26, number: 'F26-0003', status: 'voided', type: 'F1',
    date: '2026-06-01', base: '40.00', tax: '8.40', total: '48.40', voided: true,
  });
  await line(ID.invVoid, 1, ID.prodA, 'ARCAL-2025-B075', '4', '10', '40.00', ID.lotA, 'L26-ARCAL-001');
  await invoice({
    id: ID.invDraft, entity: po, series: ID.seriesF26, number: null, status: 'draft', type: 'F1',
    date: '2026-06-02', base: '30.00', tax: '6.30', total: '36.30',
  });
  await invoice({
    id: ID.invCv, entity: cvpo, series: ID.seriesC26, number: 'C26-0001', status: 'issued', type: 'F1',
    date: '2026-07-08', base: '90.00', tax: '18.90', total: '108.90',
  });
  await line(ID.invCv, 1, ID.prodB, 'ENTRE-2025-B150', '6', '15', '90.00', ID.lotB, 'L26-ENTRE-001');
  await invoice({
    id: ID.invPrev, entity: po, series: ID.seriesF25, number: 'F25-0001', status: 'issued', type: 'F1',
    date: '2025-02-12', base: '20.00', tax: '4.20', total: '24.20',
  });
  await line(ID.invPrev, 1, ID.prodA, 'ARCAL-2025-B075', '2', '10', '20.00', ID.lotA, 'L26-ARCAL-001');
  await invoice({
    id: ID.invHSub, entity: po, series: ID.seriesR26, number: 'R26-0003', status: 'issued', type: 'R1',
    kind: 'S', date: '2026-08-01', base: '10.00', tax: '2.10', total: '12.10',
  });
  await line(ID.invHSub, 1, ID.prodA, 'ARCAL-2025-B075', '1', '10', '10.00', ID.lotA, 'L26-ARCAL-001');
  await exec(sql`
    INSERT INTO billing.invoice_rectification (
      id, rectifying_invoice_id, rectified_number, rectified_issue_date, rectified_issuer_tax_id, relation, reason
    ) VALUES (
      CAST('019b1000-0000-7000-8000-000000000189' AS UUID), CAST(${ID.invHSub} AS UUID),
      'H-9', CAST('2026-03-03' AS DATE), ${poTax}, 'substituted', 'Sustituye una factura de Holded'
    )
  `);

  await exec(sql`
    INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
    VALUES (
      CAST(${ID.batch} AS UUID), 'holded', CAST(${po} AS UUID), 'sales_invoices',
      'emitidas.csv', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'load', 'synthetic'
    )
  `);
  await holded(ID.hSale, 'H-1', '2026-04-15', 'Pagado', '40.00', '8.40', '48.40');
  await holdedLine(ID.hSale, 'H-1', '2026-04-15', '4', '40.00', ID.prodA);
  await holded(ID.hVoid, 'H-VOID', '2026-04-16', 'Anulado', '63.64', '13.36', '77.00');
  await holded(ID.hDup, 'F26-0001', '2026-02-10', 'Pagado', '55.00', '11.66', '66.66');
  await holded(ID.hSub, 'H-9', '2026-03-03', 'Pagado', '57.85', '12.15', '70.00');
  await holdedLine(ID.hSub, 'H-9', '2026-03-03', '7', '57.85', ID.prodA);

  await expense({
    id: ID.expPo, entity: po, number: 'G-1', status: 'approved', category: 'packaging',
    issue: '2026-03-01', accounting: '2026-03-01', base: '80.00', tax: '16.80', total: '96.80',
  });
  await expenseLine(ID.expPo, 1, 'Botellas', '10', '8', '80.00', '16.80', '602', ID.prodA);
  await expense({
    id: ID.expCv, entity: cvpo, number: 'G-2', status: 'approved', category: 'transport',
    issue: '2026-03-20', accounting: '2026-03-20', base: '40.00', tax: '8.40', total: '48.40',
  });
  await expenseLine(ID.expCv, 1, 'Porte', '1', '40', '40.00', '8.40', '624', null);
  await expense({
    id: ID.expAbono, entity: po, number: 'G-3', status: 'approved', category: 'packaging',
    issue: '2026-03-28', accounting: '2026-03-28', base: '-10.00', tax: '-2.10', total: '-12.10',
  });
  await expenseLine(ID.expAbono, 1, 'Abono botellas', '-1', '10', '-10.00', '-2.10', '602', ID.prodA);
  await expense({
    id: ID.expValidated, entity: po, number: 'G-4', status: 'validated', category: 'packaging',
    issue: '2026-03-01', accounting: '2026-03-01', base: '413.22', tax: '86.78', total: '500.00',
  });
  await expense({
    id: ID.expRejected, entity: po, number: 'G-5', status: 'rejected', category: 'other_services',
    issue: '2026-03-01', accounting: '2026-03-01', base: '247.93', tax: '52.07', total: '300.00',
  });
  await expense({
    id: ID.expPrev, entity: po, number: 'G-6', status: 'approved', category: 'professional',
    issue: '2025-06-01', accounting: '2025-06-01', base: '15.00', tax: '3.15', total: '18.15',
  });
  await expenseLine(ID.expPrev, 1, 'Asesoria', '1', '15', '15.00', '3.15', '623', null);
  await expense({
    id: ID.expAcct, entity: po, number: 'G-7', status: 'approved', category: 'packaging',
    issue: '2025-12-20', accounting: '2026-01-10', base: '5.00', tax: '1.05', total: '6.05',
  });
  await expenseLine(ID.expAcct, 1, 'Cajas', '1', '5', '5.00', '1.05', '602', ID.prodA);

  await move('019b1000-0000-7000-8000-0000000000c1', '2025-01-10T10:00:00.000Z', 'opening', po, ID.locPo, ID.vessel, ID.lotA, null, 'wine', 0, 5000);
  await move('019b1000-0000-7000-8000-0000000000c2', '2026-01-05T10:00:00.000Z', 'delivery_out', po, ID.locPo, ID.vessel, ID.lotA, null, 'wine', 0, -5000);
  await move('019b1000-0000-7000-8000-0000000000c3', '2026-01-15T10:00:00.000Z', 'opening', po, ID.locPo, ID.vessel, ID.lotA, null, 'wine', 0, 1000000);
  await move('019b1000-0000-7000-8000-0000000000c4', '2026-02-01T10:00:00.000Z', 'opening', cvpo, ID.locCv, null, ID.lotB, ID.prodB, 'packaged_labeled', 24, 18000);
  await move('019b1000-0000-7000-8000-0000000000c5', '2026-03-10T10:00:00.000Z', 'delivery_out', po, ID.locPo, ID.vessel, ID.lotA, null, 'wine', 0, -100000);
  await move('019b1000-0000-7000-8000-0000000000c6', '2026-03-31T22:30:00.000Z', 'delivery_out', po, ID.locPo, ID.vessel, ID.lotA, null, 'wine', 0, -50000);
  await move('019b1000-0000-7000-8000-0000000000c7', '2026-05-02T10:00:00.000Z', 'delivery_out', po, ID.locPo, ID.vessel, ID.lotA, null, 'wine', 0, -1000);

  await exec(sql`
    INSERT INTO core.app_user (id, email, display_name, status) VALUES
      (CAST(${ID.approver} AS UUID), 'aprobador@winecore.test', 'Aprobador', 'active'),
      (CAST(${ID.scoped} AS UUID), 'solo.cvpo@winecore.test', 'Solo CVPO', 'active')
  `);
  await exec(sql`
    INSERT INTO core.user_role (id, user_id, role_code) VALUES
      (CAST(${ID.approverRole} AS UUID), CAST(${ID.approver} AS UUID), 'approver')
  `);
  await exec(sql`
    INSERT INTO core.user_role (id, user_id, role_code, legal_entity_id) VALUES
      (CAST(${ID.scopedRole} AS UUID), CAST(${ID.scoped} AS UUID), 'approver', CAST(${cvpo} AS UUID))
  `);
}

async function invoice(row: {
  id: string;
  entity: string;
  series: string;
  number: string | null;
  status: string;
  type: string;
  kind?: string;
  date: string;
  base: string;
  tax: string;
  total: string;
  voided?: boolean;
}): Promise<void> {
  const issued = row.status === 'issued' || row.status === 'voided';
  await exec(sql`
    INSERT INTO billing.invoice (
      id, legal_entity_id, series_id, number, status, invoice_type, rectification_kind,
      issue_date, customer_id, customer_snapshot, subtotal, tax_total, surcharge_total, withholding_total, total,
      issued_at, voided_at, void_reason, created_by
    ) VALUES (
      CAST(${row.id} AS UUID), CAST(${row.entity} AS UUID), CAST(${row.series} AS UUID), ${row.number},
      ${row.status}, ${row.type}, ${row.kind ?? null}, CAST(${row.date} AS DATE), CAST(${ID.customer} AS UUID),
      ${issued ? sql.json({ legal_name: 'Vinoteca La Encina', tax_id: 'A12345674' }) : null},
      CAST(${row.base} AS DECIMAL(14,2)), CAST(${row.tax} AS DECIMAL(14,2)),
      CAST('0.00' AS DECIMAL(14,2)), CAST('0.00' AS DECIMAL(14,2)), CAST(${row.total} AS DECIMAL(14,2)),
      ${issued ? new Date(`${row.date}T10:00:00.000Z`) : null},
      ${row.voided ? new Date(`${row.date}T11:00:00.000Z`) : null},
      ${row.voided ? 'Emitida por error' : null},
      'synthetic'
    )
  `);
}

async function line(
  invoiceId: string,
  lineNo: number,
  productId: string,
  sku: string,
  quantity: string,
  unitPrice: string,
  lineBase: string,
  lotId: string,
  lotCode: string,
): Promise<void> {
  await exec(sql`
    INSERT INTO billing.invoice_line (
      id, invoice_id, line_no, product_id, sku, description, lot_id, lot_code,
      quantity, unit, unit_price, line_base, tax_code
    ) VALUES (
      gen_random_uuid(), CAST(${invoiceId} AS UUID), ${lineNo}, CAST(${productId} AS UUID), ${sku}, ${sku},
      CAST(${lotId} AS UUID), ${lotCode}, CAST(${quantity} AS DECIMAL(14,3)), 'ud',
      CAST(${unitPrice} AS DECIMAL(14,6)), CAST(${lineBase} AS DECIMAL(14,2)), 'IVA21'
    )
  `);
}

async function rectification(
  rectifying: string,
  rectified: string,
  number: string,
  date: string,
  relation: string,
): Promise<void> {
  await exec(sql`
    INSERT INTO billing.invoice_rectification (
      id, rectifying_invoice_id, rectified_invoice_id, rectified_number, rectified_issue_date,
      rectified_issuer_tax_id, relation, reason
    ) VALUES (
      gen_random_uuid(), CAST(${rectifying} AS UUID), CAST(${rectified} AS UUID), ${number},
      CAST(${date} AS DATE), ${poTax}, ${relation}, 'Correccion de la operacion'
    )
  `);
}

async function holded(
  id: string,
  number: string,
  date: string,
  status: string,
  subtotal: string,
  vat: string,
  total: string,
): Promise<void> {
  await exec(sql`
    INSERT INTO legacy.holded_invoice (
      id, batch_id, entity_id, kind, number, issue_date, counterparty_name, counterparty_contact_id,
      subtotal, vat, total, status_holded, raw
    ) VALUES (
      CAST(${id} AS UUID), CAST(${ID.batch} AS UUID), CAST(${po} AS UUID), 'sale', ${number},
      CAST(${date} AS DATE), 'Vinoteca La Encina', CAST(${ID.customer} AS UUID),
      CAST(${subtotal} AS DECIMAL(14,2)), CAST(${vat} AS DECIMAL(14,2)), CAST(${total} AS DECIMAL(14,2)),
      ${status}, ${sql.json({})}
    )
  `);
}

async function holdedLine(
  id: string,
  number: string,
  date: string,
  units: string,
  subtotal: string,
  productId: string,
): Promise<void> {
  await exec(sql`
    INSERT INTO legacy.holded_invoice_line (
      id, batch_id, entity_id, kind, document_number, document_date, line_seq, description,
      units, subtotal, total, matched_product_id, raw
    ) VALUES (
      gen_random_uuid(), CAST(${ID.batch} AS UUID), CAST(${po} AS UUID), 'sale', ${number},
      CAST(${date} AS DATE), 1, 'Arcal', CAST(${units} AS DECIMAL(14,3)),
      CAST(${subtotal} AS DECIMAL(14,2)), CAST(${subtotal} AS DECIMAL(14,2)),
      CAST(${productId} AS UUID), ${sql.json({})}
    )
  `);
  void id;
}

async function expense(row: {
  id: string;
  entity: string;
  number: string;
  status: string;
  category: string;
  issue: string;
  accounting: string;
  base: string;
  tax: string;
  total: string;
}): Promise<void> {
  await exec(sql`
    INSERT INTO purchasing.supplier_invoice (
      id, legal_entity_id, supplier_id, supplier_invoice_number, issue_date, accounting_date,
      source, status, category_code, subtotal, tax_total, total, approved_by, approved_at,
      rejection_reason, created_by
    ) VALUES (
      CAST(${row.id} AS UUID), CAST(${row.entity} AS UUID), CAST(${ID.supplier} AS UUID), ${row.number},
      CAST(${row.issue} AS DATE), CAST(${row.accounting} AS DATE), 'upload', ${row.status}, ${row.category},
      CAST(${row.base} AS DECIMAL(14,2)), CAST(${row.tax} AS DECIMAL(14,2)), CAST(${row.total} AS DECIMAL(14,2)),
      CAST(${row.status === 'approved' ? owner : null} AS UUID),
      ${row.status === 'approved' ? new Date(`${row.accounting}T12:00:00.000Z`) : null},
      ${row.status === 'rejected' ? 'Documento ilegible' : null},
      'synthetic'
    )
  `);
}

async function expenseLine(
  invoiceId: string,
  lineNo: number,
  description: string,
  quantity: string,
  unitPrice: string,
  lineBase: string,
  vat: string,
  account: string,
  productId: string | null,
): Promise<void> {
  await exec(sql`
    INSERT INTO purchasing.supplier_invoice_line (
      id, supplier_invoice_id, line_no, description, product_id, expense_account,
      quantity, unit_price, line_base, vat_quota
    ) VALUES (
      gen_random_uuid(), CAST(${invoiceId} AS UUID), ${lineNo}, ${description},
      CAST(${productId} AS UUID),
      ${account}, CAST(${quantity} AS DECIMAL(14,3)), CAST(${unitPrice} AS DECIMAL(14,6)),
      CAST(${lineBase} AS DECIMAL(14,2)), CAST(${vat} AS DECIMAL(14,2))
    )
  `);
}

async function move(
  id: string,
  at: string,
  moveType: string,
  ownerId: string,
  locationId: string,
  vesselId: string | null,
  lotId: string,
  productId: string | null,
  state: string,
  units: number,
  volume: number,
): Promise<void> {
  await exec(sql`
    INSERT INTO inventory.stock_move (
      id, occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_id,
      product_state, qty_units, volume_ml, source_table, source_id, created_by
    ) VALUES (
      CAST(${id} AS UUID), CAST(${at} AS TIMESTAMPTZ), ${moveType}, CAST(${locationId} AS UUID),
      CAST(${vesselId} AS UUID),
      CAST(${ownerId} AS UUID), CAST(${lotId} AS UUID),
      CAST(${productId} AS UUID),
      ${state}, ${units}, ${volume}, 'inventory.lot', CAST(${lotId} AS UUID), 'synthetic'
    )
  `);
}
