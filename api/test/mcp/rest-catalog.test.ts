import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { entityId, seedWarehouse } from '../cellar-api/fixtures';
import { createTestApp } from '../helpers';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Data = Record<string, unknown>;

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ mcpRatePerMinute: 1000 });
});

afterAll(async () => {
  await t.close();
});

async function rest(method: string, path: string, body?: unknown): Promise<{ status: number; json: Data }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await t.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, json: text.trim() === '' ? {} : JSON.parse(text) as Data };
}

async function tool(name: string, args: unknown): Promise<{ error: boolean; data: Data }> {
  const response = await t.app.handle(new Request('http://localhost/m2m/mcp', {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const body = await response.json() as { result?: { isError?: boolean; content?: { type: string; text: string }[] } };
  if (!body.result) throw new Error(`${name}: ${response.status} ${JSON.stringify(body)}`);
  const block = body.result.content?.[0];
  const data = block?.type === 'text' ? JSON.parse(block.text) as Data : {};
  return { error: body.result.isError === true, data };
}

async function read(name: string, args: unknown): Promise<Data> {
  const result = await tool(name, args);
  expect(result.error ? JSON.stringify(result.data) : 'ok').toBe('ok');
  return result.data;
}

async function prepare(name: string, args: unknown): Promise<{ token: string; summary: string; preview: Data }> {
  const result = await tool(`${name}_prepare`, args);
  expect(result.error ? JSON.stringify(result.data) : 'ok').toBe('ok');
  return {
    token: String(result.data.confirmation_token),
    summary: String(result.data.summary_es),
    preview: result.data.preview as Data,
  };
}

async function commit(name: string, token: string): Promise<Data> {
  const result = await tool(`${name}_commit`, { confirmation_token: token });
  expect(result.error ? JSON.stringify(result.data) : 'ok').toBe('ok');
  return result.data;
}

async function write(name: string, args: unknown): Promise<Data> {
  const prepared = await prepare(name, args);
  return commit(name, prepared.token);
}

function ids(data: Data): string[] {
  return (data.items as { id: string }[]).map((item) => item.id);
}

async function newWineProduct(prefix: string): Promise<string> {
  const wine = await rest('POST', '/v1/wines', { code: `${prefix}-W`, name: `Vino Sintético ${prefix}`, color: 'white' });
  expect(wine.status).toBe(201);
  const format = await rest('POST', '/v1/formats', { code: `${prefix}75`, name: 'Botella sintética', container: 'bottle', nominal_volume_ml: 750 });
  expect(format.status).toBe(201);
  const product = await rest('POST', '/v1/products', {
    sku: `${prefix}-075`,
    name: `Vino Sintético ${prefix} 2025`,
    kind: 'wine',
    wine_id: wine.json.id,
    vintage: 2025,
    format_id: format.json.id,
  });
  expect(product.status).toBe(201);
  return String(product.json.id);
}

describe('MCP de catálogo y stock sobre las rutas de la app', () => {
  test('lista productos y da de alta, edita y archiva uno con prepare/commit', async () => {
    const wine = await write('catalog_wine_create', { code: 'SINT-TINTO', name: 'Vino Sintético Tinto', color: 'red' });
    const wines = await read('catalog_wines_list', {});
    expect(ids(wines)).toContain(String(wine.id));

    const format = await write('catalog_format_create', {
      code: 'S75',
      name: 'Botella sintética 0,75 L',
      container: 'bottle',
      nominal_volume_ml: 750,
      cases_per_pallet: 100,
    });
    expect((format.links as { web: string }).web.endsWith(`/catalogo/formatos/${String(format.id)}`)).toBe(true);
    const formats = await read('catalog_formats_list', {});
    const listedFormat = (formats.items as { id: string; cases_per_pallet: number }[]).find((item) => item.id === format.id);
    expect(listedFormat?.cases_per_pallet).toBe(100);

    const created = await prepare('catalog_product_create', {
      sku: 'SINT-TINTO-23-75',
      name: 'Vino Sintético Tinto 2023',
      kind: 'wine',
      wine_id: wine.id,
      vintage: 2023,
      format_id: format.id,
      alcohol_pct: '13.5',
    });
    expect(created.summary).toContain('SINT-TINTO-23-75');
    expect(created.preview.route).toBe('POST /v1/products');
    const notYet = await read('catalog_products_list', { q: 'SINT-TINTO-23' });
    expect(notYet.items).toEqual([]);
    const product = await commit('catalog_product_create', created.token);
    const id = String(product.id);
    expect((product.links as { web: string }).web.endsWith(`/catalogo/${id}`)).toBe(true);

    const listed = await read('catalog_products_list', { q: 'Sintético', kind: 'wine' });
    expect(ids(listed)).toContain(id);
    const detail = await read('catalog_product_detail_get', { id });
    expect(detail.sku).toBe('SINT-TINTO-23-75');

    const edit = await prepare('catalog_product_update', { id, changes: { name: 'Vino Sintético Tinto Reserva 2023', name_en: 'Synthetic Red' } });
    expect(edit.preview.route).toBe(`PATCH /v1/products/${id}`);
    expect((edit.preview.record as Data).name).toBe('Vino Sintético Tinto 2023');
    expect(edit.preview.changes).toEqual({ name: 'Vino Sintético Tinto Reserva 2023', name_en: 'Synthetic Red' });
    expect(edit.summary).toContain('SINT-TINTO-23-75 · Vino Sintético Tinto 2023');
    await commit('catalog_product_update', edit.token);
    const edited = await rest('GET', `/v1/products/${id}`);
    expect(edited.json.name).toBe('Vino Sintético Tinto Reserva 2023');
    expect(edited.json.name_en).toBe('Synthetic Red');

    const stale = await prepare('catalog_product_update', { id, changes: { nc_code: '22042109' } });
    await write('catalog_product_update', { id, changes: { name_en: null } });
    const refused = await tool('catalog_product_update_commit', { confirmation_token: stale.token });
    expect(refused.error).toBe(true);
    expect(refused.data.code).toBe('WC_MCP_PREVIEW_STALE');
    expect((await rest('GET', `/v1/products/${id}`)).json.nc_code).toBeNull();

    const archive = await prepare('catalog_product_update', { id, changes: { is_active: false } });
    expect(archive.summary).toStartWith('Archivar el producto SINT-TINTO-23-75');
    await commit('catalog_product_update', archive.token);
    const archived = await rest('GET', `/v1/products/${id}`);
    expect(archived.json.is_active).toBe(false);
    expect(ids(await read('catalog_products_list', { q: 'Sintético', active: true }))).not.toContain(id);
    expect(ids(await read('catalog_products_list', { q: 'Sintético', active: false }))).toContain(id);

    const invalid = await tool('catalog_product_update_prepare', { id, changes: { sku: 'minúsculas' } });
    expect(invalid.error).toBe(true);
    expect(invalid.data.code).toBe('WC_VALIDATION');

    const weights = await write('catalog_format_update', { id: format.id, changes: { unit_gross_weight_g: 1300, unit_net_weight_g: 1250 } });
    expect(weights.unit_gross_weight_g).toBe(1300);
    const retired = await prepare('catalog_wine_update', { id: wine.id, changes: { is_active: false } });
    expect(retired.preview.route).toBe(`PATCH /v1/wines/${String(wine.id)}`);
    expect(retired.summary).toStartWith('Archivar el vino');
    await commit('catalog_wine_update', retired.token);
    expect(ids(await read('catalog_wines_list', { active: false }))).toContain(String(wine.id));
  });

  test('crea una tarifa con un borrador y cambia solo los precios indicados', async () => {
    const productId = await newWineProduct('SINTB');

    const list = await write('catalog_price_list_create', { code: 'custom-sintetica', name: 'Tarifa Sintética' });
    const listId = String(list.id);
    expect((list.links as { web: string }).web.endsWith(`/catalogo/tarifas/${listId}`)).toBe(true);
    const lists = await read('catalog_price_lists_list', {});
    const listed = (lists.items as { id: string; active_version: number | null }[]).find((item) => item.id === listId);
    expect(listed?.active_version).toBeNull();
    const renamed = await write('catalog_price_list_update', { id: listId, changes: { name: 'Tarifa Sintética Horeca', tax_included: true } });
    expect([renamed.name, renamed.tax_included]).toEqual(['Tarifa Sintética Horeca', true]);

    const version = await write('catalog_price_list_version_create', { id: listId, valid_from: '2026-12-01', notes: 'Prueba sintética' });
    expect(version.status).toBe('draft');
    const number = Number(version.version);

    const first = await prepare('catalog_price_list_items_set', {
      id: listId,
      version: number,
      upsert: [
        { product_id: productId, min_qty: '1', unit_price: '7.9' },
        { product_id: productId, min_qty: '6', unit_price: '7.1' },
      ],
    });
    expect(first.preview.route).toBe(`PUT /v1/price-lists/${listId}/versions/${number}/items`);
    expect(first.summary).toContain('quedará con 2 precios (ahora tiene 0)');
    await commit('catalog_price_list_items_set', first.token);

    const second = await prepare('catalog_price_list_items_set', {
      id: listId,
      version: number,
      upsert: [{ product_id: productId, min_qty: '1', unit_price: '8.25' }],
      remove: [{ product_id: productId, min_qty: '6.000' }],
    });
    expect(second.summary).toContain('quedará con 1 precios (ahora tiene 2)');
    await commit('catalog_price_list_items_set', second.token);

    const versions = await rest('GET', `/v1/price-lists/${listId}/versions`);
    const draft = (versions.json.items as { version: number; items: { min_qty: string; unit_price: string }[] }[])
      .find((item) => item.version === number);
    expect(draft?.items.map((item) => [item.min_qty, item.unit_price])).toEqual([['1.000', '8.2500']]);
    const viaTool = await read('catalog_price_list_versions_list', { id: listId });
    expect((viaTool.items as unknown[]).length).toBe(1);

    const both = await tool('catalog_price_list_items_set_prepare', {
      id: listId,
      version: number,
      items: [{ product_id: productId, min_qty: '1', unit_price: '9' }],
      upsert: [{ product_id: productId, min_qty: '1', unit_price: '9' }],
    });
    expect(both.error).toBe(true);
    expect(both.data.code).toBe('WC_VALIDATION');
  });

  test('da de alta una ubicación, recibe material y lee las existencias', async () => {
    const po = await entityId(t);
    const warehouse = await seedWarehouse(t, po);
    const warehouses = await read('inventory_tax_warehouses_list', {});
    expect(ids(warehouses)).toContain(warehouse);

    const location = await write('inventory_location_create', {
      code: 'SINT-BOD',
      name: 'Bodega sintética',
      kind: 'cellar',
      controlling_entity_id: po,
      tax_warehouse_id: warehouse,
    });
    const located = await read('inventory_location_get', { code: 'SINT-BOD' });
    expect(located.id).toBe(location.id);
    const locationId = String(location.id);

    const renamed = await prepare('inventory_location_update', { code: 'SINT-BOD', changes: { name: 'Bodega sintética norte' } });
    expect(renamed.preview.route).toBe('PATCH /v1/locations/SINT-BOD');
    await commit('inventory_location_update', renamed.token);
    expect((await rest('GET', '/v1/locations/SINT-BOD')).json.name).toBe('Bodega sintética norte');

    const cork = await write('catalog_product_create', { sku: 'SINT-CORCHO', name: 'Corcho sintético', kind: 'packaging_material', unit: 'ud' });
    const corkId = String(cork.id);

    const format = await rest('POST', '/v1/formats', { code: 'SC75', name: 'Botella sintética corcho', container: 'bottle', nominal_volume_ml: 750 });
    const formatId = String(format.json.id);
    const line = await write('catalog_format_material_add', { id: formatId, material: { material_product_id: corkId, per: 'unit', quantity: '1' } });
    const materials = await read('catalog_format_materials_list', { id: formatId });
    expect(ids(materials)).toEqual([String(line.id)]);
    const updated = await write('catalog_format_material_update', { id: formatId, material_id: line.id, changes: { quantity: '2' } });
    expect(updated.quantity).toBe('2.000');
    const removal = await prepare('catalog_format_material_remove', { id: formatId, material_id: line.id });
    expect(removal.preview.route).toBe(`DELETE /v1/formats/${formatId}/materials/${String(line.id)}`);
    expect(removal.summary).toContain('SINT-CORCHO · Corcho sintético');
    await commit('catalog_format_material_remove', removal.token);
    expect((await rest('GET', `/v1/formats/${formatId}/materials`)).json.items).toEqual([]);

    const receipt = await prepare('inventory_material_receipt_create', {
      product_id: corkId,
      location_id: locationId,
      qty_units: 500,
      occurred_at: '2026-10-01T08:00:00Z',
    });
    expect(receipt.summary).toContain('500 unidades');
    const received = await commit('inventory_material_receipt_create', receipt.token);
    expect(received.move_type).toBe('purchase_in');

    const balances = await read('inventory_stock_balances_list', { product_id: corkId, at: '2026-10-02' });
    const rows = balances.items as { location_id: string; qty_units: number; product_state: string }[];
    expect(rows.map((row) => [row.location_id, row.product_state, Number(row.qty_units)])).toEqual([[locationId, 'goods', 500]]);
    expect((balances.links as { web: string }).web.endsWith('/stock')).toBe(true);

    const before = await read('inventory_stock_balances_list', { product_id: corkId, at: '2026-09-30' });
    expect(before.items).toEqual([]);

    const stock = await read('inventory_materials_stock_list', { at: '2026-10-02', product_id: corkId });
    expect((stock.items as { qty_units: number }[]).map((row) => Number(row.qty_units))).toEqual([500]);

    const moves = await read('inventory_stock_moves_list', { book: 'physical', product_id: corkId });
    expect((moves.items as { move_type: string }[]).map((row) => row.move_type)).toEqual(['purchase_in']);
  });
});
