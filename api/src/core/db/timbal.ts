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
        throw new Error(`Consulta a la base de datos rechazada (${response.status})`);
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
      return payload.rows as T[];
    },
  };
}
