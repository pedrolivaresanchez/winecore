import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { dispatchOutbox } from '../../src/core/events/dispatch';
import { emitEvent } from '../../src/core/events/emit';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import type { Actor } from '../../src/core/db/writer';

const actor: Actor = { type: 'user', id: 'owner', requestId: 'req-avisos' };

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function asUser(email: string, path: string, method = 'GET') {
  return new Request(`http://localhost${path}`, { method, headers: { 'X-Dev-User': email } });
}

async function items(ctx: Awaited<ReturnType<typeof createTestApp>>, email: string, query = '') {
  const response = await ctx.app.handle(asUser(email, `/v1/notifications${query}`));
  expect(response.status).toBe(200);
  const body = await json(response);
  return body.items as { id: string; kind: string; read_at: string | null; title: string; body: string }[];
}

describe('avisos', () => {
  it('cada usuario ve solo los suyos', async () => {
    const ctx = await createTestApp();
    try {
      const created = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'aviso-contacto-01' },
        body: JSON.stringify({
          kind: 'company',
          legal_name: 'Bodega Aviso',
          tax_id: '00000000T',
          country_code: 'ES',
          language: 'es',
          is_customer: true,
          is_supplier: false,
          is_carrier: false,
          is_logistics_operator: false,
          vat_regime: 'general',
          payment_terms_days: 30,
          email: 'aviso@example.com',
          phone: '100200300',
        }),
      }));
      expect(created.status).toBe(201);
      await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => new Date(), log: () => undefined });

      const owner = await items(ctx, 'owner@winecore.test', '?unread=true');
      const admin = await items(ctx, 'admin@winecore.test', '?unread=true');
      const cellar = await items(ctx, 'bodega@winecore.test', '?unread=true');
      const advisor = await items(ctx, 'asesor@winecore.test', '?unread=true');
      expect(owner).toHaveLength(1);
      expect(admin).toHaveLength(1);
      expect(owner[0]?.kind).toBe('party.contact.created');
      expect(owner[0]?.id).not.toBe(admin[0]?.id);
      expect(cellar).toHaveLength(0);
      expect(advisor).toHaveLength(0);
      const blob = JSON.stringify({ owner, admin });
      expect(blob).not.toContain('Bodega Aviso');
      expect(blob).not.toContain('aviso@example.com');
      expect(blob).not.toContain('100200300');
      expect(blob).not.toContain('00000000T');

      const foreign = await ctx.app.handle(asUser('owner@winecore.test', `/v1/notifications/${admin[0]?.id}/read`, 'POST'));
      expect(foreign.status).toBe(404);

      const read = await ctx.app.handle(asUser('owner@winecore.test', `/v1/notifications/${owner[0]?.id}/read`, 'POST'));
      expect(read.status).toBe(200);
      const marked = await json(read);
      expect(marked.read_at).not.toBeNull();
      const again = await ctx.app.handle(asUser('owner@winecore.test', `/v1/notifications/${owner[0]?.id}/read`, 'POST'));
      expect(again.status).toBe(200);
      expect((await json(again)).read_at).toBe(marked.read_at);
      expect(await items(ctx, 'owner@winecore.test', '?unread=true')).toHaveLength(0);
      expect(await items(ctx, 'admin@winecore.test', '?unread=true')).toHaveLength(1);

      const all = await ctx.app.handle(asUser('admin@winecore.test', '/v1/notifications/read-all', 'POST'));
      expect(all.status).toBe(200);
      expect((await json(all)).updated).toBe(1);
      const repeat = await ctx.app.handle(asUser('admin@winecore.test', '/v1/notifications/read-all', 'POST'));
      expect((await json(repeat)).updated).toBe(0);
      expect(await items(ctx, 'admin@winecore.test', '?unread=true')).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  it('pagina con cursor y respeta la entidad del aviso', async () => {
    const ctx = await createTestApp();
    try {
      await ctx.writer.withWrite(actor, async (tx) => {
        for (let index = 0; index < 3; index += 1) {
          const id = newId();
          emitEvent(tx, {
            type: 'cellar.fermentation.alert',
            aggregate: 'cellar.fermentation_reading',
            aggregateId: id,
            payload: { reading_id: id, link: `/bodega/lotes/${id}` },
          });
        }
      });
      const dispatched = await dispatchOutbox({
        writer: ctx.writer,
        config: ctx.config,
        now: () => new Date(),
        log: () => undefined,
      });
      expect(dispatched.internal).toBe(3);

      const seen = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query = cursor ? `?unread=true&limit=1&cursor=${encodeURIComponent(cursor)}` : '?unread=true&limit=1';
        const response = await ctx.app.handle(asUser('bodega@winecore.test', `/v1/notifications${query}`));
        expect(response.status).toBe(200);
        const body = await json(response);
        const pageItems = body.items as { id: string }[];
        expect(pageItems).toHaveLength(1);
        const item = pageItems[0];
        if (!item) throw new Error('página vacía');
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
        cursor = typeof body.next_cursor === 'string' ? body.next_cursor : null;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen.size).toBe(3);
      const owner = await items(ctx, 'owner@winecore.test', '?unread=true');
      expect(owner).toHaveLength(3);
      expect(await items(ctx, 'admin@winecore.test', '?unread=true')).toHaveLength(0);

      const bad = await ctx.app.handle(asUser('owner@winecore.test', '/v1/notifications?cursor=no-es-un-cursor'));
      expect(bad.status).toBe(422);

      const entities = await ctx.writer.read<{ id: string; code: string }>('SELECT id, code FROM core.legal_entity');
      const po = entities.find((row) => row.code === 'PO');
      const cvpo = entities.find((row) => row.code === 'CVPO');
      if (!po || !cvpo) throw new Error('entidades');
      const userId = newId();
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          INSERT INTO core.app_user (id, email, display_name, locale, status)
          VALUES (CAST(${userId} AS UUID), 'aprobador.po@winecore.test', 'Aprobador PO', 'es-ES', 'active')
        `);
        tx.write(sql`
          INSERT INTO core.user_role (id, user_id, role_code, legal_entity_id)
          VALUES (CAST(${newId()} AS UUID), CAST(${userId} AS UUID), 'approver', CAST(${po.id} AS UUID))
        `);
        const other = newId();
        emitEvent(tx, {
          type: 'ops.approval.requested',
          aggregate: 'ops.approval_request',
          aggregateId: other,
          payload: { legal_entity_id: cvpo.id, approval_id: other, link: `/aprobaciones/${other}` },
        });
        const own = newId();
        emitEvent(tx, {
          type: 'ops.approval.requested',
          aggregate: 'ops.approval_request',
          aggregateId: own,
          payload: { legal_entity_id: po.id, approval_id: own, link: `/aprobaciones/${own}` },
        });
      });
      await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => new Date(), log: () => undefined });
      const approver = await items(ctx, 'aprobador.po@winecore.test', '?unread=true');
      expect(approver).toHaveLength(1);
      expect(approver[0]?.kind).toBe('ops.approval.requested');
      const ownerApprovals = (await items(ctx, 'owner@winecore.test', '?unread=true'))
        .filter((row) => row.kind === 'ops.approval.requested');
      expect(ownerApprovals).toHaveLength(2);
    } finally {
      await ctx.close();
    }
  });
});
