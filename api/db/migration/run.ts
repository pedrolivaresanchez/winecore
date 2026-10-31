import { readFile } from 'node:fs/promises';
import { newId } from '../../src/core/ids';
import type { Actor } from '../../src/core/db/writer';
import {
  applyOps,
  batchOp,
  canonicalEntity,
  entityUuid,
  fileAlreadyLoaded,
  openMigrationDb,
  sha256Buffer,
  TIMBAL_TARGET,
  type WriteOp,
} from './apply';
import { acceptsDataset, datasetForRole, roleOf, type FileRole } from './classify';
import {
  holdedProductProposals,
  knownKeys,
  lineProposals,
  mergeProposalCsv,
  parseProposalCsv,
  planCatalogLoad,
  proposalCsv,
  shopifyProductProposals,
  type ProposalRow,
} from './datasets/catalog';
import { parseHoldedContacts, planContacts } from './datasets/contacts';
import { historyBatch, planHistory } from './datasets/history';
import { assertInvoiceCuadre, planOpenItems } from './datasets/open_items';
import { parseShopifyCustomers } from './datasets/shopify_customers';
import { readShopifyTable } from './extract/shopifyCsv';
import { dataKeyFromEnv } from './ibanStore';
import { readStoredReport, reportSha256, writeReport, type MigrationDataset, type MigrationReport, type MigrationSource } from './report';
import { readHoldedXlsx, type HoldedTable } from './xlsx';
import { sql } from '../../src/core/db/sql';

export interface RunOptions {
  source: MigrationSource;
  entity: string;
  dataset: MigrationDataset;
  file: string;
  mode: 'dry-run' | 'load';
  approvedReport?: string;
  dbPath: string;
  outDir: string;
  operator: string;
  dataKey: Buffer | null;
}

export async function runMigration(options: RunOptions): Promise<{ report: MigrationReport; reportSha256: string; alreadyLoaded: boolean }> {
  const entity = canonicalEntity(options.entity);
  if (options.source !== 'holded' && options.source !== 'shopify') throw new Error('SOURCE');
  if (options.mode === 'load' && !options.approvedReport) throw new Error('APPROVED_REPORT_REQUIRED');
  // Dry runs keep one transaction open across requests, which a shared Knowledge Base connection cannot isolate.
  if (options.mode === 'dry-run' && options.dbPath === TIMBAL_TARGET) throw new Error('DRY_RUN_REMOTE');
  const bytes = await readFile(options.file);
  const fileSha256 = sha256Buffer(bytes);
  const loaded = await loadInput(options.file, bytes);
  const role = roleOf(loaded.headers);
  if (!acceptsDataset(role, options.dataset)) throw new Error('DATASET_FILE_MISMATCH');
  const db = await openMigrationDb(options.dbPath);
  try {
    let reuseBatch: string | null = null;
    if (options.mode === 'load') {
      const stored = await readStoredReport(options.outDir, fileSha256);
      if (!stored || stored.sha256 !== options.approvedReport) throw new Error('APPROVED_REPORT_MISMATCH');
      if (
        stored.report.file_sha256 !== fileSha256
        || stored.report.dataset !== options.dataset
        || stored.report.entity !== entity
        || stored.report.source !== options.source
      ) {
        throw new Error('APPROVED_REPORT_MISMATCH');
      }
      if (options.dataset === 'history') {
        const existing = await historyBatch(db.client, fileSha256);
        if (existing?.finished) return { report: stored.report, reportSha256: stored.sha256, alreadyLoaded: true };
        reuseBatch = existing?.id ?? null;
      } else if (await fileAlreadyLoaded(db.client, fileSha256, options.dataset)) {
        return { report: stored.report, reportSha256: stored.sha256, alreadyLoaded: true };
      }
    }
    const entityId = await entityUuid(db.client, entity);
    const now = new Date();
    const batchId = reuseBatch ?? newId();
    const actor: Actor = {
      type: 'migration',
      id: `migrador:${options.operator}`,
      requestId: batchId,
      reason: `${options.dataset}:${entity}`,
    };
    const planned = await buildPlan({
      ...options,
      entity,
      entityId,
      fileSha256,
      role,
      headers: loaded.headers,
      table: loaded.table,
      records: loaded.records,
      now,
      batchId,
      client: db.client,
    });
    const hash = reportSha256(planned.report);
    if (options.mode === 'load' && hash !== options.approvedReport) throw new Error('APPROVED_REPORT_MISMATCH');
    if (planned.slice !== null) await assertProposalSlice(options.outDir, fileSha256, planned.slice, options.mode);
    const rejected = Object.values(planned.report.skipped).reduce((sum, value) => sum + value, 0);
    const batch = batchOp({
      id: batchId,
      source: options.source,
      entityId,
      dataset: options.dataset,
      fileName: `f-${fileSha256.slice(0, 16)}`,
      fileSha256,
      rowsRead: planned.report.rows_read,
      rowsLoaded: planned.report.created,
      rowsRejected: rejected,
      report: planned.report,
      actorId: actor.id,
      now,
      open: options.dataset === 'history',
    });
    const closing: WriteOp = {
      sql: sql`
        UPDATE legacy.import_batch
        SET rows_loaded = ${planned.report.created}, finished_at = ${now}
        WHERE id = CAST(${batchId} AS UUID)
      `,
    };
    const ops: WriteOp[] = options.dataset === 'history'
      ? [...(reuseBatch ? [] : [batch]), ...planned.ops, closing]
      : [batch, ...planned.ops];
    await applyOps({
      client: db.client,
      writer: db.writer,
      mode: options.mode,
      actor,
      ops,
      beforeRollback: options.dataset === 'open_items' && planned.expected
        ? (client) => assertInvoiceCuadre(client, batchId, planned.expected!)
        : undefined,
    });
    if (options.mode === 'load' && options.dataset === 'open_items' && planned.expected) {
      await assertInvoiceCuadre(db.client, batchId, planned.expected);
    }
    if (options.mode === 'dry-run') {
      await writeReport(options.outDir, planned.report);
      if (planned.slice !== null) await writeProposal(options.outDir, fileSha256, planned.slice);
    }
    return { report: planned.report, reportSha256: hash, alreadyLoaded: false };
  } finally {
    await db.close();
  }
}

