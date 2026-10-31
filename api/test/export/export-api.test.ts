import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { ENTITY_EORI_MISSING } from '../../src/core/billing/export/constants';
import { createTestApp } from '../helpers';
import { sampleInvoice } from './fixture';
import { pdfLines } from './pdfText';

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('API de exportación', () => {
  it('solo el titular lee y cambia el ajuste, y el cambio queda auditado', async () => {
    const ctx = await createTestApp();
    try {
      const denied = await ctx.app.handle(new Request('http://localhost/v1/export/documents-by-country', {
        headers: { 'X-Dev-User': 'asesor@winecore.test' },
      }));
      expect(denied.status).toBe(403);

      const current = await json(await ctx.app.handle(new Request('http://localhost/v1/export/documents-by-country')));
      expect(current.key).toBe('billing.export_documents_by_country');
      expect(current.persisted).toBe(true);
      const value = current.value as { notice: string; countries: Record<string, { example: boolean; confirmed: boolean }> };
      expect(value.notice).toContain('EJEMPLO');
      expect(value.countries.GB?.example).toBe(true);
      expect(value.countries.GB?.confirmed).toBe(false);

      const missingVersion = await ctx.app.handle(new Request('http://localhost/v1/export/documents-by-country', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      }));
      expect(missingVersion.status).toBe(409);

      const stale = await ctx.app.handle(new Request('http://localhost/v1/export/documents-by-country', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': '2000-01-01T00:00:00.000Z' },
        body: JSON.stringify(value),
      }));
      expect(stale.status).toBe(409);
      expect((await json(stale)).code).toBe('WC_STALE_VERSION');

      const next = structuredClone(value);
      const gb = next.countries.GB as { notes: string; example: boolean; confirmed: boolean };
      gb.notes = 'EJEMPLO sin confirmar. Nota sintética revisada por la prueba.';
      const saved = await json(await ctx.app.handle(new Request('http://localhost/v1/export/documents-by-country', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(current.updated_at),
          'X-Request-Id': 'export-docs-test',
        },
        body: JSON.stringify(next),
      })));
      expect((saved.value as { countries: { GB: { notes: string } } }).countries.GB.notes).toContain('Nota sintética');

      const admin = await ctx.app.handle(new Request('http://localhost/v1/export/documents-by-country', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': String(saved.updated_at),
          'X-Dev-User': 'admin@winecore.test',
        },
        body: JSON.stringify(next),
      }));
      expect(admin.status).toBe(403);

      const audit = await ctx.writer.read<{ action: string; reason: string | null; after_data: unknown }>(sql`
        SELECT action, reason, after_data
        FROM audit.audit_log
        WHERE table_name = 'core.setting'
      `);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.action).toBe('UPDATE');
      expect(audit[0]?.reason).toBe('ajuste de documentos de exportación');
      expect(JSON.stringify(audit[0]?.after_data)).toContain('Nota sintética');
    } finally {
      await ctx.close();
    }
  });

  it('la comprobación, la lista y los PDF usan la factura sintética', async () => {
    const ctx = await createTestApp();
    try {
      const blocked = await json(await ctx.app.handle(new Request('http://localhost/v1/export/readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleInvoice({ entity: { ...sampleInvoice().entity, eori: null } })),
      })));
      expect(blocked.ready).toBe(false);
      expect(blocked.entity_eori_missing).toBe(true);
      expect(blocked.missing).toContain(ENTITY_EORI_MISSING);

      const refused = await json(await ctx.app.handle(new Request('http://localhost/v1/export/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleInvoice({ entity: { ...sampleInvoice().entity, eori: null } })),
      })));
      expect(refused.code).toBe('WC_INV_ENTITY_EORI_REQUIRED');
      expect(refused.message).toBe(ENTITY_EORI_MISSING);

      const checklist = await json(await ctx.app.handle(new Request('http://localhost/v1/export/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleInvoice()),
      })));
      expect(checklist.ready).toBe(true);
      const items = checklist.items as { code: string; status: string }[];
      expect(items.find((item) => item.code === 'certificate_of_origin')?.status).toBe('pending');
      expect(items.find((item) => item.code === 'commercial_invoice')?.status).toBe('generated');

      const generated = await ctx.app.handle(new Request('http://localhost/v1/export/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleInvoice()),
      }));
      expect(generated.status).toBe(200);
      const body = await json(generated);
      const commercial = body.commercial_invoice as { text: string; pdf_base64: string; document: { tax: { rate: null; quota: null } } };
      const packing = body.packing_list as { text: string; pdf_base64: string };
      expect(commercial.text.startsWith('FACTURA COMERCIAL')).toBe(true);
      expect(commercial.text).toContain('EJEMPLO sin confirmar');
      expect(commercial.document.tax.rate).toBeNull();
      expect(commercial.document.tax.quota).toBeNull();
      expect(packing.text.startsWith('LISTA DE BULTOS')).toBe(true);
      expect(packing.text).not.toContain('120.00');
      const pdf = Buffer.from(commercial.pdf_base64, 'base64');
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      expect(pdfLines(pdf).join('\n')).toBe(commercial.text);
    } finally {
      await ctx.close();
    }
  });
});
