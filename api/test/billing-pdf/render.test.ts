import { describe, expect, it } from 'bun:test';
import { computeInvoice } from '../../src/core/billing/compute';
import { EXP_E2, INTRA_E5, IVA21, IVA21_ALQ, IVA21_RE, NS_LOC, type TaxCode } from '../../src/core/billing/taxCodes';
import { money } from '../../src/core/money';
import { QR_LABEL, QR_LEGEND, QR_MARGIN_MM, QR_SIZE_MM, QR_SIZE_PT, qrSlot } from '../../src/core/billing/pdf/qr';
import { renderInvoicePdf } from '../../src/core/billing/pdf/render';
import type { IssuedInvoice, InvoiceLang, InvoiceLineView } from '../../src/core/billing/pdf/types';
import { DomainError } from '../../src/core/errors';
import { extractPdfText, extractPlacedText, pdfStreams } from './extract';

const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
));

function dec(value: string) {
  return money.fromString(value);
}

function build(options: {
  taxCode: TaxCode;
  qty?: string;
  unitPrice?: string;
  description?: string;
  lines?: readonly { qty: string; unitPrice: string; description: string; lotCode?: string | null }[];
  operationDate?: string | null;
  incoterm?: string | null;
  notes?: string | null;
  registry?: string | null;
  tradeName?: string | null;
  logo?: Uint8Array | null;
  verifactu?: IssuedInvoice['verifactu'];
  pdfAttachmentId?: string | null;
  rectifications?: IssuedInvoice['rectifications'];
  importeTotal?: string;
}): IssuedInvoice {
  const inputs = options.lines ?? [{
    qty: options.qty ?? '12',
    unitPrice: options.unitPrice ?? '10.00',
    description: options.description ?? 'Tinto Ejemplo 2025 0,75 L',
    lotCode: 'L25-T01-B1',
  }];
  const computed = computeInvoice({
    lines: inputs.map((line) => ({
      qty: dec(line.qty),
      unitPrice: dec(line.unitPrice),
      discountPct: dec('0'),
      taxCode: options.taxCode,
    })),
    paymentTerms: { days: [30] },
    issueDate: '2026-03-10',
  });
  const lines: InvoiceLineView[] = inputs.map((line, index) => ({
    lineNo: index + 1,
    sku: null,
    description: line.description,
    lotCode: line.lotCode ?? null,
    quantity: line.qty,
    unit: 'ud',
    unitPrice: line.unitPrice,
    discountPct: '0',
    taxCode: options.taxCode.code,
    lineBase: money.toString(computed.lines[index]?.lineBase ?? dec('0')),
  }));
  return {
    id: '019a0000-0000-7000-8000-000000000105',
    legalEntityCode: 'CVPO',
    seriesCode: 'CF',
    number: 'CF26-0001',
    invoiceType: 'F1',
    issueDate: '2026-03-10',
    operationDate: options.operationDate ?? null,
    language: 'es',
    description: 'Venta de vino',
    currency: 'EUR',
    issuer: {
      legalName: 'Comercializadora (CVPO)',
      tradeName: options.tradeName === undefined ? 'CVPO' : options.tradeName,
      taxId: 'B00000000',
      taxIdType: 'nif',
      address: {
        line1: 'Calle Ejemplo 1',
        line2: null,
        postalCode: '00000',
        city: 'Ejemplo',
        province: 'Ejemplo',
        countryCode: 'ES',
      },
      registryData: options.registry ?? null,
    },
    customer: {
      legalName: 'Cliente Ejemplo S.L.',
      tradeName: null,
      taxId: 'B11111111',
      taxIdType: 'nif',
      address: {
        line1: 'Calle Cliente 2',
        line2: null,
        postalCode: '28001',
        city: 'Madrid',
        province: 'Madrid',
        countryCode: 'ES',
      },
      registryData: null,
    },
    lines,
    taxes: computed.taxes.map((tax) => ({
      taxCode: tax.taxCode.code,
      rate: tax.rate.toFixed(),
      base: money.toString(tax.base),
      quota: money.toString(tax.quota),
      surchargeRate: tax.surchargeRate.toFixed(),
      surchargeQuota: money.toString(tax.surchargeQuota),
      withholdingRate: tax.withholdingRate.toFixed(),
      withholding: money.toString(tax.withholding),
      legalMentionEs: tax.taxCode.legalMentionEs,
      legalMentionEn: tax.taxCode.legalMentionEn,
      exemption: tax.taxCode.exemption,
      qualification: tax.taxCode.qualification,
    })),
    subtotal: money.toString(computed.subtotal),
    taxTotal: money.toString(computed.taxTotal),
    surchargeTotal: money.toString(computed.surchargeTotal),
    withholdingTotal: money.toString(computed.withholdingTotal),
    importeTotal: options.importeTotal ?? money.toString(computed.importeTotal),
    totalToPay: money.toString(computed.totalToPay),
    dues: computed.dues.map((due, index) => ({
      seq: index + 1,
      dueDate: due.dueDate,
      amount: money.toString(due.amount),
    })),
    legalMentions: [],
    notes: options.notes ?? null,
    incoterm: options.incoterm ?? null,
    paymentMethod: 'transfer',
    rectifications: options.rectifications ?? [],
    branding: { logo: options.logo ?? null, accentRgb: null },
    verifactu: options.verifactu ?? { active: false, qrUrl: null, qrModules: null },
    pdfAttachmentId: options.pdfAttachmentId ?? null,
  };
}

