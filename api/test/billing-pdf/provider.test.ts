import { describe, expect, it } from 'bun:test';
import { loadConfig } from '../../src/config';
import { DomainError } from '../../src/core/errors';
import { createGraphMailProvider, mailProviderFromConfig } from '../../src/core/billing/send/provider';

const dev = { NODE_ENV: 'test', AUTH_MODE: 'dev' };
const SECRET = 'super-secret-value';

describe('proveedor de correo', () => {
  it('queda desactivado si Q-014 no está configurado y no llama a la red', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 500 });
    };
    const config = loadConfig(dev);
    expect(config.outboundMail.enabled).toBe(false);
    const provider = mailProviderFromConfig(config, fetchImpl);
    expect(provider.enabled).toBe(false);
    let caught: unknown;
    try {
      await provider.send({ to: ['facturas@example.com'], subject: 'x', text: 'y', attachments: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).code).toBe('WC_MAIL_DISABLED');
    expect(calls).toHaveLength(0);

    const partial = loadConfig({
      ...dev,
      WINECORE_MAIL_PROVIDER: 'graph',
      WINECORE_GRAPH_CLIENT_SECRET: SECRET,
    });
    expect(partial.outboundMail.enabled).toBe(false);
    expect(partial.outboundMail.clientSecret).toBe('');
  });

  it('Graph solo hace el token y sendMail, sin leer el buzón', async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') });
      if (url.endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 'token-test' }), { status: 200 });
      }
      return new Response(null, { status: 202 });
    };
    const provider = createGraphMailProvider({
      tenantId: 'tenant-id',
      clientId: 'client-id',
      clientSecret: SECRET,
      sender: 'facturacion@example.com',
    }, fetchImpl);
    await provider.send({
      to: ['facturas@example.com'],
      subject: 'Factura CF26-0001',
      text: 'Adjuntamos la factura.',
      attachments: [{ filename: 'factura-CF26-0001.pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }],
    });
    expect(calls.map((call) => call.method)).toEqual(['POST', 'POST']);
    expect(calls[0]?.url).toBe('https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token');
    expect(calls[0]?.url).not.toContain(SECRET);
    expect(calls[0]?.body).toContain(SECRET);
    expect(calls[1]?.url).toBe('https://graph.microsoft.com/v1.0/users/facturacion%40example.com/sendMail');
    expect(calls.some((call) => call.url.includes('/messages') || call.method === 'GET')).toBe(false);
    expect(calls[1]?.body).toContain('facturas@example.com');
    expect(calls[1]?.body).toContain('factura-CF26-0001.pdf');
  });

  it('un buzón mal escrito no arranca y el mensaje no repite el secreto', () => {
    let caught: unknown;
    try {
      loadConfig({
        ...dev,
        WINECORE_MAIL_PROVIDER: 'graph',
        WINECORE_GRAPH_TENANT_ID: 'tenant-id',
        WINECORE_GRAPH_CLIENT_ID: 'client-id',
        WINECORE_GRAPH_CLIENT_SECRET: SECRET,
        WINECORE_GRAPH_SENDER: 'no-es-un-correo',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('WINECORE_GRAPH_SENDER');
    expect((caught as Error).message).not.toContain(SECRET);
  });
});
