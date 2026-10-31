import { Decimal } from 'decimal.js';
import { normalizeName } from '../../../src/core/party/duplicateKey';
import type { KbClient } from '../../../src/core/db/client';
import { sql } from '../../../src/core/db/sql';
import { canonicalJson } from '../../../src/core/db/audit';
import { sha256Hex } from '../../../src/core/hash';
import { newId } from '../../../src/core/ids';
import type { WriteOp } from '../apply';
import { parseCsv, writeCsv } from '../csv';
import { cleanText, fixedMoney, parseDate, parseLooseDecimal, yearOf } from '../money';
import { bump, positive, type MigrationReport, type MigrationSource } from '../report';
import type { HoldedTable } from '../xlsx';

export const PROPOSAL_COLUMNS = [
  'source_file_sha256', 'source', 'entity', 'row_kind', 'source_sku', 'source_name',
  'proposed_wine_code', 'proposed_wine_name', 'color', 'is_organic', 'no_added_sulfites',
  'vintage', 'format_code', 'nominal_volume_ml', 'proposed_sku', 'proposed_product_name',
  'alcohol_pct', 'price_final', 'decision', 'reason', 'sold_2025_2026', 'description',
] as const;

export type ProposalRow = Record<(typeof PROPOSAL_COLUMNS)[number], string>;

const FORMATS: Readonly<Record<number, { code: string; container: 'bottle' | 'bag_in_box'; name: string }>> = {
  250: { code: 'B025', container: 'bottle', name: 'Botella 0,25 L' },
  375: { code: 'B037', container: 'bottle', name: 'Botella 0,375 L' },
  500: { code: 'B050', container: 'bottle', name: 'Botella 0,50 L' },
  750: { code: 'B075', container: 'bottle', name: 'Botella 0,75 L' },
  1500: { code: 'B150', container: 'bottle', name: 'Magnum 1,5 L' },
  3000: { code: 'BIB3', container: 'bag_in_box', name: 'Bag-in-box 3 L' },
  5000: { code: 'BIB5', container: 'bag_in_box', name: 'Bag-in-box 5 L' },
  10000: { code: 'BIB10', container: 'bag_in_box', name: 'Bag-in-box 10 L' },
};

const NOT_WINE = /porte|transport|servicio|corcho|c[aá]psula|etiqueta\b|caja\b|env[ií]o|alquiler|mano de obra/;

export function proposalCsv(rows: readonly ProposalRow[]): string {
  return writeCsv([PROPOSAL_COLUMNS, ...rows.map((row) => PROPOSAL_COLUMNS.map((column) => row[column]))]);
}

export function parseProposalCsv(text: string): ProposalRow[] {
  const matrix = parseCsv(text);
  const header = matrix[0];
  if (!header || header[0] !== 'source_file_sha256') return [];
  return matrix.slice(1).map((cells) => {
    const row = emptyProposal();
    for (let index = 0; index < header.length; index += 1) {
      const name = header[index];
      if (name && isColumn(name)) row[name] = cells[index] ?? '';
    }
    return row;
  });
}

export function mergeProposalCsv(existing: string | null, fileSha: string, slice: string): string {
  const kept = existing === null ? [] : parseProposalCsv(existing).filter((row) => row.source_file_sha256 !== fileSha);
  return proposalCsv([...kept, ...parseProposalCsv(slice)]);
}

export function holdedProductProposals(table: HoldedTable, source: MigrationSource, entity: string, fileSha: string): ProposalRow[] {
  return table.rows.map((row) => buildProposal({
    fileSha,
    source,
    entity,
    rowKind: 'holded_product',
    sku: cleanText(row.SKU),
    name: cleanText(row.Nombre),
    extra: `${cleanText(row.Descripción)} ${cleanText(row.Tipo)}`,
    alcohol: '',
    organic: '',
    sulfites: '',
    colorText: cleanText(row.Tipo),
    vintageText: '',
    price: cleanText(row['Valor venta']),
    description: cleanText(row.Descripción),
  }));
}

