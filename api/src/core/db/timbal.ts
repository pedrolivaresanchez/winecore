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
      return payload.rows as T[];
    },
  };
}