async function textOf(invoice: IssuedInvoice, lang: InvoiceLang): Promise<string> {
  return extractPdfText(await renderInvoicePdf(invoice, lang));
}

const GOLDEN_ES = `CVPO
FACTURA
Serie: CF
Número: CF26-0001
Fecha de expedición: 10/03/2026
Emisor
Comercializadora (CVPO)
NIF B00000000
Calle Ejemplo 1
00000 Ejemplo
Ejemplo
España
Cliente
Cliente Ejemplo S.L.
NIF B11111111
Calle Cliente 2
28001 Madrid
Madrid
España
Descripción de la operación
Venta de vino
Descripción | Cantidad | Unidad | Precio | Descuento | Impuesto | Base
Tinto Ejemplo 2025 0,75 L | Lote L25-T01-B1 | 12 | ud | 10,00 EUR | 0 % | IVA21 | 120,00 EUR
Impuesto | Base | Tipo | Cuota
IVA21 | 120,00 EUR | 21 % | 25,20 EUR
Base imponible: 120,00 EUR
IVA: 25,20 EUR
Importe total de la factura: 145,20 EUR
Vencimiento: 09/04/2026 145,20 EUR
Forma de pago: Transferencia`;

const GOLDEN_EN = `CVPO
INVOICE
Series: CF
Number: CF26-0001
Issue date: 10 March 2026
Issuer
Comercializadora (CVPO)
NIF B00000000
Calle Ejemplo 1
00000 Ejemplo
Ejemplo
Spain
Customer
Cliente Ejemplo S.L.
NIF B11111111
Calle Cliente 2
28001 Madrid
Madrid
Spain
Description of the operation
Venta de vino
Description | Quantity | Unit | Price | Discount | Tax | Base
Tinto Ejemplo 2025 0,75 L | Lot L25-T01-B1 | 12 | ud | 10.00 EUR | 0 % | IVA21 | 120.00 EUR
Tax | Base | Rate | VAT
IVA21 | 120.00 EUR | 21 % | 25.20 EUR
Taxable amount: 120.00 EUR
VAT: 25.20 EUR
Invoice total amount: 145.20 EUR
Due date: 9 April 2026 145.20 EUR
Payment method: Bank transfer`;

