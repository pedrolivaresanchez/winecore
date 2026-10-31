import { afterAll, describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { extractPdfText } from '../billing-pdf/extract';
import { createTestApp } from '../helpers';

const HASH = 'ab'.repeat(32);
const logs: string[] = [];
const ctx = await createTestApp({ log: (line) => logs.push(line) });

describe('detalle de documentos Holded', () => {
  afterAll(async () => {
    await ctx.close();
  });

  it('devuelve la venta con dos líneas y un PDF', async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id, code FROM core.legal_entity`);
    const cvpo = entities.find((row) => row.code === 'CVPO')?.id;
    if (!cvpo) throw new Error('Falta la entidad de semilla');
    const batch = newId();
    const sale = newId();
    const credit = newId();
    const negative = newId();
    const lineA = newId();
    const lineB = newId();
    const otherNumber = newId();
    const otherKind = newId();
    const otherDate = newId();

    await ctx.writer.withWrite({ type: 'system', id: 'holded-detail', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (
          CAST(${batch} AS UUID), 'holded', CAST(${cvpo} AS UUID), 'history', 'sintetico.xlsx', ${HASH}, 'load', 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_invoice (
          id, batch_id, entity_id, kind, number, issue_date, due_date, counterparty_name, description,
          subtotal, vat, withholding, total, paid, pending, status_holded, raw
        ) VALUES
          (CAST(${sale} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale', 'F-9001',
           CAST('2026-06-01' AS DATE), CAST('2026-07-01' AS DATE), 'Cliente Ejemplo', 'Pedido de ejemplo',
           14.00, 2.94, 0.00, 16.94, 10.00, 6.94, 'Pendiente', ${sql.json({})}),
          (CAST(${credit} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale', 'CN-9001',
           CAST('2026-06-02' AS DATE), NULL, 'Cliente Ejemplo', NULL,
           -10.00, -2.10, 0.00, -12.10, 0.00, -12.10, 'Pagado', ${sql.json({})}),
          (CAST(${negative} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale', 'R-9001',
           CAST('2026-06-03' AS DATE), NULL, 'Cliente Ejemplo', NULL,
           -4.00, -0.84, 0.00, -4.84, NULL, NULL, 'Pendiente', ${sql.json({})})
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_invoice_line (
          id, batch_id, entity_id, kind, document_number, document_date, line_seq,
          description, sku, units, subtotal, tax_rate_label, raw
        ) VALUES
          (CAST(${lineA} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale', 'F-9001',
           CAST('2026-06-01' AS DATE), 1, 'Botella ejemplo', 'BOT-1', 2, 10.00, '21%', ${sql.json({})}),
          (CAST(${lineB} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale', 'F-9001',
           CAST('2026-06-01' AS DATE), 2, 'Caja ejemplo', 'CAJ-1', 1, 4.00, '21%', ${sql.json({})}),
          (CAST(${otherNumber} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale', 'F-9002',
           CAST('2026-06-01' AS DATE), 1, 'Otro numero', 'OTR-1', 1, 1.00, '21%', ${sql.json({})}),
          (CAST(${otherKind} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'purchase', 'F-9001',
           CAST('2026-06-01' AS DATE), 1, 'Compra ajena', 'COM-1', 1, 1.00, '21%', ${sql.json({})}),
          (CAST(${otherDate} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale', 'F-9001',
           CAST('2026-06-04' AS DATE), 1, 'Otra fecha', 'FEC-1', 1, 1.00, '21%', ${sql.json({})})
      `);
    });

    const response = await ctx.app.handle(new Request(`http://localhost/v1/legacy/invoices/${sale}`));
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      id: sale,
      number: 'F-9001',
      issue_date: '2026-06-01',
      due_date: '2026-07-01',
      counterparty_name: 'Cliente Ejemplo',
      description: 'Pedido de ejemplo',
      subtotal: '14.00',
      vat: '2.94',
      withholding: '0.00',
      total: '16.94',
      paid: '10.00',
      pending: '6.94',
      status_holded: 'Pendiente',
      kind: 'sale',
      entity_code: 'CVPO',
      legal_entity_id: cvpo,
    });
    expect(body.lines).toEqual([
      {
        line_no: 1,
        sku: 'BOT-1',
        description: 'Botella ejemplo',
        quantity: '2',
        unit_price: '5.00',
        line_base: '10.00',
        tax_code: '21%',
      },
      {
        line_no: 2,
        sku: 'CAJ-1',
        description: 'Caja ejemplo',
        quantity: '1',
        unit_price: '4.00',
        line_base: '4.00',
        tax_code: '21%',
      },
    ]);

    const pdf = await ctx.app.handle(new Request(`http://localhost/v1/legacy/invoices/${sale}/pdf`));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
    expect(pdf.headers.get('content-disposition')).toContain('filename="factura-F-9001.pdf"');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 4)).toString('ascii')).toBe('%PDF');
    const text = extractPdfText(bytes);
    expect(text).toContain('Factura');
    expect(text).not.toContain('rectificativa');
    expect(text).toContain('Cliente Ejemplo');
    expect(text).toContain('Botella ejemplo');
    expect(text).toContain('Caja ejemplo');
    expect(text).toContain('Comercializadora (CVPO)');
    expect(text).toContain('Calle Ejemplo 1');
    expect(text).toContain('Copia generada desde el histórico de Holded. No es un registro Verifactu.');
    expect(text).not.toContain('Otro numero');
    expect(text).not.toContain('Compra ajena');
    expect(text).not.toContain('Otra fecha');
    expect(text).not.toContain('IBAN');
    expect(logs.join('\n')).not.toContain('Cliente Ejemplo');

    const creditPdf = await ctx.app.handle(new Request(`http://localhost/v1/legacy/invoices/${credit}/pdf`));
    expect(creditPdf.status).toBe(200);
    expect(extractPdfText(new Uint8Array(await creditPdf.arrayBuffer()))).toContain('Factura rectificativa');
    const negativePdf = await ctx.app.handle(new Request(`http://localhost/v1/legacy/invoices/${negative}/pdf`));
    expect(extractPdfText(new Uint8Array(await negativePdf.arrayBuffer()))).toContain('Factura rectificativa');

    const missing = await ctx.app.handle(new Request(`http://localhost/v1/legacy/invoices/${newId()}`));
    expect(missing.status).toBe(404);
    expect((await missing.json() as { code: string }).code).toBe('WC_NOT_FOUND');
    const missingPdf = await ctx.app.handle(new Request(`http://localhost/v1/legacy/invoices/${newId()}/pdf`));
    expect(missingPdf.status).toBe(404);
  });

  it('devuelve el presupuesto o el albarán con la línea del mismo documento', async () => {
    const entities = await ctx.writer.read<{ id: string; code: string }>(`SELECT id, code FROM core.legal_entity`);
    const cvpo = entities.find((row) => row.code === 'CVPO')?.id;
    if (!cvpo) throw new Error('Falta la entidad de semilla');
    const batch = newId();
    const quote = newId();
    const note = newId();
    const quoteLine = newId();
    const noteLine = newId();
    const stray = newId();

    await ctx.writer.withWrite({ type: 'system', id: 'holded-detail-doc', requestId: newId() }, async (tx) => {
      tx.write(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (
          CAST(${batch} AS UUID), 'holded', CAST(${cvpo} AS UUID), 'history', 'sintetico.xlsx', ${'cd'.repeat(32)}, 'load', 'test'
        )
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_quote (
          id, batch_id, entity_id, number, issue_date, valid_until, counterparty_name, description,
          subtotal, vat, total, status_holded, raw
        ) VALUES (
          CAST(${quote} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'P-9001',
          CAST('2026-05-01' AS DATE), CAST('2026-05-31' AS DATE), 'Cliente Ejemplo', 'Propuesta de ejemplo',
          20.00, 4.20, 24.20, 'Pendiente', ${sql.json({})}
        )
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_delivery_note (
          id, batch_id, entity_id, number, issue_date, destination, description,
          subtotal, vat, withholding, total, invoiced_status, raw
        ) VALUES (
          CAST(${note} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'A-9001',
          CAST('2026-05-02' AS DATE), 'Bodega ejemplo', 'Salida de ejemplo',
          8.00, 1.68, 0.00, 9.68, 'Pendiente', ${sql.json({})}
        )
      `);
      tx.write(sql`
        INSERT INTO legacy.holded_invoice_line (
          id, batch_id, entity_id, kind, document_number, document_date, line_seq, description, sku, units, subtotal, tax_rate_label, raw
        ) VALUES
          (CAST(${quoteLine} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'quote', 'P-9001',
           CAST('2026-05-01' AS DATE), 1, 'Linea de presupuesto', 'PRE-1', 3, 20.00, '21%', ${sql.json({})}),
          (CAST(${noteLine} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'delivery_note', 'A-9001',
           CAST('2026-05-02' AS DATE), 1, 'Linea de albaran', 'ALB-1', 1, 8.00, '21%', ${sql.json({})}),
          (CAST(${stray} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale', 'P-9001',
           CAST('2026-05-01' AS DATE), 1, 'Linea de venta', 'VEN-1', 1, 1.00, '21%', ${sql.json({})})
      `);
    });

    const quoteResponse = await ctx.app.handle(new Request(`http://localhost/v1/legacy/documents/${quote}`));
    expect(quoteResponse.status).toBe(200);
    const quoteBody = await quoteResponse.json() as { kind: string; due_date: string | null; withholding: string | null; lines: { description: string }[] };
    expect(quoteBody.kind).toBe('quote');
    expect(quoteBody.due_date).toBe('2026-05-31');
    expect(quoteBody.withholding).toBeNull();
    expect(quoteBody.lines.map((line) => line.description)).toEqual(['Linea de presupuesto']);

    const noteResponse = await ctx.app.handle(new Request(`http://localhost/v1/legacy/documents/${note}`));
    expect(noteResponse.status).toBe(200);
    const noteBody = await noteResponse.json() as {
      kind: string;
      counterparty_name: string;
      withholding: string;
      lines: { description: string; quantity: string; line_base: string }[];
    };
    expect(noteBody.kind).toBe('delivery_note');
    expect(noteBody.counterparty_name).toBe('Bodega ejemplo');
    expect(noteBody.withholding).toBe('0.00');
    expect(noteBody.lines).toEqual([
      expect.objectContaining({ description: 'Linea de albaran', quantity: '1', line_base: '8.00' }),
    ]);

    const missing = await ctx.app.handle(new Request(`http://localhost/v1/legacy/documents/${newId()}`));
    expect(missing.status).toBe(404);
    expect((await missing.json() as { code: string }).code).toBe('WC_NOT_FOUND');
  });
});
