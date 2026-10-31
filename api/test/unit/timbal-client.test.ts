import { describe, expect, it } from 'bun:test';
import { createTimbalAuth } from '../../src/auth/timbal';
import { createTimbalClient, type FetchLike } from '../../src/core/db/timbal';

describe('createTimbalClient', () => {
  it('envía el SQL y el token al endpoint de la Knowledge Base', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ rows: [{ id: 1 }] }), { status: 200 });
    };
    const client = createTimbalClient({
      host: 'api.timbal.ai',
      orgId: '122',
      kbId: 'kb-1',
      token: 'secret-token',
      fetchImpl,
    });
    const rows = await client.query<{ id: number }>('SELECT 1');
    expect(rows).toEqual([{ id: 1 }]);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://api.timbal.ai/orgs/122/k2/kb-1/query');
    expect(call?.init?.method).toBe('POST');
    const headers = new Headers(call?.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer secret-token');
    expect(JSON.parse(String(call?.init?.body))).toEqual({ sql: 'SELECT 1', params: [] });
  });

  it('no llama a la red real si la respuesta no es correcta', async () => {
    const fetchImpl: FetchLike = async () => new Response('no', { status: 403 });
    const client = createTimbalClient({
      host: 'api.timbal.ai',
      orgId: '122',
      kbId: 'kb-1',
      token: 'secret-token',
      fetchImpl,
    });
    await expect(client.query('SELECT 1')).rejects.toThrow(/403/);
  });
});

describe('createTimbalAuth', () => {
  it('valida /me y el acceso al proyecto, y cachea 60 s', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/me')) {
        return new Response(JSON.stringify({ user_email: 'owner@winecore.test' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };
    const auth = createTimbalAuth(
      { timbalApiHost: 'api.timbal.ai', timbalOrgId: 'org-1', timbalProjectId: 'proj-1' },
      fetchImpl,
    );
    expect(await auth.emailFor('token-1')).toBe('owner@winecore.test');
    expect(await auth.emailFor('token-1')).toBe('owner@winecore.test');
    expect(calls).toEqual([
      'https://api.timbal.ai/me',
      'https://api.timbal.ai/orgs/org-1/projects/proj-1',
    ]);
  });
});
