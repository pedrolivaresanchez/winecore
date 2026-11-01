import { afterAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { renderDocumentPdf, type DocumentPdfInput } from '../../src/core/pdf/document';
import { renderFallbackPdf } from '../../src/core/pdf/fallback';
import { EMPTY_DOCUMENT_PROFILE } from '../../src/core/pdf/profile';
import { extractPdfText } from '../billing-pdf/extract';
import { createTestApp } from '../helpers';

const ctx = await createTestApp({ log: () => {} });

afterAll(async () => {
  await ctx.close?.();
});

function input(overrides: Partial<DocumentPdfInput> = {}): DocumentPdfInput {
  return {
    title: 'Presupuesto',
    number: 'P260002',
    issueDate: '2026-04-01',
    dueLabel: 'Válido hasta',
    dueDate: '2026-06-28',
    status: 'Convertido',
    partyLabel: 'Cliente',
    seller: {
      legalName: 'COMPAÑIA DE VINOS PEDRO OLIVARES S.L.',
      tradeName: null,
      taxId: 'B97749790',
      addressLine: 'Avda la Victoria nº 4',
      postalCode: '23360',
      city: 'La Puerta de Segura',
      province: 'Jaén',
      countryCode: 'ES',
    },
    customerName: 'JAVIER ALVARADO DEPORTES S.L.',
    description: null,
    lines: [
      {
        description: 'Migración Ecommerce PrestaShop a Shopify. Importe 40%',
        quantity: '1',
        unit_price: '1760.00',
        line_base: '1760.00',
        tax_code: 'IVA21',
        tax_rate: '21',
      },
    ],
    totals: { subtotal: '1760.00', vat: '369.60', withholding: null, total: '2129.60' },
    settlement: null,
    note: 'Copia generada desde el histórico de Holded.',
    ...overrides,
  };
}

const BAD_LOGO = new Uint8Array([1, 2, 3, 4]);

describe('un PDF que se abre desde la pantalla no devuelve un 500', () => {
  it('repite la maqueta sin logotipo cuando el logotipo no se puede leer', async () => {
    const bytes = await renderDocumentPdf(input({ profile: { ...EMPTY_DOCUMENT_PROFILE, variant: 'cvpo', logo: BAD_LOGO } }));
    expect(Buffer.from(bytes.subarray(0, 4)).toString('ascii')).toBe('%PDF');
    const text = extractPdfText(bytes);
    expect(text).toContain('PRESUPUESTO #P260002');
    expect(text).toContain('JAVIER ALVARADO DEPORTES S.L.');
  });

  it('pinta una hoja sencilla con caracteres que la fuente no conoce y muchas líneas', async () => {
    const lines = Array.from({ length: 120 }, (_, index) => ({
      description: `Línea ${index} 日本語 🍷 ‑ “comillas”`,
      quantity: index % 2 === 0 ? '2' : null,
      unit_price: null,
      line_base: '1.00',
      tax_code: null,
    }));
    const bytes = await renderFallbackPdf(input({ lines: lines as DocumentPdfInput['lines'] }));
    expect(Buffer.from(bytes.subarray(0, 4)).toString('ascii')).toBe('%PDF');
    const text = extractPdfText(bytes);
    expect(text).toContain('Presupuesto P260002');
    expect(text).toContain('Total: 2129.60 EUR');
  });

  it('el PDF histórico de un presupuesto y de un albarán se abre aunque falte la tabla del perfil documental', async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id, code FROM core.legal_entity`);
    const cvpo = entities.find((row) => row.code === 'CVPO')?.id;
    if (!cvpo) throw new Error('Falta la entidad de semilla');
    const batch = newId();
    const quote = newId();
    const note = newId();
    await ctx.writer.withWrite({ type: 'system', id: 'pdf-never-fails', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (CAST(${batch} AS UUID), 'holded', CAST(${cvpo} AS UUID), 'history', 'sintetico.xlsx', ${'ef'.repeat(32)}, 'load', 'test')
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_quote (
          id, batch_id, entity_id, number, issue_date, valid_until, counterparty_name, description,
          subtotal, vat, total, status_holded, raw
        ) VALUES (
          CAST(${quote} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'P-9100',
          CAST('2026-04-01' AS DATE), CAST('2026-06-28' AS DATE), 'Cliente Ejemplo', NULL,
          17.60, 3.70, 21.30, 'Aceptado', ${sql.json({})}
        )
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_delivery_note (
          id, batch_id, entity_id, number, issue_date, destination, description,
          subtotal, vat, withholding, total, invoiced_status, raw
        ) VALUES (
          CAST(${note} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'A-9100',
          CAST('2026-04-02' AS DATE), 'Bodega ejemplo', NULL, 8.00, 1.68, 0.00, 9.68, 'Pendiente', ${sql.json({})}
        )
      `);
    });

    await ctx.writer.withWrite({ type: 'system', id: 'pdf-never-fails', requestId: newId() }, async (tx) => {
      tx.write(sql`DROP TABLE IF EXISTS core.document_profile`);
    });

    for (const [id, title] of [[quote, 'PRESUPUESTO #P-9100'], [note, 'ALBARÁN #A-9100']] as const) {
      const response = await ctx.app.handle(new Request(`http://localhost/v1/legacy/documents/${id}/pdf`));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/pdf');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(extractPdfText(bytes)).toContain(title);
    }
  });
});
