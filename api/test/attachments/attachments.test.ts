import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';
import { PERMANENT_LINK_ROLES, unlinkAttachment } from '../../src/core/attachments';
import { detectMime } from '../../src/core/attachments/mime';
import { sql } from '../../src/core/db/sql';
import { DomainError } from '../../src/core/errors';
import { newId } from '../../src/core/ids';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const actor = { type: 'user' as const, id: 'user-test', requestId: 'attachments-test' };

function png(extra = 0): Uint8Array {
  const bytes = new Uint8Array(8 + extra);
  bytes.set(PNG);
  if (extra > 0) bytes[8] = extra % 255;
  return bytes;
}

function heic(): Uint8Array {
  const bytes = new Uint8Array(24);
  new DataView(bytes.buffer).setUint32(0, 24);
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 4);
  return bytes;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function insertContact(ctx: Awaited<ReturnType<typeof createTestApp>>): Promise<string> {
  const id = newId();
  await ctx.writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      INSERT INTO party.contact (id, kind, legal_name, created_by)
      VALUES (CAST(${id} AS UUID), 'company', 'Cliente Sintético', 'test')
    `);
  });
  return id;
}

function upload(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  options: { bytes: Uint8Array; name: string; rowId: string; role: string; user?: string; type?: string; table?: string },
): Promise<Response> {
  const form = new FormData();
  form.set('file', new File([options.bytes], options.name, { type: options.type ?? 'application/octet-stream' }));
  form.set('table', options.table ?? 'party.contact');
  form.set('row_id', options.rowId);
  form.set('role', options.role);
  const headers = new Headers();
  if (options.user) headers.set('X-Dev-User', options.user);
  return ctx.app.handle(new Request('http://localhost/v1/attachments', {
    method: 'POST',
    headers,
    body: form,
  }));
}

describe('detección de MIME', () => {
  it('clasifica por los bytes', () => {
    expect(detectMime(png())).toBe('image/png');
    expect(detectMime(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectMime(new TextEncoder().encode('%PDF-1.4\n'))).toBe('application/pdf');
    expect(detectMime(heic())).toBe('image/heic');
    expect(detectMime(new TextEncoder().encode('<?xml version="1.0"?><a/>'))).toBe('application/xml');
    expect(detectMime(new TextEncoder().encode('a,b\n1,2\n'))).toBe('text/csv');
    expect(detectMime(new TextEncoder().encode('a;b\n1;2\n'))).toBe('text/csv');
    expect(detectMime(new TextEncoder().encode('Nota de bodega\n'))).toBe('text/plain');
    expect(detectMime(Uint8Array.of(0, 1, 2, 3))).toBeNull();
  });
});

describe('adjuntos', () => {
  it('reutiliza el contenido con el mismo hash', async () => {
    const ctx = await createTestApp();
    try {
      const rowId = await insertContact(ctx);
      const bytes = png(4);
      const first = await upload(ctx, { bytes, name: 'nota.pdf', rowId, role: 'photo', type: 'application/pdf' });
      expect(first.status).toBe(201);
      const created = await json(first);
      const second = await upload(ctx, { bytes, name: 'otro.pdf', rowId, role: 'other', type: 'image/png' });
      expect(second.status).toBe(201);
      const again = await json(second);
      expect(again.id).toBe(created.id);
      expect(again.sha256).toBe(created.sha256);
      expect(again.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      const third = await upload(ctx, { bytes, name: 'nota.pdf', rowId, role: 'photo' });
      expect((await json(third)).id).toBe(created.id);

      const content = await ctx.writer.read<{ total: number }>(
        'SELECT count(*)::INTEGER AS total FROM core.attachment_content',
      );
      const attachments = await ctx.writer.read<{ total: number }>(
        'SELECT count(*)::INTEGER AS total FROM core.attachment',
      );
      expect(Number(content[0]?.total)).toBe(1);
      expect(Number(attachments[0]?.total)).toBe(1);
      const listed = await json(await ctx.app.handle(new Request(
        `http://localhost/v1/attachments?table=party.contact&row_id=${rowId}`,
      )));
      expect(listed.items as unknown[]).toHaveLength(2);
      const down = await ctx.app.handle(new Request(`http://localhost/v1/attachments/${String(created.id)}`));
      expect(down.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await down.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza un fichero de más de 20 MB y uno vacío', async () => {
    const ctx = await createTestApp();
    try {
      const rowId = await insertContact(ctx);
      const big = await upload(ctx, {
        bytes: new Uint8Array(20 * 1024 * 1024 + 1),
        name: 'grande.bin',
        rowId,
        role: 'other',
      });
      expect(big.status).toBe(422);
      const body = await json(big);
      expect(body.code).toBe('WC_VALIDATION');
      expect(JSON.stringify(body)).toContain('20');
      const empty = await upload(ctx, { bytes: new Uint8Array(), name: 'vacio.txt', rowId, role: 'other' });
      expect(empty.status).toBe(422);
      const totals = await ctx.writer.read<{ total: number }>(
        'SELECT count(*)::INTEGER AS total FROM core.attachment_content',
      );
      expect(Number(totals[0]?.total)).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  it('detecta PNG aunque el nombre diga .pdf', async () => {
    const ctx = await createTestApp();
    try {
      const rowId = await insertContact(ctx);
      const bytes = png();
      const created = await upload(ctx, { bytes, name: 'nota.pdf', rowId, role: 'photo', type: 'application/pdf' });
      expect(created.status).toBe(201);
      const saved = await json(created);
      const down = await ctx.app.handle(new Request(`http://localhost/v1/attachments/${String(saved.id)}`));
      expect(down.status).toBe(200);
      expect(down.headers.get('content-type')).toBe('image/png');
      expect(down.headers.get('content-disposition')).toContain('nota.pdf');
      const stored = await ctx.writer.read<{ mime_type: string; filename: string }>(sql`
        SELECT mime_type, filename FROM core.attachment WHERE id = CAST(${String(saved.id)} AS UUID)
      `);
      expect(stored[0]?.mime_type).toBe('image/png');
      expect(stored[0]?.filename).toBe('nota.pdf');
      const junk = await upload(ctx, { bytes: Uint8Array.of(0, 1, 2, 3, 4), name: 'nota.pdf', rowId, role: 'other' });
      expect(junk.status).toBe(422);
      expect((await json(junk)).code).toBe('WC_VALIDATION');
    } finally {
      await ctx.close();
    }
  });

  it('exige el permiso de la tabla enlazada', async () => {
    const ctx = await createTestApp();
    try {
      const rowId = await insertContact(ctx);
      const bytes = png(2);
      const cellar = await upload(ctx, { bytes, name: 'a.png', rowId, role: 'photo', user: 'bodega@winecore.test' });
      expect(cellar.status).toBe(403);
      expect((await json(cellar)).code).toBe('WC_FORBIDDEN');
      const advisorPost = await upload(ctx, { bytes, name: 'a.png', rowId, role: 'photo', user: 'asesor@winecore.test' });
      expect(advisorPost.status).toBe(403);

      const created = await upload(ctx, { bytes, name: 'a.png', rowId, role: 'photo', user: 'admin@winecore.test' });
      expect(created.status).toBe(201);
      const saved = await json(created);
      const id = String(saved.id);

      const advisor = await ctx.app.handle(new Request(`http://localhost/v1/attachments/${id}`, {
        headers: { 'X-Dev-User': 'asesor@winecore.test' },
      }));
      expect(advisor.status).toBe(200);
      expect(advisor.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await advisor.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);

      const hidden = await ctx.app.handle(new Request(`http://localhost/v1/attachments/${id}`, {
        headers: { 'X-Dev-User': 'bodega@winecore.test' },
      }));
      expect(hidden.status).toBe(403);
      expect(hidden.headers.get('content-disposition')).toBeNull();
      expect((await json(hidden)).code).toBe('WC_FORBIDDEN');

      const list = await ctx.app.handle(new Request(
        `http://localhost/v1/attachments?table=party.contact&row_id=${rowId}`,
        { headers: { 'X-Dev-User': 'asesor@winecore.test' } },
      ));
      expect(list.status).toBe(200);
      expect((await json(list)).items as unknown[]).toHaveLength(1);
      const listDenied = await ctx.app.handle(new Request(
        `http://localhost/v1/attachments?table=party.contact&row_id=${rowId}`,
        { headers: { 'X-Dev-User': 'bodega@winecore.test' } },
      ));
      expect(listDenied.status).toBe(403);

      const missing = await upload(ctx, { bytes, name: 'a.png', rowId: newId(), role: 'photo', user: 'admin@winecore.test' });
      expect(missing.status).toBe(404);
      const unknown = await upload(ctx, {
        bytes, name: 'a.png', rowId, role: 'photo', user: 'admin@winecore.test', table: 'no.such',
      });
      expect(unknown.status).toBe(422);
    } finally {
      await ctx.close();
    }
  });

  it('no desvincula evidencias, PDF emitidos ni acuses', async () => {
    const ctx = await createTestApp();
    try {
      expect([...PERMANENT_LINK_ROLES]).toEqual([
        'invoice_pdf',
        'delivery_note_pdf',
        'evidence_screenshot',
        'evidence_request',
        'evidence_response',
        'official_receipt',
        'lab_report',
      ]);
      const rowId = await insertContact(ctx);
      const bytes = png(6);
      for (const role of PERMANENT_LINK_ROLES) {
        const response = await upload(ctx, { bytes, name: `${role}.pdf`, rowId, role, type: 'application/pdf' });
        expect(response.status).toBe(201);
      }
      const photo = await upload(ctx, { bytes, name: 'foto.png', rowId, role: 'photo' });
      expect(photo.status).toBe(201);
      const listed = await json(await ctx.app.handle(new Request(
        `http://localhost/v1/attachments?table=party.contact&row_id=${rowId}`,
      )));
      const items = listed.items as { link_id: string; role: string }[];
      expect(items).toHaveLength(PERMANENT_LINK_ROLES.length + 1);
      for (const item of items) {
        if (item.role === 'photo') continue;
        let caught: unknown;
        try {
          await ctx.writer.withWrite(actor, (tx) => unlinkAttachment(tx, item.link_id));
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(DomainError);
        expect((caught as DomainError).code).toBe('WC001');
      }
      const photoLink = items.find((item) => item.role === 'photo');
      if (!photoLink) throw new Error('sin foto');
      await ctx.writer.withWrite(actor, (tx) => unlinkAttachment(tx, photoLink.link_id));
      const after = await json(await ctx.app.handle(new Request(
        `http://localhost/v1/attachments?table=party.contact&row_id=${rowId}`,
      )));
      const roles = (after.items as { role: string }[]).map((item) => item.role);
      expect(roles).not.toContain('photo');
      expect(roles).toHaveLength(PERMANENT_LINK_ROLES.length);
      const content = await ctx.writer.read<{ total: number }>(
        'SELECT count(*)::INTEGER AS total FROM core.attachment_content',
      );
      expect(Number(content[0]?.total)).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  it('un fichero de 10 MB vuelve idéntico', async () => {
    const ctx = await createTestApp();
    try {
      const rowId = await insertContact(ctx);
      const bytes = new Uint8Array(10 * 1024 * 1024);
      bytes.set(PNG);
      const created = await upload(ctx, { bytes, name: 'grande.png', rowId, role: 'photo', type: 'image/png' });
      expect(created.status).toBe(201);
      const saved = await json(created);
      expect(saved.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      const down = await ctx.app.handle(new Request(`http://localhost/v1/attachments/${String(saved.id)}`));
      expect(down.status).toBe(200);
      expect(down.headers.get('content-type')).toBe('image/png');
      expect(down.headers.get('content-disposition')).toContain('filename=');
      const got = Buffer.from(await down.arrayBuffer());
      expect(got.length).toBe(bytes.length);
      expect(got.equals(Buffer.from(bytes))).toBe(true);
    } finally {
      await ctx.close();
    }
  }, 120_000);
});
