import { describe, expect, test } from 'bun:test';

import { sql } from '../../src/core/db/sql';
import { listOpenDocuments } from '../../src/core/finance/store';
import { projectHoldedInvoices } from '../../src/core/billing/holdedProject';
import { newId } from '../../src/core/ids';
import { createTestApp } from '../helpers';

const YEARS = [2022, 2023, 2024, 2025, 2026] as const;

function rowsOf(csv: string): string[][] {
  return csv.replace(/^\uFEFF/, '').trim().split('\r\n').slice(1).filter(Boolean).map((line) => line.split(';'));
}

describe('histórico Holded en los libros nativos', () => {
  test('proyecta ventas y compras por sociedad y año, sin duplicar ni enviar a Verifactu', async () => {
    const ctx = await createTestApp();
    try {
      const entities = await ctx.client.query<{ id: string; code: string }>('SELECT id, code FROM core.legal_entity');
      const idOf = (code: string) => {
        const found = entities.find((entity) => entity.code === code);
        if (!found) throw new Error(`Falta ${code}`);
        return found.id;
      };
      const po = idOf('PO');
      const cvpo = idOf('CVPO');
      const batch = newId();
      const nativeCustomer = newId();
      const nativeInvoice = newId();
      const duplicateId = newId();
      await ctx.client.query(sql`
        INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
        VALUES (
          CAST(${batch} AS UUID), 'holded', CAST(${po} AS UUID), 'history', 'sintetico.xlsx',
          ${'ab'.repeat(32)}, 'load', 'test'
        )
      `);
      await ctx.client.query(sql`
        INSERT INTO party.contact (id, kind, legal_name, tax_id, tax_id_type, is_customer, created_by)
        VALUES (
          CAST(${nativeCustomer} AS UUID), 'company', 'Cliente Nativo SL', 'B00000019', 'nif', TRUE, 'test'
        )
      `);

      let seq = 0;
      const next = () => {
        seq += 1;
        return newId();
      };
      for (const code of ['PO', 'CVPO'] as const) {
        const entity = code === 'PO' ? po : cvpo;
        for (const year of YEARS) {
          const sale = next();
          const purchase = next();
          const saleLine = next();
          const purchaseLine = next();
          const day = `${year}-03-15`;
          await ctx.client.query(sql`
            INSERT INTO legacy.holded_invoice (
              id, batch_id, entity_id, kind, number, issue_date, due_date, counterparty_name, description,
              payment_method, subtotal, vat, withholding, surcharge, total, status_holded, paid, pending, raw
            ) VALUES (
              CAST(${sale} AS UUID), CAST(${batch} AS UUID), CAST(${entity} AS UUID), 'sale',
              ${`F${year}${code}`}, CAST(${day} AS DATE), CAST(${`${year}-04-15`} AS DATE),
              ${`Cliente ${code}`}, 'Vino', 'Transferencia bancaria',
              100.00, 21.00, 0, 0, 121.00, 'Pagado', 121.00, 0, ${sql.json({})}
            )
          `);
          await ctx.client.query(sql`
            INSERT INTO legacy.holded_invoice_line (
              id, batch_id, entity_id, kind, document_number, document_date, line_seq, description,
              counterparty_tax_id, units, subtotal, tax_rate_label, tax_amount, total, raw
            ) VALUES (
              CAST(${saleLine} AS UUID), CAST(${batch} AS UUID), CAST(${entity} AS UUID), 'sale',
              ${`F${year}${code}`}, CAST(${day} AS DATE), 1, 'Tinto reserva', 'B12345678',
              4, 100.00, 'IVA 21%', 21.00, 121.00, ${sql.json({})}
            )
          `);
          await ctx.client.query(sql`
            INSERT INTO legacy.holded_invoice (
              id, batch_id, entity_id, kind, number, issue_date, accounting_date, counterparty_name,
              account_label, subtotal, vat, withholding, surcharge, total, status_holded, paid, pending, raw
            ) VALUES (
              CAST(${purchase} AS UUID), CAST(${batch} AS UUID), CAST(${entity} AS UUID), 'purchase',
              ${`C${year}${code}`}, CAST(${day} AS DATE), CAST(${day} AS DATE),
              ${`Proveedor ${code}`}, '629 Otros',
              100.00, 21.00, 0, 0, 121.00, 'Pagado', 121.00, 0, ${sql.json({})}
            )
          `);
          await ctx.client.query(sql`
            INSERT INTO legacy.holded_invoice_line (
              id, batch_id, entity_id, kind, document_number, document_date, line_seq, description,
              units, subtotal, tax_rate_label, tax_amount, total, raw
            ) VALUES (
              CAST(${purchaseLine} AS UUID), CAST(${batch} AS UUID), CAST(${entity} AS UUID), 'purchase',
              ${`C${year}${code}`}, CAST(${day} AS DATE), 1, 'Corchos',
              10, 100.00, 'IVA 21%', 21.00, 121.00, ${sql.json({})}
            )
          `);
        }
      }

      const multiSale = next();
      const multiPurchase = next();
      await ctx.client.query(sql`
        INSERT INTO legacy.holded_invoice (
          id, batch_id, entity_id, kind, number, issue_date, counterparty_name, description,
          subtotal, vat, withholding, surcharge, total, status_holded, raw
        ) VALUES (
          CAST(${multiSale} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale',
          'F2024CVPO-M', DATE '2024-06-01', 'Cliente CVPO', 'Mixto',
          150.00, 26.00, 0, 0, 176.00, 'Pagado', ${sql.json({})}
        )
      `);
      for (const [lineNo, base, rate, quota, label] of [
        [1, '100.00', '21.00', '21.00', 'IVA 21%'],
        [2, '50.00', '10.00', '5.00', 'IVA 10%'],
      ] as const) {
        await ctx.client.query(sql`
          INSERT INTO legacy.holded_invoice_line (
            id, batch_id, entity_id, kind, document_number, document_date, line_seq, description,
            units, subtotal, tax_rate_label, tax_amount, total, raw
          ) VALUES (
            CAST(${next()} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale',
            'F2024CVPO-M', DATE '2024-06-01', ${lineNo}, ${label},
            1, ${base}, ${label}, ${quota}, ${String(Number(base) + Number(quota))}, ${sql.json({})}
          )
        `);
      }
      await ctx.client.query(sql`
        INSERT INTO legacy.holded_invoice (
          id, batch_id, entity_id, kind, number, issue_date, accounting_date, counterparty_name,
          subtotal, vat, withholding, surcharge, total, status_holded, raw
        ) VALUES (
          CAST(${multiPurchase} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'purchase',
          'C2024CVPO-M', DATE '2024-06-02', DATE '2024-06-02', 'Proveedor CVPO',
          150.00, 26.00, 0, 0, 176.00, 'Pagado', ${sql.json({})}
        )
      `);
      for (const [lineNo, base, quota, label] of [
        [1, '100.00', '21.00', 'IVA 21%'],
        [2, '50.00', '5.00', 'IVA 10%'],
      ] as const) {
        await ctx.client.query(sql`
          INSERT INTO legacy.holded_invoice_line (
            id, batch_id, entity_id, kind, document_number, document_date, line_seq, description,
            units, subtotal, tax_rate_label, tax_amount, total, raw
          ) VALUES (
            CAST(${next()} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'purchase',
            'C2024CVPO-M', DATE '2024-06-02', ${lineNo}, ${label},
            1, ${base}, ${label}, ${quota}, ${String(Number(base) + Number(quota))}, ${sql.json({})}
          )
        `);
      }

      await ctx.client.query(sql`
        INSERT INTO legacy.holded_invoice (
          id, batch_id, entity_id, kind, number, issue_date, counterparty_name, description,
          subtotal, vat, withholding, surcharge, total, status_holded, pending, number_anomaly, raw
        ) VALUES (
          CAST(${duplicateId} AS UUID), CAST(${batch} AS UUID), CAST(${cvpo} AS UUID), 'sale',
          'F2025CVPO', DATE '2025-03-20', 'Cliente CVPO', 'Duplicada',
          50.00, 10.50, 0, 0, 60.50, 'Pendiente', 60.50, 'duplicate', ${sql.json({})}
        )
      `);
      const credit = next();
      await ctx.client.query(sql`
        INSERT INTO legacy.holded_invoice (
          id, batch_id, entity_id, kind, number, issue_date, counterparty_name,
          subtotal, vat, withholding, surcharge, total, status_holded, raw
        ) VALUES (
          CAST(${credit} AS UUID), CAST(${batch} AS UUID), CAST(${po} AS UUID), 'sale',
          'CN2022PO', DATE '2022-08-01', 'Cliente PO',
          -100.00, -21.00, 0, 0, -121.00, 'Pagado', ${sql.json({})}
        )
      `);
      await ctx.client.query(sql`
        INSERT INTO legacy.holded_invoice_line (
          id, batch_id, entity_id, kind, document_number, document_date, line_seq, description,
          units, subtotal, tax_rate_label, tax_amount, total, raw
        ) VALUES (
          CAST(${next()} AS UUID), CAST(${batch} AS UUID), CAST(${po} AS UUID), 'sale',
          'CN2022PO', DATE '2022-08-01', 1, 'Abono',
          -1, -100.00, 'IVA 21%', -21.00, -121.00, ${sql.json({})}
        )
      `);
      const voided = next();
      await ctx.client.query(sql`
        INSERT INTO legacy.holded_invoice (
          id, batch_id, entity_id, kind, number, issue_date, counterparty_name,
          subtotal, vat, withholding, surcharge, total, status_holded, raw
        ) VALUES (
          CAST(${voided} AS UUID), CAST(${batch} AS UUID), CAST(${po} AS UUID), 'sale',
          'F2023PO-V', DATE '2023-01-10', 'Cliente PO',
          10.00, 2.10, 0, 0, 12.10, 'Anulado', ${sql.json({})}
        )
      `);
      const withheld = next();
      await ctx.client.query(sql`
        INSERT INTO legacy.holded_invoice (
          id, batch_id, entity_id, kind, number, issue_date, accounting_date, counterparty_name,
          subtotal, vat, withholding, surcharge, total, status_holded, pending, raw
        ) VALUES (
          CAST(${withheld} AS UUID), CAST(${batch} AS UUID), CAST(${po} AS UUID), 'purchase',
          'C2026PO-R', DATE '2026-11-01', DATE '2026-11-01', 'Proveedor PO',
          100.00, 21.00, 15.00, 0, 106.00, 'Pendiente', 106.00, ${sql.json({})}
        )
      `);
      await ctx.client.query(sql`
        INSERT INTO legacy.open_item (
          id, entity_id, direction, holded_invoice_id, document_number, document_date, due_date, amount
        ) VALUES (
          CAST(${next()} AS UUID), CAST(${cvpo} AS UUID), 'receivable', CAST(${duplicateId} AS UUID),
          'F2025CVPO', DATE '2025-03-20', DATE '2025-04-20', 60.50
        )
      `);

      const first = await projectHoldedInvoices(ctx.client);
      const second = await projectHoldedInvoices(ctx.client);
      expect(first).toEqual({ sales: 14, purchases: 12 });
      expect(second).toEqual(first);
      const lineCount = await ctx.client.query<{ n: number | string }>(`
        SELECT
          (SELECT count(*) FROM billing.invoice_line l
             JOIN billing.invoice i ON i.id = l.invoice_id WHERE i.origin = 'holded_import') AS n
      `);
      const lineCountAgain = await ctx.client.query<{ n: number | string }>(`
        SELECT
          (SELECT count(*) FROM billing.invoice_line l
             JOIN billing.invoice i ON i.id = l.invoice_id WHERE i.origin = 'holded_import') AS n
      `);
      expect(lineCountAgain[0]?.n).toBe(lineCount[0]?.n);
      const verifactu = await ctx.client.query<{ n: number | string }>('SELECT count(*) AS n FROM regulatory.verifactu_record');
      expect(Number(verifactu[0]?.n)).toBe(0);
      const shaped = await ctx.client.query<{
        number: string;
        invoice_type: string;
        status: string;
        series_id: string | null;
        anomaly: string;
      }>(`
        SELECT i.number, i.invoice_type, i.status, i.series_id,
               json_extract_string(i.legacy_refs, '$.number_anomaly') AS anomaly
        FROM billing.invoice i
        WHERE i.origin = 'holded_import' AND i.number IN ('CN2022PO', 'F2023PO-V', 'F2025CVPO')
        ORDER BY i.issue_date, i.number
      `);
      expect(shaped).toEqual([
        { number: 'CN2022PO', invoice_type: 'R1', status: 'issued', series_id: null, anomaly: '' },
        { number: 'F2023PO-V', invoice_type: 'F1', status: 'voided', series_id: null, anomaly: '' },
        { number: 'F2025CVPO', invoice_type: 'F1', status: 'issued', series_id: null, anomaly: '' },
        { number: 'F2025CVPO', invoice_type: 'F1', status: 'issued', series_id: null, anomaly: 'duplicate' },
      ]);

      await ctx.client.query(sql`
        INSERT INTO billing.invoice (
          id, legal_entity_id, number, status, invoice_type, issue_date, customer_id, customer_snapshot,
          subtotal, tax_total, surcharge_total, withholding_total, total, issued_at, created_by, description
        ) VALUES (
          CAST(${nativeInvoice} AS UUID), CAST(${po} AS UUID), 'WN-1', 'issued', 'F1', DATE '2026-04-01',
          CAST(${nativeCustomer} AS UUID), ${sql.json({ name: 'Cliente Nativo SL', tax_id: 'B00000019' })},
          10.00, 2.10, 0, 0, 12.10, TIMESTAMPTZ '2026-04-01 10:00:00+00', 'test', 'Venta de vino'
        )
      `);
      await ctx.client.query(sql`
        INSERT INTO billing.invoice_tax (
          id, invoice_id, tax_code, tax, regime_key, qualification, rate, base, quota
        ) VALUES (
          CAST(${next()} AS UUID), CAST(${nativeInvoice} AS UUID), 'IVA21', '01', '01', 'S1',
          21.00, 10.00, 2.10
        )
      `);
      await ctx.client.query(sql`
        INSERT INTO billing.invoice_line (
          id, invoice_id, line_no, description, quantity, unit_price, line_base, tax_code
        ) VALUES (
          CAST(${next()} AS UUID), CAST(${nativeInvoice} AS UUID), 1, 'Nativa', 1, 10, 10.00, 'IVA21'
        )
      `);

      const salesByYear: Record<string, Record<number, number>> = { PO: {}, CVPO: {} };
      for (const code of ['PO', 'CVPO'] as const) {
        for (const year of YEARS) {
          const response = await ctx.app.handle(new Request(
            `http://localhost/v1/invoices/export?entity=${code}&from=${year}-01-01&to=${year}-12-31`,
          ));
          expect(response.status).toBe(200);
          const table = rowsOf(await response.text());
          salesByYear[code]![year] = table.length;
          expect(table.every((row) => row[0] === String(year))).toBe(true);
        }
      }
      expect(salesByYear).toEqual({
        PO: { 2022: 2, 2023: 2, 2024: 1, 2025: 1, 2026: 2 },
        CVPO: { 2022: 1, 2023: 1, 2024: 3, 2025: 2, 2026: 1 },
      });

      const cvpo2025 = rowsOf(await (await ctx.app.handle(new Request(
        'http://localhost/v1/invoices/export?entity=CVPO&from=2025-03-01&to=2025-03-31',
      ))).text());
      expect(cvpo2025.map((row) => row[4])).toEqual(['F2025CVPO', 'F2025CVPO']);
      expect(cvpo2025.every((row) => row[21] === 'no aplica (histórico Holded)')).toBe(true);
      expect(cvpo2025[0]?.[9]).toBe('Cliente CVPO');
      expect(cvpo2025[0]?.[8]).toBe('B12345678');
      expect(cvpo2025.some((row) => row[11] === '100.00' && row[13] === '21.00' && row[18] === '121.00')).toBe(true);

      const po2026 = rowsOf(await (await ctx.app.handle(new Request(
        'http://localhost/v1/invoices/export?entity=PO&from=2026-01-01&to=2026-12-31',
      ))).text());
      const nativeRow = po2026.find((row) => row[4] === 'WN-1');
      const historicalRow = po2026.find((row) => row[4] === 'F2026PO');
      expect(nativeRow?.[21]).toBe('');
      expect(historicalRow?.[21]).toBe('no aplica (histórico Holded)');

      const purchasesByYear: Record<string, Record<number, number>> = { PO: {}, CVPO: {} };
      for (const code of ['PO', 'CVPO'] as const) {
        for (const year of YEARS) {
          const response = await ctx.app.handle(new Request(
            `http://localhost/v1/supplier-invoices/export?entity=${code}&period=${year}-T1`,
          ));
          expect(response.status).toBe(200);
          purchasesByYear[code]![year] = rowsOf(await response.text()).length;
        }
      }
      expect(purchasesByYear).toEqual({
        PO: { 2022: 1, 2023: 1, 2024: 1, 2025: 1, 2026: 1 },
        CVPO: { 2022: 1, 2023: 1, 2024: 1, 2025: 1, 2026: 1 },
      });
      const cvpoT2 = rowsOf(await (await ctx.app.handle(new Request(
        'http://localhost/v1/supplier-invoices/export?entity=CVPO&period=2024-T2',
      ))).text());
      expect(cvpoT2).toHaveLength(2);
      expect(cvpoT2.every((row) => row[3] === 'C2024CVPO-M')).toBe(true);
      expect(cvpoT2.map((row) => row[9]).sort()).toEqual(['10,00', '21,00']);
      const poOther = rowsOf(await (await ctx.app.handle(new Request(
        'http://localhost/v1/supplier-invoices/export?entity=PO&period=2024-T2',
      ))).text());
      expect(poOther).toHaveLength(0);
      const withheldBook = rowsOf(await (await ctx.app.handle(new Request(
        'http://localhost/v1/supplier-invoices/export?entity=PO&period=2026-T4',
      ))).text());
      expect(withheldBook.map((row) => row[3])).toEqual(['C2026PO-R']);
      expect(withheldBook[0]?.[12]).toBe('106,00');

      const open = await listOpenDocuments(ctx.writer, null);
      expect(open.filter((doc) => doc.origin === 'winecore' && doc.documentNumber === 'F2025CVPO')).toEqual([]);
      expect(open.filter((doc) => doc.origin === 'winecore' && doc.documentNumber === 'C2026PO-R')).toEqual([]);
      expect(open.filter((doc) => doc.origin === 'holded' && doc.documentNumber === 'F2025CVPO')).toHaveLength(1);

      await ctx.client.query(`
        INSERT INTO core.module_state (module_key, enabled, changed_by)
        VALUES ('verifactu', TRUE, 'test')
        ON CONFLICT (module_key) DO UPDATE SET enabled = TRUE
      `);
      const historicalOnly = await ctx.app.handle(new Request(
        'http://localhost/v1/invoices/export?entity=CVPO&from=2022-01-01&to=2022-12-31',
      ));
      expect(historicalOnly.status).toBe(200);
      const mixed = await ctx.app.handle(new Request(
        'http://localhost/v1/invoices/export?entity=PO&from=2026-01-01&to=2026-12-31',
      ));
      expect(mixed.status).toBe(422);
    } finally {
      await ctx.close();
    }
  });
});
