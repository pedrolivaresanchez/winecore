import { describe, expect, it } from 'bun:test';
import { seed, seedInputFromEnv } from '../../db/seed';
import { sql } from '../../src/core/db/sql';
import { ensureInternalCustomer } from '../../src/core/intercompany/settlement';
import { defaultPair } from '../../src/core/intercompany/entities';
import { createTestApp } from '../helpers';

const actor = { type: 'user' as const, id: '019a0000-0000-7000-8000-000000000011', requestId: 'seed-cvpo' };

describe('semilla de intercompañía', () => {
  it('crea las series PI de 2026 y 2027 y el contacto interno de CVPO, y se puede repetir', async () => {
    const ctx = await createTestApp();
    try {
      await seed(ctx.client, seedInputFromEnv({ NODE_ENV: 'test' }));
      const series = await ctx.writer.read<{ year: number; code: string; prefix: string; entity: string }>(sql`
        SELECT s.year, s.code, s.prefix, e.code AS entity
        FROM core.number_series s
        JOIN core.legal_entity e ON e.id = s.legal_entity_id
        WHERE s.doc_type = 'intercompany_invoice'
        ORDER BY e.code, s.year
      `);
      expect(series.map((row) => `${row.entity}-${Number(row.year)}-${row.code}-${row.prefix}`)).toEqual([
        'CVPO-2026-PI-PI26',
        'CVPO-2027-PI-PI27',
        'PO-2026-PI-PI26',
        'PO-2027-PI-PI27',
      ]);
      const contacts = await ctx.writer.read<{ legal_name: string; legacy_refs: unknown; n: number }>(sql`
        SELECT c.legal_name, c.legacy_refs, count(*) OVER () AS n
        FROM party.contact c
        WHERE c.tax_id = 'B00000000' AND c.archived_at IS NULL AND c.merged_into_id IS NULL
      `);
      expect(Number(contacts[0]?.n)).toBe(1);
      expect(contacts[0]?.legal_name).toBe('Comercializadora (CVPO)');
      const refs = typeof contacts[0]?.legacy_refs === 'string'
        ? JSON.parse(contacts[0].legacy_refs) as { internal?: boolean }
        : contacts[0]?.legacy_refs as { internal?: boolean };
      expect(refs.internal).toBe(true);

      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          UPDATE party.contact
          SET archived_at = now()
          WHERE tax_id = 'B00000000' AND archived_at IS NULL
        `);
      });
      await ctx.writer.withWrite(actor, async (tx) => {
        const pair = await defaultPair(tx);
        const created = await ensureInternalCustomer(tx, pair.buyer);
        expect(created.paymentTermsDays).toBe(30);
      });
      const live = await ctx.writer.read<{ legacy_refs: unknown; created_by: string }>(sql`
        SELECT legacy_refs, created_by
        FROM party.contact
        WHERE tax_id = 'B00000000' AND archived_at IS NULL AND merged_into_id IS NULL
      `);
      expect(live).toHaveLength(1);
      expect(live[0]?.created_by).toBe('intercompany');
      const flag = typeof live[0]?.legacy_refs === 'string'
        ? JSON.parse(live[0].legacy_refs) as { internal?: boolean }
        : live[0]?.legacy_refs as { internal?: boolean };
      expect(flag.internal).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
