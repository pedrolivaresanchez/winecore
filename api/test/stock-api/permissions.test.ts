import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, jsonOf, seedCellar } from './fixture';

describe('permisos de existencias', () => {
  it('el asesor lee y no cuenta; bodega cuenta; campo no lee', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      await ctx.client.query(sql`
        INSERT INTO core.app_user (id, email, display_name, locale, status)
        VALUES (CAST('019a1000-0000-7000-8000-000000000099' AS UUID), 'campo@winecore.test', 'Campo', 'es-ES', 'active')
      `);
      await ctx.client.query(sql`
        INSERT INTO core.user_role (id, user_id, role_code)
        VALUES (
          CAST('019a1000-0000-7000-8000-000000000098' AS UUID),
          CAST('019a1000-0000-7000-8000-000000000099' AS UUID),
          'field'
        )
      `);
      const body = {
        legal_entity_id: cellar.po,
        kind: 'periodic',
        counted_at: '2027-06-01T10:00:00+02:00',
        location_ids: [cellar.bod],
      };

      const advisorRead = await ctx.app.handle(call('GET', '/v1/stock/balances?at=2027-06-01', undefined, 'asesor@winecore.test'));
      expect(advisorRead.status).toBe(200);
      const advisorMoves = await ctx.app.handle(call('GET', '/v1/stock/moves?book=physical', undefined, 'asesor@winecore.test'));
      expect(advisorMoves.status).toBe(200);
      const advisorCount = await ctx.app.handle(call('POST', '/v1/inventory-counts', body, 'asesor@winecore.test'));
      expect(advisorCount.status).toBe(403);
      expect(await jsonOf(advisorCount)).toEqual({
        code: 'WC_FORBIDDEN',
        message: 'No tienes permiso para esta operación',
      });

      const cellarCount = await ctx.app.handle(call('POST', '/v1/inventory-counts', body, 'bodega@winecore.test'));
      expect(cellarCount.status).toBe(200);
      const created = await jsonOf<{ status: string; kind: string }>(cellarCount);
      expect(created.status).toBe('counting');
      expect(created.kind).toBe('periodic');

      const fieldRead = await ctx.app.handle(call('GET', '/v1/stock/balances?at=2027-06-01', undefined, 'campo@winecore.test'));
      expect(fieldRead.status).toBe(403);
    } finally {
      await ctx.close();
    }
  });
});
