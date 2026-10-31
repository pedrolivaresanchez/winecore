import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { migrate } from '../migrate';
import { seed, seedInputFromEnv } from '../seed';
import { loadConfig } from '../../src/config';
import type { AuditChange } from '../../src/core/db/audit';
import type { KbClient } from '../../src/core/db/client';
import { createLocalClient } from '../../src/core/db/local';
import { openClient } from '../../src/core/db/open';
import { sql } from '../../src/core/db/sql';
import { createWriter, installWriter, withWrite, type Actor, type Writer } from '../../src/core/db/writer';
import type { MigrationReport } from './report';

export interface WriteOp {
  sql: string;
  audit?: AuditChange;
}

export interface MigrationDb {
  client: KbClient;
  writer: Writer;
  /** True for the Timbal Knowledge Base: a dry run there would hold one transaction across several requests. */
  remote: boolean;
  close: () => Promise<void>;
}

/** `dbPath` value that targets the Knowledge Base configured by DB_MODE=timbal and the TIMBAL_* variables. */
export const TIMBAL_TARGET = 'timbal';

export async function openMigrationDb(path: string): Promise<MigrationDb> {
  if (path === TIMBAL_TARGET) return openTimbalMigrationDb();
  if (path !== ':memory:') await mkdir(dirname(path), { recursive: true });
  const client = await createLocalClient(path);
  await migrate(client);
  // A database that already has its entities (a mirror of production) keeps its own seed.
  const seeded = await client.query<{ n: unknown }>('SELECT count(*) AS n FROM core.legal_entity');
  if (Number(seeded[0]?.n ?? 0) === 0) await seed(client, seedInputFromEnv({ NODE_ENV: 'development' }));
  const writer = createWriter(client, { log: () => undefined });
  installWriter(writer);
  return { client, writer, remote: false, close: closer(client, writer) };
}

async function openTimbalMigrationDb(): Promise<MigrationDb> {
  const config = loadConfig(process.env);
  if (config.dbMode !== 'timbal') throw new Error('DB_MODE');
  const client = await openClient(config);
  // The schema is deployed separately; the migrator never changes it and never seeds production.
  const { pending } = await migrate(client, { dryRun: true });
  if (pending.length > 0) throw new Error('SCHEMA_PENDING');
  const writer = createWriter(client, { log: () => undefined });
  installWriter(writer);
  // The running API may hold the single-writer lease; it lapses 60 s after its last renewal.
  let acquired = false;
  for (let attempt = 0; attempt < 24 && !acquired; attempt += 1) {
    acquired = await writer.tryAcquireLease();
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!acquired) throw new Error('WRITER_LEASE');
  return { client, writer, remote: true, close: closer(client, writer) };
}

function closer(client: KbClient, writer: Writer): () => Promise<void> {
  return async () => {
    writer.stopMaintenance();
    await client.query(sql`
      UPDATE core.writer_lease
      SET holder = NULL, expires_at = TIMESTAMPTZ '1970-01-01 00:00:00+00'
      WHERE holder = ${writer.instanceId}
    `).catch(() => undefined);
    await client.close?.();
  };
}

export async function entityUuid(client: KbClient, code: string): Promise<string | null> {
  if (code === 'SHOPIFY') return null;
  const rows = await client.query<{ id: string }>(sql`
    SELECT id FROM core.legal_entity WHERE code = ${code}
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error('ENTITY');
  return id;
}

export function canonicalEntity(raw: string): string {
  const code = raw.trim().toUpperCase().replaceAll('.', '');
  if (code === 'PO' || code === 'CVPO' || code === 'SHOPIFY') return code;
  if (code === 'WEB') return 'SHOPIFY';
  throw new Error('ENTITY');
}

export async function fileAlreadyLoaded(client: KbClient, fileSha256: string, dataset: string): Promise<boolean> {
  const rows = await client.query<{ id: string }>(sql`
    SELECT id FROM legacy.import_batch
    WHERE file_sha256 = ${fileSha256} AND dataset = ${dataset} AND mode = 'load'
    LIMIT 1
  `);
  return rows.length > 0;
}

export function batchOp(input: {
  id: string;
  source: string;
  entityId: string | null;
  dataset: string;
  fileName: string;
  fileSha256: string;
  rowsRead: number;
  rowsLoaded: number;
  rowsRejected: number;
  report: MigrationReport;
  actorId: string;
  now: Date;
  /** Histórico: el lote se cierra al final para poder reanudar un corte a medias. */
  open?: boolean;
}): WriteOp {
  return {
    sql: sql`
      INSERT INTO legacy.import_batch (
        id, source, entity_id, dataset, file_name, file_sha256, mode,
        rows_read, rows_loaded, rows_rejected, report, started_at, finished_at, run_by
      ) VALUES (
        CAST(${input.id} AS UUID),
        ${input.source},
        CASE WHEN ${input.entityId} IS NULL THEN NULL ELSE CAST(${input.entityId} AS UUID) END,
        ${input.dataset},
        ${input.fileName},
        ${input.fileSha256},
        'load',
        ${input.rowsRead},
        ${input.open ? 0 : input.rowsLoaded},
        ${input.rowsRejected},
        ${sql.json(input.report)},
        ${input.now},
        ${input.open ? null : input.now},
        ${input.actorId}
      )
    `,
    audit: {
      table: 'legacy.import_batch',
      rowId: input.id,
      action: 'INSERT',
      before: null,
      after: {
        dataset: input.dataset,
        source: input.source,
        rows_read: input.rowsRead,
        rows_loaded: input.rowsLoaded,
      },
    },
  };
}

export async function applyOps(input: {
  client: KbClient;
  writer: Writer;
  mode: 'dry-run' | 'load';
  actor: Actor;
  ops: readonly WriteOp[];
  beforeRollback?: (client: KbClient) => Promise<void>;
}): Promise<void> {
  if (input.ops.length === 0) return;
  if (input.mode === 'dry-run') {
    await input.client.query('BEGIN TRANSACTION');
    try {
      for (const chunk of chunks(input.ops, 80)) {
        await input.client.query(chunk.map((op) => stripSemicolon(op.sql)).join(';\n'));
      }
      if (input.beforeRollback) await input.beforeRollback(input.client);
      await input.client.query('ROLLBACK');
    } catch (error) {
      await input.client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    return;
  }
  if (!(await input.writer.tryAcquireLease())) throw new Error('WRITER_LEASE');
  for (const chunk of chunks(input.ops, 80)) {
    await withWrite(input.actor, async (tx) => {
      for (const op of chunk) {
        tx.write(op.sql);
        if (op.audit) tx.audit(op.audit);
      }
    });
  }
}

export function sha256Buffer(value: Buffer | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function stripSemicolon(statement: string): string {
  return statement.trim().replace(/;+\s*$/u, '');
}