async function buildPlan(input: {
  source: MigrationSource;
  entity: string;
  entityId: string | null;
  dataset: MigrationDataset;
  fileSha256: string;
  role: FileRole;
  headers: string[];
  table: HoldedTable | null;
  records: Record<string, string>[] | null;
  file: string;
  operator: string;
  dataKey: Buffer | null;
  now: Date;
  batchId: string;
  outDir: string;
  client: import('../../src/core/db/client').KbClient;
}): Promise<{ ops: WriteOp[]; report: MigrationReport; slice: string | null; expected: import('./datasets/open_items').InvoiceExpected | null }> {
  if (input.dataset === 'contacts') {
    const parsed = input.role === 'shopify_customers'
      ? parseShopifyCustomers(input.records ?? [])
      : { ...parseHoldedContacts(input.table!, input.entity, input.dataKey), rowsRead: input.table!.rows.length };
    const plan = await planContacts({
      client: input.client,
      source: input.source,
      entity: input.entity,
      entityId: input.entityId,
      fileSha256: input.fileSha256,
      drafts: parsed.drafts,
      rowsRead: parsed.rowsRead,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      nifWarnings: parsed.nifWarnings,
      actorId: `migrador:${input.operator}`,
      now: input.now,
    });
    return { ...plan, slice: null, expected: null };
  }
  if (input.dataset === 'open_items') {
    if (!input.table || !input.entityId) throw new Error('DATASET_FILE_MISMATCH');
    const plan = await planOpenItems({
      client: input.client,
      source: input.source,
      entity: input.entity,
      entityId: input.entityId,
      fileSha256: input.fileSha256,
      table: input.table,
      actorId: `migrador:${input.operator}`,
      now: input.now,
      batchId: input.batchId,
    });
    return { ops: plan.ops, report: plan.report, slice: null, expected: plan.expected };
  }
  if (input.dataset === 'history') {
    if (!input.table || !input.entityId) throw new Error('DATASET_FILE_MISMATCH');
    const plan = await planHistory({
      client: input.client,
      source: input.source,
      entity: input.entity,
      entityId: input.entityId,
      fileSha256: input.fileSha256,
      filePath: input.file,
      role: input.role,
      table: input.table,
      batchId: input.batchId,
      now: input.now,
    });
    return { ops: plan.ops, report: plan.report, slice: null, expected: null };
  }
  const proposals = await catalogProposals(input);
  const plan = await planCatalogLoad({
    client: input.client,
    source: input.source,
    entity: input.entity,
    entityId: input.entityId,
    fileSha256: input.fileSha256,
    proposals: proposals.rows,
    holdedRows: input.role === 'product' ? input.table?.rows ?? null : null,
    actorId: `migrador:${input.operator}`,
    now: input.now,
    batchId: input.batchId,
  });
  plan.report.rows_read = proposals.rowsRead;
  plan.report.resulting.matched = proposals.matched;
  plan.report.resulting.unmatched = proposals.unmatched;
  const slice = proposalCsv(proposals.rows);
  plan.report.proposal_sha256 = sha256OfText(slice);
  return { ops: plan.ops, report: plan.report, slice, expected: null };
}

