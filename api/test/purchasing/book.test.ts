import { describe, expect, it } from 'bun:test';
import { parseQuarter, renderReceivedBook, type BookInvoice } from '../../src/core/purchasing/books';
import { DomainError } from '../../src/core/errors';

function invoice(overrides: Partial<BookInvoice> = {}): BookInvoice {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    number: 'F-2027-118',
    issueDate: '2027-02-03',
    accountingDate: '2027-02-03',
    categoryName: 'Productos enológicos (SO2, tartárico)',
    taxId: 'B11111119',
    supplierName: 'Suministros Sintéticos SL',
    subtotal: '150.00',
    taxTotal: '26.00',
    withholdingTotal: '0.00',
    total: '176.00',
    ...overrides,
  };
}

describe('libro de recibidas', () => {
  it('interpreta el trimestre', () => {
    expect(parseQuarter('2027-T1')).toEqual({ year: 2027, quarter: 1, from: '2027-01-01', to: '2027-03-31' });
    expect(parseQuarter('2027Q2')?.quarter).toBe(2);
    expect(parseQuarter('2027-t4')?.to).toBe('2027-12-31');
    expect(parseQuarter('2027-T5')).toBeNull();
    expect(parseQuarter('2027-01')).toBeNull();
  });

  it('cuadra bases, cuotas y total por tipo de IVA', () => {
    const book = renderReceivedBook({ year: 2027, quarter: 1 }, [invoice()], new Map([
      [invoice().id, [
        { vatRate: '21', lineBase: '100.00', vatQuota: '21.00', withholdingRate: '0' },
        { vatRate: '10.00', lineBase: '50.00', vatQuota: '5.00', withholdingRate: '0' },
      ]],
    ]));
    expect(book.totals).toEqual({
      invoices: 1,
      base: '150.00',
      quota: '26.00',
      withholding: '0.00',
      total: '176.00',
    });
    const lines = book.csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toContain('Ejercicio;Periodo;Fecha de expedición');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('10,00');
    expect(lines[2]).toContain('21,00');
    expect(book.csv).toContain('176,00');
    expect(book.csv).toContain('B11111119');
    expect(book.csv).toContain('03/02/2027');
    expect(book.csv).toContain('1T');
  });

  it('no exporta un gasto que no cuadra', () => {
    expect(() => renderReceivedBook({ year: 2027, quarter: 1 }, [invoice({ subtotal: '1.00' })], new Map([
      [invoice().id, [{ vatRate: '21.00', lineBase: '150.00', vatQuota: '26.00', withholdingRate: '0.00' }]],
    ]))).toThrow(DomainError);
  });
});
