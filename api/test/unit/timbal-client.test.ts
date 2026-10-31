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
  const config = { timbalApiHost: 'api.timbal.ai', timbalOrgId: 'org-1', timbalProjectId: 'proj-1' };

  it('valida la sesión de la app con /me?project_id y la cachea 60 s', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ session: { user_id: 1, user_email: 'owner@winecore.test' }, project: { id: 'proj-1', role: 'member' } }), { status: 200 });
    };
    const auth = createTimbalAuth(config, fetchImpl);
    expect(await auth.emailFor('token-1')).toBe('owner@winecore.test');
    expect(await auth.emailFor('token-1')).toBe('owner@winecore.test');
    expect(calls).toEqual(['https://api.timbal.ai/me?project_id=proj-1']);
  });

  it('no usa la API de gestión de la organización, que da 403 a los usuarios de la app', async () => {
    const fetchImpl: FetchLike = async (url) =>
      String(url).includes('/orgs/')
        ? new Response('{}', { status: 403 })
        : new Response(JSON.stringify({ session: { user_email: 'owner@winecore.test' }, project: { id: 'proj-1' } }), { status: 200 });
    expect(await createTimbalAuth(config, fetchImpl).emailFor('token-2')).toBe('owner@winecore.test');
  });

  it('rechaza la sesión si Timbal no la acepta para el proyecto', async () => {
    const fetchImpl: FetchLike = async () => new Response('{}', { status: 403 });
    expect(await createTimbalAuth(config, fetchImpl).emailFor('token-3')).toBeNull();
  });

  it('rechaza la sesión de otro proyecto', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ session: { user_email: 'owner@winecore.test' }, project: { id: 'otro' } }), { status: 200 });
    expect(await createTimbalAuth(config, fetchImpl).emailFor('token-4')).toBeNull();
  });
});
