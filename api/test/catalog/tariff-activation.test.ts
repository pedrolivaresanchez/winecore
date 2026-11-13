import { describe, expect, it } from 'bun:test';
import { openApprovalService } from '../../src/core/approvals/sql-store';
import { sql } from '../../src/core/db/sql';
import type { Writer } from '../../src/core/db/writer';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

type App = Awaited<ReturnType<typeof createTestApp>>;
type Data = Record<string, unknown>;

async function ownerId(writer: Writer): Promise<string> {
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.app_user WHERE email = 'owner@winecore.test'
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error('falta el propietario');
  return id;
}

async function approveSubject(writer: Writer, userId: string, subjectId: string): Promise<void> {
  const rows = await writer.read<{ id: string; payload_sha256: string }>(sql`
    SELECT id::VARCHAR AS id, payload_sha256
    FROM ops.approval_request
    WHERE subject_id = CAST(${subjectId} AS UUID)
    ORDER BY requested_at DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw new Error('falta la solicitud');
  const service = await openApprovalService(writer, { type: 'user', id: userId, requestId: `approve-${subjectId}` });
  await service.decide({
    requestId: row.id,
    decision: 'approve',
    payloadSha256: row.payload_sha256,
    stepUpMethod: 'totp',
    actor: {
      userId,
      kind: 'user',
      stepUpAt: new Date().toISOString(),
      roles: [{ role: 'owner', legalEntityId: null }],
    },
  });
}

async function call(
  ctx: App,
  method: string,
  path: string,
  body?: unknown,
  user?: string,
): Promise<{ status: number; body: Data }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (user) headers['x-dev-user'] = user;
  const response = await ctx.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text === '' ? {} : JSON.parse(text) as Data };
}

async function tool(ctx: App, name: string, args: unknown): Promise<{ error: boolean; data: Data }> {
  const response = await ctx.app.handle(new Request('http://localhost/m2m/mcp', {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const payload = await response.json() as { result?: { isError?: boolean; content?: { type: string; text: string }[] } };
  if (!payload.result) throw new Error(`${name}: ${response.status} ${JSON.stringify(payload)}`);
  const block = payload.result.content?.[0];
  const data = block?.type === 'text' ? JSON.parse(block.text) as Data : {};
  return { error: payload.result.isError === true, data };
}

async function prepare(ctx: App, name: string, args: unknown): Promise<{ token: string; summary: string; route: string }> {
  const result = await tool(ctx, `${name}_prepare`, args);
  expect(result.error ? JSON.stringify(result.data) : 'ok').toBe('ok');
  const preview = result.data.preview as Data;
  return {
    token: String(result.data.confirmation_token),
    summary: String(result.data.summary_es),
    route: String(preview.route),
  };
}

async function wineProduct(ctx: App, sku: string): Promise<string> {
  const wine = await call(ctx, 'POST', '/v1/wines', { code: sku.slice(0, 8), name: `Vino ${sku}`, color: 'red' });
  expect(wine.status).toBe(201);
  const format = await call(ctx, 'POST', '/v1/formats', {
    code: `${sku.slice(0, 6)}75`,
    name: '0,75',
    container: 'bottle',
    nominal_volume_ml: 750,
  });
  expect(format.status).toBe(201);
  const product = await call(ctx, 'POST', '/v1/products', {
    sku,
    name: `${sku} 2024`,
    kind: 'wine',
    wine_id: wine.body.id,
    vintage: 2024,
    format_id: format.body.id,
    alcohol_pct: '13.00',
  });
  expect(product.status).toBe(201);
  return String(product.body.id);
}

async function quoted(ctx: App, customerId: string, productId: string, date: string, channel?: string): Promise<Data> {
  const params = new URLSearchParams({ customer_id: customerId, product_id: productId, qty: '1', date });
  if (channel) params.set('channel', channel);
  const response = await call(ctx, 'GET', `/v1/price-quote?${params.toString()}`);
  expect(response.status).toBe(200);
  return response.body;
}

describe('activación de una tarifa', () => {
  it('activa la versión aprobada, rechaza la que no lo está y la cotización usa el precio nuevo', async () => {
    const ctx = await createTestApp({ mcpRatePerMinute: 1000 });
    try {
      const productId = await wineProduct(ctx, 'ACTIVA075');
      const list = await call(ctx, 'POST', '/v1/price-lists', {
        code: 'custom-activacion',
        name: 'Activación',
        currency: 'EUR',
      });
      expect(list.status).toBe(201);
      const listId = String(list.body.id);
      const version = await call(ctx, 'POST', `/v1/price-lists/${listId}/versions`, { valid_from: '2026-01-01' });
      expect(version.status).toBe(201);
      const versionId = String(version.body.id);
      const prices = await call(ctx, 'PUT', `/v1/price-lists/${listId}/versions/1/items`, {
        items: [{ product_id: productId, min_qty: '1', unit_price: '8.5000' }],
      });
      expect(prices.status).toBe(200);

      const customerId = newId();
      await ctx.client.query(sql`
        INSERT INTO party.contact (id, kind, legal_name, is_customer, default_price_list_id, created_by)
        VALUES (
          CAST(${customerId} AS UUID), 'company', 'Cliente Activación', TRUE,
          CAST(${listId} AS UUID), 'tariff-test'
        )
      `);

      const denied = await call(ctx, 'POST', `/v1/price-lists/${listId}/versions/1/activate`, undefined, 'asesor@winecore.test');
      expect(denied.status).toBe(403);

      const blocked = await call(ctx, 'POST', `/v1/price-lists/${listId}/versions/1/activate`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('WC_NOT_APPROVED');
      const stillDraft = await call(ctx, 'GET', `/v1/price-lists/${listId}/versions`);
      const draft = (stillDraft.body.items as { id: string; status: string }[]).find((item) => item.id === versionId);
      expect(draft?.status).toBe('draft');

      const asked = await call(ctx, 'POST', `/v1/price-lists/${listId}/versions/1/request-activation`);
      expect(asked.status).toBe(200);
      const pending = await call(ctx, 'POST', `/v1/price-lists/${listId}/versions/1/activate`);
      expect(pending.status).toBe(409);
      expect(pending.body.code).toBe('WC_NOT_APPROVED');

      const owner = await ownerId(ctx.writer);
      await approveSubject(ctx.writer, owner, versionId);
      const approved = await call(ctx, 'GET', `/v1/price-lists/${listId}/versions`);
      const ready = (approved.body.items as { id: string; status: string; approval_status: string | null }[])
        .find((item) => item.id === versionId);
      expect(ready).toMatchObject({ status: 'draft', approval_status: 'approved' });

      const activated = await call(ctx, 'POST', `/v1/price-lists/${listId}/versions/1/activate`);
      expect(activated.status).toBe(200);
      expect(activated.body.status).toBe('active');
      const first = await quoted(ctx, customerId, productId, '2026-06-01');
      expect(first).toMatchObject({
        unit_price: '8.500000',
        code: 'custom-activacion',
        price_list_version_id: versionId,
      });

      const next = await call(ctx, 'POST', `/v1/price-lists/${listId}/versions`, { valid_from: '2026-11-13' });
      expect(next.status).toBe(201);
      const nextId = String(next.body.id);
      const raised = await call(ctx, 'PUT', `/v1/price-lists/${listId}/versions/2/items`, {
        items: [{ product_id: productId, min_qty: '1', unit_price: '9.2500' }],
      });
      expect(raised.status).toBe(200);
      const secondAsk = await call(ctx, 'POST', `/v1/price-lists/${listId}/versions/2/request-activation`);
      expect(secondAsk.status).toBe(200);
      const beforeApproval = await prepare(ctx, 'catalog_price_list_version_activate', { id: listId, version: 2 });
      const refused = await tool(ctx, 'catalog_price_list_version_activate_commit', { confirmation_token: beforeApproval.token });
      expect(refused.error).toBe(true);
      expect(refused.data.code).toBe('WC_NOT_APPROVED');

      await approveSubject(ctx.writer, owner, nextId);
      const preview = await prepare(ctx, 'catalog_price_list_version_activate', { id: listId, version: 2 });
      expect(preview.route).toBe(`POST /v1/price-lists/${listId}/versions/2/activate`);
      expect(preview.summary).toContain('Activar la versión 2');
      const committed = await tool(ctx, 'catalog_price_list_version_activate_commit', { confirmation_token: preview.token });
      expect(committed.error ? JSON.stringify(committed.data) : 'ok').toBe('ok');
      expect(committed.data.status).toBe('active');

      const later = await quoted(ctx, customerId, productId, '2026-11-13');
      expect(later).toMatchObject({ unit_price: '9.250000', price_list_version_id: nextId });
      const earlier = await quoted(ctx, customerId, productId, '2026-11-12');
      expect(earlier).toMatchObject({ unit_price: '8.500000', price_list_version_id: versionId });

      const viaTool = await tool(ctx, 'catalog_price_quote', {
        customer_id: customerId,
        channel: 'direct',
        date: '2026-11-13',
        lines: [{ sku: 'ACTIVA075', quantity: '1' }],
      });
      expect(viaTool.error ? JSON.stringify(viaTool.data) : 'ok').toBe('ok');
      const line = (viaTool.data.lines as { unit_price: string; price_list: string }[])[0];
      expect(line).toMatchObject({ unit_price: '9.25', price_list: 'custom-activacion' });
    } finally {
      await ctx.close();
    }
  });
});

describe('catalog_price_quote por canal', () => {
  it('hostelería usa Restaurante y no el PVP, igual que el precio del cliente', async () => {
    const ctx = await createTestApp({ mcpRatePerMinute: 1000 });
    try {
      const productId = await wineProduct(ctx, 'ENTRE075');
      const final = await call(ctx, 'POST', '/v1/price-lists', {
        code: 'final',
        name: 'PVP',
        currency: 'EUR',
        tax_included: true,
      });
      const horeca = await call(ctx, 'POST', '/v1/price-lists', {
        code: 'custom-horeca',
        name: 'Restaurante 2026',
        currency: 'EUR',
      });
      const distributor = await call(ctx, 'POST', '/v1/price-lists', {
        code: 'distributor',
        name: 'Distribución',
        currency: 'EUR',
      });
      expect([final.status, horeca.status, distributor.status]).toEqual([201, 201, 201]);

      async function active(listId: string, price: string): Promise<void> {
        const versionId = newId();
        await ctx.writer.withWrite({ type: 'user', id: 'tariff-test', requestId: 'tariff-test' }, async (tx) => {
          tx.write(sql`
            INSERT INTO catalog.price_list_version (
              id, price_list_id, version, valid_from, status, created_by, activated_at
            ) VALUES (
              CAST(${versionId} AS UUID), CAST(${listId} AS UUID), 1,
              DATE '2026-01-01', 'active', 'tariff-test', now()
            )
          `);
          tx.write(sql`
            INSERT INTO catalog.price_list_item (id, version_id, product_id, min_qty, unit_price)
            VALUES (
              CAST(${newId()} AS UUID), CAST(${versionId} AS UUID), CAST(${productId} AS UUID),
              CAST('1.000' AS DECIMAL(14,3)), CAST(${price} AS DECIMAL(14,6))
            )
          `);
        });
      }
      await active(String(final.body.id), '15.0000');
      await active(String(horeca.body.id), '11.1000');
      await active(String(distributor.body.id), '8.4000');

      const customerId = newId();
      await ctx.client.query(sql`
        INSERT INTO party.contact (id, kind, legal_name, is_customer, default_channel, created_by)
        VALUES (
          CAST(${customerId} AS UUID), 'company', 'Restaurante Ejemplo', TRUE, 'direct', 'tariff-test'
        )
      `);

      const quote = await tool(ctx, 'catalog_price_quote', {
        customer_id: customerId,
        channel: 'horeca',
        date: '2026-11-13',
        lines: [{ sku: 'ENTRE075', quantity: '1' }],
      });
      expect(quote.error ? JSON.stringify(quote.data) : 'ok').toBe('ok');
      expect((quote.data.lines as Data[])[0]).toMatchObject({ unit_price: '11.10', price_list: 'custom-horeca' });

      const withoutCustomer = await tool(ctx, 'catalog_price_quote', {
        channel: 'horeca',
        date: '2026-11-13',
        lines: [{ sku: 'ENTRE075', quantity: '2' }],
      });
      expect(withoutCustomer.error ? JSON.stringify(withoutCustomer.data) : 'ok').toBe('ok');
      expect((withoutCustomer.data.lines as Data[])[0]).toMatchObject({ unit_price: '11.10', price_list: 'custom-horeca' });

      const http = await quoted(ctx, customerId, productId, '2026-11-13', 'horeca');
      expect(http).toMatchObject({ unit_price: '11.100000', code: 'custom-horeca' });

      const pvp = await tool(ctx, 'catalog_price_quote', {
        customer_id: customerId,
        channel: 'direct',
        date: '2026-11-13',
        lines: [{ sku: 'ENTRE075', quantity: '1' }],
      });
      expect(pvp.error ? JSON.stringify(pvp.data) : 'ok').toBe('ok');
      expect((pvp.data.lines as Data[])[0]).toMatchObject({ unit_price: '12.40', price_list: 'final' });
    } finally {
      await ctx.close();
    }
  });
});
