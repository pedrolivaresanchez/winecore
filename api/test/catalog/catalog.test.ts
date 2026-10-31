import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { gs1CheckDigit } from '../../src/core/shared/gs1';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { activateVersion } from '../../src/core/catalog/pricing';
import type { Actor } from '../../src/core/db/writer';
import { createTestApp } from '../helpers';

const actor: Actor = { type: 'user', id: 'catalog-test', requestId: 'catalog-test', reason: 'test' };

function gtin(body: string): string {
  return `${body}${gs1CheckDigit(body)}`;
}

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

describe('catálogo HTTP', () => {
  let ctx: Ctx;
  let n = 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    const userId = newId();
    const roleId = newId();
    await ctx.client.query(sql`
      INSERT INTO core.app_user (id, email, display_name, status)
      VALUES (CAST(${userId} AS UUID), 'campo@winecore.test', 'Campo', 'active')
    `);
    await ctx.client.query(sql`
      INSERT INTO core.user_role (id, user_id, role_code)
      VALUES (CAST(${roleId} AS UUID), CAST(${userId} AS UUID), 'field')
    `);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function code(prefix: string): string {
    n += 1;
    return `${prefix}${String(n).padStart(2, '0')}`;
  }

  async function call(path: string, init: RequestInit & { user?: string } = {}) {
    const headers = new Headers(init.headers);
    if (init.user) headers.set('x-dev-user', init.user);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await ctx.app.handle(new Request(`http://localhost${path}`, { ...init, headers }));
    const text = await response.text();
    return {
      status: response.status,
      text,
      json: text === '' ? null : JSON.parse(text) as Record<string, unknown>,
    };
  }

  it('crea vino, formato y producto y los lista', async () => {
    const wine = await call('/v1/wines', {
      method: 'POST',
      body: JSON.stringify({ code: code('W'), name: 'Tinto Ejemplo', color: 'red', is_organic: true }),
    });
    expect(wine.status).toBe(201);
    const wineId = String(wine.json?.id);
    expect(wine.json?.color).toBe('red');
    expect(wine.json?.category).toBe('wine');

    const badVolume = await call('/v1/formats', {
      method: 'POST',
      body: JSON.stringify({ code: code('F'), name: 'Nada', container: 'bottle', nominal_volume_ml: 0 }),
    });
    expect(badVolume.status).toBe(422);
    expect(badVolume.json?.code).toBe('WC_VALIDATION');
    expect((badVolume.json?.fields as Record<string, string>).nominal_volume_ml).toBeDefined();

    const heavy = await call('/v1/formats', {
      method: 'POST',
      body: JSON.stringify({
        code: code('F'),
        name: 'Peso imposible',
        container: 'bottle',
        nominal_volume_ml: 750,
        unit_gross_weight_g: 100,
        unit_net_weight_g: 200,
      }),
    });
    expect(heavy.status).toBe(422);
    expect((heavy.json?.fields as Record<string, string>).unit_net_weight_g).toBeDefined();

    const format = await call('/v1/formats', {
      method: 'POST',
      body: JSON.stringify({ code: code('F'), name: 'Botella 0,75 L', container: 'bottle', nominal_volume_ml: 750 }),
    });
    expect(format.status).toBe(201);
    expect(format.json?.nominal_volume_ml).toBe(750);
    expect(format.json?.units_per_case).toBe(6);
    const formatId = String(format.json?.id);

    const badVintage = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({
        sku: code('SKU'),
        name: 'Sin añada válida',
        kind: 'wine',
        wine_id: wineId,
        vintage: 1989,
        format_id: formatId,
      }),
    });
    expect(badVintage.status).toBe(422);
    expect((badVintage.json?.fields as Record<string, string>).vintage).toBeDefined();

    const badGtin = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({
        sku: code('SKU'),
        name: 'GTIN malo',
        kind: 'wine',
        wine_id: wineId,
        vintage: 2024,
        format_id: formatId,
        gtin: '6291041500214',
      }),
    });
    expect(badGtin.status).toBe(422);
    expect((badGtin.json?.fields as Record<string, string>).gtin).toBeDefined();

    const sku = code('SKU');
    const product = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({
        sku,
        name: 'Tinto Ejemplo 2024 0,75 L',
        name_en: 'Example red',
        kind: 'wine',
        wine_id: wineId,
        vintage: 2024,
        format_id: formatId,
        gtin: gtin('840000000001'),
        nc_code: '22042100',
        alcohol_pct: '13.50',
        default_tax_code: 'IVA21',
        sales_account: '70000000',
      }),
    });
    expect(product.status).toBe(201);
    expect(product.json?.requires_lot).toBe(true);
    expect(product.json?.alcohol_pct).toBe('13.50');
    expect(typeof product.json?.alcohol_pct).toBe('string');
    expect(product.text).toContain('"alcohol_pct":"13.50"');
    const productId = String(product.json?.id);

    const duplicate = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({
        sku: code('SKU'),
        name: 'Otro igual',
        kind: 'wine',
        wine_id: wineId,
        vintage: 2024,
        format_id: formatId,
      }),
    });
    expect(duplicate.status).toBe(422);
    expect((duplicate.json?.fields as Record<string, string>).wine_id).toBe('Ya existe');
    const duplicateDetails = duplicate.json?.details as { existing_id?: string; existing_name?: string };
    expect(duplicateDetails.existing_id).toBe(productId);
    expect(duplicateDetails.existing_name).toBe('Tinto Ejemplo 2024 0,75 L');

    const listed = await call(`/v1/products?kind=wine&wine_id=${wineId}&vintage=2024&format_id=${formatId}&active=true&organic=true`);
    expect(listed.status).toBe(200);
    const items = listed.json?.items as { id: string }[];
    expect(items.some((item) => item.id === productId)).toBe(true);
    expect(listed.json?.total).toBeGreaterThan(0);
    expect(listed.json?.next_cursor).toBeNull();

    const detail = await call(`/v1/products/${productId}`);
    expect(detail.status).toBe(200);
    expect(detail.json?.sku).toBe(sku);
    expect(detail.json?.is_gtin_current).toBe(false);

    const missingHeader = await call(`/v1/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Nuevo nombre largo' }),
    });
    expect(missingHeader.status).toBe(422);
    expect(missingHeader.json?.code).toBe('WC_VALIDATION');

    const stale = await call(`/v1/products/${productId}`, {
      method: 'PATCH',
      headers: { 'if-match': '2000-01-01T00:00:00.000Z' },
      body: JSON.stringify({ name: 'Nuevo nombre largo' }),
    });
    expect(stale.status).toBe(409);
    expect(stale.json?.code).toBe('WC_STALE_VERSION');

    const renamed = await call(`/v1/products/${productId}`, {
      method: 'PATCH',
      headers: { 'if-match': String(detail.json?.updated_at) },
      body: JSON.stringify({ name: 'Tinto Ejemplo renombrado' }),
    });
    expect(renamed.status).toBe(200);
    expect(renamed.json?.name).toBe('Tinto Ejemplo renombrado');
    expect(renamed.json?.alcohol_pct).toBe('13.50');
    expect(renamed.json?.updated_at).not.toBe(detail.json?.updated_at);

    const audits = await ctx.writer.read<{ action: string }>(sql`
      SELECT action FROM audit.audit_log
      WHERE table_name = 'catalog.product' AND row_id = ${productId}
    `);
    expect(audits.map((row) => row.action)).toContain('INSERT');
    expect(audits.map((row) => row.action)).toContain('UPDATE');

    const current = await call(`/v1/products/${productId}/gtin-current`, { method: 'POST', body: '{}' });
    expect(current.status).toBe(200);
    expect(current.json?.product_id).toBe(productId);
    const again = await call(`/v1/products/${productId}`);
    expect(again.json?.is_gtin_current).toBe(true);

    const archived = await call(`/v1/wines/${wineId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: false }),
    });
    expect(archived.status).toBe(200);
    expect(archived.json?.is_active).toBe(false);
    const still = await ctx.writer.read<{ id: string }>(sql`SELECT id FROM catalog.wine WHERE id = CAST(${wineId} AS UUID)`);
    expect(still).toHaveLength(1);
  });

  it('bloquea vino, añada y formato si hay movimientos', async () => {
    const wine = await call('/v1/wines', {
      method: 'POST',
      body: JSON.stringify({ code: code('W'), name: 'Blanco Ejemplo', color: 'white' }),
    });
    const other = await call('/v1/wines', {
      method: 'POST',
      body: JSON.stringify({ code: code('W'), name: 'Rosado Ejemplo', color: 'rose' }),
    });
    const format = await call('/v1/formats', {
      method: 'POST',
      body: JSON.stringify({ code: code('F'), name: 'Botella 0,5 L', container: 'bottle', nominal_volume_ml: 500 }),
    });
    const product = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({
        sku: code('SKU'),
        name: 'Blanco con stock',
        kind: 'wine',
        wine_id: wine.json?.id,
        vintage: 2023,
        format_id: format.json?.id,
      }),
    });
    expect(product.status).toBe(201);
    const productId = String(product.json?.id);
    const entities = await ctx.writer.read<{ id: string }>(`SELECT id FROM core.legal_entity WHERE code = 'PO'`);
    const entityId = String(entities[0]?.id);
    const locationId = newId();
    await ctx.client.query(sql`
      INSERT INTO inventory.location (id, code, name, kind, controlling_entity_id)
      VALUES (CAST(${locationId} AS UUID), ${code('LOC')}, 'Bodega de prueba', 'cellar', CAST(${entityId} AS UUID))
    `);
    await ctx.client.query(sql`
      INSERT INTO inventory.stock_move (
        id, occurred_at, move_type, location_id, owner_entity_id, product_id, product_state,
        qty_units, volume_ml, mass_g, source_table, source_id, created_by
      ) VALUES (
        CAST(${newId()} AS UUID), now(), 'purchase_in', CAST(${locationId} AS UUID), CAST(${entityId} AS UUID),
        CAST(${productId} AS UUID), 'goods', 1, 0, 0, 'catalog.product', CAST(${productId} AS UUID), 'test'
      )
    `);
    const locked = await call(`/v1/products/${productId}`, {
      method: 'PATCH',
      headers: { 'if-match': String(product.json?.updated_at) },
      body: JSON.stringify({ wine_id: other.json?.id }),
    });
    expect(locked.status).toBe(422);
    expect((locked.json?.fields as Record<string, string>).wine_id).toContain('movimientos');
    const off = await call(`/v1/products/${productId}`, {
      method: 'PATCH',
      headers: { 'if-match': String(product.json?.updated_at) },
      body: JSON.stringify({ is_active: false }),
    });
    expect(off.status).toBe(200);
    expect(off.json?.is_active).toBe(false);
  });

  it('pagina vinos con cursor y total', async () => {
    await call('/v1/wines', { method: 'POST', body: JSON.stringify({ code: code('W'), name: 'Uno', color: 'red' }) });
    await call('/v1/wines', { method: 'POST', body: JSON.stringify({ code: code('W'), name: 'Dos', color: 'white' }) });
    const seen: string[] = [];
    let cursor: string | null = null;
    let total = 0;
    for (let page = 0; page < 30; page += 1) {
      const url = cursor ? `/v1/wines?limit=1&cursor=${encodeURIComponent(cursor)}` : '/v1/wines?limit=1';
      const response = await call(url);
      expect(response.status).toBe(200);
      total = Number(response.json?.total);
      const items = response.json?.items as { id: string }[];
      expect(items.length).toBeLessThanOrEqual(1);
      seen.push(...items.map((item) => item.id));
      cursor = response.json?.next_cursor == null ? null : String(response.json.next_cursor);
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(seen.length);
    const bad = await call('/v1/wines?cursor=no-es-valido');
    expect(bad.status).toBe(422);
    expect(bad.json?.code).toBe('WC_VALIDATION');
  });

  it('filtra productos sin GTIN, sin NC y sin clave SILICIE', async () => {
    const wine = await call('/v1/wines', {
      method: 'POST',
      body: JSON.stringify({ code: code('W'), name: 'Sin códigos', color: 'other' }),
    });
    const format = await call('/v1/formats', {
      method: 'POST',
      body: JSON.stringify({ code: code('F'), name: 'Bag in box', container: 'bag_in_box', nominal_volume_ml: 3000 }),
    });
    const bare = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({
        sku: code('SKU'),
        name: 'Sin identificadores',
        kind: 'wine',
        wine_id: wine.json?.id,
        vintage: 2022,
        format_id: format.json?.id,
      }),
    });
    expect(bare.status).toBe(201);
    for (const missing of ['gtin', 'nc_code', 'silicie']) {
      const response = await call(`/v1/products?missing=${missing}`);
      const items = response.json?.items as { id: string }[];
      expect(items.some((item) => item.id === bare.json?.id)).toBe(true);
    }
    const priced = await call('/v1/products?gtin=' + gtin('840000000001'));
    expect(priced.status).toBe(200);
  });

  it('exige catalog.write y deja bodega y asesoría en lectura', async () => {
    const cellarRead = await call('/v1/products', { user: 'bodega@winecore.test' });
    expect(cellarRead.status).toBe(200);
    const cellarWrite = await call('/v1/wines', {
      method: 'POST',
      user: 'bodega@winecore.test',
      body: JSON.stringify({ code: code('W'), name: 'No', color: 'red' }),
    });
    expect(cellarWrite.status).toBe(403);
    expect(cellarWrite.json?.code).toBe('WC_FORBIDDEN');
    const advisorRead = await call('/v1/formats', { user: 'asesor@winecore.test' });
    expect(advisorRead.status).toBe(200);
    const advisorWrite = await call('/v1/formats', {
      method: 'POST',
      user: 'asesor@winecore.test',
      body: JSON.stringify({ code: code('F'), name: 'No', container: 'bottle', nominal_volume_ml: 750 }),
    });
    expect(advisorWrite.status).toBe(403);
    const field = await call('/v1/products', { user: 'campo@winecore.test' });
    expect(field.status).toBe(403);
    expect(field.json?.code).toBe('WC_FORBIDDEN');
    const fieldCsv = await ctx.app.handle(new Request('http://localhost/v1/products/export.csv', {
      headers: { 'x-dev-user': 'campo@winecore.test' },
    }));
    expect(fieldCsv.status).toBe(403);
    const admin = await call('/v1/wines', {
      method: 'POST',
      user: 'admin@winecore.test',
      body: JSON.stringify({ code: code('W'), name: 'De administración', color: 'red' }),
    });
    expect(admin.status).toBe(201);
  });

  it('rechaza un servicio con stock y un precio que no es cadena', async () => {
    const service = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({ sku: code('SKU'), name: 'Visita', kind: 'service', is_stock_tracked: true }),
    });
    expect(service.status).toBe(422);
    expect((service.json?.fields as Record<string, string>).is_stock_tracked).toBeDefined();
    const ok = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({ sku: code('SKU'), name: 'Visita bodega', kind: 'service' }),
    });
    expect(ok.status).toBe(201);
    expect(ok.json?.is_stock_tracked).toBe(false);
    expect(ok.json?.requires_lot).toBe(false);
  });

  it('exporta el CSV filtrado con BOM y coma decimal', async () => {
    const wine = await call('/v1/wines', {
      method: 'POST',
      body: JSON.stringify({ code: code('W'), name: 'Exportable', color: 'red' }),
    });
    const format = await call('/v1/formats', {
      method: 'POST',
      body: JSON.stringify({ code: code('F'), name: 'Botella', container: 'bottle', nominal_volume_ml: 750 }),
    });
    const sku = code('SKU');
    const created = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({
        sku,
        name: 'Cosecha exportable',
        kind: 'wine',
        wine_id: wine.json?.id,
        vintage: 2019,
        format_id: format.json?.id,
        alcohol_pct: '13.50',
        gtin: gtin('840000000090'),
      }),
    });
    expect(created.status).toBe(201);
    const other = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({ sku: code('SKU'), name: 'Servicio aparte', kind: 'service' }),
    });
    expect(other.status).toBe(201);

    const response = await ctx.app.handle(new Request('http://localhost/v1/products/export.csv?q=exportable&kind=wine'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('SKU;Nombre;Nombre en inglés;Tipo;Vino;')).toBe(true);
    expect(text).toContain(`${sku};Cosecha exportable;`);
    expect(text).toContain(';Vino;Exportable;2019;');
    expect(text).toContain('13,50');
    expect(text).not.toContain('Servicio aparte');

    const missing = await ctx.app.handle(new Request('http://localhost/v1/products/export.csv?missing=gtin'));
    expect(missing.status).toBe(200);
    const missingText = await missing.text();
    expect(missingText).not.toContain(sku);
    expect(missingText).toContain('Servicio aparte');

    const advisor = await ctx.app.handle(new Request('http://localhost/v1/products/export.csv?q=exportable', {
      headers: { 'x-dev-user': 'asesor@winecore.test' },
    }));
    expect(advisor.status).toBe(200);
    expect([...(new Uint8Array(await advisor.arrayBuffer())).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe('tarifas HTTP', () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function call(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await ctx.app.handle(new Request(`http://localhost${path}`, { ...init, headers }));
    const text = await response.text();
    return { status: response.status, text, json: text === '' ? null : JSON.parse(text) as Record<string, unknown> };
  }

  it('reemplaza el borrador, conserva el precio como cadena y bloquea la versión activa', async () => {
    const wine = await call('/v1/wines', {
      method: 'POST',
      body: JSON.stringify({ code: 'TARIFA', name: 'Tarifa Ejemplo', color: 'red' }),
    });
    const format = await call('/v1/formats', {
      method: 'POST',
      body: JSON.stringify({ code: 'T075', name: '0,75', container: 'bottle', nominal_volume_ml: 750 }),
    });
    const product = await call('/v1/products', {
      method: 'POST',
      body: JSON.stringify({
        sku: 'TARIFA075',
        name: 'Tarifa Ejemplo 2025',
        kind: 'wine',
        wine_id: wine.json?.id,
        vintage: 2025,
        format_id: format.json?.id,
        alcohol_pct: '12.5',
      }),
    });
    expect(product.status).toBe(201);
    const productId = String(product.json?.id);
    const list = await call('/v1/price-lists', {
      method: 'POST',
      body: JSON.stringify({ code: 'custom-ejemplo', name: 'Ejemplo', currency: 'EUR' }),
    });
    expect(list.status).toBe(201);
    const usd = await call('/v1/price-lists', {
      method: 'POST',
      body: JSON.stringify({ code: 'custom-dolar', name: 'Dólar', currency: 'USD' }),
    });
    expect(usd.status).toBe(422);
    const version = await call(`/v1/price-lists/${String(list.json?.id)}/versions`, {
      method: 'POST',
      body: JSON.stringify({ valid_from: '2026-01-01', notes: 'inicial' }),
    });
    expect(version.status).toBe(201);
    expect(version.json?.status).toBe('draft');
    const numeric = await call(`/v1/price-lists/${String(list.json?.id)}/versions/1/items`, {
      method: 'PUT',
      body: JSON.stringify({ items: [{ product_id: productId, min_qty: '1', unit_price: 7.9 }] }),
    });
    expect(numeric.status).toBe(422);
    const prices = await call(`/v1/price-lists/${String(list.json?.id)}/versions/1/items`, {
      method: 'PUT',
      body: JSON.stringify({
        items: [
          { product_id: productId, min_qty: '1', unit_price: '7.9000' },
          { product_id: productId, min_qty: '6', unit_price: '7.1000' },
        ],
      }),
    });
    expect(prices.status).toBe(200);
    expect(prices.text).toContain('"unit_price":"7.9000"');
    expect(prices.text).toContain('"min_qty":"6.000"');
    const items = (prices.json?.items as { unit_price: string }[]);
    expect(items.map((item) => item.unit_price).sort()).toEqual(['7.1000', '7.9000']);

    await ctx.writer.withWrite(actor, (tx) => activateVersion(tx, String(version.json?.id)));
    const locked = await call(`/v1/price-lists/${String(list.json?.id)}/versions/1/items`, {
      method: 'PUT',
      body: JSON.stringify({ items: [{ product_id: productId, min_qty: '1', unit_price: '8.0000' }] }),
    });
    expect(locked.status).toBe(409);
    expect(locked.json).toEqual({ code: 'WC050', message: 'Versión de tarifa no editable' });

    const visible = await call(`/v1/products/${productId}/prices`);
    expect(visible.status).toBe(200);
    const shown = visible.json?.items as { unit_price: string; code: string }[];
    expect(shown.some((row) => row.unit_price === '7.9000' && row.code === 'custom-ejemplo')).toBe(true);
    expect(visible.text).toContain('"unit_price":"7.9000"');
  });

  it('responde 404 si el producto no existe y respeta el prefijo /api', async () => {
    const missing = await call('/v1/products/019a0000-0000-7000-8000-00000000abcd');
    expect(missing.status).toBe(404);
    expect(missing.json?.code).toBe('WC_NOT_FOUND');
    const prefixed = await createTestApp({ env: { API_BASE_PATH: '/api' } });
    try {
      const response = await prefixed.app.handle(new Request('http://localhost/api/v1/wines'));
      expect(response.status).toBe(200);
      const outside = await prefixed.app.handle(new Request('http://localhost/v1/wines'));
      expect(outside.status).toBe(404);
    } finally {
      await prefixed.close();
    }
  });
});