async function catalogProposals(input: {
  source: MigrationSource;
  entity: string;
  fileSha256: string;
  role: FileRole;
  table: HoldedTable | null;
  records: Record<string, string>[] | null;
  outDir: string;
}): Promise<{ rows: ProposalRow[]; rowsRead: number; matched: number; unmatched: number }> {
  if (input.role === 'product' && input.table) {
    const rows = holdedProductProposals(input.table, input.source, input.entity, input.fileSha256);
    return { rows, rowsRead: input.table.rows.length, matched: 0, unmatched: rows.filter((row) => row.decision === 'sin_correspondencia').length };
  }
  if (input.role === 'shopify_products' && input.records) {
    const rows = shopifyProductProposals(input.records, input.entity, input.fileSha256);
    return { rows, rowsRead: input.records.length, matched: 0, unmatched: rows.filter((row) => row.decision === 'sin_correspondencia').length };
  }
  if (input.role === 'proposal' && input.records) {
    const rows = input.records.map((row) => normalizeProposal(row, input.fileSha256));
    return { rows, rowsRead: rows.length, matched: 0, unmatched: rows.filter((row) => row.decision === 'sin_correspondencia').length };
  }
  const known = knownKeys(await readCombined(input.outDir));
  if (input.role === 'lines' && input.table) {
    const result = lineProposals({
      rows: input.table.rows,
      source: input.source,
      entity: input.entity,
      fileSha: input.fileSha256,
      nameColumn: 'Item',
      skuColumn: 'SKU',
      dateColumn: 'Fecha',
      onlyYears: [2025, 2026],
      known,
    });
    return { rows: result.rows, rowsRead: input.table.rows.length, matched: result.matched, unmatched: result.rows.length };
  }
  if (input.role === 'shopify_orders' && input.records) {
    const result = lineProposals({
      rows: input.records,
      source: input.source,
      entity: input.entity,
      fileSha: input.fileSha256,
      nameColumn: 'Lineitem name',
      skuColumn: 'Lineitem sku',
      dateColumn: null,
      onlyYears: null,
      known,
    });
    return { rows: result.rows, rowsRead: input.records.length, matched: result.matched, unmatched: result.rows.length };
  }
  throw new Error('DATASET_FILE_MISMATCH');
}

async function loadInput(path: string, bytes: Buffer): Promise<{ headers: string[]; table: HoldedTable | null; records: Record<string, string>[] | null }> {
  if (isXlsx(path, bytes)) {
    const table = readHoldedXlsx(bytes);
    return { headers: table.headers, table, records: null };
  }
  const records = await readShopifyTable(path);
  return { headers: Object.keys(records[0] ?? {}), table: null, records };
}

function isXlsx(path: string, bytes: Buffer): boolean {
  if (path.toLowerCase().endsWith('.xlsx')) return true;
  return bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50 && !path.toLowerCase().endsWith('.zip');
}

async function readCombined(outDir: string): Promise<ProposalRow[]> {
  try {
    const text = await readFile(`${outDir}/catalog_proposal.csv`, 'utf8');
    return parseProposalCsv(text);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') return [];
    throw error;
  }
}

