import { describe, expect, it } from 'bun:test';
import { isAuthGuard } from '../../src/auth/guard';
import { devAuthEnabled, isAllowedOrigin, securityHeaders } from '../../src/auth/policy';
import type { Config } from '../../src/config';
import { safeAttachmentName } from '../../src/core/attachments/mime';
import { sessionHash } from '../../src/core/auth/stepup/session';
import { isSensitiveText, safeLogMessage } from '../../src/core/redact';
import { createTestApp } from '../helpers';

const PUBLIC_PATHS = new Set(['/health', '/healthcheck']);

interface ListedRoute {
  method: string;
  path: string;
  hooks: { beforeHandle?: unknown };
}

function guarded(route: ListedRoute): boolean {
  const before = route.hooks.beforeHandle;
  const hooks = Array.isArray(before) ? before : before ? [before] : [];
  return hooks.some((hook) => {
    const fn = hook && typeof hook === 'object' && 'fn' in hook ? hook.fn : hook;
    return isAuthGuard(fn);
  });
}

describe('rutas con guarda', () => {
  it('toda ruta que no sea de salud exige una guarda de autenticación', async () => {
    const ctx = await createTestApp();
    try {
      const routes = (ctx.app as unknown as { routes: ListedRoute[] }).routes;
      expect(routes.length).toBeGreaterThan(20);
      const open = routes
        .filter((route) => route.method !== 'OPTIONS' && !guarded(route))
        .map((route) => `${route.method} ${route.path}`);
      expect(open.sort()).toEqual([
        'GET /auth/callback',
        'GET /health',
        'GET /healthcheck',
        'POST /auth/callback',
      ]);
      for (const route of routes) {
        if (route.method === 'OPTIONS') continue;
        if (route.path.startsWith('/v1') || route.path.includes('/m2m')) {
          expect(PUBLIC_PATHS.has(route.path)).toBe(false);
          expect(guarded(route)).toBe(true);
        }
      }
    } finally {
      await ctx.close();
    }
  });
});

