import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalJson } from '../../src/core/db/audit';
import { sha256Hex } from '../../src/core/hash';

export type MigrationSource = 'holded' | 'shopify';
export type MigrationDataset = 'contacts' | 'catalog' | 'open_items';

export interface MigrationReport {
  source: MigrationSource;
  entity: string;
  dataset: MigrationDataset;
  file_sha256: string;
  rows_read: number;
  created: number;
  merged_duplicates: number;
  proposals_pending: number;
  nif_warnings: number;
  skipped: Record<string, number>;
  warnings: Record<string, number>;
  totals: Record<string, string>;
  resulting: Record<string, number>;
  proposal_sha256?: string;
}

export function reportJson(report: MigrationReport): string {
  return canonicalJson(report);
}

export function reportSha256(report: MigrationReport): string {
  return sha256Hex(reportJson(report));
}

export function reportPath(outDir: string, fileSha256: string): string {
  return `${outDir}/reports/${fileSha256}.json`;
}

export async function writeReport(outDir: string, report: MigrationReport): Promise<string> {
  const json = reportJson(report);
  const hash = sha256Hex(json);
  const path = reportPath(outDir, report.file_sha256);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json, 'utf8');
  await writeFile(path.replace(/\.json$/, '.md'), markdown(report), 'utf8');
  return hash;
}

export async function readStoredReport(outDir: string, fileSha256: string): Promise<{ raw: string; report: MigrationReport; sha256: string } | null> {
  try {
    const raw = await readFile(reportPath(outDir, fileSha256), 'utf8');
    return { raw, report: JSON.parse(raw) as MigrationReport, sha256: sha256Hex(raw) };
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') return null;
    throw error;
  }
}

export function bump(map: Record<string, number>, key: string, amount = 1): void {
  map[key] = (map[key] ?? 0) + amount;
}

export function positive(map: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(map).sort()) {
    const value = map[key];
    if (value !== undefined && value > 0) out[key] = value;
  }
  return out;
}

function markdown(report: MigrationReport): string {
  const lines = [
    `# Migración ${report.dataset} ${report.entity}`,
    '',
    `- Origen: ${report.source}`,
    `- Filas leídas: ${report.rows_read}`,
    `- Creadas: ${report.created}`,
    `- Duplicados fusionados: ${report.merged_duplicates}`,
    `- Propuestas pendientes: ${report.proposals_pending}`,
    `- Avisos de NIF: ${report.nif_warnings}`,
    '',
    '## Omitidas',
    ...Object.entries(report.skipped).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Avisos',
    ...Object.entries(report.warnings).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Totales',
    ...Object.entries(report.totals).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Resultado',
    ...Object.entries(report.resulting).map(([key, value]) => `- ${key}: ${value}`),
    '',
  ];
  return lines.join('\n');
}
