import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { sql } from '../../src/core/db/sql';
import { DomainError } from '../../src/core/errors';
import { derivePrefix, formatSeriesNumber, seriesPrefixError } from '../../src/core/series/prefix';
import { createSeries, deactivateSeries, takeNumber } from '../../src/core/series/numbering';
import { businessDate } from '../../src/core/time';

const actor = { type: 'user' as const, id: 'user-test', requestId: 'series-test' };

function seriesBody(entityId: string, overrides: Record<string, unknown> = {}) {
  return {
    legal_entity_id: entityId,
    doc_type: 'invoice',
    code: 'CF',
    prefix: 'CF27-',
    padding: 4,
    is_default: true,
    verifactu: true,
    year: 2027,
    ...overrides,
  };
}

async function entityId(ctx: Awaited<ReturnType<typeof createTestApp>>, code = 'CVPO'): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`
    SELECT id FROM core.legal_entity WHERE code = ${code}
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error('sin entidad');
  return String(id).toLowerCase();
}

async function expectDomain(run: () => Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe(code);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('prefijo de serie', () => {
  it('acepta ASCII 32–126 y rechaza los caracteres de Verifactu y los 60', () => {
    expect(seriesPrefixError('CF27-', 4)).toBeNull();
    expect(seriesPrefixError('CF 27-', 4)).toBeNull();
    expect(seriesPrefixError('CF<27-', 4)).toContain('<');
    expect(seriesPrefixError('CF>27-', 4)).not.toBeNull();
    expect(seriesPrefixError('CF=27-', 4)).not.toBeNull();
    expect(seriesPrefixError('CF"27-', 4)).not.toBeNull();
    expect(seriesPrefixError("CF'27-", 4)).not.toBeNull();
    expect(seriesPrefixError('CF27-ñ', 4)).not.toBeNull();
    expect(seriesPrefixError('A'.repeat(13), 4)).toContain('12');
    expect(seriesPrefixError('CF27-', 56)).toContain('60');
    expect(formatSeriesNumber('CF27-', 4, 12)).toBe('CF27-0012');
    expect(derivePrefix('CF26-', 2027)).toBe('CF27-');
    expect(derivePrefix('F-2026-', 2027)).toBe('F-2027-');
    expect(derivePrefix('2026/', 2027)).toBe('2027/');
    expect(derivePrefix('LIBRE', 2027)).toBeNull();
    expect(seriesPrefixError('F-2026-', 2)).toBeNull();
    expect(seriesPrefixError('FAC/2026/', 3)).toBeNull();
  });
});

describe('numeración', () => {
  it('no deja hueco si la operación falla después de tomar el número', async () => {
    const ctx = await createTestApp();
    try {
      const legalEntityId = await entityId(ctx);
      await ctx.writer.withWrite(actor, (tx) => createSeries(tx, seriesBody(legalEntityId)));
      const input = { legalEntityId, docType: 'invoice', date: new Date('2027-06-01T10:00:00Z') };
      let taken = '';
      let caught: unknown;
      try {
        await ctx.writer.withWrite(actor, async (tx) => {
          taken = await takeNumber(tx, input);
          throw new Error('fallo posterior');
        });
      } catch (error) {
        caught = error;
      }
      expect((caught as Error).message).toBe('fallo posterior');
      expect(taken).toBe('CF27-0001');
      const stuck = await ctx.writer.read<{ next_value: number | bigint }>(sql`
        SELECT next_value FROM core.number_series WHERE code = 'CF'
      `);
      expect(Number(stuck[0]?.next_value)).toBe(1);
      const again = await ctx.writer.withWrite(actor, (tx) => takeNumber(tx, input));
      expect(again).toBe('CF27-0001');
      const moved = await ctx.writer.read<{ next_value: number | bigint }>(sql`
        SELECT next_value FROM core.number_series WHERE code = 'CF'
      `);
      expect(Number(moved[0]?.next_value)).toBe(2);
    } finally {
      await ctx.close();
    }
  });

  it('encola dos operaciones y da números consecutivos', async () => {
    const ctx = await createTestApp();
    let release = (): void => {};
    try {
      const legalEntityId = await entityId(ctx);
      await ctx.writer.withWrite(actor, (tx) => createSeries(tx, seriesBody(legalEntityId)));
      const input = { legalEntityId, docType: 'invoice', date: new Date('2027-06-01T10:00:00Z') };
      let entered!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = ctx.writer.withWrite(actor, async (tx) => {
        entered();
        await gate;
        return takeNumber(tx, input);
      });
      await enteredPromise;
      const second = ctx.writer.withWrite(actor, (tx) => takeNumber(tx, input));
      release();
      expect(await Promise.all([first, second])).toEqual(['CF27-0001', 'CF27-0002']);
      const rows = await ctx.writer.read<{ next_value: number | bigint }>(sql`
        SELECT next_value FROM core.number_series WHERE code = 'CF'
      `);
      expect(Number(rows[0]?.next_value)).toBe(3);
    } finally {
      release();
      await ctx.close();
    }
  });

  it('usa el año de Europa/Madrid en el cambio de año', async () => {
    const ctx = await createTestApp();
    try {
      const legalEntityId = await entityId(ctx);
      const lastNight = new Date('2026-12-31T22:30:00.000Z');
      const firstMorning = new Date('2026-12-31T23:30:00.000Z');
      expect(businessDate(lastNight)).toBe('2026-12-31');
      expect(businessDate(firstMorning)).toBe('2027-01-01');
      await ctx.writer.withWrite(actor, (tx) => createSeries(tx, seriesBody(legalEntityId, {
        year: 2026,
        prefix: 'CF26-',
      })));
      const issued = await ctx.writer.withWrite(actor, (tx) => takeNumber(tx, {
        legalEntityId, docType: 'invoice', date: lastNight,
      }));
      expect(issued).toBe('CF26-0001');
      await expectDomain(() => ctx.writer.withWrite(actor, (tx) => takeNumber(tx, {
        legalEntityId, docType: 'invoice', date: firstMorning,
      })), 'WC010');
      await ctx.writer.withWrite(actor, (tx) => createSeries(tx, seriesBody(legalEntityId, {
        year: undefined,
        prefix: undefined,
      })));
      const next = await ctx.writer.withWrite(actor, (tx) => takeNumber(tx, {
        legalEntityId, docType: 'invoice', date: firstMorning,
      }));
      expect(next).toBe('CF27-0001');
      const again = await ctx.writer.withWrite(actor, (tx) => takeNumber(tx, {
        legalEntityId, docType: 'invoice', date: lastNight,
      }));
      expect(again).toBe('CF26-0002');
    } finally {
      await ctx.close();
    }
  });

  it('responde WC010 si no hay serie activa', async () => {
    const ctx = await createTestApp();
    try {
      const legalEntityId = await entityId(ctx);
      const input = { legalEntityId, docType: 'invoice', date: new Date('2027-06-01T10:00:00Z') };
      await expectDomain(() => ctx.writer.withWrite(actor, (tx) => takeNumber(tx, input)), 'WC010');
      const id = await ctx.writer.withWrite(actor, (tx) => createSeries(tx, seriesBody(legalEntityId)));
      await expectDomain(() => ctx.writer.withWrite(actor, (tx) => takeNumber(tx, {
        ...input,
        docType: 'delivery_note',
      })), 'WC010');
      await ctx.writer.withWrite(actor, (tx) => deactivateSeries(tx, id));
      await expectDomain(() => ctx.writer.withWrite(actor, (tx) => takeNumber(tx, input)), 'WC010');
      const rows = await ctx.writer.read<{ next_value: number | bigint }>(sql`
        SELECT next_value FROM core.number_series WHERE code = 'CF'
      `);
      expect(Number(rows[0]?.next_value)).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('responde WC011 al agotar el relleno y no avanza el contador', async () => {
    const ctx = await createTestApp();
    try {
      const legalEntityId = await entityId(ctx);
      await ctx.writer.withWrite(actor, (tx) => createSeries(tx, seriesBody(legalEntityId, {
        code: 'E',
        prefix: 'E27-',
        padding: 3,
      })));
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`UPDATE core.number_series SET next_value = 999 WHERE code = 'E'`);
      });
      const input = { legalEntityId, docType: 'invoice', date: new Date('2027-06-15T12:00:00Z') };
      const last = await ctx.writer.withWrite(actor, (tx) => takeNumber(tx, input));
      expect(last).toBe('E27-999');
      await expectDomain(() => ctx.writer.withWrite(actor, (tx) => takeNumber(tx, input)), 'WC011');
      const rows = await ctx.writer.read<{ next_value: number | bigint }>(sql`
        SELECT next_value FROM core.number_series WHERE code = 'E'
      `);
      expect(Number(rows[0]?.next_value)).toBe(1000);
    } finally {
      await ctx.close();
    }
  });

  it('empieza en el número indicado, que debe caber en el relleno', async () => {
    const ctx = await createTestApp();
    try {
      const legalEntityId = await entityId(ctx);
      const tooBig = await post(ctx, seriesBody(legalEntityId, { code: 'G', prefix: 'G27-', padding: 2, next_value: 100 }));
      expect(tooBig.status).toBe(422);
      expect(JSON.stringify(await json(tooBig))).toContain('no cabe en 2 cifras');
      const zero = await post(ctx, seriesBody(legalEntityId, { code: 'G', prefix: 'G27-', next_value: 0 }));
      expect(zero.status).toBe(422);
      const narrow = await post(ctx, seriesBody(legalEntityId, { code: 'G', prefix: 'G27-', padding: 1 }));
      expect(narrow.status).toBe(422);

      const created = await json(await post(ctx, seriesBody(legalEntityId, { code: 'G', prefix: 'G-2027-', padding: 2, next_value: 35 })));
      expect(created.next_value).toBe(35);
      expect(created.last_number).toBe('G-2027-34');
      const taken = await ctx.writer.withWrite(actor, (tx) => takeNumber(tx, {
        legalEntityId, docType: 'invoice', date: new Date('2027-06-01T10:00:00Z'),
      }));
      expect(taken).toBe('G-2027-35');
    } finally {
      await ctx.close();
    }
  });

  it('lista, crea la serie del año siguiente, desactiva y audita', async () => {
    const ctx = await createTestApp();
    try {
      const legalEntityId = await entityId(ctx);
      const denied = await ctx.app.handle(new Request('http://localhost/v1/number-series', {
        headers: { 'X-Dev-User': 'asesor@winecore.test' },
      }));
      expect(denied.status).toBe(403);
      expect((await json(denied)).code).toBe('WC_FORBIDDEN');

      const bad = await post(ctx, { legal_entity_id: legalEntityId, doc_type: 'invoice', code: 'CF', prefix: 'CF<27-', year: 2027 });
      expect(bad.status).toBe(422);
      const badBody = await json(bad);
      expect(badBody.code).toBe('WC_VALIDATION');
      expect(JSON.stringify(badBody)).toContain('<');
      const seeded = await json(await ctx.app.handle(new Request('http://localhost/v1/number-series')));
      const seededItems = seeded.items as { doc_type: string; code: string }[];
      const cellar = seededItems.filter((item) => item.doc_type === 'cellar_operation');
      const intercompany = seededItems.filter((item) => item.doc_type === 'intercompany_invoice');
      expect(cellar.length).toBeGreaterThan(0);
      expect(cellar.every((item) => item.code === 'OB')).toBe(true);
      expect(intercompany.length).toBeGreaterThan(0);
      expect(intercompany.every((item) => item.code === 'PI')).toBe(true);
      const invoiceBefore = await json(await ctx.app.handle(new Request('http://localhost/v1/number-series?doc_type=invoice')));
      expect(invoiceBefore.items).toEqual([]);

      const created = await json(await post(ctx, {
        legal_entity_id: legalEntityId,
        doc_type: 'invoice',
        code: 'CF',
        prefix: 'CF27-',
        padding: 4,
        is_default: true,
        verifactu: true,
        year: 2027,
      }));
      expect(created.prefix).toBe('CF27-');
      expect(created.year).toBe(2027);
      expect(created.last_number).toBeNull();
      expect(created.is_default).toBe(true);

      const other = await json(await post(ctx, {
        legal_entity_id: legalEntityId,
        doc_type: 'invoice',
        code: 'CR',
        prefix: 'CR27-',
        year: 2027,
        is_default: true,
        verifactu: false,
      }));
      const page = await json(await ctx.app.handle(new Request(
        `http://localhost/v1/number-series?legal_entity_id=${legalEntityId}&year=2027&doc_type=invoice`,
      )));
      const items = page.items as { code: string; is_default: boolean }[];
      expect(items.find((item) => item.code === 'CF')?.is_default).toBe(false);
      expect(items.find((item) => item.code === 'CR')?.is_default).toBe(true);

      const rolled = await json(await post(ctx, {
        legal_entity_id: legalEntityId,
        doc_type: 'invoice',
        code: 'CF',
      }));
      expect(rolled.year).toBe(2028);
      expect(rolled.prefix).toBe('CF28-');
      expect(rolled.padding).toBe(4);
      expect(rolled.verifactu).toBe(true);

      const opened = await json(await post(ctx, {
        legal_entity_id: legalEntityId,
        doc_type: 'cellar_operation',
        code: 'OB',
        prefix: 'OB01-',
      }));
      expect(opened.year).toBe(Number(businessDate(new Date()).slice(0, 4)) + 2);

      const skipped = await post(ctx, {
        legal_entity_id: legalEntityId,
        doc_type: 'invoice',
        code: 'CF',
        year: 2030,
        prefix: 'CF30-',
      });
      expect(skipped.status).toBe(422);

      const off = await ctx.app.handle(new Request(`http://localhost/v1/number-series/${String(other.id)}/deactivate`, {
        method: 'POST',
      }));
      expect(off.status).toBe(200);
      const deactivated = await json(off);
      expect(deactivated.is_active).toBe(false);
      expect(deactivated.is_default).toBe(false);
      const still = await json(await ctx.app.handle(new Request(
        `http://localhost/v1/number-series?year=2027&doc_type=invoice`,
      )));
      expect((still.items as { id: string }[]).some((item) => item.id === String(other.id))).toBe(true);

      const removed = await ctx.app.handle(new Request(`http://localhost/v1/number-series/${String(created.id)}`, {
        method: 'DELETE',
      }));
      expect(removed.status).toBe(404);

      const audit = await ctx.writer.read<{ action: string }>(sql`
        SELECT action FROM audit.audit_log WHERE table_name = 'core.number_series'
      `);
      expect(audit.some((row) => row.action === 'INSERT')).toBe(true);
      expect(audit.some((row) => row.action === 'UPDATE')).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});

function post(ctx: Awaited<ReturnType<typeof createTestApp>>, body: unknown): Promise<Response> {
  return ctx.app.handle(new Request('http://localhost/v1/number-series', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}
