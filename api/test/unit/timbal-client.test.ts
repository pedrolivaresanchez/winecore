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

  it('caduca a los 60 s, no pasa de 500 entradas y no escribe el token', async () => {
    let now = 1_000_000;
    const calls: string[] = [];
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((item) => String(item)).join(' '));
    };
    const fetchImpl: FetchLike = async (_url, init) => {
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      calls.push(authorization);
      const token = authorization.slice('Bearer '.length);
      return new Response(JSON.stringify({
        session: { user_email: 'owner@winecore.test' },
        project: { id: 'proj-1' },
      }), { status: 200, headers: { 'x-echo': token } });
    };
    try {
      const auth = createTimbalAuth(config, fetchImpl, () => now);
      await auth.emailFor('token-vivo');
      expect(calls).toHaveLength(1);
      now += 59_000;
      expect(await auth.emailFor('token-vivo')).toBe('owner@winecore.test');
      expect(calls).toHaveLength(1);
      now += 2_000;
      expect(await auth.emailFor('token-vivo')).toBe('owner@winecore.test');
      expect(calls).toHaveLength(2);

      const sized = createTimbalAuth(config, fetchImpl, () => now);
      const mark = calls.length;
      for (let index = 0; index < 500; index += 1) await sized.emailFor(`token-${index}`);
      expect(calls.length).toBe(mark + 500);
      await sized.emailFor('token-extra');
      expect(calls.length).toBe(mark + 501);
      await sized.emailFor('token-0');
      expect(calls.length).toBe(mark + 502);
      expect(logs.join('\n')).not.toContain('token-vivo');
      expect(logs.join('\n')).not.toContain('token-extra');
    } finally {
      console.log = original;
    }
  });

  it('un fallo de red no incluye el token en el error', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('fallo de red con token-secreto');
    };
    await expect(createTimbalAuth(config, fetchImpl).emailFor('token-secreto')).rejects.toThrow(/sesión/);
    try {
      await createTimbalAuth(config, fetchImpl).emailFor('token-secreto');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('token-secreto');
    }
  });
});
