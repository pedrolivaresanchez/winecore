import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { newId } from '../../src/core/ids';
import { sql } from '../../src/core/db/sql';
import {
  deliveryInvoicingOf,
  isCreditDocument,
  lineKindOf,
  paymentMethodOf,
  quoteStatusOf,
} from '../../db/migration/datasets/history';
import { runMigration } from '../../db/migration/run';
import { Decimal } from 'decimal.js';
import { createTestApp } from '../helpers';
import { buildXlsx } from '../fixtures/synthetic/migration/workbook';

describe('mapeo de histórico Holded', () => {
  test('clasifica líneas por el nombre del fichero y el tipo de documento', () => {
    expect(lineKindOf('/data/holded/cvpo/ventas/Ventas Exportar items.xlsx', ['Num factura', 'Item'])).toBe('sale');
    expect(lineKindOf('/data/holded/cvpo/ventas/Albaranes Exportar items.xlsx', ['Num factura', 'Item'])).toBe('delivery_note');
    expect(lineKindOf('/data/holded/po/ventas/Presupuestos Exportar items.xlsx', ['Num factura', 'Item'])).toBe('quote');
    expect(lineKindOf('/data/holded/po/compras/Compras Exportar items.xlsx', ['Num factura', 'Item', 'Num interno'])).toBe('purchase');
    expect(isCreditDocument('CN260001', new Decimal('10'))).toBe(true);
    expect(isCreditDocument('F260001', new Decimal('-3'))).toBe(true);
    expect(isCreditDocument('F260001', new Decimal('3'))).toBe(false);
    expect(paymentMethodOf('Transferencia bancaria')).toBe('transfer');
    expect(paymentMethodOf('Pago al contado')).toBe('cash');
    expect(quoteStatusOf('Aceptado', 'Facturado')).toBe('converted');
    expect(quoteStatusOf('Pendiente', 'Pendiente')).toBe('sent');
    expect(deliveryInvoicingOf('Parcialmente')).toBe('partially_invoiced');
  });

  test('carga líneas, albaranes y presupuestos sin duplicar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wc-hist-'));
    const out = join(dir, 'out');
    await mkdir(out);
    const db = join(dir, 'scratch.duckdb');
    try {
      const lines = join(dir, 'ventas', 'Ventas Exportar items.xlsx');
      const notes = join(dir, 'ventas', 'Albaranes.xlsx');
      const quotes = join(dir, 'ventas', 'Presupuestos.xlsx');
      await mkdir(join(dir, 'ventas'), { recursive: true });
      await writeFile(lines, buildXlsx([
        ['Export'],
        ['Num factura', 'Fecha', 'Item', 'Contacto', 'Unidades', 'Subtotal', 'Total', 'Borrador'],
        ['F240001', '2024-02-01', 'Botella ejemplo', 'Cliente Ejemplo', '2', '10.00', '12.10', 'No'],
        ['F240001', '2024-02-01', 'Caja ejemplo', 'Cliente Ejemplo', '1', '4.00', '4.84', 'No'],
      ]));
      await writeFile(notes, buildXlsx([
        ['Export'],
        ['Num', 'Fecha', 'Destino', 'Almacén', 'Canal', 'Subtotal', 'Total', 'Facturado', 'Etapa', 'Facturado'],
        ['A240001', '2024-03-01', 'Cliente Ejemplo', 'Principal', 'Ventas Bodega', '20.00', '24.20', '24.20', '', 'Facturado'],
        ['A240002', '2024-03-02', 'Cliente Ejemplo', 'Principal', 'Ventas Bodega', '5.00', '6.05', '0', '', 'Pendiente'],
      ]));
      await writeFile(quotes, buildXlsx([
        ['Export'],
        ['Fecha', 'Num', 'Cliente', 'Subtotal', 'Total', 'Total facturado', 'Pagos a cuenta', 'Estado', 'Facturado'],
        ['2024-01-15', 'P240001', 'Cliente Ejemplo', '30.00', '36.30', '0', '0', 'Pendiente', 'Pendiente'],
      ]));
      const base = {
        source: 'holded' as const,
        entity: 'CVPO',
        dbPath: db,
        outDir: out,
        operator: 'test',
        dataKey: null,
      };
      for (const file of [lines, notes, quotes]) {
        const dry = await runMigration({ ...base, dataset: 'history', file, mode: 'dry-run' });
        expect(JSON.stringify(dry.report).includes('Cliente Ejemplo')).toBe(false);
        const loaded = await runMigration({
          ...base,
          dataset: 'history',
          file,
          mode: 'load',
          approvedReport: dry.reportSha256,
        });
        expect(loaded.alreadyLoaded).toBe(false);
        const again = await runMigration({
          ...base,
          dataset: 'history',
          file,
          mode: 'load',
          approvedReport: dry.reportSha256,
        });
        expect(again.alreadyLoaded).toBe(true);
      }
      const { createLocalClient } = await import('../../src/core/db/local');
      const client = await createLocalClient(db);
      try {
        const linesCount = Number((await client.query<{ n: number }>('SELECT count(*) AS n FROM legacy.holded_invoice_line'))[0]?.n);
        const notesCount = Number((await client.query<{ n: number }>('SELECT count(*) AS n FROM legacy.holded_delivery_note'))[0]?.n);
        const quotesCount = Number((await client.query<{ n: number }>('SELECT count(*) AS n FROM legacy.holded_quote'))[0]?.n);
        expect(linesCount).toBe(2);
        expect(notesCount).toBe(2);
        expect(quotesCount).toBe(1);
      } finally {
        await client.close?.();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('listas con histórico', () => {
  test('facturas, gastos, presupuestos, albaranes y cobros devuelven lo importado', async () => {
    const ctx = await createTestApp();
    try {
      const entities = await ctx.writer.read<{ id: string; code: string }>('SELECT id, code FROM core.legal_entity');
      const cvpo = entities.find((row) => row.code === 'CVPO')?.id;
      if (!cvpo) throw new Error('Falta la entidad');
      const batch = newId();
      const sale = newId();
      const credit = newId();
      const purchase = newId();
      const quote = newId();
      const note = newId();
      const actor = { type: 'system' as const, id: 'history-test', requestId: newId() };
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
          VALUES (CAST(${batch} AS UUID), 'holded', CAST(${cvpo} AS UUID), 'history', 'sintetico.xlsx', ${'ab'.repeat(32)}, 'load', 'test')
        `);
        tx.write(sql`
          INSERT INTO legacy.holded_invoice (
            id, batch_id, entity_id, kind, number, issue_date, counterparty_name, subtotal, total, paid, pending, status_holded, raw
          ) VALUES
            (CAST(${sale} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale', 'F240099',
             DATE '2024-05-01', 'Cliente Ejemplo', 10, 12.10, 12.10, 0, 'Pagado', ${sql.json({})}),
            (CAST(${credit} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale', 'CN240001',
             DATE '2024-05-02', 'Cliente Ejemplo', -10, -12.10, 0, -12.10, 'Pagado', ${sql.json({})}),
            (CAST(${purchase} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'purchase', 'C240001',
             DATE '2024-05-03', 'Proveedor Ejemplo', 8, 9.68, 9.68, 0, 'Pagado', ${sql.json({})})
        `);
        tx.write(sql`
          INSERT INTO legacy.holded_quote (
            id, batch_id, entity_id, number, issue_date, counterparty_name, subtotal, total, status_holded, invoiced_status, raw
          ) VALUES (
            CAST(${quote} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'P240099',
            DATE '2024-04-01', 'Cliente Ejemplo', 5, 6.05, 'Pendiente', 'Pendiente', ${sql.json({})}
          )
        `);
        tx.write(sql`
          INSERT INTO legacy.holded_delivery_note (
            id, batch_id, entity_id, number, issue_date, destination, subtotal, total, invoiced_status, raw
          ) VALUES (
            CAST(${note} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'A240099',
            DATE '2024-04-02', 'Cliente Ejemplo', 5, 6.05, 'Pendiente', ${sql.json({})}
          )
        `);
      });
      const headers = { 'x-dev-user': 'owner@winecore.test' };
      const invoices = await json(ctx, '/v1/invoices?limit=100', headers);
      const numbers = (invoices.body.items as { number: string; imported?: boolean; invoice_type: string }[]).map((item) => item.number);
      expect(numbers).toContain('F240099');
      expect(numbers).toContain('CN240001');
      const creditRow = (invoices.body.items as { number: string; invoice_type: string; imported?: boolean }[])
        .find((item) => item.number === 'CN240001');
      expect(creditRow?.invoice_type).toBe('R1');
      expect(creditRow?.imported).toBe(true);
      const expenses = await json(ctx, '/v1/supplier-invoices?limit=100', headers);
      const expenseNumbers = (expenses.body.items as { supplier_invoice_number: string; imported?: boolean }[])
        .map((item) => item.supplier_invoice_number);
      expect(expenseNumbers).toContain('C240001');
      const quotes = await json(ctx, '/v1/quotes?limit=100', headers);
      expect((quotes.body.items as { number: string; imported?: boolean }[]).some((item) => item.number === 'P240099' && item.imported)).toBe(true);
      const notes = await json(ctx, '/v1/delivery-notes?limit=100', headers);
      expect((notes.body.items as { number: string; imported?: boolean }[]).some((item) => item.number === 'A240099' && item.imported)).toBe(true);
      const payments = await json(ctx, '/v1/payments?limit=100', headers);
      const references = (payments.body.items as { reference: string | null; imported?: boolean }[])
        .filter((item) => item.imported)
        .map((item) => item.reference);
      expect(references).toContain('F240099');
      expect(references).toContain('C240001');
      expect(invoices.status).toBe(200);
      expect(expenses.status).toBe(200);
    } finally {
      await ctx.close();
    }
  });
});

async function json(ctx: { app: { handle: (request: Request) => Promise<Response> } }, path: string, headers: Record<string, string>) {
  const response = await ctx.app.handle(new Request(`http://localhost${path}`, { headers }));
  return { status: response.status, body: await response.json() as { items: unknown[] } };
}
