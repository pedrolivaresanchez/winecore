import { describe, expect, it } from 'bun:test';
import { renderDocumentPdfStrict, type DocumentPdfInput, type DocumentPdfLine } from '../../src/core/pdf/document';
import { EMPTY_DOCUMENT_PROFILE } from '../../src/core/pdf/profile';
import { extractPdfText } from './extract';

const SELLER: DocumentPdfInput['seller'] = {
  legalName: 'Comercializadora de Vinos Pedro Olivares SL',
  taxId: 'B00000000',
  addressLine: 'Calle Ejemplo 1',
  postalCode: '00000',
  city: 'Ejemplo',
  province: 'Ejemplo',
};

function invoice(overrides: Partial<DocumentPdfInput> = {}): DocumentPdfInput {
  return {
    title: 'Factura',
    number: 'F260001',
    issueDate: '2026-03-10',
    dueLabel: 'Vencimiento',
    dueDate: '2026-04-09',
    status: 'Pagado',
    partyLabel: 'Cliente',
    seller: SELLER,
    customerName: 'Cliente Ejemplo',
    description: null,
    lines: [],
    profile: { ...EMPTY_DOCUMENT_PROFILE, variant: 'cvpo' },
    totals: { subtotal: '0.00', vat: '0.00', withholding: null, total: '0.00' },
    note: 'Copia generada desde el histórico de Holded. No es un registro Verifactu.',
    ...overrides,
  };
}

async function textOf(input: DocumentPdfInput): Promise<string> {
  return extractPdfText(await renderDocumentPdfStrict(input));
}

