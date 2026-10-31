import { describe, expect, test } from 'bun:test';

import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';
import { call, entityId, seedHolding, seedWarehouse } from '../cellar-api/fixtures';

async function enable(ctx: Awaited<ReturnType<typeof createTestApp>>, modules: readonly string[]) {
  await ctx.writer.withWrite(
    { type: 'system', id: 'mcp-test', requestId: 'mcp-test' },
    async (tx) => {
      for (const key of modules) {
        tx.write(sql`
          INSERT INTO core.module_state (module_key, enabled, changed_by)
          VALUES (${key}, TRUE, ${'test'})
        `);
      }
    },
  );
}

async function tool(
  app: { handle: (request: Request) => Promise<Response> },
  name: string,
  args: unknown,
  token?: string,
) {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await app.handle(new Request('http://localhost/m2m/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  }));
  const body = await response.json() as {
    result?: { isError?: boolean; content?: { text: string }[] };
    code?: string;
  };
  const text = body.result?.content?.[0]?.text;
  return {
    status: response.status,
    code: body.code,
    error: body.result?.isError === true,
    data: text ? JSON.parse(text) as Record<string, unknown> : null,
  };
}

describe('MCP tools on this branch', () => {
  test('a stale duplicate forces prepare again', async () => {
    const ctx = await createTestApp();
    try {
      await enable(ctx, ['contacts']);
      const created = await call(ctx, 'POST', '/v1/mcp/clients', {
        code: 'cvbot-stale',
        description: 'Cliente para caducidad de vista previa',
        scopes: ['write:contacts'],
      });
      const token = String(created.body.token);
      const prepared = await tool(ctx.app, 'contacts_create_prepare', {
        kind: 'company',
        legal_name: 'Bodega Gemela',
        country: 'US',
        is_customer: true,
      }, token);
      expect(prepared.error).toBe(false);
      await ctx.writer.withWrite(
        { type: 'system', id: 'mcp-test', requestId: 'dup' },
        async (tx) => {
          tx.write(sql`
            INSERT INTO party.contact (id, kind, legal_name, country_code, tax_id_type, is_customer, created_by)
            VALUES (
              CAST(${newId()} AS UUID), ${'company'}, ${'Bodega Gemela'}, ${'US'}, ${'none'}, TRUE, ${'mcp-test'}
            )
          `);
        },
      );
      const committed = await tool(ctx.app, 'contacts_create_commit', {
        confirmation_token: String(prepared.data?.confirmation_token),
      }, token);
      expect(committed.error).toBe(true);
      expect(committed.data?.code).toBe('WC_MCP_PREVIEW_STALE');
    } finally {
      await ctx.close();
    }
  });

  test('rotates and revokes a client token', async () => {
    const ctx = await createTestApp();
    try {
      const created = await call(ctx, 'POST', '/v1/mcp/clients', {
        code: 'cvbot-rota',
        description: 'Rotación de prueba',
        scopes: ['read:*'],
      });
      expect(created.status).toBe(201);
      const first = String(created.body.token);
      const id = String(created.body.id);
      const rotated = await call(ctx, 'POST', `/v1/mcp/clients/${id}/rotate`);
      expect(rotated.status).toBe(200);
      const second = String(rotated.body.token);
      expect(second).not.toBe(first);
      expect(String(rotated.body.prefix)).not.toBe(String(created.body.prefix));
      const stale = await tool(ctx.app, 'system_whoami', {}, first);
      expect(stale.status).toBe(401);
      const fresh = await tool(ctx.app, 'system_whoami', {}, second);
      expect(fresh.error).toBe(false);
      const revoked = await call(ctx, 'POST', `/v1/mcp/clients/${id}/revoke`);
      expect(revoked.status).toBe(200);
      const dead = await tool(ctx.app, 'system_whoami', {}, second);
      expect(dead.status).toBe(401);
      const again = await call(ctx, 'GET', '/v1/mcp/clients');
      expect(JSON.stringify(again.body)).not.toContain(second);
    } finally {
      await ctx.close();
    }
  });

  test('reads catalog and stock, creates an approval link, and drafts a cellar operation', async () => {
    const ctx = await createTestApp();
    try {
      await enable(ctx, ['catalog', 'inventory', 'cellar']);
      const products = await tool(ctx.app, 'catalog_products_search', { q: 'entredicho' });
      expect(products.error).toBe(false);
      expect(products.data?.items).toEqual([]);
      const formats = await tool(ctx.app, 'catalog_formats_list', {});
      expect(formats.error).toBe(false);
      expect(Array.isArray(formats.data?.items)).toBe(true);
      const lists = await tool(ctx.app, 'catalog_price_lists_list', { active: true });
      expect(lists.error).toBe(false);

      const stock = await tool(ctx.app, 'inventory_stock_at', { owner: 'PO' });
      expect(stock.error).toBe(false);
      expect(stock.data?.totals).toEqual({
        bulk_liters: '0.000',
        packaged_units: 0,
        packaged_liters: '0.000',
      });
      const moves = await tool(ctx.app, 'inventory_movements_list', { ledger: 'physical' });
      expect(moves.error).toBe(false);
      expect(moves.data?.items).toEqual([]);
      const reconcile = await tool(ctx.app, 'inventory_reconcile_physical_fiscal', {
        from: '2026-01-01',
        to: '2026-10-31',
      });
      expect(reconcile.error).toBe(false);
      expect(reconcile.data?.balanced).toBe(true);

      const subject = newId();
      const prepared = await tool(ctx.app, 'approvals_request_create_prepare', {
        kind: 'cellar_loss',
        subject_table: 'cellar.operation',
        subject_id: subject,
        summary: 'Merma sintetica de prueba',
        legal_entity: 'PO',
      });
      expect(prepared.error).toBe(false);
      const confirmation = String(prepared.data?.confirmation_token);
      const committed = await tool(ctx.app, 'approvals_request_create_commit', {
        confirmation_token: confirmation,
        idempotency_key: 'solicitud-sintetica',
      });
      expect(committed.error).toBe(false);
      expect(committed.data?.status).toBe('pending');
      expect(String(committed.data?.link)).toContain('/aprobaciones/');
      const decisions = await ctx.writer.read<{ n: string }>(sql`
        SELECT count(*)::VARCHAR AS n FROM ops.approval_decision
      `);
      expect(decisions[0]?.n).toBe('0');
      const pending = await tool(ctx.app, 'approvals_list_pending', { entity: 'PO', kind: 'cellar_loss' });
      expect(pending.error).toBe(false);
      const items = pending.data?.items as { id: string; link: string }[];
      expect(items.some((item) => item.id === committed.data?.approval_id)).toBe(true);

      const po = await entityId(ctx);
      const warehouse = await seedWarehouse(ctx, po);
      const location = await call(ctx, 'POST', '/v1/locations', {
        code: 'BOD',
        name: 'Bodega',
        kind: 'cellar',
        controlling_entity_id: po,
        tax_warehouse_id: warehouse,
      });
      expect(location.status).toBe(201);
      const locationId = String(location.body.id);
      for (const code of ['TANK-A', 'TANK-B']) {
        const vessel = await call(ctx, 'POST', '/v1/vessels', {
          code,
          name: code,
          kind: 'tank_storage',
          capacity_ml: 8_000_000,
          material: 'stainless_steel',
          location_id: locationId,
        });
        expect(vessel.status).toBe(201);
      }
      const tankA = await ctx.writer.read<{ id: string }>(sql`
        SELECT id::VARCHAR AS id FROM cellar.vessel WHERE code = ${'TANK-A'}
      `);
      await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId,
        vesselId: String(tankA[0]?.id),
        code: 'LOTE1',
        volumeMl: 100_000,
      });
      const draft = await tool(ctx.app, 'cellar_operation_draft_prepare', {
        op_type: 'racking',
        inputs: [{ lot_code: 'LOTE1', vessel_code: 'TANK-A', liters: '10.000' }],
        outputs: [{ lot_code: 'LOTE1', vessel_code: 'TANK-B', liters: '10.000' }],
      });
      expect(draft.error).toBe(false);
      const done = await tool(ctx.app, 'cellar_operation_draft_commit', {
        confirmation_token: String(draft.data?.confirmation_token),
      });
      expect(done.error).toBe(false);
      expect(done.data?.status).toBe('draft');
      const operationId = String(done.data?.operation_id);
      const stored = await ctx.writer.read<{ status: string }>(sql`
        SELECT status FROM cellar.operation WHERE id = CAST(${operationId} AS UUID)
      `);
      expect(stored[0]?.status).toBe('draft');
      const listed = await tool(ctx.app, 'cellar_operations_list', { status: 'draft' });
      const ops = listed.data?.items as { id: string }[];
      expect(ops.some((item) => item.id === operationId)).toBe(true);
      const vessels = await tool(ctx.app, 'cellar_vessels_list', { only_with_content: true });
      const codes = (vessels.data?.items as { code: string }[]).map((item) => item.code);
      expect(codes).toContain('TANK-A');
      const lot = await tool(ctx.app, 'cellar_lot_get', { lot_code: 'LOTE1' });
      expect(lot.error).toBe(false);
      expect((lot.data?.lot as { code: string }).code).toBe('LOTE1');
    } finally {
      await ctx.close();
    }
  });
});
