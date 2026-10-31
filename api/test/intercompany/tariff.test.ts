import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { sql } from '../../src/core/db/sql';
import { intercompanyPrice } from '../../src/core/intercompany/tariff';
import { OWNER, actor, seedCatalog } from './fixture';

describe('tarifa intercompañía', () => {
  it('solo dirección la cambia, exige al asesor y no solapa vigencias activas', async () => {
    const ctx = await createTestApp();
    try {
      let priceListId = '';
      await ctx.writer.withWrite(actor, async (tx) => {
        priceListId = (await seedCatalog(tx)).priceListId;
      });

      const denied = await ctx.app.handle(new Request('http://localhost/v1/intercompany/tariffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User': 'admin@winecore.test' },
        body: JSON.stringify(tariffBody(priceListId, '2027-01-01', '2027-03-01')),
      }));
      expect(denied.status).toBe(403);

      const missingAdvisor = await ctx.app.handle(new Request('http://localhost/v1/intercompany/tariffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tariffBody(priceListId, '2027-01-01', '2027-03-01'), advisor_validation: 'no' }),
      }));
      expect(missingAdvisor.status).toBe(422);
      expect((await bodyOf(missingAdvisor)).code).toBe('WC_IC_ADVISOR_REQUIRED');

      const first = await postTariff(ctx, tariffBody(priceListId, '2027-01-01', '2027-03-01', '10'));
      const second = await postTariff(ctx, tariffBody(priceListId, '2027-02-01', '2027-04-01', '20'));
      const third = await postTariff(ctx, tariffBody(priceListId, '2027-03-01', null, '20'));

      const activated = await ctx.app.handle(new Request(`http://localhost/v1/intercompany/tariffs/${first.id}/activate`, {
        method: 'POST',
      }));
      expect(activated.status).toBe(200);

      const overlap = await ctx.app.handle(new Request(`http://localhost/v1/intercompany/tariffs/${second.id}/activate`, {
        method: 'POST',
      }));
      expect(overlap.status).toBe(409);
      expect((await bodyOf(overlap)).code).toBe('WC_IC_TARIFF_OVERLAP');

      const adjacent = await ctx.app.handle(new Request(`http://localhost/v1/intercompany/tariffs/${third.id}/activate`, {
        method: 'POST',
      }));
      expect(adjacent.status).toBe(200);

      const locked = await ctx.app.handle(new Request(`http://localhost/v1/intercompany/tariffs/${first.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discount_pct: '15' }),
      }));
      expect(locked.status).toBe(409);
      expect((await bodyOf(locked)).code).toBe('WC_IC_TARIFF_LOCKED');

      const wineId = await productId(ctx);
      await ctx.writer.withWrite(actor, async (tx) => {
        const february = await intercompanyPrice(tx, { productId: wineId, date: '2027-02-28' });
        const march = await intercompanyPrice(tx, { productId: wineId, date: '2027-03-01' });
        expect(february.toFixed(6)).toBe('11.250000');
        expect(march.toFixed(6)).toBe('10.000000');
      });

      const audit = await ctx.writer.read<{ n: number }>(sql`
        SELECT count(*)::INTEGER AS n
        FROM audit.audit_log
        WHERE table_name = 'catalog.intercompany_tariff' AND actor_id = ${OWNER}
      `);
      expect(Number(audit[0]?.n ?? 0)).toBeGreaterThan(0);

      const advisor = await ctx.app.handle(new Request('http://localhost/v1/intercompany/tariffs', {
        headers: { 'X-Dev-User': 'asesor@winecore.test' },
      }));
      expect(advisor.status).toBe(200);
      const listed = await advisor.json() as { items: { status: string }[] };
      expect(listed.items.filter((item) => item.status === 'active')).toHaveLength(2);
    } finally {
      await ctx.close();
    }
  });
});

async function bodyOf(response: Response): Promise<{ code?: string }> {
  return response.json() as Promise<{ code?: string }>;
}

function tariffBody(priceListId: string, validFrom: string, validTo: string | null, discount = '60') {
  return {
    base_price_list_id: priceListId,
    discount_pct: discount,
    valid_from: validFrom,
    valid_to: validTo,
    advisor_validation: 'Informe del asesor D4',
  };
}

async function postTariff(ctx: Awaited<ReturnType<typeof createTestApp>>, body: ReturnType<typeof tariffBody>) {
  const response = await ctx.app.handle(new Request('http://localhost/v1/intercompany/tariffs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  expect(response.status).toBe(201);
  return response.json() as Promise<{ id: string }>;
}

async function productId(ctx: Awaited<ReturnType<typeof createTestApp>>): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(`SELECT id FROM catalog.product WHERE sku = 'VIN075'`);
  const id = rows[0]?.id;
  if (!id) throw new Error('falta el producto');
  return String(id);
}
