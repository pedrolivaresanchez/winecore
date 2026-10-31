import { readFile } from 'node:fs/promises';
import { Decimal } from 'decimal.js';
import { sql } from '../../src/core/db/sql';
import { entityUuid, openMigrationDb } from './apply';
import { fixedMoney, money } from './money';
import type { Manifest, ManifestFile, YearTotals } from './manifest';

interface Difference {
  sha256: string;
  entity: string;
  role: string;
  field: string;
  expected: string;
  actual: string;
}

export async function verifyManifest(dbPath: string, manifestPath: string): Promise<{ ok: boolean; differences: Difference[] }> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  const db = await openMigrationDb(dbPath);
  const differences: Difference[] = [];
  try {
    for (const file of manifest.files) {
      if (file.informational || (file.role !== 'sales_invoice' && file.role !== 'purchase_invoice')) continue;
      const entityId = await entityUuid(db.client, file.entity);
      if (!entityId) continue;
      const kind = file.role === 'purchase_invoice' ? 'purchase' : 'sale';
      const direction = file.role === 'purchase_invoice' ? 'payable' : 'receivable';
      const actualYears = await yearTotals(db.client, entityId, kind);
      for (const [year, expected] of Object.entries(file.by_year)) {
        const actual = actualYears.get(year);
        compareYear(differences, file, year, expected, actual);
      }
      for (const [year, actual] of actualYears) {
        if (!file.by_year[year]) compareYear(differences, file, year, emptyYear(), actual);
      }
      if (file.open_items) {
        const open = await db.client.query<{ amount: unknown; n: unknown }>(sql`
          SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS n
          FROM legacy.open_item
          WHERE entity_id = CAST(${entityId} AS UUID) AND direction = ${direction}
        `);
        const row = open[0];
        pushDiff(differences, file, 'open_amount', file.open_items.amount, moneyText(row?.amount));
        pushDiff(differences, file, 'open_count', String(file.open_items.count), integerText(row?.n));
      }
    }
  } finally {
    await db.close();
  }
  return { ok: differences.length === 0, differences };
}

async function yearTotals(
  client: { query<T>(sql: string): Promise<T[]> },
  entityId: string,
  kind: string,
): Promise<Map<string, YearTotals>> {
  const rows = await client.query<{
    year: unknown;
    documents: unknown;
    subtotal: unknown;
    vat: unknown;
    vat_2: unknown;
    total: unknown;
    pending: unknown;
  }>(sql`
    SELECT
      year(issue_date) AS year,
      COUNT(*) AS documents,
      COALESCE(SUM(subtotal), 0) AS subtotal,
      COALESCE(SUM(vat), 0) AS vat,
      COALESCE(SUM(vat_2), 0) AS vat_2,
      COALESCE(SUM(total), 0) AS total,
      COALESCE(SUM(pending), 0) AS pending
    FROM legacy.holded_invoice
    WHERE entity_id = CAST(${entityId} AS UUID) AND kind = ${kind}
    GROUP BY year(issue_date)
  `);
  const map = new Map<string, YearTotals>();
  for (const row of rows) {
    map.set(integerText(row.year), {
      documents: Number(integerText(row.documents)),
      subtotal: moneyText(row.subtotal),
      vat: moneyText(row.vat),
      vat_2: moneyText(row.vat_2),
      total: moneyText(row.total),
      pending: moneyText(row.pending),
    });
  }
  return map;
}

function compareYear(
  differences: Difference[],
  file: ManifestFile,
  year: string,
  expected: YearTotals,
  actual: YearTotals | undefined,
): void {
  const got = actual ?? emptyYear();
  for (const field of ['documents', 'subtotal', 'vat', 'vat_2', 'total', 'pending'] as const) {
    const left = field === 'documents' ? String(expected[field]) : expected[field];
    const right = field === 'documents' ? String(got[field]) : got[field];
    pushDiff(differences, file, `${year}.${field}`, left, right);
  }
}

function pushDiff(differences: Difference[], file: ManifestFile, field: string, expected: string, actual: string): void {
  if (normalize(expected) === normalize(actual)) return;
  differences.push({ sha256: file.sha256, entity: file.entity, role: file.role, field, expected: normalize(expected), actual: normalize(actual) });
}

function normalize(value: string): string {
  const parsed = money(value);
  if (parsed) return fixedMoney(parsed);
  return value;
}

function moneyText(value: unknown): string {
  if (value == null) return '0.00';
  const parsed = money(String(value));
  return parsed ? fixedMoney(parsed) : '0.00';
}

function integerText(value: unknown): string {
  if (value == null) return '0';
  const parsed = new Decimal(String(value));
  return parsed.toFixed(0);
}

function emptyYear(): YearTotals {
  return { documents: 0, subtotal: '0.00', vat: '0.00', vat_2: '0.00', total: '0.00', pending: '0.00' };
}

async function main(): Promise<void> {
  const manifest = argument('--manifest') ?? 'data/migration/expected_totals.json';
  const db = argument('--db') ?? 'data/migration/scratch.duckdb';
  const result = await verifyManifest(db, manifest);
  process.stdout.write(`${JSON.stringify({ ok: result.ok, differences: result.differences.length, sample: result.differences.slice(0, 12) })}\n`);
  if (!result.ok) process.exit(1);
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (import.meta.main) {
  main().catch(() => {
    process.stderr.write('MIGRATION_FAILED\n');
    process.exit(1);
  });
}
