import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DuckDBInstance, DuckDBTypeId, type DuckDBResultReader } from '@duckdb/node-api';
import type { KbClient } from './client';

const TIMESTAMP_TYPES = new Set<DuckDBTypeId>([
  DuckDBTypeId.TIMESTAMP,
  DuckDBTypeId.TIMESTAMP_S,
  DuckDBTypeId.TIMESTAMP_MS,
  DuckDBTypeId.TIMESTAMP_NS,
  // node-api 1.5.5 no define TIMESTAMP_TZ_NS.
  DuckDBTypeId.TIMESTAMP_TZ,
]);
// DuckDB 1.5.5 has no TIMESTAMP_TZ_NS (that id arrived in 2.x).
const timestampTzNs = (DuckDBTypeId as unknown as Record<string, DuckDBTypeId | undefined>).TIMESTAMP_TZ_NS;
if (timestampTzNs !== undefined) TIMESTAMP_TYPES.add(timestampTzNs);

function plainValue(
  typeId: DuckDBTypeId,
  alias: string | undefined,
  jsonValue: unknown,
  jsValue: unknown,
): unknown {
  if (jsonValue == null) return null;
  if (alias === 'JSON' && typeof jsonValue === 'string') {
    try {
      return JSON.parse(jsonValue) as unknown;
    } catch {
      return jsonValue;
    }
  }
  if (TIMESTAMP_TYPES.has(typeId)) {
    if (jsValue instanceof Date) return jsValue.toISOString();
    return String(jsonValue);
  }
  if (typeId === DuckDBTypeId.BLOB && jsValue instanceof Uint8Array) {
    return Buffer.from(jsValue).toString('base64');
  }
  return jsonValue;
}

function rowsOf(reader: DuckDBResultReader): Record<string, unknown>[] {
  const jsonRows = reader.getRowObjectsJson() as Record<string, unknown>[];
  const jsRows = reader.getRowObjectsJS() as Record<string, unknown>[];
  const columns = Array.from({ length: reader.columnCount }, (_, index) => {
    const type = reader.columnType(index);
    return {
      name: reader.columnName(index),
      typeId: type.typeId,
      alias: type.alias,
    };
  });
  return jsonRows.map((jsonRow, rowIndex) => {
    const jsRow = jsRows[rowIndex];
    const out: Record<string, unknown> = {};
    for (const column of columns) {
      out[column.name] = plainValue(
        column.typeId,
        column.alias,
        jsonRow[column.name],
        jsRow?.[column.name],
      );
    }
    return out;
  });
}

export async function createLocalClient(path: string): Promise<KbClient> {
  if (path !== ':memory:') {
    await mkdir(dirname(path), { recursive: true });
  }
  const instance = await DuckDBInstance.create(path);
  const connection = await instance.connect();
  let chain: Promise<void> = Promise.resolve();

  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    query<T>(statement: string): Promise<T[]> {
      return exclusive(async () => {
        try {
          const reader = await connection.runAndReadAll(statement);
          return rowsOf(reader) as T[];
        } catch (error) {
          try {
            await connection.run('ROLLBACK');
          } catch {
            // No open transaction, or the rollback itself failed.
          }
          throw error;
        }
      });
    },
    close: async () => {
      connection.closeSync();
      instance.closeSync();
    },
  };
}