describe('renderInvoicePdf', () => {
  it('fija el texto en español de una factura con IVA 21', async () => {
    expect(await textOf(build({ taxCode: IVA21 }), 'es')).toBe(GOLDEN_ES);
  });

  it('fija el texto en inglés de la misma factura', async () => {
    expect(await textOf(build({ taxCode: IVA21 }), 'en')).toBe(GOLDEN_EN);
  });

  it('muestra recargo, retención, exención, intracomunitaria y no sujeción', async () => {
    const surcharge = await textOf(build({ taxCode: IVA21_RE, qty: '1', unitPrice: '100.00', description: 'Generoso' }), 'es');
    expect(surcharge).toContain('Recargo de equivalencia: 5,20 EUR');
    expect(surcharge).toContain('Importe total de la factura: 126,20 EUR');
    expect(surcharge).not.toContain('Total a pagar');

    const withholding = await textOf(build({ taxCode: IVA21_ALQ, qty: '1', unitPrice: '1000.00', description: 'Local' }), 'es');
    expect(withholding).toContain('Retención IRPF: 190,00 EUR');
    expect(withholding).toContain('Importe total de la factura: 1.210,00 EUR');
    expect(withholding).toContain('Total a pagar: 1.020,00 EUR');

    const exported = await textOf(build({ taxCode: EXP_E2, qty: '1', unitPrice: '80.00', description: 'Exportación' }), 'es');
    expect(exported).toContain('Operación exenta de IVA por exportación (art. 21 Ley 37/1992).');
    expect(exported).toContain('Importe total de la factura: 80,00 EUR');

    const intra = await textOf(build({ taxCode: INTRA_E5, qty: '1', unitPrice: '50.00', description: 'Entrega UE' }), 'es');
    expect(intra).toContain('Entrega intracomunitaria exenta de IVA (art. 25 Ley 37/1992).');

    const notSubject = await textOf(build({ taxCode: NS_LOC, qty: '1', unitPrice: '40.00', description: 'Servicio' }), 'es');
    expect(notSubject).toContain('Operación no sujeta al IVA español por reglas de localización.');

    const englishExport = await textOf(build({ taxCode: EXP_E2, qty: '1', unitPrice: '80.00', description: 'Exportación' }), 'en');
    expect(englishExport).toContain('VAT exempt export (Art. 21 Spanish VAT Act 37/1992).');
    expect(englishExport).not.toContain('Operación exenta de IVA por exportación');
    expect(englishExport).toContain('Invoice total amount:');
    expect(englishExport).not.toContain('Importe total de la factura');
  });

  it('incluye fecha de operación, rectificativa, incoterm y datos registrales', async () => {
    const text = await textOf(build({
      taxCode: IVA21,
      operationDate: '2026-03-01',
      incoterm: 'FCA',
      notes: 'Entrega en muelle',
      registry: 'Tomo 1, folio 1',
      rectifications: [{
        rectifiedNumber: 'CF25-0007',
        rectifiedIssueDate: '2026-02-01',
        rectifiedIssuerTaxId: 'B00000000',
        relation: 'rectified',
        reason: 'Devolución',
      }],
    }), 'es');
    expect(text).toContain('Fecha de operación: 01/03/2026');
    expect(text).toContain('Rectifica la factura CF25-0007 del 01/02/2026, NIF B00000000');
    expect(text).toContain('Motivo: Devolución');
    expect(text).toContain('Incoterm: FCA');
    expect(text).toContain('Notas: Entrega en muelle');
    expect(text).toContain('Datos registrales: Tomo 1, folio 1');
  });

  it('es determinista y no depende del identificador interno ni del orden de las líneas', async () => {
    const invoice = build({ taxCode: IVA21 });
    const first = await renderInvoicePdf(invoice, 'es');
    const second = await renderInvoicePdf(invoice, 'es');
    expect(Buffer.compare(first, second)).toBe(0);

    const otherId = await renderInvoicePdf({ ...invoice, pdfAttachmentId: '019a0000-0000-7000-8000-000000000199' }, 'es');
    expect(Buffer.compare(first, otherId)).toBe(0);

    const reversed = await renderInvoicePdf({
      ...invoice,
      lines: [...invoice.lines].reverse(),
      taxes: [...invoice.taxes].reverse(),
    }, 'es');
    expect(Buffer.compare(first, reversed)).toBe(0);

    const raw = Buffer.from(first).toString('latin1');
    expect(raw).toContain('D:20260310000000Z');
    expect(raw).not.toContain('D:20261031');
    // pdf-lib stores the producer as UTF-16 hex, not as literal ASCII.
    expect(raw).toContain('00570069006E00650043006F00720065');
    expect(raw).not.toContain('pdf-lib');
  });

  it('reserva el QR arriba y solo pinta la leyenda si Verifactu está activo', async () => {
    expect(QR_SIZE_MM).toBeGreaterThanOrEqual(30);
    expect(QR_SIZE_MM).toBeLessThanOrEqual(40);
    expect(QR_MARGIN_MM).toBeGreaterThanOrEqual(2);

    const slot = qrSlot(841.89);
    expect(slot.x).toBeGreaterThanOrEqual((2 * 72) / 25.4);
    expect(841.89 - (slot.y + slot.size)).toBeGreaterThanOrEqual((2 * 72) / 25.4);

    const invoice = build({ taxCode: IVA21 });
    const bytes = await renderInvoicePdf(invoice, 'es');
    const placed = extractPlacedText(bytes);
    const highest = Math.max(...placed.map((item) => item.y));
    expect(highest).toBeLessThan(slot.y);
    expect(highest).toBeLessThanOrEqual(slot.contentTop);
    expect(extractPdfText(bytes)).not.toContain(QR_LABEL);
    expect(extractPdfText(bytes)).not.toContain(QR_LEGEND);

    const numbers = pdfStreams(bytes).join('\n').match(/\d+\.\d+/gu)?.map(Number) ?? [];
    expect(numbers.some((value) => Math.abs(value - QR_SIZE_PT) < 0.001)).toBe(true);

    const withJunk = await renderInvoicePdf({
      ...invoice,
      verifactu: { active: false, qrUrl: 'https://example.test/qr', qrModules: [[true, false], [false, true]] },
    }, 'es');
    expect(Buffer.compare(bytes, withJunk)).toBe(0);

    const active = {
      ...invoice,
      verifactu: {
        active: true,
        qrUrl: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B00000000&numserie=CF26-0001&fecha=10-03-2026&importe=145.20',
        qrModules: [[true, false], [false, true]] as const,
      },
    };
    const activeText = await textOf(active, 'en');
    expect(activeText).toContain(QR_LABEL);
    expect(activeText).toContain(QR_LEGEND);
    const activePlaced = extractPlacedText(await renderInvoicePdf(active, 'en'));
    const label = activePlaced.find((item) => item.text === QR_LABEL);
    const legend = activePlaced.find((item) => item.text === QR_LEGEND);
    expect(label?.y).toBeGreaterThan(slot.y + slot.size);
    expect(legend?.y).toBeLessThan(slot.y);

    let missing: unknown;
    try {
      await renderInvoicePdf({
        ...invoice,
        verifactu: { active: true, qrUrl: 'https://example.test/qr', qrModules: null },
      }, 'es');
    } catch (error) {
      missing = error;
    }
    expect(missing).toBeInstanceOf(DomainError);
    expect((missing as DomainError).code).toBe('WC_VALIDATION');
  });

  it('usa el hueco de marca y no repite el nombre comercial si hay logotipo', async () => {
    const branded = build({ taxCode: IVA21, tradeName: 'Marca Ejemplo', logo: PNG_1X1 });
    const bytes = await renderInvoicePdf(branded, 'es');
    const text = extractPdfText(bytes);
    expect(text).toContain('Comercializadora (CVPO)');
    expect(text).not.toContain('Marca Ejemplo');
    expect(Buffer.from(bytes).toString('latin1')).toContain('/Image');
    const again = await renderInvoicePdf(branded, 'es');
    expect(Buffer.compare(bytes, again)).toBe(0);
  });

  it('sigue en otra página sin repetir el bloque del QR', async () => {
    const lines = Array.from({ length: 50 }, (_, index) => ({
      qty: '1',
      unitPrice: '10.00',
      description: `Linea ${index + 1}`,
      lotCode: null,
    }));
    const text = await textOf(build({ taxCode: IVA21, lines }), 'es');
    expect(text).toContain('Factura CF26-0001 (continuación)');
    expect(text).toContain('Linea 50');
    expect(text).not.toContain(QR_LABEL);
  });
});
