import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';

function headers(email?: string, json = false): Headers {
  const value = new Headers();
  if (json) value.set('content-type', 'application/json');
  if (email) value.set('x-dev-user', email);
  return value;
}

async function call(
  app: { handle: (request: Request) => Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
  email?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: headers(email, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  const parsed = text === '' ? {} : JSON.parse(text) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

const parcel = {
  code: 'P-OPT',
  name: 'Pago opciones',
  ownership: 'own',
  sigpac: '23:50:0:0:9:1:1',
  area_ha: '1.2500',
  organic_status: 'in_conversion',
  conversion_started_on: '2024-03-01',
  varieties: [{ variety: 'BOBAL', area_ha: '1.2500', planting_year: 2008 }],
};

describe('opciones de parcela', () => {
  it('devuelve id, código, nombre, superficie y estado ecológico', async () => {
    const ctx = await createTestApp();
    try {
      const variety = await call(ctx.app, 'POST', '/v1/grape-varieties', {
        code: 'BOBAL',
        name: 'Bobal',
        color: 'red',
      }, 'bodega@winecore.test');
      expect(variety.status).toBe(201);
      const created = await call(ctx.app, 'POST', '/v1/parcels', parcel, 'bodega@winecore.test');
      expect(created.status).toBe(201);
      const hidden = await call(ctx.app, 'POST', '/v1/parcels', {
        ...parcel,
        code: 'P-OFF',
        name: 'Parcela baja',
        sigpac: '23:50:0:0:9:2:1',
        is_active: false,
      }, 'bodega@winecore.test');
      expect(hidden.status).toBe(201);

      const options = await call(ctx.app, 'GET', '/v1/parcels/options', undefined, 'asesor@winecore.test');
      expect(options.status).toBe(200);
      const items = options.body.items as Record<string, unknown>[];
      expect(items.find((item) => item.code === 'P-OFF')).toBeUndefined();
      expect(items.find((item) => item.code === 'P-OPT')).toMatchObject({
        id: created.body.id,
        code: 'P-OPT',
        name: 'Pago opciones',
        area: '1.2500',
        area_ha: '1.2500',
        organic_status: 'in_conversion',
      });
      const cellar = await call(ctx.app, 'GET', '/v1/parcels/options', undefined, 'bodega@winecore.test');
      expect(cellar.status).toBe(200);
    } finally {
      await ctx.close();
    }
  });
});
