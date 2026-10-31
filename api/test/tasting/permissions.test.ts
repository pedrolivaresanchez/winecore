import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';
import { call, seedWorld, type TastingWorld, type TestApp } from './fixture';

let ctx: TestApp;
let world: TastingWorld;

beforeAll(async () => {
  ctx = await createTestApp();
  world = await seedWorld(ctx);
  const userId = newId();
  const roleId = newId();
  await ctx.writer.withWrite({ type: 'system', id: 'tasting-test', requestId: newId() }, async (tx) => {
    tx.write(sql`
      INSERT INTO core.app_user (id, email, display_name, locale, status)
      VALUES (CAST(${userId} AS UUID), ${'campo@winecore.test'}, ${'Campo Sintético'}, ${'es-ES'}, ${'active'})
    `);
    tx.write(sql`
      INSERT INTO core.user_role (id, user_id, role_code)
      VALUES (CAST(${roleId} AS UUID), CAST(${userId} AS UUID), ${'field'})
    `);
  });
});

afterAll(async () => {
  await ctx.close();
});

describe('permisos de cata', () => {
  it('deja leer con cellar.read y escribir solo con tasting.write', async () => {
    const advisor = await call(ctx, 'GET', '/v1/tasting-templates', undefined, 'asesor@winecore.test');
    expect(advisor.status).toBe(200);
    const advisorWrite = await call(ctx, 'POST', '/v1/tasting-notes', {
      template_code: 'MOSTO',
      tasted_at: '2026-09-01T08:00:00Z',
      lot_id: world.lotMust,
      values: {},
    }, 'asesor@winecore.test');
    expect(advisorWrite.status).toBe(403);
    expect(advisorWrite.body.code).toBe('WC_FORBIDDEN');

    const admin = await call(ctx, 'GET', '/v1/tasting-sessions', undefined, 'admin@winecore.test');
    expect(admin.status).toBe(200);
    const adminWrite = await call(ctx, 'POST', '/v1/tasting-sessions', {
      title: 'No',
      target: 'Referencia B',
      started_on: '2026-10-02',
      days: 2,
    }, 'admin@winecore.test');
    expect(adminWrite.status).toBe(403);

    const field = await call(ctx, 'GET', '/v1/tasting-evolution?lot_code=REFA2026', undefined, 'campo@winecore.test');
    expect(field.status).toBe(200);
    const fieldWrite = await call(ctx, 'POST', '/v1/tasting-sessions', {
      title: 'No',
      target: 'nueva colección',
      started_on: '2026-10-02',
      days: 2,
    }, 'campo@winecore.test');
    expect(fieldWrite.status).toBe(403);

    const cellar = await call(ctx, 'POST', '/v1/tasting-sessions', {
      title: 'Cata de bodega',
      target: 'Referencia B',
      started_on: '2026-10-03',
      days: 2,
    }, 'bodega@winecore.test');
    expect(cellar.status, JSON.stringify(cellar.body)).toBe(201);
    expect(cellar.body.target).toBe('Referencia B');
  });
});
