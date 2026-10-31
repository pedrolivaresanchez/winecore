import { Decimal } from 'decimal.js';
import { normalizeName } from '../../../src/core/party/duplicateKey';
import type { KbClient } from '../../../src/core/db/client';
import { sql } from '../../../src/core/db/sql';
import { canonicalJson } from '../../../src/core/db/audit';
import { sha256Hex } from '../../../src/core/hash';
import { newId } from '../../../src/core/ids';
import type { WriteOp } from '../apply';
import type { FileRole } from '../classify';
import { cleanText, fixedMoney, integerText, moneyOrZero, parseDate, parseLooseDecimal } from '../money';
import { bump, positive, type MigrationReport, type MigrationSource } from '../report';
import type { HoldedTable } from '../xlsx';

export type HistoryKind = 'sale' | 'purchase' | 'delivery_note' | 'quote';

export function lineKindOf(filePath: string, headers: readonly string[]): HistoryKind {
  const path = filePath.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (path.includes('albaran')) return 'delivery_note';
  if (path.includes('presupuesto')) return 'quote';
  if (path.includes('compra') || headers.includes('Num interno')) return 'purchase';
  return 'sale';
}

export function isCreditDocument(number: string, total: Decimal): boolean {
  return total.lt(0) || /^CN/i.test(number.trim());
}

export function paymentMethodOf(label: string | null | undefined): string {
  const value = cleanText(label).toLowerCase();
  if (value.includes('transfer')) return 'transfer';
  if (value.includes('domicil') || value.includes('recibo') || value.includes('sepa')) return 'direct_debit';
  if (value.includes('tarjeta')) return 'card';
  if (value.includes('contado') || value.includes('efectivo')) return 'cash';
  if (value.includes('compens')) return 'compensation';
  return 'other';
}

export function quoteStatusOf(estado: string, invoiced: string): string {
  const billed = cleanText(invoiced).toLowerCase();
  if (billed === 'facturado') return 'converted';
  const status = cleanText(estado).toLowerCase();
  if (status === 'aceptado' || status === 'aceptada') return 'accepted';
  if (status === 'rechazado' || status === 'rechazada') return 'rejected';
  if (status === 'borrador') return 'draft';
  return 'sent';
}

export function deliveryInvoicingOf(estado: string): string {
  const value = cleanText(estado).toLowerCase();
  if (value === 'facturado') return 'invoiced';
  if (value.startsWith('parcial')) return 'partially_invoiced';
  return 'not_invoiced';
}

export function expenseCategoryOf(account: string | null | undefined): string | null {
  const digits = cleanText(account).replace(/\D/g, '').slice(0, 3);
  const table: Record<string, string> = {
    '600': 'goods_for_resale',
    '601': 'grapes',
    '602': 'oenological',
    '621': 'rent',
    '623': 'professional',
    '624': 'transport',
    '627': 'marketing',
    '628': 'utilities',
    '629': 'other_services',
  };
  return table[digits] ?? null;
}

export async function planHistory(input: {
  client: KbClient;
  source: MigrationSource;
  entity: string;
  entityId: string;
  fileSha256: string;
  filePath: string;
  role: FileRole;
  table: HoldedTable;
  batchId: string;
  now: Date;
}): Promise<{ ops: WriteOp[]; report: MigrationReport }> {
  if (input.role === 'lines') return planLines(input);
  if (input.role === 'delivery_note') return planDeliveries(input);
  if (input.role === 'quote') return planQuotes(input);
  if (input.role === 'product') return planProducts(input);
  throw new Error('DATASET_FILE_MISMATCH');
}

