import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config';
import type { KbClient } from '../src/core/db/client';
import { openClient } from '../src/core/db/open';
import { sql } from '../src/core/db/sql';
import { sha256Hex } from '../src/core/hash';

export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(
  client: KbClient,
  options?: { dir?: string; dryRun?: boolean },
): Promise<{ pending: string[] }> {
  const dir = options?.dir ?? migrationsDir;
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const applied = await readApplied(client);
  for (const name of applied.keys()) {
    if (!names.includes(name)) throw new Error(`Falta la migración ya aplicada ${name}`);
  }
  const pending: string[] = [];
  for (const name of names) {
    const content = await readFile(join(dir, name), 'utf8');
    const hash = sha256Hex(content);
    const previous = applied.get(name);
    if (previous !== undefined) {
      if (previous !== hash) throw new Error(`La migración ya aplicada ${name} ha cambiado`);
      continue;
    }
    pending.push(name);
    if (options?.dryRun) continue;
    const body = content.trim().replace(/;+\s*$/u, '');
    const insert = sql`INSERT INTO core.schema_migration (file, sha256) VALUES (${name}, ${hash})`;
    try {
      await client.query(`BEGIN TRANSACTION;\n${body};\n${insert};\nCOMMIT;`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
  return { pending };
}

async function readApplied(client: KbClient): Promise<Map<string, string>> {
  try {
    const rows = await client.query<{ file: string; sha256: string }>(
      'SELECT file, sha256 FROM core.schema_migration',
    );
    return new Map(rows.map((row) => [row.file, row.sha256]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('does not exist')) return new Map();
    throw error;
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const client = await openClient(config);
  try {
    const dryRun = process.argv.includes('--dry-run');
    const result = await migrate(client, { dryRun });
    console.log(JSON.stringify({ pending: result.pending, dry_run: dryRun }));
  } finally {
    await client.close?.();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Error interno');
    process.exit(1);
  });
}