export function shopifyProductProposals(rows: readonly Record<string, string>[], entity: string, fileSha: string): ProposalRow[] {
  const filled = forwardFill(rows);
  return filled.map((row) => buildProposal({
    fileSha,
    source: 'shopify',
    entity,
    rowKind: 'shopify_product',
    sku: cleanText(row['Variant SKU']),
    name: cleanText(row.Title),
    extra: `${cleanText(row['Option1 Value'])} ${cleanText(row['Option1 Name'])}`,
    alcohol: cleanText(row['Alcohol (product.metafields.custom.alcohol)']),
    organic: cleanText(row['Ecologico (product.metafields.custom.ecologico)']),
    sulfites: cleanText(row['Sulfitos (product.metafields.custom.sulfitos)']),
    colorText: `${cleanText(row['Tipo (product.metafields.custom.tipo)'])} ${cleanText(row.Title)}`,
    vintageText: cleanText(row['Anada (product.metafields.custom.anada)']).replace(/^['']+/, ''),
    price: cleanText(row['Variant Price']),
    description: [
      cleanText(row['Variedad (product.metafields.custom.variedad)']),
      cleanText(row['Zona Origen (product.metafields.custom.zona_origen)']),
      cleanText(row['Produccion (product.metafields.custom.produccion)']),
      cleanText(row['Ficha Cata (product.metafields.custom.ficha_cata)']),
    ].filter((part) => part !== '').join('\n').slice(0, 4000),
  }));
}

export function lineProposals(input: {
  rows: readonly Record<string, string>[];
  source: MigrationSource;
  entity: string;
  fileSha: string;
  nameColumn: string;
  skuColumn: string;
  dateColumn: string | null;
  onlyYears: number[] | null;
  known: ReadonlySet<string>;
}): { rows: ProposalRow[]; matched: number; considered: number } {
  const seen = new Set<string>();
  const rows: ProposalRow[] = [];
  let matched = 0;
  let considered = 0;
  for (const row of input.rows) {
    if (input.dateColumn) {
      const date = parseDate(row[input.dateColumn]);
      if (!date) continue;
      if (input.onlyYears && !input.onlyYears.includes(yearOf(date))) continue;
    }
    considered += 1;
    const name = cleanText(row[input.nameColumn]);
    const sku = cleanText(row[input.skuColumn]);
    if (name === '' && sku === '') continue;
    const key = matchKey(name, sku);
    if (input.known.has(key) || (sku !== '' && input.known.has(sku.toUpperCase()))) {
      matched += 1;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const proposal = buildProposal({
      fileSha: input.fileSha,
      source: input.source,
      entity: input.entity,
      rowKind: 'line',
      sku,
      name,
      extra: name,
      alcohol: '',
      organic: '',
      sulfites: '',
      colorText: name,
      vintageText: '',
      price: '',
      description: '',
    });
    proposal.decision = 'sin_correspondencia';
    proposal.reason = proposal.reason === 'ok' ? 'no_catalog_match' : proposal.reason;
    proposal.sold_2025_2026 = 'yes';
    rows.push(proposal);
  }
  return { rows, matched, considered };
}

export function knownKeys(rows: readonly ProposalRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.row_kind === 'line') continue;
    if (row.source_sku) keys.add(row.source_sku.toUpperCase());
    if (row.source_name) keys.add(matchKey(row.source_name, ''));
    if (row.proposed_sku) keys.add(row.proposed_sku.toUpperCase());
  }
  return keys;
}

