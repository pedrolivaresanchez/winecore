import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { call, entityId, seedOperator, seedWarehouse } from './fixtures';

describe('ubicaciones', () => {
  it('crea, lista, edita y archiva', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const created = await call(ctx, 'POST', '/v1/locations', {
        code: 'BOD',
        name: 'Bodega',
        kind: 'cellar',
        controlling_entity_id: po,
        address: { city: 'Ejemplo' },
      });
      expect(created.status).toBe(201);
      expect(created.body.code).toBe('BOD');
      expect(created.body.is_active).toBe(true);
      expect(created.body.address).toEqual({ city: 'Ejemplo' });

      const listed = await call(ctx, 'GET', '/v1/locations?limit=1');
      expect(listed.status).toBe(200);
      const page = listed.body as { items: { code: string }[]; next_cursor: string | null; total: number };
      expect(page.total).toBe(1);
      expect(page.items.map((item) => item.code)).toEqual(['BOD']);
      expect(page.next_cursor).toBeNull();

      const renamed = await call(ctx, 'PATCH', '/v1/locations/BOD', { name: 'Bodega principal' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('Bodega principal');

      const archived = await call(ctx, 'POST', '/v1/locations/BOD/archive', { reason: 'cierre de prueba' });
      expect(archived.status).toBe(200);
      expect(archived.body.is_active).toBe(false);
      const onlyActive = await call(ctx, 'GET', '/v1/locations?is_active=true');
      expect((onlyActive.body.items as unknown[]).length).toBe(0);
      const onlyArchived = await call(ctx, 'GET', '/v1/locations?is_active=false');
      expect((onlyArchived.body.items as { code: string }[]).map((item) => item.code)).toEqual(['BOD']);
    } finally {
      await ctx.close();
    }
  });

  it('pagina por código', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      for (const code of ['CCC', 'AAA', 'BBB']) {
        const response = await call(ctx, 'POST', '/v1/locations', {
          code,
          name: code,
          kind: 'own_warehouse',
          controlling_entity_id: po,
        });
        expect(response.status).toBe(201);
      }
      const first = await call(ctx, 'GET', '/v1/locations?limit=2');
      const page = first.body as { items: { code: string }[]; next_cursor: string | null; total: number };
      expect(page.total).toBe(3);
      expect(page.items.map((item) => item.code)).toEqual(['AAA', 'BBB']);
      expect(page.next_cursor).toBe('BBB');
      const second = await call(ctx, 'GET', `/v1/locations?limit=2&cursor=${page.next_cursor}`);
      const rest = second.body as { items: { code: string }[]; next_cursor: string | null };
      expect(rest.items.map((item) => item.code)).toEqual(['CCC']);
      expect(rest.next_cursor).toBeNull();
    } finally {
      await ctx.close();
    }
  });

  it('exige operador logístico en un almacén externo', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const missing = await call(ctx, 'POST', '/v1/locations', {
        code: 'TFRP',
        name: 'Operador',
        kind: 'third_party_warehouse',
        controlling_entity_id: po,
      });
      expect(missing.status).toBe(422);
      expect(missing.body.code).toBe('WC_VALIDATION');

      const operator = await seedOperator(ctx);
      const created = await call(ctx, 'POST', '/v1/locations', {
        code: 'TFRP',
        name: 'Operador',
        kind: 'third_party_warehouse',
        controlling_entity_id: po,
        operator_contact_id: operator,
      });
      expect(created.status).toBe(201);
      expect(created.body.kind).toBe('third_party_warehouse');
      expect(created.body.operator_contact_id).toBe(operator);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza un código duplicado y un almacén fiscal inexistente', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const warehouse = await seedWarehouse(ctx, po);
      const first = await call(ctx, 'POST', '/v1/locations', {
        code: 'BOD',
        name: 'Bodega',
        kind: 'cellar',
        controlling_entity_id: po,
        tax_warehouse_id: warehouse,
      });
      expect(first.status).toBe(201);
      const duplicate = await call(ctx, 'POST', '/v1/locations', {
        code: 'BOD',
        name: 'Otra',
        kind: 'cellar',
        controlling_entity_id: po,
      });
      expect(duplicate.status).toBe(422);
      expect((duplicate.body.fields as { code?: string }).code).toContain('Ya existe');
      const missing = await call(ctx, 'POST', '/v1/locations', {
        code: 'TIENDA',
        name: 'Tienda',
        kind: 'cellar_shop',
        controlling_entity_id: po,
        tax_warehouse_id: '019a0000-0000-7000-8000-000000000099',
      });
      expect(missing.status).toBe(422);
      expect(missing.body.code).toBe('WC_VALIDATION');
    } finally {
      await ctx.close();
    }
  });

  it('el asesor lee y la bodega no administra', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      await call(ctx, 'POST', '/v1/locations', {
        code: 'BOD',
        name: 'Bodega',
        kind: 'cellar',
        controlling_entity_id: po,
      });
      const read = await call(ctx, 'GET', '/v1/locations/BOD', undefined, 'asesor@winecore.test');
      expect(read.status).toBe(200);
      const cellar = await call(ctx, 'POST', '/v1/locations', {
        code: 'VLC',
        name: 'Valencia',
        kind: 'own_warehouse',
        controlling_entity_id: po,
      }, 'bodega@winecore.test');
      expect(cellar.status).toBe(403);
      expect(cellar.body.code).toBe('WC_FORBIDDEN');
      const advisor = await call(ctx, 'POST', '/v1/locations/BOD/archive', { reason: 'no' }, 'asesor@winecore.test');
      expect(advisor.status).toBe(403);
    } finally {
      await ctx.close();
    }
  });
});
