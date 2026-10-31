import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { dispatchOutbox } from '../../src/core/events/dispatch';
import { emitEvent } from '../../src/core/events/emit';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import type { Actor } from '../../src/core/db/writer';

const actor: Actor = { type: 'system', id: 'test', requestId: 'req-dispatch' };
const KEY = 'test-hmac-key';
const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

function personTaxId(digits: string): string {
  const letter = LETTERS[Number(digits) % 23];
  if (!letter) throw new Error('letra');
  return `${digits}${letter}`;
}

function personal() {
  return {
    name: 'Bodega Zznombre Unico',
    email: 'zz-correo-unico@example.com',
    phone: '100200301',
    taxId: personTaxId('12345678'),
  };
}

async function emitContact(ctx: Awaited<ReturnType<typeof createTestApp>>, id = newId()) {
  await ctx.writer.withWrite(actor, async (tx) => {
    emitEvent(tx, {
      type: 'party.contact.created',
      aggregate: 'party.contact',
      aggregateId: id,
      payload: { contact_id: id, link: `/contactos/${id}` },
    });
  });
  return id;
}

function serve(fetch: (req: Request) => Response | Promise<Response>) {
  return Bun.serve({ hostname: '127.0.0.1', port: 0, fetch });
}

async function rowOf(ctx: Awaited<ReturnType<typeof createTestApp>>, id: string) {
  const rows = await ctx.writer.read<{
    attempts: number;
    published_at: string | null;
    last_error: string | null;
    available_at: string;
    payload: unknown;
  }>(sql`
    SELECT attempts, published_at, last_error, available_at, payload
    FROM ops.outbox_event
    WHERE aggregate_id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw new Error('evento ausente');
  return row;
}

describe('despachador del outbox', () => {
  it('entrega una vez, con event_id, y no repite el POST', async () => {
    const hits: string[] = [];
    const server = serve(async (req) => {
      hits.push(await req.text());
      return new Response('ok', { status: 200 });
    });
    const ctx = await createTestApp({
      env: { CVBOT_EVENTS_URL: `http://127.0.0.1:${server.port}/events`, CVBOT_EVENTS_HMAC_KEY: KEY },
    });
    try {
      const id = await emitContact(ctx);
      const now = new Date();
      const first = await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => now, log: () => undefined });
      expect(first.delivered).toBe(1);
      expect(hits).toHaveLength(1);
      const body = JSON.parse(hits[0] ?? '{}') as { event_id: number; type: string; data: { contact_id: string } };
      expect(body.type).toBe('party.contact.created');
      expect(body.data.contact_id).toBe(id);
      expect(typeof body.event_id).toBe('number');
      const second = await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => now, log: () => undefined });
      expect(second.delivered).toBe(0);
      expect(hits).toHaveLength(1);
      const stored = await rowOf(ctx, id);
      expect(stored.published_at).not.toBeNull();
      expect(stored.last_error).toBeNull();
      expect(Number(stored.attempts)).toBe(0);
    } finally {
      server.stop(true);
      await ctx.close();
    }
  });

  it('firma el cuerpo en bruto con HMAC-SHA256', async () => {
    const hits: { body: string; signature: string | null }[] = [];
    const server = serve(async (req) => {
      hits.push({ body: await req.text(), signature: req.headers.get('x-winecore-signature') });
      return new Response('ok', { status: 200 });
    });
    const ctx = await createTestApp({
      env: { CVBOT_EVENTS_URL: `http://127.0.0.1:${server.port}/events`, CVBOT_EVENTS_HMAC_KEY: KEY },
    });
    try {
      await emitContact(ctx);
      await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => new Date(), log: () => undefined });
      const hit = hits[0];
      if (!hit) throw new Error('sin POST');
      const expected = `sha256=${createHmac('sha256', KEY).update(hit.body, 'utf8').digest('hex')}`;
      expect(hit.signature).toBe(expected);
      const tampered = createHmac('sha256', KEY).update(`${hit.body}x`, 'utf8').digest('hex');
      expect(hit.signature).not.toBe(`sha256=${tampered}`);
      const parsed = JSON.parse(hit.body) as { event_id: number; type: string; occurred_at: string; data: unknown };
      expect(Object.keys(parsed)).toEqual(['event_id', 'type', 'occurred_at', 'data']);
    } finally {
      server.stop(true);
      await ctx.close();
    }
  });

  it('reintenta cuando CVBOT responde 500', async () => {
    const server = serve(() => new Response('no', { status: 500 }));
    const ctx = await createTestApp({
      env: { CVBOT_EVENTS_URL: `http://127.0.0.1:${server.port}/events`, CVBOT_EVENTS_HMAC_KEY: KEY },
    });
    try {
      const id = await emitContact(ctx);
      const now = new Date();
      const result = await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => now, log: () => undefined });
      expect(result.retried).toBe(1);
      const stored = await rowOf(ctx, id);
      expect(stored.published_at).toBeNull();
      expect(stored.last_error).toBe('http_500');
      expect(Number(stored.attempts)).toBe(1);
      expect(Date.parse(stored.available_at) - now.getTime()).toBe(60_000);
    } finally {
      server.stop(true);
      await ctx.close();
    }
  });

  it('reintenta si se agota el tiempo de espera', async () => {
    const server = serve(() => new Promise(() => undefined));
    const ctx = await createTestApp({
      env: { CVBOT_EVENTS_URL: `http://127.0.0.1:${server.port}/events`, CVBOT_EVENTS_HMAC_KEY: KEY },
    });
    try {
      const id = await emitContact(ctx);
      const now = new Date();
      const result = await dispatchOutbox({
        writer: ctx.writer,
        config: ctx.config,
        now: () => now,
        timeoutMs: 200,
        log: () => undefined,
      });
      expect(result.retried).toBe(1);
      const stored = await rowOf(ctx, id);
      expect(stored.last_error).toBe('timeout');
      expect(Number(stored.attempts)).toBe(1);
      expect(stored.published_at).toBeNull();
    } finally {
      server.stop(true);
      await ctx.close();
    }
  });

  it('espera 1, 5 y 30 minutos entre reintentos', async () => {
    const server = serve(() => new Response('no', { status: 500 }));
    const ctx = await createTestApp({
      env: { CVBOT_EVENTS_URL: `http://127.0.0.1:${server.port}/events`, CVBOT_EVENTS_HMAC_KEY: KEY },
    });
    try {
      const id = await emitContact(ctx);
      let now = new Date();
      const delays = [60_000, 5 * 60_000, 30 * 60_000];
      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        const result = await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => now, log: () => undefined });
        expect(result.retried).toBe(1);
        const stored = await rowOf(ctx, id);
        expect(Number(stored.attempts)).toBe(attempt + 1);
        const delay = delays[attempt];
        if (delay === undefined) throw new Error('espera');
        expect(Date.parse(stored.available_at) - now.getTime()).toBe(delay);
        now = new Date(Date.parse(stored.available_at));
      }
    } finally {
      server.stop(true);
      await ctx.close();
    }
  });

  it('queda failed a la quinta entrega y deja de enviarse', async () => {
    let posts = 0;
    const server = serve(() => {
      posts += 1;
      return new Response('no', { status: 500 });
    });
    const ctx = await createTestApp({
      env: { CVBOT_EVENTS_URL: `http://127.0.0.1:${server.port}/events`, CVBOT_EVENTS_HMAC_KEY: KEY },
    });
    try {
      const id = await emitContact(ctx);
      let now = new Date();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => now, log: () => undefined });
        const stored = await rowOf(ctx, id);
        if (attempt < 4) now = new Date(Date.parse(stored.available_at));
      }
      expect(posts).toBe(5);
      const failed = await rowOf(ctx, id);
      expect(Number(failed.attempts)).toBe(5);
      expect(failed.published_at).toBeNull();
      expect(failed.last_error).toBe('failed');
      const notices = await ctx.writer.read<{ kind: string }>(`
        SELECT kind FROM core.notification WHERE kind IN ('party.contact.created', 'ops.outbox.failed')
      `);
      expect(notices.some((row) => row.kind === 'party.contact.created')).toBe(true);
      expect(notices.some((row) => row.kind === 'ops.outbox.failed')).toBe(true);
      await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => now, log: () => undefined });
      expect(posts).toBe(5);
    } finally {
      server.stop(true);
      await ctx.close();
    }
  });

  it('sin URL crea avisos y marca delivered-internal', async () => {
    const ctx = await createTestApp();
    try {
      const id = await emitContact(ctx);
      let called = false;
      const result = await dispatchOutbox({
        writer: ctx.writer,
        config: ctx.config,
        now: () => new Date(),
        log: () => undefined,
        fetchImpl: () => {
          called = true;
          throw new Error('no debe salir');
        },
      });
      expect(called).toBe(false);
      expect(result.internal).toBe(1);
      const stored = await rowOf(ctx, id);
      expect(stored.published_at).not.toBeNull();
      expect(stored.last_error).toBe('delivered-internal');
      const notices = await ctx.writer.read('SELECT id FROM core.notification');
      expect(notices.length).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  it('no envía datos personales ni a CVBOT ni al aviso', async () => {
    const hits: string[] = [];
    const server = serve(async (req) => {
      hits.push(await req.text());
      return new Response('ok', { status: 200 });
    });
    const ctx = await createTestApp({
      env: { CVBOT_EVENTS_URL: `http://127.0.0.1:${server.port}/events`, CVBOT_EVENTS_HMAC_KEY: KEY },
    });
    try {
      const secret = personal();
      const created = await ctx.app.handle(new Request('http://localhost/v1/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'contacto-privado-1' },
        body: JSON.stringify({
          kind: 'company',
          legal_name: secret.name,
          tax_id: secret.taxId,
          country_code: 'ES',
          language: 'es',
          is_customer: true,
          is_supplier: false,
          is_carrier: false,
          is_logistics_operator: false,
          vat_regime: 'general',
          payment_terms_days: 30,
          email: secret.email,
          phone: secret.phone,
        }),
      }));
      expect(created.status).toBe(201);
      await dispatchOutbox({ writer: ctx.writer, config: ctx.config, now: () => new Date(), log: () => undefined });
      const notices = await ctx.writer.read<{ title: string; body: string; link: string | null }>(
        'SELECT title, body, link FROM core.notification',
      );
      const blob = JSON.stringify({ hits, notices });
      expect(blob).not.toContain(secret.name);
      expect(blob).not.toContain(secret.email);
      expect(blob).not.toContain(secret.phone);
      expect(blob).not.toContain(secret.taxId);
      expect(hits.length).toBe(1);
    } finally {
      server.stop(true);
      await ctx.close();
    }
  });
});

describe('CVBOT_EVENTS_URL', () => {
  it('carga la URL y la clave y no repite un valor inválido', async () => {
    const { loadConfig } = await import('../../src/config');
    const config = loadConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'dev',
      CVBOT_EVENTS_URL: 'http://127.0.0.1:9/events',
      CVBOT_EVENTS_HMAC_KEY: 'clave-de-prueba',
    });
    expect(config.cvbotEventsUrl).toBe('http://127.0.0.1:9/events');
    expect(config.cvbotEventsHmacKey).toBe('clave-de-prueba');
    expect(loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'dev' }).cvbotEventsUrl).toBeNull();
    const secret = 'super-secret-hmac-value';
    try {
      loadConfig({
        NODE_ENV: 'test',
        AUTH_MODE: 'dev',
        CVBOT_EVENTS_URL: 'notaurl',
        CVBOT_EVENTS_HMAC_KEY: secret,
      });
      throw new Error('debería fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('CVBOT_EVENTS_URL');
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain('notaurl');
    }
  });
});