export async function planCatalogLoad(input: {
  client: KbClient;
  source: MigrationSource;
  entity: string;
  entityId: string | null;
  fileSha256: string;
  proposals: readonly ProposalRow[];
  holdedRows: Record<string, string>[] | null;
  actorId: string;
  now: Date;
  batchId: string;
}): Promise<{ ops: WriteOp[]; report: MigrationReport }> {
  const loadable = input.proposals.some((row) => row.decision === 'proposed' || row.decision === 'approved');
  const wines = new Map((await input.client.query<{ id: string; code: string }>(sql`SELECT id, code FROM catalog.wine`)).map((row) => [row.code, row.id]));
  const formats = new Map((await input.client.query<{ id: string; code: string }>(sql`SELECT id, code FROM catalog.format`)).map((row) => [row.code, row.id]));
  const products = new Map((await input.client.query<{ id: string; sku: string }>(sql`SELECT id, sku FROM catalog.product`)).map((row) => [row.sku, row.id]));
  const priceList = await readPriceList(input.client);
  const priceListId = priceList ?? newId();
  const versionExisting = priceList ? await readDraftVersion(input.client, priceList) : null;
  const versionId = versionExisting ?? newId();
  const priced = new Set(versionExisting ? (await input.client.query<{ product_id: string }>(sql`
    SELECT product_id FROM catalog.price_list_item WHERE version_id = CAST(${versionId} AS UUID)
  `)).map((row) => row.product_id) : []);
  const existingSha = new Set<string>();
  if (input.entityId) {
    const rows = await input.client.query<{ sha: string | null }>(sql`
      SELECT json_extract_string(raw, '$._sha') AS sha
      FROM legacy.holded_product
      WHERE entity_id = CAST(${input.entityId} AS UUID)
    `);
    for (const row of rows) if (row.sha) existingSha.add(row.sha);
  }

  const ops: WriteOp[] = [];
  if (loadable && !priceList) ops.push(priceListInsert(priceListId));
  if (loadable && !versionExisting) ops.push(versionInsert(versionId, priceListId, input.actorId, input.now));
  const skipped: Record<string, number> = {};
  let created = 0;
  let winesAdded = 0;
  let formatsAdded = 0;
  let pricesAdded = 0;
  const skuBySource = new Map<string, string>();

  for (const row of input.proposals) {
    if (row.decision !== 'proposed' && row.decision !== 'approved') {
      bump(skipped, 'sin_correspondencia');
      continue;
    }
    if (!row.proposed_wine_code || !row.format_code || !row.vintage || !row.proposed_sku) {
      bump(skipped, 'incomplete');
      continue;
    }
    const formatId = formats.get(row.format_code) ?? newId();
    if (!formats.has(row.format_code)) {
      formats.set(row.format_code, formatId);
      formatsAdded += 1;
      ops.push(formatInsert(formatId, row));
    }
    const wineId = wines.get(row.proposed_wine_code) ?? newId();
    if (!wines.has(row.proposed_wine_code)) {
      wines.set(row.proposed_wine_code, wineId);
      winesAdded += 1;
      ops.push(wineInsert(wineId, row, input.now));
    }
    const productId = products.get(row.proposed_sku);
    if (productId) {
      bump(skipped, 'already_present');
      skuBySource.set(sourceKey(row), productId);
      continue;
    }
    const id = newId();
    products.set(row.proposed_sku, id);
    skuBySource.set(sourceKey(row), id);
    created += 1;
    ops.push(productInsert(id, wineId, formatId, row, input.now));
    if (row.price_final && !priced.has(id)) {
      const price = parseLooseDecimal(row.price_final);
      if (price && price.gte(0)) {
        pricesAdded += 1;
        priced.add(id);
        ops.push(priceInsert(versionId, id, price.toDecimalPlaces(6, Decimal.ROUND_HALF_UP)));
      }
    }
  }

  if (input.holdedRows && input.entityId) {
    for (const [index, row] of input.holdedRows.entries()) {
      const payload: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) payload[key] = value;
      const sha = sha256Hex(canonicalJson(payload));
      if (existingSha.has(sha)) {
        bump(skipped, 'product_archive_present');
        continue;
      }
      existingSha.add(sha);
      const matched = skuBySource.get(matchKey(cleanText(row.Nombre), cleanText(row.SKU))) ?? null;
      ops.push(holdedProductInsert({
        id: newId(),
        batchId: input.batchId,
        entityId: input.entityId,
        row,
        matched,
        sha,
        index,
      }));
    }
  }

  const report: MigrationReport = {
    source: input.source,
    entity: input.entity,
    dataset: 'catalog',
    file_sha256: input.fileSha256,
    rows_read: input.holdedRows?.length ?? input.proposals.length,
    created,
    merged_duplicates: 0,
    proposals_pending: 0,
    nif_warnings: 0,
    skipped: positive(skipped),
    warnings: {},
    totals: {},
    resulting: { wines: winesAdded, formats: formatsAdded, prices: pricesAdded, proposal_rows: input.proposals.length },
  };
  return { ops, report };
}

