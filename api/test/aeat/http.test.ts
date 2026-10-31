import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { sessionHash, writeStepUp } from '../../src/core/auth/stepup/session';
import { createTestApp } from '../helpers';
import { insertSample } from './fixture';

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
  email = 'admin@winecore.test',
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: headers(email, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  const parsed = text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) as Record<string, unknown> : {};
  return { status: response.status, body: parsed, text };
}

async function userId(ctx: Awaited<ReturnType<typeof createTestApp>>, email: string): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM core.app_user WHERE lower(email) = ${email}`);
  const id = rows[0]?.id;
  if (!id) throw new Error(email);
  return id;
}

async function entityId(ctx: Awaited<ReturnType<typeof createTestApp>>, code: string): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = ${code}`);
  const id = rows[0]?.id;
  if (!id) throw new Error(code);
  return id;
}

function amount(body: Record<string, unknown>, code: string): string {
  const boxes = body.boxes as { code: string; amount: string }[];
  return boxes.find((item) => item.code === code)?.amount ?? 'missing';
}

describe('API de modelos AEAT', () => {
  it('sirve libros y borradores y deja constancia humana del justificante', async () => {
    const now = new Date('2026-04-20T10:00:00.000Z');
    const ctx = await createTestApp({ now: () => now });
    try {
      const po = await entityId(ctx, 'PO');
      const cvpo = await entityId(ctx, 'CVPO');
      const admin = await userId(ctx, 'admin@winecore.test');
      const owner = await userId(ctx, 'owner@winecore.test');
      await ctx.writer.withWrite({ type: 'system', id: 'aeat-fixture', requestId: newId() }, (tx) => insertSample(tx, po, admin));

      const denied = await call(ctx.app, 'GET', '/v1/aeat/drafts?entity=PO&period=2026-Q1&model=303', undefined, 'bodega@winecore.test');
      expect(denied.status).toBe(403);

      const advisor = await call(ctx.app, 'GET', '/v1/aeat/drafts?entity=PO&period=2026-Q1&model=303', undefined, 'asesor@winecore.test');
      expect(advisor.status).toBe(200);
      expect(amount(advisor.body, '07')).toBe('8100.00');
      expect(amount(advisor.body, 'deducible')).toBe('2843.00');
      expect(advisor.body.result).toBe('-69.60');

      const prepareDenied = await call(ctx.app, 'POST', '/v1/aeat/submissions', {
        legal_entity_id: po, model: '303', period: '2026-Q1',
      }, 'asesor@winecore.test');
      expect(prepareDenied.status).toBe(403);

      const csvResponse = await ctx.app.handle(new Request('http://localhost/v1/aeat/books.csv?entity=PO&period=2026-Q1&book=issued', { headers: headers('admin@winecore.test') }));
      const bytes = new Uint8Array(await csvResponse.arrayBuffer());
      const csvText = new TextDecoder().decode(bytes);
      expect(csvResponse.status).toBe(200);
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
      expect(csvText.startsWith('Ejercicio;Periodo;')).toBe(true);
      expect(csvText).toContain('1000,00');
      expect(csvText).toContain('1T');

      const received = await call(ctx.app, 'GET', '/v1/aeat/books?entity=PO&period=2026-Q1&book=received');
      expect(received.status).toBe(200);
      expect((received.body.missing as { code: string }[])[0]?.code).toBe('rectificativas_recibidas');
      expect((received.body.checks as { ok: boolean }[]).every((check) => check.ok)).toBe(true);

      const annual = await call(ctx.app, 'GET', '/v1/aeat/drafts?entity=PO&period=2026&model=390');
      expect(amount(annual.body, '09')).toBe('1703.10');
      const third = await call(ctx.app, 'GET', '/v1/aeat/drafts?entity=PO&period=2026&model=347');
      const lines = third.body.lines as { clave: string; tax_id: string }[];
      expect(lines.filter((line) => line.clave === 'B').map((line) => line.tax_id)).toEqual(['B00000026']);
      expect(lines.some((line) => line.tax_id === 'DE123456789')).toBe(false);
      const intra = await call(ctx.app, 'GET', '/v1/aeat/drafts?entity=PO&period=2026-Q1&model=349');
      expect((intra.body.lines as { clave: string; annual: string }[]).map((line) => `${line.clave}:${line.annual}`).sort()).toEqual(['A:5000.00', 'E:5000.00']);
      const rent = await call(ctx.app, 'GET', '/v1/aeat/drafts?entity=PO&period=2026-Q1&model=115');
      expect(amount(rent.body, 'cuota')).toBe('760.00');
      const irpf = await call(ctx.app, 'GET', '/v1/aeat/drafts?entity=PO&period=2026-Q1&model=130');
      expect(amount(irpf.body, 'ingresos')).toBe('13675.00');
      expect(irpf.body.result).toBeNull();
      expect((irpf.body.missing as { code: string }[]).map((item) => item.code).sort()).toEqual(['cuota', 'pagos_anteriores']);
      const company = await call(ctx.app, 'GET', `/v1/aeat/drafts?entity=${cvpo}&period=2026-Q1&model=130`);
      expect(company.body.applies).toBe(false);
      expect((company.body.missing as { code: string }[])[0]?.code).toBe('no_aplica');

      const generated = await call(ctx.app, 'POST', '/v1/aeat/submissions', {
        legal_entity_id: po, model: '303', period: '2026-Q1',
      });
      expect(generated.status).toBe(200);
      expect(generated.body.status).toBe('draft');
      const id = String(generated.body.id);
      const hash = String(generated.body.content_sha256);
      const again = await call(ctx.app, 'POST', '/v1/aeat/submissions', {
        legal_entity_id: po, model: '303', period: '2026-Q1',
      });
      expect(again.body.id).toBe(id);
      expect(again.body.content_sha256).toBe(hash);

      const validated = await call(ctx.app, 'POST', `/v1/aeat/submissions/${id}/validate`, {});
      expect(validated.status).toBe(200);
      expect(validated.body.status).toBe('validated');
      const pending = await call(ctx.app, 'POST', `/v1/aeat/submissions/${id}/request-approval`, {});
      expect(pending.status).toBe(200);
      expect(pending.body.status).toBe('pending_approval');
      const approvalId = String(pending.body.approval_request_id);

      const frozen = await call(ctx.app, 'POST', '/v1/aeat/submissions', {
        legal_entity_id: po, model: '303', period: '2026-Q1',
      });
      expect(frozen.status).toBe(409);

      await ctx.app.handle(new Request('http://localhost/v1/me', { headers: headers('owner@winecore.test') }));
      const stepRequest = new Request('http://localhost/v1/approvals', { headers: headers('owner@winecore.test') });
      await ctx.writer.withWrite({ type: 'user', id: owner, requestId: 'step-aeat' }, async (tx) => {
        await writeStepUp(tx, {
          userId: owner,
          hash: sessionHash(ctx.config, stepRequest, owner),
          at: now,
          method: 'totp',
          ip: null,
          userAgent: null,
        });
      });
      const approved = await call(ctx.app, 'POST', `/v1/approvals/${approvalId}/decide`, {
        decision: 'approve',
        payload_sha256: hash,
      }, 'owner@winecore.test');
      expect(approved.status).toBe(200);
      const after = await call(ctx.app, 'GET', `/v1/aeat/submissions/${id}`);
      expect(after.body.status).toBe('approved');

      const filed = await call(ctx.app, 'POST', `/v1/aeat/submissions/${id}/mark-filed`, { external_ref: 'BORR303-2026Q1' });
      expect(filed.status).toBe(200);
      expect(filed.body.status).toBe('submitted');
      expect(filed.body.external_ref).toBe('BORR303-2026Q1');
      const runs = await ctx.writer.read<{ n: number }>(sql`
        SELECT count(*)::INTEGER AS n FROM regulatory.connector_run WHERE submission_id = CAST(${id} AS UUID)
      `);
      expect(Number(runs[0]?.n ?? 0)).toBe(0);
    } finally {
      await ctx.close();
    }
  });
});
