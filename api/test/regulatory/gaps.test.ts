import { describe, expect, it } from 'bun:test';
import { planGrapeEntry } from '../../src/core/vineyard/silicie-post';
import { sql } from '../../src/core/db/sql';
import { DomainError } from '../../src/core/errors';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const CAE = 'ES00000V0002T';

function headers(email?: string, json = false): Headers {
  const value = new Headers();
  if (json) value.set('content-type', 'application/json');
  if (email) value.set('x-dev-user', email);
  return value;
}

async function call(
  app: { handle: (request: Request) => Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
  email?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: headers(email, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  const parsed = text === '' ? {} : JSON.parse(text) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

async function entityId(ctx: Awaited<ReturnType<typeof createTestApp>>, code = 'PO'): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = ${code}
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error(`sin entidad ${code}`);
  return id.toLowerCase();
}

describe('huecos regulatorios', () => {
  it('cataloga el establecimiento y enmascara el CAE salvo a dirección', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const warehouse = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'silicie-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
          VALUES (CAST(${warehouse} AS UUID), CAST(${po} AS UUID), ${CAE}, 'V1', ${'Fábrica sintética'}, TRUE)
        `);
      });
      const owner = await call(ctx.app, 'GET', '/v1/tax-warehouses');
      expect(owner.status).toBe(200);
      const ownerItems = owner.body.items as Record<string, unknown>[];
      const shown = ownerItems.find((item) => item.id === warehouse);
      expect(shown).toMatchObject({
        id: warehouse,
        code: 'PO-V1',
        name: 'Fábrica sintética',
        cae: CAE,
        activity: 'V1',
        is_test: true,
      });
      expect((shown?.entity as { code: string }).code).toBe('PO');

      const admin = await call(ctx.app, 'GET', '/v1/tax-warehouses', undefined, 'admin@winecore.test');
      const masked = (admin.body.items as Record<string, unknown>[]).find((item) => item.id === warehouse);
      expect(masked?.cae).toBe('*********002T');
      expect(JSON.stringify(masked)).not.toContain(CAE);

      const advisor = await call(ctx.app, 'GET', '/v1/tax-warehouses', undefined, 'asesor@winecore.test');
      expect((advisor.body.items as Record<string, unknown>[]).find((item) => item.id === warehouse)?.cae).toBe('*********002T');
      const cellar = await call(ctx.app, 'GET', '/v1/tax-warehouses', undefined, 'bodega@winecore.test');
      expect(cellar.status).toBe(403);
    } finally {
      await ctx.close();
    }
  });

  it('adjunta el establecimiento a la obligación y pagina los envíos', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const warehouse = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'silicie-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
          VALUES (CAST(${warehouse} AS UUID), CAST(${po} AS UUID), ${CAE}, 'V1', ${'Fábrica sintética'}, TRUE)
        `);
      });
      const synced = await call(ctx.app, 'POST', '/v1/regulatory/obligations/sync', {
        legal_entity_id: po,
        year: 2027,
      }, 'admin@winecore.test');
      expect(synced.status).toBe(200);
      const obligations = await call(ctx.app, 'GET', '/v1/regulatory/obligations?from=2026-01-01&to=2028-12-31&entity=' + po, undefined, 'admin@winecore.test');
      expect(obligations.status).toBe(200);
      const items = obligations.body.items as Record<string, unknown>[];
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.tax_warehouse_id === warehouse)).toBe(true);
      expect((items[0]?.tax_warehouse as { code: string }).code).toBe('PO-V1');
      expect(JSON.stringify(items)).not.toContain(CAE);

      const ids = [newId(), newId(), newId()];
      const hash = 'a'.repeat(64);
      await ctx.writer.withWrite({ type: 'system', id: 'silicie-test', requestId: newId() }, async (tx) => {
        for (const [index, id] of ids.entries()) {
          tx.write(sql`
            INSERT INTO regulatory.submission (
              id, flow, legal_entity_id, kind, status, payload, payload_sha256, validation_errors, created_by, created_at
            ) VALUES (
              CAST(${id} AS UUID), 'silicie', CAST(${po} AS UUID), 'silicie.asientos', 'draft',
              ${sql.json({ tax_warehouse_id: warehouse })}, ${hash}, ${sql.json([])}, 'silicie-test',
              TIMESTAMPTZ ${`2027-03-0${index + 1} 10:00:00+00`}
            )
          `);
        }
      });
      const first = await call(ctx.app, 'GET', '/v1/regulatory/submissions?limit=1', undefined, 'admin@winecore.test');
      expect(first.status).toBe(200);
      expect((first.body.items as { id: string }[]).map((item) => item.id)).toEqual([ids[2]]);
      expect(typeof first.body.next_cursor).toBe('string');
      const second = await call(ctx.app, 'GET', `/v1/regulatory/submissions?limit=1&cursor=${encodeURIComponent(String(first.body.next_cursor))}`, undefined, 'admin@winecore.test');
      expect(second.status).toBe(200);
      expect((second.body.items as { id: string }[]).map((item) => item.id)).toEqual([ids[1]]);
      const third = await call(ctx.app, 'GET', `/v1/regulatory/submissions?limit=2&cursor=${encodeURIComponent(String(second.body.next_cursor))}`, undefined, 'admin@winecore.test');
      expect((third.body.items as { id: string }[]).map((item) => item.id)).toEqual([ids[0]]);
      expect(third.body.next_cursor).toBeNull();
      const bad = await call(ctx.app, 'GET', '/v1/regulatory/submissions?cursor=no-es-cursor&limit=0', undefined, 'admin@winecore.test');
      expect(bad.status).toBe(422);
      expect(first.body.total).toBe(3);
      expect(third.body.total).toBe(3);

      const original = ids[0] as string;
      const rectifier = newId();
      const approvals = [newId(), newId(), newId()];
      await ctx.writer.withWrite({ type: 'system', id: 'silicie-test', requestId: newId() }, async (tx) => {
        for (const [index, approval] of approvals.entries()) {
          tx.write(sql`
            INSERT INTO ops.approval_request (
              id, kind, legal_entity_id, subject_table, subject_id, payload_sha256, summary, status, requested_by, expires_at
            ) VALUES (
              CAST(${approval} AS UUID), 'regulatory_submission', CAST(${po} AS UUID), 'regulatory.submission',
              CAST(${[original, ids[1], rectifier][index]} AS UUID), ${hash}, ${'Envío sintético'}, 'approved',
              'silicie-test', TIMESTAMPTZ ${'2027-12-31 00:00:00+00'}
            )
          `);
        }
        tx.write(sql`
          UPDATE regulatory.submission SET status = 'accepted', approval_request_id = CAST(${approvals[0]} AS UUID)
          WHERE id = CAST(${original} AS UUID)
        `);
        tx.write(sql`
          UPDATE regulatory.submission SET status = 'submitting', approval_request_id = CAST(${approvals[1]} AS UUID)
          WHERE id = CAST(${ids[1]} AS UUID)
        `);
        tx.write(sql`
          INSERT INTO regulatory.submission (
            id, flow, legal_entity_id, kind, status, payload, payload_sha256, validation_errors,
            approval_request_id, rectifies_submission_id, created_by, created_at
          ) VALUES (
            CAST(${rectifier} AS UUID), 'silicie', CAST(${po} AS UUID), 'silicie.asientos', 'accepted',
            ${sql.json({ tax_warehouse_id: warehouse })}, ${hash}, ${sql.json([])},
            CAST(${approvals[2]} AS UUID), CAST(${original} AS UUID), 'silicie-test', TIMESTAMPTZ ${'2027-03-04 10:00:00+00'}
          )
        `);
      });
      const listed = async (status: string) => {
        const page = await call(ctx.app, 'GET', `/v1/regulatory/submissions?status=${status}&limit=1`, undefined, 'admin@winecore.test');
        expect(page.status).toBe(200);
        return { ids: (page.body.items as { id: string }[]).map((item) => item.id), total: page.body.total };
      };
      expect(await listed('draft')).toEqual({ ids: [ids[2] as string], total: 1 });
      expect(await listed('approved')).toEqual({ ids: [ids[1] as string], total: 1 });
      expect(await listed('accepted')).toEqual({ ids: [rectifier], total: 2 });
      expect(await listed('corrected')).toEqual({ ids: [original], total: 1 });
      const unknown = await call(ctx.app, 'GET', '/v1/regulatory/submissions?status=perdido', undefined, 'admin@winecore.test');
      expect(unknown.status).toBe(422);
    } finally {
      await ctx.close();
    }
  });

  it('anula un envío solo antes de aprobarlo', async () => {
    const ctx = await createTestApp({ now: () => new Date('2027-06-15T10:00:00.000Z') });
    try {
      const po = await entityId(ctx);
      const warehouse = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'silicie-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
          VALUES (CAST(${warehouse} AS UUID), CAST(${po} AS UUID), ${CAE}, 'V1', ${'Fábrica sintética'}, TRUE)
        `);
        tx.write(sql`
          INSERT INTO inventory.fiscal_move (
            id, tax_warehouse_id, fiscal_date, move_type, product_class, volume_ml, units, abv_pct,
            excise_product_key, justification_type, justification_ref, fiscal_trigger,
            source_table, source_id, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${warehouse} AS UUID), DATE '2027-01-01', 'opening', 'bulk',
            2500000, 0, 12.50, 'GRANEL-TINTO', 'count_record', 'AF-HUECO', 'count',
            'inventory.inventory_count', CAST(${newId()} AS UUID), 'silicie-test'
          )
        `);
      });
      const generated = await call(ctx.app, 'POST', '/v1/regulatory/submissions', {
        legal_entity_id: po,
        tax_warehouse_id: warehouse,
        period_start: '2027-01-01',
        period_end: '2027-01-31',
      }, 'admin@winecore.test');
      expect(generated.status).toBe(200);
      const id = String(generated.body.id);
      const denied = await call(ctx.app, 'POST', `/v1/regulatory/submissions/${id}/cancel`, { reason: 'prueba' }, 'bodega@winecore.test');
      expect(denied.status).toBe(403);
      const missing = await call(ctx.app, 'POST', `/v1/regulatory/submissions/${id}/cancel`, {}, 'admin@winecore.test');
      expect(missing.status).toBe(422);
      const cancelled = await call(ctx.app, 'POST', `/v1/regulatory/submissions/${id}/cancel`, {
        reason: 'Periodo mal elegido',
      }, 'admin@winecore.test');
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('cancelled');
      const again = await call(ctx.app, 'POST', `/v1/regulatory/submissions/${id}/cancel`, {
        reason: 'Otra vez',
      }, 'admin@winecore.test');
      expect(again.status).toBe(409);

      const approved = newId();
      await ctx.client.query(`
        INSERT INTO regulatory.submission (
          id, flow, legal_entity_id, kind, status, payload, payload_sha256, validation_errors,
          approval_request_id, created_by
        ) VALUES (
          '${approved}', 'silicie', '${po}', 'silicie.asientos', 'approved',
          '{"tax_warehouse_id":"${warehouse}"}', '${'b'.repeat(64)}', '[]',
          '${newId()}', 'silicie-test'
        )
      `);
      const blocked = await call(ctx.app, 'POST', `/v1/regulatory/submissions/${approved}/cancel`, {
        reason: 'Ya aprobado',
      }, 'admin@winecore.test');
      expect(blocked.status).toBe(409);
      expect(blocked.body.message).toContain('antes de aprobarlo');
    } finally {
      await ctx.close();
    }
  });

  it('abre el ejercicio de forma idempotente y desbloquea el asiento A02', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const warehouse = newId();
      await ctx.writer.withWrite({ type: 'system', id: 'silicie-test', requestId: newId() }, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
          VALUES (CAST(${warehouse} AS UUID), CAST(${po} AS UUID), ${CAE}, 'V1', ${'Fábrica sintética'}, TRUE)
        `);
      });
      const grape = {
        operationId: newId(),
        warehouseId: warehouse,
        warehouseName: 'Fábrica sintética',
        fiscalDate: '2027-09-15',
        massG: 500_000,
        justificationRef: 'T-SINT-1',
        counterparty: null,
        persist: false,
      };
      const actor = { type: 'system' as const, id: 'silicie-test', requestId: newId() };
      await expect(ctx.writer.withWrite(actor, (tx) => planGrapeEntry(tx, grape))).rejects.toBeInstanceOf(DomainError);

      const admin = await call(ctx.app, 'POST', '/v1/silicie-exercises', {
        tax_warehouse_id: warehouse,
        year: 2027,
      }, 'admin@winecore.test');
      expect(admin.status).toBe(403);
      const opened = await call(ctx.app, 'POST', '/v1/silicie-exercises', {
        tax_warehouse_id: warehouse,
        year: 2027,
      }, 'asesor@winecore.test');
      expect(opened.status).toBe(201);
      expect(opened.body).toMatchObject({
        tax_warehouse_id: warehouse,
        year: 2027,
        status: 'open',
        created: true,
      });
      const repeat = await call(ctx.app, 'POST', '/v1/silicie-exercises', {
        tax_warehouse_id: warehouse,
        year: '2027',
      });
      expect(repeat.status).toBe(200);
      expect(repeat.body.id).toBe(opened.body.id);
      expect(repeat.body.created).toBe(false);
      const rows = await ctx.writer.read<{ n: number }>(sql`
        SELECT count(*)::INTEGER AS n
        FROM regulatory.silicie_exercise
        WHERE tax_warehouse_id = CAST(${warehouse} AS UUID) AND year = 2027
      `);
      expect(rows[0]?.n).toBe(1);
      const planned = await ctx.writer.withWrite(actor, (tx) => planGrapeEntry(tx, grape));
      expect(planned.entry_kind).toBe('A02');
      expect(planned.status).toBeNull();

      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          UPDATE regulatory.silicie_exercise
          SET status = 'closed', closed_at = now()
          WHERE id = CAST(${String(opened.body.id)} AS UUID)
        `);
      });
      const closed = await call(ctx.app, 'POST', '/v1/silicie-exercises', {
        tax_warehouse_id: warehouse,
        year: 2027,
      }, 'asesor@winecore.test');
      expect(closed.status).toBe(409);
    } finally {
      await ctx.close();
    }
  });
});