function buildProposal(input: {
  fileSha: string;
  source: MigrationSource;
  entity: string;
  rowKind: string;
  sku: string;
  name: string;
  extra: string;
  alcohol: string;
  organic: string;
  sulfites: string;
  colorText: string;
  vintageText: string;
  price: string;
  description: string;
}): ProposalRow {
  const row = emptyProposal();
  row.source_file_sha256 = input.fileSha;
  row.source = input.source;
  row.entity = input.entity;
  row.row_kind = input.rowKind;
  row.source_sku = input.sku;
  row.source_name = input.name.slice(0, 120);
  row.sold_2025_2026 = 'unknown';
  row.description = input.description;
  if (input.name === '') {
    row.decision = 'sin_correspondencia';
    row.reason = 'missing_name';
    return row;
  }
  if (NOT_WINE.test(input.name.toLowerCase())) {
    row.decision = 'sin_correspondencia';
    row.reason = 'not_wine';
    return row;
  }
  const vintage = parseVintage(input.vintageText) ?? parseVintage(input.name) ?? parseVintage(input.extra);
  const volume = parseVolumeMl(`${input.name} ${input.extra}`);
  const format = volume === null ? null : FORMATS[volume] ?? null;
  const wineName = wineTitle(input.name, vintage);
  row.proposed_wine_name = wineName;
  row.proposed_wine_code = wineCode(wineName);
  row.color = parseColor(input.colorText || input.name);
  row.is_organic = organicFlag(input.organic) ? 'true' : 'false';
  row.no_added_sulfites = sulfiteFlag(input.sulfites) ? 'true' : 'false';
  row.vintage = vintage === null ? '' : String(vintage);
  const alcohol = parseAlcohol(input.alcohol);
  row.alcohol_pct = alcohol === null ? '' : alcohol;
  const price = parseLooseDecimal(input.price);
  row.price_final = price === null ? '' : fixedMoney(price);
  if (!format || vintage === null) {
    row.decision = 'sin_correspondencia';
    row.reason = !format ? 'missing_format' : 'missing_vintage';
    return row;
  }
  row.format_code = format.code;
  row.nominal_volume_ml = String(volume);
  row.proposed_sku = skuOf(input.sku, wineName, row.vintage, format.code);
  row.proposed_product_name = `${wineName} ${row.vintage} ${format.name}`.slice(0, 120);
  row.decision = 'proposed';
  row.reason = 'ok';
  return row;
}

function emptyProposal(): ProposalRow {
  const row = {} as ProposalRow;
  for (const column of PROPOSAL_COLUMNS) row[column] = '';
  return row;
}

function isColumn(value: string): value is (typeof PROPOSAL_COLUMNS)[number] {
  return (PROPOSAL_COLUMNS as readonly string[]).includes(value);
}

function forwardFill(rows: readonly Record<string, string>[]): Record<string, string>[] {
  let carry: Record<string, string> = {};
  return rows.map((row) => {
    if (cleanText(row.Handle) !== '' && cleanText(row.Handle) !== cleanText(carry.Handle)) carry = { ...row };
    const filled: Record<string, string> = { ...carry };
    for (const [key, value] of Object.entries(row)) {
      if (cleanText(value) !== '') filled[key] = value;
    }
    if (cleanText(row.Title) !== '') carry = { ...filled };
    return filled;
  });
}

export function parseVolumeMl(text: string): number | null {
  const value = text.toLowerCase();
  if (/\bbib\b|bag-in-box|bag in box/.test(value)) {
    const liters = /(\d+(?:[.,]\d+)?)\s*l\b/.exec(value);
    if (liters?.[1]) return Math.round(Number(liters[1].replace(',', '.')) * 1000);
    return 3000;
  }
  const cl = /(\d+(?:[.,]\d+)?)\s*cl\b/.exec(value);
  if (cl?.[1]) return Math.round(Number(cl[1].replace(',', '.')) * 10);
  const ml = /(\d+)\s*ml\b/.exec(value);
  if (ml?.[1]) return Number(ml[1]);
  const liters = /(\d+)[.,](\d+)\s*l\b/.exec(value);
  if (liters?.[1] && liters[2]) return Math.round(Number(`${liters[1]}.${liters[2]}`) * 1000);
  if (/\b0[,.]75\b/.test(value)) return 750;
  if (/\bmagnum\b/.test(value) || /\b1[,.]5\s*l\b/.test(value)) return 1500;
  if (/\b37[,.]5\s*cl\b/.test(value)) return 375;
  return null;
}

export function parseVintage(text: string): number | null {
  const match = /\b((?:19|20)\d{2})\b/.exec(text.replace(/^['']+/, ''));
  if (!match?.[1]) return null;
  const year = Number(match[1]);
  if (year < 1990 || year > 2100) return null;
  return year;
}

