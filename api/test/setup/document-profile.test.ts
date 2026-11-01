import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { loadDocumentProfile } from '../../src/core/pdf/profile';
import { extractPdfText } from '../billing-pdf/extract';
import { createTestApp } from '../helpers';

const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
));
const PNG_2X2 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGOokNMAIgYIBQAWFgL5OFlYMgAAAABJRU5ErkJggg==',
  'base64',
));

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

function call(ctx: Ctx, method: string, path: string, body?: unknown, email?: string): Promise<Response> {
  const headers = new Headers();
  if (email) headers.set('x-dev-user', email);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return ctx.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

function upload(ctx: Ctx, path: string, bytes: Uint8Array, name: string, email?: string): Promise<Response> {
  const form = new FormData();
  form.set('file', new File([bytes], name));
  const headers = new Headers();
  if (email) headers.set('x-dev-user', email);
  return ctx.app.handle(new Request(`http://localhost${path}`, { method: 'PUT', headers, body: form }));
}

const PROFILE = {
  variant: 'cvpo',
  email: 'info@example.com',
  phone: '+34 000 000 000',
  website: 'www.example.com',
  footer_lines: ['Nº de cuenta: IBAN ES00 0000 0000 00 0000000000', '', 'Nº Operador SHC: AN0000EJEMPLO'],
};

describe('perfil documental de la sociedad', () => {
  it('lee, guarda y audita el perfil, y solo lo toca el propietario o el administrador', async () => {
    const ctx = await createTestApp();
    try {
      const empty = await call(ctx, 'GET', '/v1/legal-entities/CVPO/document-profile');
      expect(empty.status).toBe(200);
      expect(await empty.json()).toEqual({
        legal_entity_code: 'CVPO',
        variants: ['po', 'cvpo'],
        variant: 'po',
        email: null,
        phone: null,
        website: null,
        footer_lines: [],
        logo: null,
        configured: false,
        updated_at: null,
      });

      const saved = await call(ctx, 'PUT', '/v1/legal-entities/CVPO/document-profile', PROFILE);
      expect(saved.status).toBe(200);
      const body = await saved.json() as Record<string, unknown>;
      expect(body).toMatchObject({ ...PROFILE, configured: true, logo: null });
      expect(typeof body.updated_at).toBe('string');

      const partial = await call(ctx, 'PUT', '/v1/legal-entities/CVPO/document-profile', { phone: null, footer_lines: ['  Solo una línea  ', ''] });
      expect(partial.status).toBe(200);
      const again = await (await call(ctx, 'GET', '/v1/legal-entities/cvpo/document-profile')).json() as Record<string, unknown>;
      expect(again).toMatchObject({
        variant: 'cvpo',
        email: 'info@example.com',
        phone: null,
        website: 'www.example.com',
        footer_lines: ['Solo una línea'],
      });

      const other = await (await call(ctx, 'GET', '/v1/legal-entities/PO/document-profile')).json() as Record<string, unknown>;
      expect(other.configured).toBe(false);

      const audit = await ctx.writer.read<{ action: string }>(sql`
        SELECT action FROM audit.audit_log WHERE table_name = 'core.document_profile' ORDER BY id
      `);
      expect(audit.map((row) => row.action)).toEqual(['INSERT', 'UPDATE']);

      const admin = await call(ctx, 'PUT', '/v1/legal-entities/PO/document-profile', { variant: 'po' }, 'admin@winecore.test');
      expect(admin.status).toBe(200);
      for (const email of ['bodega@winecore.test', 'asesor@winecore.test', 'nadie@winecore.test']) {
        const read = await call(ctx, 'GET', '/v1/legal-entities/PO/document-profile', undefined, email);
        expect(read.status).toBe(403);
        const write = await call(ctx, 'PUT', '/v1/legal-entities/PO/document-profile', { variant: 'cvpo' }, email);
        expect(write.status).toBe(403);
        const sample = await call(ctx, 'POST', '/v1/legal-entities/PO/document-profile/sample', {}, email);
        expect(sample.status).toBe(403);
      }
      const untouched = await (await call(ctx, 'GET', '/v1/legal-entities/PO/document-profile')).json() as Record<string, unknown>;
      expect(untouched.variant).toBe('po');
    } finally {
      await ctx.close();
    }
  });

  it('valida el cuerpo y la sociedad', async () => {
    const ctx = await createTestApp();
    try {
      const path = '/v1/legal-entities/PO/document-profile';
      const cases: [unknown, string][] = [
        [{ variant: 'otra' }, 'variant'],
        [{ email: 'no-es-un-correo' }, 'email'],
        [{ email: 12 }, 'email'],
        [{ phone: 'x'.repeat(61) }, 'phone'],
        [{ website: 'x'.repeat(201) }, 'website'],
        [{ footer_lines: 'una línea' }, 'footer_lines'],
        [{ footer_lines: [1] }, 'footer_lines'],
        [{ footer_lines: ['x'.repeat(201)] }, 'footer_lines'],
        [{ footer_lines: Array.from({ length: 13 }, (_, index) => `línea ${index}`) }, 'footer_lines'],
      ];
      for (const [body, field] of cases) {
        const response = await call(ctx, 'PUT', path, body);
        expect(response.status).toBe(422);
        expect(JSON.stringify(await response.json())).toContain(field);
      }
      expect((await call(ctx, 'PUT', path, {})).status).toBe(422);
      expect((await call(ctx, 'PUT', path, [])).status).toBe(422);
      const broken = await ctx.app.handle(new Request(`http://localhost${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{no',
      }));
      expect(broken.status).toBe(422);
      expect((await call(ctx, 'GET', '/v1/legal-entities/NOEXISTE/document-profile')).status).toBe(404);
      expect((await call(ctx, 'GET', '/v1/legal-entities/no-valido/document-profile')).status).toBe(404);
      expect((await call(ctx, 'PUT', '/v1/legal-entities/NOEXISTE/document-profile', { variant: 'po' })).status).toBe(404);
      const none = await (await call(ctx, 'GET', path)).json() as Record<string, unknown>;
      expect(none.configured).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  it('sube, sustituye, descarga y quita el logotipo, y el PDF lo lleva', async () => {
    const ctx = await createTestApp();
    try {
      const base = '/v1/legal-entities/CVPO/document-profile';
      expect((await call(ctx, 'GET', `${base}/logo`)).status).toBe(404);

      const first = await upload(ctx, `${base}/logo`, PNG_1X1, 'logo-ejemplo.png');
      expect(first.status).toBe(200);
      const firstBody = await first.json() as { logo: { attachment_id: string; filename: string; mime_type: string; size_bytes: number }; configured: boolean };
      expect(firstBody.configured).toBe(true);
      expect(firstBody.logo).toMatchObject({ filename: 'logo-ejemplo.png', mime_type: 'image/png', size_bytes: PNG_1X1.byteLength });

      const download = await call(ctx, 'GET', `${base}/logo`);
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toBe('image/png');
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG_1X1);

      const stored = await loadDocumentProfile(ctx.writer, (await legalEntityId(ctx, 'CVPO')));
      expect(stored.logo).toEqual(PNG_1X1);

      const second = await upload(ctx, `${base}/logo`, PNG_2X2, 'otro.png');
      expect(second.status).toBe(200);
      const secondBody = await second.json() as { logo: { attachment_id: string } };
      expect(secondBody.logo.attachment_id).not.toBe(firstBody.logo.attachment_id);
      const links = await ctx.writer.read<{ n: number }>(sql`
        SELECT count(*)::INTEGER AS n FROM core.attachment_link WHERE entity_table = 'core.document_profile'
      `);
      expect(Number(links[0]?.n)).toBe(1);
      expect(new Uint8Array(await (await call(ctx, 'GET', `${base}/logo`)).arrayBuffer())).toEqual(PNG_2X2);

      const withLogo = await call(ctx, 'POST', `${base}/sample`, {});
      expect(withLogo.status).toBe(200);
      const logoPdf = new Uint8Array(await withLogo.arrayBuffer());
      const without = await call(ctx, 'DELETE', `${base}/logo`);
      expect(without.status).toBe(200);
      expect((await without.json() as { logo: unknown }).logo).toBeNull();
      expect((await call(ctx, 'GET', `${base}/logo`)).status).toBe(404);
      const plainPdf = new Uint8Array(await (await call(ctx, 'POST', `${base}/sample`, {})).arrayBuffer());
      expect(Buffer.from(logoPdf).equals(Buffer.from(plainPdf))).toBe(false);
      expect((await call(ctx, 'DELETE', `${base}/logo`)).status).toBe(200);

      const audit = await ctx.writer.read<{ action: string }>(sql`
        SELECT action FROM audit.audit_log WHERE table_name = 'core.document_profile' ORDER BY id
      `);
      expect(audit.map((row) => row.action)).toEqual(['INSERT', 'UPDATE', 'UPDATE']);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza logotipos que no son imagen, que pesan demasiado o sin fichero', async () => {
    const ctx = await createTestApp();
    try {
      const base = '/v1/legal-entities/PO/document-profile/logo';
      const text = await upload(ctx, base, new TextEncoder().encode('esto no es una imagen'), 'logo.png');
      expect(text.status).toBe(422);
      const broken = await upload(ctx, base, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), 'roto.png');
      expect(broken.status).toBe(422);
      const empty = await upload(ctx, base, new Uint8Array(0), 'vacio.png');
      expect(empty.status).toBe(422);
      const big = new Uint8Array(2 * 1024 * 1024 + 1);
      big.set(PNG_1X1);
      expect((await upload(ctx, base, big, 'grande.png')).status).toBe(422);
      const noFile = await ctx.app.handle(new Request(`http://localhost${base}`, { method: 'PUT', body: new FormData() }));
      expect(noFile.status).toBe(422);
      const notForm = await call(ctx, 'PUT', base, { file: 'x' });
      expect(notForm.status).toBe(422);
      const denied = await upload(ctx, base, PNG_1X1, 'logo.png', 'bodega@winecore.test');
      expect(denied.status).toBe(403);
      const none = await (await call(ctx, 'GET', '/v1/legal-entities/PO/document-profile')).json() as Record<string, unknown>;
      expect(none.configured).toBe(false);
      expect(none.logo).toBeNull();
    } finally {
      await ctx.close();
    }
  });

  it('dibuja la muestra con el perfil guardado o con lo que se pruebe en el cuerpo, sin guardar nada', async () => {
    const ctx = await createTestApp();
    try {
      const base = '/v1/legal-entities/CVPO/document-profile';
      await call(ctx, 'PUT', base, PROFILE);

      const invoice = await call(ctx, 'POST', `${base}/sample`);
      expect(invoice.status).toBe(200);
      expect(invoice.headers.get('content-type')).toContain('application/pdf');
      expect(invoice.headers.get('content-disposition')).toBe('inline; filename="muestra-invoice-cvpo.pdf"');
      const text = extractPdfText(new Uint8Array(await invoice.arrayBuffer()));
      expect(text).toContain('FACTURA #F260086');
      expect(text).toContain('info@example.com');
      expect(text).toContain('Nº Operador SHC: AN0000EJEMPLO');
      expect(text).toContain('Distribuciones Ejemplo S.L.');
      expect(text).toContain('SUBTOTAL');
      expect(text).toContain('Albarán:');

      const tried = await call(ctx, 'POST', `${base}/sample`, {
        variant: 'po',
        email: 'prueba@example.org',
        footer_lines: ['Pie de prueba'],
        kind: 'discount',
        lang: 'en',
      });
      expect(tried.status).toBe(200);
      const triedText = extractPdfText(new Uint8Array(await tried.arrayBuffer()));
      expect(triedText).toContain('INVOICE #F260086');
      expect(triedText).toContain('prueba@example.org');
      expect(triedText).toContain('Pie de prueba');
      expect(triedText).toContain('DISC.');
      expect(triedText).not.toContain('SUBTOTAL');
      expect(triedText).not.toContain('info@example.com');

      const kept = await (await call(ctx, 'GET', base)).json() as Record<string, unknown>;
      expect(kept).toMatchObject({ variant: 'cvpo', email: 'info@example.com' });

      const expectations: [string, string][] = [
        ['corrective', 'FACTURA RECTIFICATIVA #R260003'],
        ['withholding', 'RETENCIÓN IRPF'],
        ['multipage', 'Pág. 1 de 3'],
        ['quote', 'PRESUPUESTO #P260012'],
        ['delivery_note', 'ALBARÁN #A260142'],
      ];
      for (const [kind, fragment] of expectations) {
        const response = await call(ctx, 'POST', `${base}/sample`, { kind });
        expect(response.status).toBe(200);
        expect(extractPdfText(new Uint8Array(await response.arrayBuffer()))).toContain(fragment);
      }
      const delivery = extractPdfText(new Uint8Array(await (await call(ctx, 'POST', `${base}/sample`, { kind: 'delivery_note' })).arrayBuffer()));
      expect(delivery).not.toContain('PRECIO');
      expect(delivery).toContain('UNIDADES');

      const same = await call(ctx, 'POST', `${base}/sample`, { kind: 'quote' });
      const twice = await call(ctx, 'POST', `${base}/sample`, { kind: 'quote' });
      expect(Buffer.from(await same.arrayBuffer()).equals(Buffer.from(await twice.arrayBuffer()))).toBe(true);

      expect((await call(ctx, 'POST', `${base}/sample`, { kind: 'otra' })).status).toBe(422);
      expect((await call(ctx, 'POST', `${base}/sample`, { lang: 'fr' })).status).toBe(422);
      expect((await call(ctx, 'POST', `${base}/sample`, { variant: 'otra' })).status).toBe(422);
      expect((await call(ctx, 'POST', `${base}/sample`, [])).status).toBe(422);
      const broken = await ctx.app.handle(new Request(`http://localhost${base}/sample`, { method: 'POST', body: '{no' }));
      expect(broken.status).toBe(422);
      expect((await call(ctx, 'POST', '/v1/legal-entities/NOEXISTE/document-profile/sample', {})).status).toBe(404);
    } finally {
      await ctx.close();
    }
  });

  it('dibuja la muestra aunque la sociedad todavía no tenga domicilio', async () => {
    const ctx = await createTestApp();
    try {
      await ctx.writer.withWrite({ type: 'system', id: 'prueba', requestId: 'prueba' }, async (tx) => {
        tx.write(sql`UPDATE core.legal_entity SET address_line = '', city = '', province = '' WHERE code = 'PO'`);
      });
      const response = await call(ctx, 'POST', '/v1/legal-entities/PO/document-profile/sample', {});
      expect(response.status).toBe(200);
      expect(extractPdfText(new Uint8Array(await response.arrayBuffer()))).toContain('FACTURA #F260086');
    } finally {
      await ctx.close();
    }
  });
});

async function legalEntityId(ctx: Ctx, code: string): Promise<string> {
  const rows = await ctx.writer.read<{ id: string }>(sql`SELECT id FROM core.legal_entity WHERE code = ${code}`);
  return String(rows[0]?.id).toLowerCase();
}