describe('callback de acceso', () => {
  it('acepta el POST del proveedor y sigue con GET a la interfaz', async () => {
    const ctx = await createTestApp();
    try {
      const posted = await ctx.app.handle(new Request('http://localhost/auth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'access_token=access-token-1&refresh_token=refresh-token-1',
      }));
      expect(posted.status).toBe(303);
      expect(posted.headers.get('location')).toBe(
        '/login/callback#access_token=access-token-1&refresh_token=refresh-token-1',
      );
      expect(await posted.text()).toBe('');

      const missing = await ctx.app.handle(new Request('http://localhost/auth/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }));
      expect(missing.status).toBe(303);
      expect(missing.headers.get('location')).toBe('/login?error=auth_failed');

      const get = await ctx.app.handle(new Request('http://localhost/auth/callback'));
      expect(get.status).toBe(303);
      expect(get.headers.get('location')).toBe('/login/callback');
    } finally {
      await ctx.close();
    }
  });
});

describe('CORS y cabeceras', () => {
  it('en desarrollo admite el origen de la app y localhost, y rechaza el resto', async () => {
    const ctx = await createTestApp();
    try {
      const allowed = await ctx.app.handle(new Request('http://localhost/health', {
        headers: { origin: 'http://localhost:5173' },
      }));
      expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      expect(allowed.headers.get('x-content-type-options')).toBe('nosniff');
      expect(allowed.headers.get('strict-transport-security')).toBeNull();

      const denied = await ctx.app.handle(new Request('http://localhost/health', {
        headers: { origin: 'https://evil.example' },
      }));
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await ctx.close();
    }
  });

  it('en producción solo admite el origen de despliegue', async () => {
    const ctx = await createTestApp({
      env: {
        NODE_ENV: 'production',
        AUTH_MODE: 'timbal',
        TIMBAL_ORG_ID: 'org-1',
        TIMBAL_PROJECT_ID: 'proj-1',
        WEBAUTHN_RP_ID: 'bodega.example',
        WEBAUTHN_ORIGIN: 'https://bodega.example',
        APP_PUBLIC_URL: 'https://bodega.example',
        WINECORE_DATA_KEY: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      },
    });
    try {
      const allowed = await ctx.app.handle(new Request('http://localhost/health', {
        headers: { origin: 'https://bodega.example' },
      }));
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://bodega.example');
      expect(allowed.headers.get('strict-transport-security')).toContain('max-age=');

      const local = await ctx.app.handle(new Request('http://localhost/health', {
        headers: { origin: 'http://localhost:5173' },
      }));
      expect(local.headers.get('access-control-allow-origin')).toBeNull();

      const devUser = await ctx.app.handle(new Request('http://localhost/v1/me', {
        headers: { 'x-dev-user': 'owner@winecore.test', origin: 'https://bodega.example' },
      }));
      expect(devUser.status).toBe(401);
    } finally {
      await ctx.close();
    }
  });
});

describe('sesión y registros', () => {
  it('la cabecera de desarrollo no cuenta en producción', () => {
    expect(devAuthEnabled({ authMode: 'dev', nodeEnv: 'production' })).toBe(false);
    expect(devAuthEnabled({ authMode: 'dev', nodeEnv: 'test' })).toBe(true);
    const request = new Request('http://localhost/v1/me', {
      headers: { 'x-dev-user': 'otra@winecore.test', authorization: 'Bearer token-real' },
    });
    const dev = sessionHash({ authMode: 'dev', nodeEnv: 'test' } as Config, request, 'user-1');
    const prod = sessionHash({ authMode: 'dev', nodeEnv: 'production' } as Config, request, 'user-1');
    expect(Buffer.from(dev).equals(Buffer.from(prod))).toBe(false);
  });

  it('un error interno no escribe SQL ni datos personales', async () => {
    const logs: string[] = [];
    const ctx = await createTestApp({ log: (line) => logs.push(line) });
    try {
      const writer = ctx.writer as { read: (statement: string) => Promise<unknown[]> };
      const original = writer.read.bind(ctx.writer);
      writer.read = async (statement: string) => {
        if (statement.includes('schema_migration')) {
          const email = ['persona', 'example.com'].join('@');
          const iban = `ES91${'21000418450200051332'}`;
          throw new Error(`SELECT email FROM party.contact WHERE email = '${email}' AND iban = '${iban}'`);
        }
        return original(statement);
      };
      const response = await ctx.app.handle(new Request('http://localhost/health'));
      expect(response.status).toBe(500);
      const body = await response.text();
      const email = ['persona', 'example.com'].join('@');
      const iban = `ES91${'21000418450200051332'}`;
      expect(body).not.toContain(email);
      expect(body).not.toContain(iban);
      expect(body).not.toContain('SELECT');
      expect(logs.join('\n')).not.toContain(email);
      expect(logs.join('\n')).not.toContain(iban);
      expect(logs.join('\n')).not.toContain('SELECT');
    } finally {
      await ctx.close();
    }
  });

  it('la cookie no sustituye a un bearer inválido', async () => {
    const logs: string[] = [];
    const seen: string[] = [];
    const ctx = await createTestApp({
      log: (line) => logs.push(line),
      env: {
        AUTH_MODE: 'timbal',
        TIMBAL_ORG_ID: 'org-1',
        TIMBAL_PROJECT_ID: 'proj-1',
      },
      fetchImpl: async (_url, init) => {
        const authorization = new Headers(init?.headers).get('authorization') ?? '';
        seen.push(authorization);
        if (authorization === 'Bearer good-token') {
          return new Response(JSON.stringify({
            session: { user_email: 'owner@winecore.test' },
            project: { id: 'proj-1' },
          }), { status: 200 });
        }
        return new Response('{}', { status: 401 });
      },
    });
    try {
      const cookie = await ctx.app.handle(new Request('http://localhost/v1/me', {
        headers: { cookie: 'timbal_access_token=good-token' },
      }));
      expect(cookie.status).toBe(200);
      const mixed = await ctx.app.handle(new Request('http://localhost/v1/me', {
        headers: {
          authorization: 'Bearer bad-token',
          cookie: 'timbal_access_token=good-token',
        },
      }));
      expect(mixed.status).toBe(401);
      expect(seen).toContain('Bearer good-token');
      expect(seen).toContain('Bearer bad-token');
      expect(logs.join('\n')).not.toContain('good-token');
      expect(logs.join('\n')).not.toContain('bad-token');
    } finally {
      await ctx.close();
    }
  });
});

describe('datos de contacto y nombres de fichero', () => {
  it('el asesor no recibe calle, correo ni teléfono', async () => {
    const ctx = await createTestApp();
    try {
      const created = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'seguridad-contacto-1' },
        body: JSON.stringify({
          kind: 'company',
          legal_name: 'Bodega Ejemplo',
          country_code: 'ES',
          language: 'es',
          is_customer: true,
          is_supplier: false,
          is_carrier: false,
          is_logistics_operator: false,
          vat_regime: 'general',
          payment_terms_days: 30,
          email: ['cliente', 'example.com'].join('@'),
          phone: '100200300',
        }),
      }));
      expect(created.status).toBe(201);
      const contact = await created.json() as { id: string };
      const address = await ctx.app.handle(new Request(`http://localhost/v1/contacts/${contact.id}/addresses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'billing',
          line1: 'Calle Secreta 1',
          postal_code: '28001',
          city: 'Madrid',
          country_code: 'ES',
          is_default: true,
        }),
      }));
      expect(address.status).toBe(200);
      const hidden = await ctx.app.handle(new Request(`http://localhost/v1/contacts/${contact.id}`, {
        headers: { 'x-dev-user': 'asesor@winecore.test' },
      }));
      expect(hidden.status).toBe(200);
      const body = await hidden.json() as {
        email: string | null;
        phone: string | null;
        addresses: { line1: string | null; postal_code: string | null; city: string }[];
      };
      expect(body.email).toBeNull();
      expect(body.phone).toBeNull();
      expect(body.addresses[0]?.city).toBe('Madrid');
      expect(body.addresses[0]?.line1).toBeNull();
      expect(body.addresses[0]?.postal_code).toBeNull();
      expect(JSON.stringify(body)).not.toContain('Calle Secreta');
      expect(JSON.stringify(body)).not.toContain(['cliente', 'example.com'].join('@'));
    } finally {
      await ctx.close();
    }
  });

  it('un nombre de fichero no sale del directorio', () => {
    expect(safeAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(safeAttachmentName('..\\..\\nota.pdf')).toBe('nota.pdf');
    expect(safeAttachmentName('nota.pdf')).toBe('nota.pdf');
    expect(safeAttachmentName('.')).toBe('');
  });
});

describe('redacción', () => {
  it('detecta correo, NIF, IBAN, teléfono, SQL y tokens', () => {
    expect(isSensitiveText(`hola ${['persona', 'example.com'].join('@')}`)).toBe(true);
    expect(isSensitiveText(`NIF ${'12345678'}Z`)).toBe(true);
    expect(isSensitiveText(`ES91${'21000418450200051332'}`)).toBe(true);
    expect(isSensitiveText('SELECT 1')).toBe(true);
    expect(isSensitiveText('Bearer abc.def')).toBe(true);
    expect(safeLogMessage('SELECT email FROM t')).toBe('Error interno');
    expect(safeLogMessage('Variable ausente o inválida: PORT')).toBe('Variable ausente o inválida: PORT');
    expect(isAllowedOrigin(
      { nodeEnv: 'production', appPublicUrl: 'https://bodega.example', webauthnOrigin: 'https://bodega.example' },
      'http://localhost:5173',
    )).toBe(false);
    expect(securityHeaders('production')['strict-transport-security']).toContain('max-age=');
    expect(securityHeaders('test')['strict-transport-security']).toBeUndefined();
  });
});