describe('bloque de totales y columna IVA', () => {
  it('no imprime PAGADO ni PENDIENTE y recupera el 21 % cuando el IVA de la línea es un importe en bruto', async () => {
    const text = await textOf(invoice({
      number: 'F260524',
      customerName: 'Cliente Alquiler SL',
      lines: [{
        description: 'Alquiler local',
        quantity: '1',
        unit_price: '524.07',
        line_base: '524.07',
        tax_code: '10.4814',
      }],
      totals: { subtotal: '524.07', vat: '110.05', withholding: '99.57', total: '534.55' },
    }));

    expect(text).toContain('BASE IMPONIBLE\n524,07€');
    expect(text).toContain('IVA\n110,05€');
    expect(text).toContain('RETENCIÓN\n-99,57€');
    expect(text).toContain('TOTAL\n534,55€');
    expect(text).toContain('21%');
    expect(text).not.toContain('IVA 21%');
    expect(text).not.toContain('10.4814');
    expect(text).not.toContain('10,48');
    expect(text).not.toContain('634,12');
    expect(text).not.toContain('PAGADO');
    expect(text).not.toContain('PENDIENTE');
    expect(text).not.toContain('PAID');
    expect(text).not.toContain('PENDING');
    expect(text).toContain('No es un registro Verifactu.');
  });

  it('la plantilla PO y la CVPO muestran el tipo, no el importe con cuatro decimales', async () => {
    const lines: DocumentPdfLine[] = [
      { description: 'Tinto', quantity: '4', unit_price: '12.40', line_base: '49.60', tax_code: '10.416', unit: 'ud' },
      { description: 'Blanco', quantity: '4', unit_price: '14.88', line_base: '59.52', tax_code: '12.4992', unit: 'ud' },
      { description: 'Rosado', quantity: '2', unit_price: '11.57', line_base: '23.14', tax_code: '4.8594', unit: 'ud' },
    ];
    const totals = { subtotal: '132.23', vat: '27.77', withholding: '0.00', total: '160.00' };
    for (const variant of ['po', 'cvpo'] as const) {
      const text = await textOf(invoice({
        number: 'F260160',
        customerName: 'Cliente Tres Líneas SL',
        lines,
        totals,
        profile: { ...EMPTY_DOCUMENT_PROFILE, variant },
      }));
      expect(text).toContain('21%');
      expect(text).toContain('BASE IMPONIBLE\n132,23€');
      expect(text).toContain('IVA\n27,77€');
      expect(text).toContain('TOTAL\n160,00€');
      expect(text).not.toContain('RETENCIÓN');
      expect(text).not.toContain('10.416');
      expect(text).not.toContain('12.4992');
      expect(text).not.toContain('4.8594');
      expect(text).not.toContain('PAGADO');
      expect(text).not.toContain('PENDIENTE');
    }
  });

  it('un abono CN26 y un albarán tampoco llevan cobrado ni pendiente', async () => {
    const credit = await textOf(invoice({
      title: 'Factura rectificativa',
      number: 'CN26-0001',
      lines: [{
        description: 'Abono tinto',
        quantity: '-4',
        unit_price: '12.40',
        line_base: '-49.60',
        tax_code: '-10.416',
      }],
      totals: { subtotal: '-49.60', vat: '-10.42', withholding: null, total: '-60.02' },
    }));
    expect(credit).toContain('FACTURA RECTIFICATIVA #CN26-0001');
    expect(credit).toContain('21%');
    expect(credit).toContain('BASE IMPONIBLE\n-49,60€');
    expect(credit).toContain('TOTAL\n-60,02€');
    expect(credit).not.toContain('PAGADO');
    expect(credit).not.toContain('PENDIENTE');
    expect(credit).not.toContain('-10.416');

    const note = await textOf(invoice({
      title: 'Albarán',
      number: 'A260142',
      dueLabel: null,
      dueDate: null,
      lines: [{
        description: 'Tinto ejemplo',
        quantity: '6',
        unit_price: '8.25',
        line_base: '49.50',
        tax_code: 'IVA21',
        tax_rate: '21',
        unit: 'ud',
      }],
      totals: { subtotal: '49.50', vat: '10.40', withholding: null, total: '59.90' },
      note: 'Albarán de entrega. No es una factura.',
    }));
    expect(note).toContain('ALBARÁN #A260142');
    expect(note).toContain('21%');
    expect(note).toContain('BASE IMPONIBLE\n49,50€');
    expect(note).not.toContain('PAGADO');
    expect(note).not.toContain('PENDIENTE');
    expect(note).not.toContain('IVA21');
  });

  it('un importe que no es un tipo de IVA sale con dos decimales y euro', async () => {
    const text = await textOf(invoice({
      lines: [{
        description: 'Concepto',
        quantity: '1',
        unit_price: '100.00',
        line_base: '100.00',
        tax_code: '3.3333',
      }],
      totals: { subtotal: '100.00', vat: '3.33', withholding: null, total: '103.33' },
    }));
    expect(text).toContain('3,33€');
    expect(text).not.toContain('3.3333');
    expect(text).toContain('IVA\n3,33€');
    expect(text).toContain('TOTAL\n103,33€');
  });

  it('en inglés tampoco imprime PAID ni PENDING y el tipo sigue siendo 21%', async () => {
    const text = await textOf(invoice({
      lang: 'en',
      title: 'Invoice',
      lines: [{
        description: 'Rent',
        quantity: '1',
        unit_price: '524.07',
        line_base: '524.07',
        tax_code: '10.4814',
      }],
      totals: { subtotal: '524.07', vat: '110.05', withholding: '99.57', total: '534.55' },
    }));
    expect(text).toContain('TAXABLE AMOUNT\n€524.07');
    expect(text).toContain('VAT\n€110.05');
    expect(text).toContain('WITHHOLDING\n-€99.57');
    expect(text).toContain('TOTAL\n€534.55');
    expect(text).toContain('21%');
    expect(text).not.toContain('PAID');
    expect(text).not.toContain('PENDING');
    expect(text).not.toContain('10.4814');
  });

  it('una etiqueta «21%» sigue sumando el IVA al total de la línea', async () => {
    const text = await textOf(invoice({
      lines: [{
        description: 'Botella',
        quantity: '2',
        unit_price: '5.00',
        line_base: '10.00',
        tax_code: '21%',
      }],
      totals: { subtotal: '10.00', vat: '2.10', withholding: null, total: '12.10' },
    }));
    expect(text).toContain('21%');
    expect(text).toContain('12,10€');
    expect(text).toContain('IVA 21%\n2,10€');
  });
});
