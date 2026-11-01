import { describe, expect, it } from 'bun:test';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, entityId, type TestApp } from './fixtures';

async function seedLot(ctx: TestApp, producer: string, code: string, organic: boolean): Promise<void> {
  await ctx.writer.withWrite({ type: 'system', id: 'cellar-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO inventory.lot (id, producer_entity_id, code, kind, vintage, is_organic, status, origin)
      VALUES (
        CAST(${newId()} AS UUID), CAST(${producer} AS UUID), ${code}, ${'wine'},
        2025, ${organic}, ${'active'}, ${'opening_count'}
      )
    `);
  });
}

describe('listado de lotes', () => {
  it('filtra por ecológico y pagina con el total del filtro', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      await seedLot(ctx, po, 'L25ECO1', true);
      await seedLot(ctx, po, 'L25ECO2', true);
      await seedLot(ctx, po, 'L25ECO3', true);
      await seedLot(ctx, po, 'L25CON1', false);

      const first = await call(ctx, 'GET', '/v1/lots?organic=true&limit=2');
      expect(first.status).toBe(200);
      expect((first.body.items as { code: string }[]).map((row) => row.code)).toEqual(['L25ECO1', 'L25ECO2']);
      expect(first.body.total).toBe(3);
      expect(first.body.next_cursor).toBe('L25ECO2');

      const second = await call(ctx, 'GET', `/v1/lots?organic=true&limit=2&cursor=${String(first.body.next_cursor)}`);
      expect((second.body.items as { code: string }[]).map((row) => row.code)).toEqual(['L25ECO3']);
      expect(second.body.total).toBe(3);
      expect(second.body.next_cursor).toBeNull();

      const conventional = await call(ctx, 'GET', '/v1/lots?organic=false');
      expect((conventional.body.items as { code: string }[]).map((row) => row.code)).toEqual(['L25CON1']);
      expect(conventional.body.total).toBe(1);

      const all = await call(ctx, 'GET', '/v1/lots?organic=');
      expect(all.body.total).toBe(4);

      const wrong = await call(ctx, 'GET', '/v1/lots?organic=si');
      expect(wrong.status).toBe(422);
    } finally {
      await ctx.close();
    }
  });
});