export async function historyBatch(client: KbClient, fileSha256: string): Promise<{ id: string; finished: boolean } | null> {
  const rows = await client.query<{ id: string; finished_at: string | null }>(sql`
    SELECT id, finished_at
    FROM legacy.import_batch
    WHERE file_sha256 = ${fileSha256} AND dataset = 'history' AND mode = 'load'
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return { id: String(row.id), finished: row.finished_at != null && String(row.finished_at) !== '' };
}

async function planLines(input: Parameters<typeof planHistory>[0]): Promise<{ ops: WriteOp[]; report: MigrationReport }> {
  const kind = lineKindOf(input.filePath, input.table.headers);
  const skipped: Record<string, number> = {};
  const seq = new Map<string, number>();
  const ops: WriteOp[] = [];
  let subtotal = new Decimal(0);
  let total = new Decimal(0);
  for (const row of input.table.rows) {
    const documentDate = parseDate(row.Fecha);
    const documentNumber = integerText(row['Num factura']);
    if (!documentDate || documentNumber === '') {
      bump(skipped, 'no_key');
      continue;
    }
    const key = `${documentNumber}|${documentDate}`;
    const lineSeq = (seq.get(key) ?? 0) + 1;
    seq.set(key, lineSeq);
    const lineSubtotal = moneyOrZero(row.Subtotal);
    const lineTotal = moneyOrZero(row.Total);
    subtotal = subtotal.plus(lineSubtotal);
    total = total.plus(lineTotal);
    const id = newId();
    const draft = cleanText(row.Borrador).toLowerCase();
    ops.push({
      sql: sql`
        INSERT INTO legacy.holded_invoice_line (
          id, batch_id, entity_id, kind, document_number, document_date, due_date, line_seq,
          description, is_draft, counterparty_name, counterparty_tax_id, postal_code, city, country,
          sku, item, tags, account_label, units, subtotal, tax_rate_label, tax_amount, total, raw
        ) VALUES (
          CAST(${id} AS UUID),
          CAST(${input.batchId} AS UUID),
          CAST(${input.entityId} AS UUID),
          ${kind},
          ${documentNumber},
          CAST(${documentDate} AS DATE),
          CAST(${parseDate(row['Fecha de vencimiento'])} AS DATE),
          ${lineSeq},
          ${cleanText(row['Descripción'] || row.Item) || null},
          ${draft === 'si' || draft === 'sí' || draft === 'yes'},
          ${cleanText(row.Contacto) || null},
          ${cleanText(row['ID Contacto']) || null},
          ${cleanText(row['Código postal']) || null},
          ${cleanText(row['Población']) || null},
          ${cleanText(row['País']) || null},
          ${cleanText(row.SKU) || null},
          ${cleanText(row.Item) || null},
          ${cleanText(row.Tags) || null},
          ${cleanText(row.Cuenta) || null},
          ${decimalOrNull(row.Unidades, 3)},
          ${lineSubtotal},
          ${cleanText(row.Impuestos) || null},
          ${moneyOrZero(row['Importe Impuestos'])},
          ${lineTotal},
          ${sql.json(row)}
        )
        ON CONFLICT (entity_id, kind, document_number, document_date, line_seq) DO NOTHING
      `,
      audit: {
        table: 'legacy.holded_invoice_line',
        rowId: id,
        action: 'INSERT',
        before: null,
        after: { kind, line_seq: lineSeq },
      },
    });
  }
  return {
    ops,
    report: reportOf(input, input.table.rows.length, ops.length, skipped, { subtotal: fixedMoney(subtotal), total: fixedMoney(total) }, { documents: seq.size, kind_sale: kind === 'sale' ? 1 : 0 }),
  };
}

async function planDeliveries(input: Parameters<typeof planHistory>[0]): Promise<{ ops: WriteOp[]; report: MigrationReport }> {
  const skipped: Record<string, number> = {};
  const ops: WriteOp[] = [];
  let subtotal = new Decimal(0);
  let total = new Decimal(0);
  const seen = new Set<string>();
  for (const row of input.table.rows) {
    const issueDate = parseDate(row.Fecha);
    const number = integerText(row.Num);
    if (!issueDate || number === '') {
      bump(skipped, 'no_key');
      continue;
    }
    const key = `${number}|${issueDate}`;
    if (seen.has(key)) {
      bump(skipped, 'duplicate_key');
      continue;
    }
    seen.add(key);
    const rowSubtotal = moneyOrZero(row.Subtotal);
    const rowTotal = moneyOrZero(row.Total);
    subtotal = subtotal.plus(rowSubtotal);
    total = total.plus(rowTotal);
    const id = newId();
    const status = cleanText(row.Facturado_estado || row.Facturado) || 'Pendiente';
    ops.push({
      sql: sql`
        INSERT INTO legacy.holded_delivery_note (
          id, batch_id, entity_id, number, issue_date, destination, shipping, tags, description,
          channel_label, warehouse_label, payment_method, units, vat, withholding, surcharge,
          subtotal, total, invoiced_amount, invoiced_status, raw
        ) VALUES (
          CAST(${id} AS UUID),
          CAST(${input.batchId} AS UUID),
          CAST(${input.entityId} AS UUID),
          ${number},
          CAST(${issueDate} AS DATE),
          ${cleanText(row.Destino) || null},
          ${cleanText(row['Envío']) || null},
          ${cleanText(row.Tags) || null},
          ${cleanText(row['Descripción']) || null},
          ${cleanText(row.Canal) || null},
          ${cleanText(row['Almacén']) || null},
          ${cleanText(row['F.Pago']) || null},
          ${decimalOrNull(row.Unidades, 3)},
          ${moneyOrZero(row.IVA)},
          ${moneyOrZero(row['Retención']).abs()},
          ${moneyOrZero(row['Rec. de eq.'])},
          ${rowSubtotal},
          ${rowTotal},
          ${moneyOrZero(row.Facturado_importe)},
          ${status},
          ${sql.json(row)}
        )
        ON CONFLICT (entity_id, number, issue_date) DO NOTHING
      `,
      audit: {
        table: 'legacy.holded_delivery_note',
        rowId: id,
        action: 'INSERT',
        before: null,
        after: { invoiced_status: deliveryInvoicingOf(status) },
      },
    });
  }
  return {
    ops,
    report: reportOf(input, input.table.rows.length, ops.length, skipped, { subtotal: fixedMoney(subtotal), total: fixedMoney(total) }, { documents: ops.length }),
  };
}

async function planQuotes(input: Parameters<typeof planHistory>[0]): Promise<{ ops: WriteOp[]; report: MigrationReport }> {
  const names = await contactNames(input.client, input.entityId, input.entity);
  const skipped: Record<string, number> = {};
  const ops: WriteOp[] = [];
  let subtotal = new Decimal(0);
  let total = new Decimal(0);
  const seen = new Set<string>();
  for (const row of input.table.rows) {
    const issueDate = parseDate(row.Fecha);
    const number = integerText(row.Num);
    if (!issueDate || number === '') {
      bump(skipped, 'no_key');
      continue;
    }
    const key = `${number}|${issueDate}`;
    if (seen.has(key)) {
      bump(skipped, 'duplicate_key');
      continue;
    }
    seen.add(key);
    const rowSubtotal = moneyOrZero(row.Subtotal);
    const rowTotal = moneyOrZero(row.Total);
    subtotal = subtotal.plus(rowSubtotal);
    total = total.plus(rowTotal);
    const id = newId();
    const contact = linkContact(names, row.Cliente);
    const status = cleanText(row.Estado) || 'Pendiente';
    ops.push(quoteInsert(id, input, row, number, issueDate, contact, status, rowSubtotal, rowTotal));
  }
  return {
    ops,
    report: reportOf(input, input.table.rows.length, ops.length, skipped, { subtotal: fixedMoney(subtotal), total: fixedMoney(total) }, { documents: ops.length }),
  };
}

function quoteInsert(
  id: string,
  input: Parameters<typeof planHistory>[0],
  row: Record<string, string>,
  number: string,
  issueDate: string,
  contact: string | null,
  status: string,
  rowSubtotal: Decimal,
  rowTotal: Decimal,
): WriteOp {
  return {
    sql: sql`
      INSERT INTO legacy.holded_quote (
        id, batch_id, entity_id, number, issue_date, valid_until, counterparty_name, counterparty_contact_id,
        description, tags, subtotal, vat, total, invoiced_total, paid_on_account, status_holded, invoiced_status, raw
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${input.batchId} AS UUID),
        CAST(${input.entityId} AS UUID),
        ${number},
        CAST(${issueDate} AS DATE),
        CAST(${parseDate(row.Vencimiento)} AS DATE),
        ${cleanText(row.Cliente) || 'Sin nombre'},
        CASE WHEN ${contact} IS NULL THEN NULL ELSE CAST(${contact} AS UUID) END,
        ${cleanText(row['Descripción']) || null},
        ${cleanText(row.Tags) || null},
        ${rowSubtotal},
        ${moneyOrZero(row.IVA).plus(moneyOrZero(row.IVA_2))},
        ${rowTotal},
        ${moneyOrZero(row['Total facturado'])},
        ${moneyOrZero(row['Pagos a cuenta'])},
        ${status},
        ${cleanText(row.Facturado) || null},
        ${sql.json(row)}
      )
      ON CONFLICT (entity_id, number, issue_date) DO NOTHING
    `,
    audit: {
      table: 'legacy.holded_quote',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { status: quoteStatusOf(status, row.Facturado ?? '') },
    },
  };
}

async function planProducts(input: Parameters<typeof planHistory>[0]): Promise<{ ops: WriteOp[]; report: MigrationReport }> {
  const skipped: Record<string, number> = {};
  const ops: WriteOp[] = [];
  const catalog = await catalogIndex(input.client);
  let sale = new Decimal(0);
  for (const row of input.table.rows) {
    const name = cleanText(row.Nombre).slice(0, 500);
    if (name === '') {
      bump(skipped, 'no_key');
      continue;
    }
    const sku = cleanText(row.SKU);
    const saleValue = parseLooseDecimal(row['Valor venta']);
    if (saleValue && saleValue.gt(0)) sale = sale.plus(saleValue);
    const id = newId();
    const matched = matchProduct(catalog, name, sku);
    ops.push({
      sql: sql`
        INSERT INTO legacy.holded_product (
          id, batch_id, entity_id, name, description, sku, warehouse_label, stock, cost, sale_value,
          tax_label, matched_product_id, raw
        )
        SELECT
          CAST(${id} AS UUID),
          CAST(${input.batchId} AS UUID),
          CAST(${input.entityId} AS UUID),
          ${name},
          ${cleanText(row['Descripción']) || null},
          ${sku || null},
          ${cleanText(row['Almacén']) || null},
          ${decimalOrNull(row.Stock, 3)},
          ${decimalOrNull(row.Coste, 6)},
          ${saleValue === null ? null : saleValue.toDecimalPlaces(6, Decimal.ROUND_HALF_UP)},
          ${cleanText(row.Impuestos) || null},
          CASE WHEN ${matched} IS NULL THEN NULL ELSE CAST(${matched} AS UUID) END,
          ${sql.json({ ...row, _sha: sha256Hex(canonicalJson(row)) })}
        WHERE NOT EXISTS (
          SELECT 1 FROM legacy.holded_product existing
          WHERE existing.entity_id = CAST(${input.entityId} AS UUID)
            AND existing.name = ${name}
            AND coalesce(existing.sku, '') = ${sku}
        )
      `,
      audit: {
        table: 'legacy.holded_product',
        rowId: id,
        action: 'INSERT',
        before: null,
        after: { archived: true },
      },
    });
    if (matched && saleValue && saleValue.gt(0) && !catalog.priced.has(matched)) {
      const priceOps = await priceOpsFor(input, catalog, matched, saleValue);
      if (priceOps.length > 0) {
        catalog.priced.add(matched);
        ops.push(...priceOps);
      }
    }
  }
  return {
    ops,
    report: reportOf(
      input,
      input.table.rows.length,
      input.table.rows.length - (skipped.no_key ?? 0),
      skipped,
      { sale_value: fixedMoney(sale) },
      { documents: input.table.rows.length - (skipped.no_key ?? 0) },
    ),
  };
}

async function priceOpsFor(
  input: Parameters<typeof planHistory>[0],
  catalog: CatalogIndex,
  productId: string,
  saleValue: Decimal,
): Promise<WriteOp[]> {
  const ops: WriteOp[] = [];
  if (!catalog.priceListId) {
    catalog.priceListId = newId();
    ops.push({
      sql: sql`
        INSERT INTO catalog.price_list (id, code, name, currency, tax_included, is_active)
        SELECT CAST(${catalog.priceListId} AS UUID), 'final', 'Tarifa final', 'EUR', FALSE, TRUE
        WHERE NOT EXISTS (SELECT 1 FROM catalog.price_list WHERE code = 'final')
      `,
      audit: { table: 'catalog.price_list', rowId: catalog.priceListId, action: 'INSERT', before: null, after: { code: 'final' } },
    });
  }
  if (!catalog.versionId && catalog.priceListId) {
    catalog.versionId = newId();
    const listId = catalog.priceListId;
    const versionId = catalog.versionId;
    ops.push({
      sql: sql`
        INSERT INTO catalog.price_list_version (id, price_list_id, version, valid_from, status, notes, created_by, created_at)
        SELECT CAST(${versionId} AS UUID), p.id, 1, DATE '2026-01-01', 'draft', 'migration', ${`migrador:${input.entity}`}, ${input.now}
        FROM catalog.price_list p
        WHERE p.code = 'final'
          AND NOT EXISTS (
            SELECT 1 FROM catalog.price_list_version v
            WHERE v.price_list_id = p.id AND v.status = 'draft' AND v.notes = 'migration'
          )
      `,
      audit: { table: 'catalog.price_list_version', rowId: versionId, action: 'INSERT', before: null, after: { status: 'draft' } },
    });
    void listId;
  }
  const itemId = newId();
  const versionId = catalog.versionId;
  if (!versionId) return ops;
  const price = saleValue.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  ops.push({
    sql: sql`
      INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
      SELECT CAST(${itemId} AS UUID), v.id, CAST(${productId} AS UUID), 1, ${price}
      FROM catalog.price_list_version v
      JOIN catalog.price_list p ON p.id = v.price_list_id
      WHERE p.code = 'final' AND v.status = 'draft' AND v.notes = 'migration'
        AND NOT EXISTS (
          SELECT 1 FROM catalog.price_list_item item
          WHERE item.version_id = v.id AND item.product_id = CAST(${productId} AS UUID)
        )
      LIMIT 1
    `,
    audit: { table: 'catalog.price_list_item', rowId: itemId, action: 'INSERT', before: null, after: { unit_price: price.toFixed(2) } },
  });
  return ops;
}

interface CatalogIndex {
  bySku: Map<string, string>;
  byName: Map<string, string>;
  priced: Set<string>;
  priceListId: string | null;
  versionId: string | null;
}

async function catalogIndex(client: KbClient): Promise<CatalogIndex> {
  const products = await client.query<{ id: string; sku: string | null; name: string }>(sql`
    SELECT id, sku, name FROM catalog.product
  `);
  const bySku = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const product of products) {
    const id = String(product.id).toLowerCase();
    const sku = cleanText(product.sku).toUpperCase();
    if (sku) bySku.set(sku, id);
    const name = normalizeName(String(product.name ?? ''));
    if (name && !byName.has(name)) byName.set(name, id);
  }
  const lists = await client.query<{ id: string }>(sql`SELECT id FROM catalog.price_list WHERE code = 'final' LIMIT 1`);
  const priceListId = lists[0] ? String(lists[0].id) : null;
  const versions = priceListId
    ? await client.query<{ id: string }>(sql`
        SELECT id FROM catalog.price_list_version
        WHERE price_list_id = CAST(${priceListId} AS UUID) AND status = 'draft' AND notes = 'migration'
        LIMIT 1
      `)
    : [];
  const versionId = versions[0] ? String(versions[0].id) : null;
  const priced = new Set<string>();
  if (versionId) {
    const items = await client.query<{ product_id: string }>(sql`
      SELECT product_id FROM catalog.price_list_item WHERE version_id = CAST(${versionId} AS UUID)
    `);
    for (const item of items) priced.add(String(item.product_id).toLowerCase());
  }
  return { bySku, byName, priced, priceListId, versionId };
}

function matchProduct(catalog: CatalogIndex, name: string, sku: string): string | null {
  if (sku && catalog.bySku.has(sku.toUpperCase())) return catalog.bySku.get(sku.toUpperCase()) ?? null;
  const normalized = normalizeName(name);
  return catalog.byName.get(normalized) ?? null;
}

function reportOf(
  input: Parameters<typeof planHistory>[0],
  rowsRead: number,
  created: number,
  skipped: Record<string, number>,
  totals: Record<string, string>,
  resulting: Record<string, number>,
): MigrationReport {
  return {
    source: input.source,
    entity: input.entity,
    dataset: 'history',
    file_sha256: input.fileSha256,
    rows_read: rowsRead,
    created,
    merged_duplicates: skipped.duplicate_key ?? 0,
    proposals_pending: 0,
    nif_warnings: 0,
    skipped: positive(skipped),
    warnings: {},
    totals,
    resulting,
  };
}

function decimalOrNull(raw: string | undefined, places: number): Decimal | null {
  const parsed = parseLooseDecimal(raw);
  if (parsed === null) return null;
  return parsed.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

function linkContact(names: Map<string, string | 'ambiguous'>, raw: string | undefined): string | null {
  const name = cleanText(raw);
  if (!name) return null;
  const link = names.get(name);
  if (!link || link === 'ambiguous') return null;
  return link;
}

async function contactNames(client: KbClient, entityId: string, entity: string): Promise<Map<string, string | 'ambiguous'>> {
  const path = entity === 'CVPO' ? '$.holded_cvpo' : '$.holded_po';
  const rows = await client.query<{ id: string; legal_name: string }>(sql`
    SELECT c.id, c.legal_name
    FROM party.contact c
    LEFT JOIN party.contact_entity_terms t
      ON t.contact_id = c.id AND t.legal_entity_id = CAST(${entityId} AS UUID)
    WHERE c.merged_into_id IS NULL
      AND c.archived_at IS NULL
      AND (
        t.contact_id IS NOT NULL
        OR json_extract_string(c.legacy_refs, ${path}) IS NOT NULL
      )
  `);
  const map = new Map<string, string | 'ambiguous'>();
  for (const row of rows) {
    const name = cleanText(row.legal_name);
    const current = map.get(name);
    if (current === undefined) map.set(name, String(row.id));
    else if (current !== String(row.id)) map.set(name, 'ambiguous');
  }
  return map;
}
