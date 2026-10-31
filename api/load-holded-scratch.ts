import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runMigration } from './db/migration/run';
import { readHoldedXlsx } from './db/migration/xlsx';
import { roleOf } from './db/migration/classify';
import { readFile } from 'node:fs/promises';

const root = '/workspace/data/holded';
const outDir = '/tmp/holded-reports';
const dbPath = process.env.HOLDED_DB ?? '/tmp/holded-local.duckdb';
const target = process.env.HOLDED_TARGET ?? 'local';

async function files(): Promise<{ entity: 'CVPO' | 'PO'; dataset: 'contacts' | 'open_items' | 'history'; file: string }[]> {
  const all: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'contabilidad') continue;
        await walk(path);
      } else if (entry.name.endsWith('.xlsx')) all.push(path);
    }
  }
  await walk(root);
  const jobs = [];
  for (const file of all.sort()) {
    const entity = file.includes('/cvpo/') ? 'CVPO' as const : file.includes('/po/') ? 'PO' as const : null;
    if (!entity) continue;
    const bytes = await readFile(file);
    const table = readHoldedXlsx(bytes);
    const role = roleOf(table.headers);
    const dataset = role === 'contacts' ? 'contacts' as const
      : role === 'sales_invoice' || role === 'purchase_invoice' ? 'open_items' as const
      : role === 'lines' || role === 'delivery_note' || role === 'quote' || role === 'product' ? 'history' as const
      : null;
    if (!dataset) {
      process.stdout.write(`${JSON.stringify({ skip: file.split('/').slice(-2).join('/'), role, rows: table.rows.length })}\n`);
      continue;
    }
    jobs.push({ entity, dataset, file, rows: table.rows.length, role });
  }
  const order = { contacts: 0, open_items: 1, history: 2 };
  jobs.sort((a, b) => order[a.dataset] - order[b.dataset] || a.entity.localeCompare(b.entity) || a.role.localeCompare(b.role));
  return jobs;
}

const jobs = await files();
for (const job of jobs) {
  const label = job.file.split('/').slice(-2).join('/');
  const dry = await runMigration({
    source: 'holded',
    entity: job.entity,
    dataset: job.dataset,
    file: job.file,
    mode: 'dry-run',
    dbPath: target === 'timbal' ? '/tmp/holded-local.duckdb' : dbPath,
    outDir,
    operator: 'import',
    dataKey: null,
  });
  const loaded = await runMigration({
    source: 'holded',
    entity: job.entity,
    dataset: job.dataset,
    file: job.file,
    mode: 'load',
    approvedReport: dry.reportSha256,
    dbPath: target === 'timbal' ? 'timbal' : dbPath,
    outDir,
    operator: 'import',
    dataKey: null,
  });
  process.stdout.write(`${JSON.stringify({
    target,
    entity: job.entity,
    dataset: job.dataset,
    role: job.role,
    file_rows: job.rows,
    rows_read: loaded.report.rows_read,
    created: loaded.report.created,
    skipped: loaded.report.skipped,
    resulting: loaded.report.resulting,
    already: loaded.alreadyLoaded,
    label,
  })}\n`);
}