async function writeProposal(outDir: string, fileSha: string, slice: string): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(`${outDir}/proposals`, { recursive: true });
  await writeFile(`${outDir}/proposals/${fileSha}.csv`, slice, 'utf8');
  const existing = await readCombined(outDir);
  const merged = mergeProposalCsv(existing.length === 0 ? null : proposalCsv(existing), fileSha, slice);
  await writeFile(`${outDir}/catalog_proposal.csv`, merged, 'utf8');
}

async function assertProposalSlice(outDir: string, fileSha: string, slice: string, mode: 'dry-run' | 'load'): Promise<void> {
  if (mode === 'dry-run') return;
  const combined = await readCombined(outDir);
  if (combined.length === 0) return;
  const extracted = proposalCsv(combined.filter((row) => row.source_file_sha256 === fileSha));
  if (sha256OfText(extracted) !== sha256OfText(slice)) throw new Error('PROPOSAL_CHANGED');
}

function normalizeProposal(row: Record<string, string>, fileSha: string): ProposalRow {
  const parsed = parseProposalCsv(proposalCsv([{
    source_file_sha256: row.source_file_sha256 || fileSha,
    source: row.source === 'shopify' ? 'shopify' : 'holded',
    entity: row.entity ?? '',
    row_kind: row.row_kind || 'proposal',
    source_sku: row.source_sku ?? '',
    source_name: row.source_name ?? '',
    proposed_wine_code: row.proposed_wine_code ?? '',
    proposed_wine_name: row.proposed_wine_name ?? '',
    color: row.color || 'other',
    is_organic: row.is_organic ?? '',
    no_added_sulfites: row.no_added_sulfites ?? '',
    vintage: row.vintage ?? '',
    format_code: row.format_code ?? '',
    nominal_volume_ml: row.nominal_volume_ml ?? '',
    proposed_sku: row.proposed_sku ?? '',
    proposed_product_name: row.proposed_product_name ?? '',
    alcohol_pct: row.alcohol_pct ?? '',
    price_final: row.price_final ?? '',
    decision: row.decision || 'proposed',
    reason: row.reason || 'ok',
    sold_2025_2026: row.sold_2025_2026 || 'unknown',
    description: row.description ?? '',
  }]));
  const first = parsed[0];
  if (!first) throw new Error('PROPOSAL');
  return first;
}

function sha256OfText(value: string): string {
  return sha256Buffer(Buffer.from(value));
}

function parseArgs(argv: readonly string[]): RunOptions {
  const read = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const source = read('--source');
  const entity = read('--entity');
  const dataset = read('--dataset');
  const file = read('--file');
  const dryRun = argv.includes('--dry-run');
  const load = argv.includes('--load');
  if (!source || !entity || !dataset || !file || dryRun === load) throw new Error('USAGE');
  if (source !== 'holded' && source !== 'shopify') throw new Error('SOURCE');
  if (dataset !== 'contacts' && dataset !== 'catalog' && dataset !== 'open_items' && dataset !== 'history') throw new Error('DATASET');
  const outDir = read('--out') ?? 'data/migration';
  return {
    source,
    entity,
    dataset,
    file,
    mode: load ? 'load' : 'dry-run',
    approvedReport: read('--approved-report'),
    dbPath: read('--db') ?? `${outDir}/scratch.duckdb`,
    outDir,
    operator: read('--operator') ?? (process.env.WINECORE_MIGRATION_OPERATOR?.trim() || 'local'),
    dataKey: dataKeyFromEnv(process.env),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runMigration(options);
  process.stdout.write(`${JSON.stringify({ report_sha256: result.reportSha256, already_loaded: result.alreadyLoaded, report: result.report })}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exit(1);
  });
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'MIGRATION_FAILED';
  const code = /^(APPROVED_REPORT_MISMATCH|APPROVED_REPORT_REQUIRED|DATASET_FILE_MISMATCH|DATASET|SOURCE|ENTITY|USAGE|HEADER_NOT_FOUND|CUADRE|PROPOSAL_CHANGED|WRITER_LEASE|INVOICE_KEY|DATA_KEY|ZIP_METHOD|XLSX_SHEET)\b/.exec(message)?.[1];
  if (code === 'CUADRE') return message.split('\n')[0] ?? 'CUADRE';
  return code ?? 'MIGRATION_FAILED';
}
