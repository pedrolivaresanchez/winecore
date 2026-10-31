import type { KbClient } from './client';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TimbalClientOptions {
  host: string;
  orgId: string;
  kbId: string;
  token: string;
  fetchImpl?: FetchLike;
}

export function createTimbalClient(options: TimbalClientOptions): KbClient {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `https://${options.host}/orgs/${options.orgId}/k2/${options.kbId}/query`;

  return {
    async query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql: statement, params: [] }),
        });
      } catch {
        throw new Error('No se ha podido consultar la base de datos');
      }
      if (!response.ok) {
        // The Knowledge Base returns { code, message }; only the first line is kept so SQL literals never reach logs.
        let message = `Consulta a la base de datos rechazada (${response.status})`;
        try {
          const body = (await response.json()) as { message?: unknown };
          if (typeof body.message === 'string' && body.message.trim() !== '') message = body.message.split('\n')[0]!.trim();
        } catch {
          // keep the generic message
        }
        throw new Error(message);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('Respuesta de la base de datos inválida');
      }
      if (!payload || typeof payload !== 'object' || !('rows' in payload) || !Array.isArray(payload.rows)) {
        throw new Error('Respuesta de la base de datos inválida');
      }
      if ('truncated' in payload && payload.truncated === true) {
        throw new Error('Resultado truncado por la Knowledge Base (más de 10.000 filas): hay que paginar la consulta');
      }
      return withNullColumns(payload.rows, 'columns' in payload ? payload.columns : undefined) as T[];
    },
  };
}

// The Knowledge Base omits NULL values from each row; the local DuckDB client returns them as null.
function withNullColumns(rows: unknown[], columns: unknown): unknown[] {
  if (!Array.isArray(columns)) return rows;
  const names = columns
    .map((column) => (column && typeof column === 'object' && 'name' in column ? column.name : undefined))
    .filter((name): name is string => typeof name === 'string');
  if (names.length === 0) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const record = row as Record<string, unknown>;
    for (const name of names) if (!(name in record)) record[name] = null;
    return record;
  });
}