function parseColor(text: string): string {
  const value = text.toLowerCase();
  if (/espumos|cava|sparkling/.test(value)) return 'sparkling';
  if (/rosad|rosé|\brose\b/.test(value)) return 'rose';
  if (/blanc|\bwhite\b/.test(value)) return 'white';
  if (/tint|\bred\b/.test(value)) return 'red';
  if (/dulce|\bsweet\b/.test(value)) return 'sweet';
  if (/naranj|\borange\b/.test(value)) return 'orange';
  return 'other';
}

function organicFlag(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === 'yes' || value === 'si' || value === 'sí' || value === '1';
}

function sulfiteFlag(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (value === '') return false;
  if (value === 'false' || value === 'no' || value === '0') return true;
  return /sin sulfitos|no added|without sulfite/.test(value);
}

function parseAlcohol(raw: string): string | null {
  const parsed = parseLooseDecimal(raw.replace('%', ''));
  if (parsed === null || parsed.lt(0) || parsed.gt(25)) return null;
  return parsed.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function wineTitle(name: string, vintage: number | null): string {
  let text = name;
  if (vintage !== null) text = text.replace(new RegExp(`\\b${vintage}\\b`), ' ');
  text = text.replace(/\b\d+(?:[.,]\d+)?\s*(?:cl|ml|l)\b/gi, ' ');
  text = text.replace(/\b0[,.]\d+\b/g, ' ');
  text = cleanText(text);
  return (text || name).slice(0, 120);
}

function wineCode(name: string): string {
  return `W${sha256Hex(normalizeName(name)).slice(0, 10).toUpperCase()}`;
}

function skuOf(sourceSku: string, wine: string, vintage: string, format: string): string {
  const upper = sourceSku.toUpperCase();
  if (/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(upper)) return upper;
  return `P${sha256Hex(`${normalizeName(wine)}|${vintage}|${format}`).slice(0, 12).toUpperCase()}`;
}

function matchKey(name: string, sku: string): string {
  if (sku.trim() !== '') return sku.trim().toUpperCase();
  return normalizeName(name);
}

function sourceKey(row: ProposalRow): string {
  return matchKey(row.source_name, row.source_sku);
}

async function readPriceList(client: KbClient): Promise<string | null> {
  const rows = await client.query<{ id: string }>(sql`SELECT id FROM catalog.price_list WHERE code = 'final'`);
  return rows[0]?.id ?? null;
}

async function readDraftVersion(client: KbClient, priceListId: string): Promise<string | null> {
  const rows = await client.query<{ id: string }>(sql`
    SELECT id FROM catalog.price_list_version
    WHERE price_list_id = CAST(${priceListId} AS UUID) AND status = 'draft' AND notes = 'migration'
    LIMIT 1
  `);
  return rows[0]?.id ?? null;
}

function priceListInsert(id: string): WriteOp {
  return {
    sql: sql`
      INSERT INTO catalog.price_list (id, code, name, currency, tax_included, is_active)
      VALUES (CAST(${id} AS UUID), 'final', 'Tarifa final', 'EUR', FALSE, TRUE)
    `,
    audit: { table: 'catalog.price_list', rowId: id, action: 'INSERT', before: null, after: { code: 'final', status: 'draft' } },
  };
}

function versionInsert(id: string, priceListId: string, actorId: string, now: Date): WriteOp {
  return {
    sql: sql`
      INSERT INTO catalog.price_list_version (
        id, price_list_id, version, valid_from, status, notes, created_by, created_at
      ) VALUES (
        CAST(${id} AS UUID), CAST(${priceListId} AS UUID), 1, DATE '2026-01-01', 'draft', 'migration', ${actorId}, ${now}
      )
    `,
    audit: { table: 'catalog.price_list_version', rowId: id, action: 'INSERT', before: null, after: { status: 'draft' } },
  };
}

function formatInsert(id: string, row: ProposalRow): WriteOp {
  const spec = FORMATS[Number(row.nominal_volume_ml)];
  const container = spec?.container ?? 'bottle';
  const name = spec?.name ?? row.format_code;
  const perCase = container === 'bag_in_box' ? 1 : 6;
  return {
    sql: sql`
      INSERT INTO catalog.format (id, code, name, container, nominal_volume_ml, units_per_case, cases_per_pallet, is_active)
      VALUES (
        CAST(${id} AS UUID), ${row.format_code}, ${name}, ${container}, ${Number(row.nominal_volume_ml)},
        ${perCase}, 112, TRUE
      )
    `,
    audit: { table: 'catalog.format', rowId: id, action: 'INSERT', before: null, after: { code: row.format_code } },
  };
}

function wineInsert(id: string, row: ProposalRow, now: Date): WriteOp {
  return {
    sql: sql`
      INSERT INTO catalog.wine (
        id, code, name, color, category, is_organic, no_added_sulfites, description, is_active, created_at
      ) VALUES (
        CAST(${id} AS UUID), ${row.proposed_wine_code}, ${row.proposed_wine_name}, ${row.color || 'other'},
        'wine', ${row.is_organic === 'true'}, ${row.no_added_sulfites === 'true'},
        ${row.description || null}, TRUE, ${now}
      )
    `,
    audit: { table: 'catalog.wine', rowId: id, action: 'INSERT', before: null, after: { code: row.proposed_wine_code, color: row.color || 'other' } },
  };
}

function productInsert(id: string, wineId: string, formatId: string, row: ProposalRow, now: Date): WriteOp {
  const alcohol = row.alcohol_pct === '' ? null : new Decimal(row.alcohol_pct);
  return {
    sql: sql`
      INSERT INTO catalog.product (
        id, sku, name, kind, wine_id, vintage, format_id, unit, alcohol_pct,
        is_stock_tracked, requires_lot, is_active, legacy_refs, created_at, updated_at
      ) VALUES (
        CAST(${id} AS UUID), ${row.proposed_sku}, ${row.proposed_product_name}, 'wine',
        CAST(${wineId} AS UUID), ${Number(row.vintage)}, CAST(${formatId} AS UUID), 'ud', ${alcohol},
        TRUE, TRUE, TRUE, ${sql.json({ source: row.source, entity: row.entity, row_kind: row.row_kind })},
        ${now}, ${now}
      )
    `,
    audit: { table: 'catalog.product', rowId: id, action: 'INSERT', before: null, after: { sku: row.proposed_sku, vintage: Number(row.vintage) } },
  };
}

function priceInsert(versionId: string, productId: string, price: Decimal): WriteOp {
  const id = newId();
  return {
    sql: sql`
      INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
      VALUES (CAST(${id} AS UUID), CAST(${versionId} AS UUID), CAST(${productId} AS UUID), 1, ${price})
    `,
    audit: { table: 'catalog.price_list_item', rowId: id, action: 'INSERT', before: null, after: { unit_price: price.toFixed(2) } },
  };
}

function holdedProductInsert(input: {
  id: string;
  batchId: string;
  entityId: string;
  row: Record<string, string>;
  matched: string | null;
  sha: string;
  index: number;
}): WriteOp {
  const raw = { ...input.row, _sha: input.sha, _index: String(input.index) };
  const stock = parseLooseDecimal(input.row.Stock);
  const cost = parseLooseDecimal(input.row.Coste);
  const sale = parseLooseDecimal(input.row['Valor venta']);
  return {
    sql: sql`
      INSERT INTO legacy.holded_product (
        id, batch_id, entity_id, name, description, sku, warehouse_label, stock, cost, sale_value,
        tax_label, matched_product_id, raw
      ) VALUES (
        CAST(${input.id} AS UUID),
        CAST(${input.batchId} AS UUID),
        CAST(${input.entityId} AS UUID),
        ${cleanText(input.row.Nombre).slice(0, 500) || 'Sin nombre'},
        ${cleanText(input.row.Descripción) || null},
        ${cleanText(input.row.SKU) || null},
        ${cleanText(input.row['Almacén']) || null},
        ${stock === null ? null : stock.toDecimalPlaces(3, Decimal.ROUND_HALF_UP)},
        ${cost === null ? null : cost.toDecimalPlaces(6, Decimal.ROUND_HALF_UP)},
        ${sale === null ? null : sale.toDecimalPlaces(6, Decimal.ROUND_HALF_UP)},
        ${cleanText(input.row.Impuestos) || null},
        CASE WHEN ${input.matched} IS NULL THEN NULL ELSE CAST(${input.matched} AS UUID) END,
        ${sql.json(raw)}
      )
    `,
    audit: { table: 'legacy.holded_product', rowId: input.id, action: 'INSERT', before: null, after: { archived: true } },
  };
}
