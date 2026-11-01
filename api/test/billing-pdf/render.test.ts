import { describe, expect, it } from 'bun:test';
import { computeInvoice } from '../../src/core/billing/compute';
import { EXP_E2, INTRA_E5, IVA21, IVA21_ALQ, IVA21_RE, NS_LOC, type TaxCode } from '../../src/core/billing/taxCodes';
import { money } from '../../src/core/money';
import { QR_LABEL, QR_LEGEND, QR_MARGIN_MM, QR_SIZE_MM, QR_SIZE_PT } from '../../src/core/billing/pdf/qr';
import { EMPTY_DOCUMENT_PROFILE, type DocumentProfileView } from '../../src/core/pdf/profile';
import { renderInvoicePdf } from '../../src/core/billing/pdf/render';
import type { IssuedInvoice, InvoiceLang, InvoiceLineView } from '../../src/core/billing/pdf/types';
import { DomainError } from '../../src/core/errors';
import { extractPdfText, extractPlacedText, pdfStreams } from './extract';

const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
));

const PNG_2X2 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGOokNMAIgYIBQAWFgL5OFlYMgAAAABJRU5ErkJggg==',
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
  customer?: Partial<IssuedInvoice['customer']>;
  profile?: Partial<DocumentProfileView>;
  shipTo?: IssuedInvoice['shipTo'];
  customerReferences?: string | null;
  deliveryNoteNumbers?: readonly string[];
  discountPct?: string;
  dues?: IssuedInvoice['dues'];
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
      discountPct: dec(options.discountPct ?? '0'),
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
    discountPct: options.discountPct ?? '0',
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
      ...options.customer,
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
    dues: options.dues ?? computed.dues.map((due, index) => ({
      seq: index + 1,
      dueDate: due.dueDate,
      amount: money.toString(due.amount),
    })),
    legalMentions: [],
    notes: options.notes ?? null,
    incoterm: options.incoterm ?? null,
    paymentMethod: 'transfer',
    rectifications: options.rectifications ?? [],
    profile: { ...EMPTY_DOCUMENT_PROFILE, logo: options.logo ?? null, ...options.profile },
    shipTo: options.shipTo ?? null,
    customerReferences: options.customerReferences ?? null,
    deliveryNoteNumbers: options.deliveryNoteNumbers ?? [],
    verifactu: options.verifactu ?? { active: false, qrUrl: null, qrModules: null },
    pdfAttachmentId: options.pdfAttachmentId ?? null,
  };
}

async function textOf(invoice: IssuedInvoice, lang: InvoiceLang): Promise<string> {
  return extractPdfText(await renderInvoicePdf(invoice, lang));
}

const SHIP_TO: IssuedInvoice['shipTo'] = {
  name: 'Almacén Central Ejemplo',
  line1: 'Avenida del Almacén 20',
  line2: null,
  postalCode: '18000',
  city: 'Granada',
  province: 'Granada',
  countryCode: 'ES',
};

const FOOTER = ['www.ejemplo.example.com', '', 'Nº de cuenta: IBAN ES00-SINTETICO', '', 'Nº Operador SHC: AN0000EJEMPLO'];

const GOLDEN_ES_PO = `CVPO
FACTURA #CF26-0001
Fecha: 10/03/2026
Comercializadora (CVPO)
B00000000
Calle Ejemplo 1
Ejemplo (00000), Ejemplo
Cliente:
Cliente Ejemplo S.L.
B11111111
Calle Cliente 2
Madrid (28001), Madrid, España
CONCEPTO
PRECIO
UNIDADES
DTO.
IVA
TOTAL
Tinto Ejemplo 2025 0,75 L
LOTE: L25-T01-B1
10,00€
12
21%
145,20€
BASE IMPONIBLE
120,00€
IVA 21%
25,20€
TOTAL
145,20€
Vencimiento: 09/04/2026 145,20€
Forma de pago: Transferencia
Pág. 1 de 1`;

const GOLDEN_EN_PO = `CVPO
INVOICE #CF26-0001
Date: 10 March 2026
Comercializadora (CVPO)
B00000000
Calle Ejemplo 1
Ejemplo (00000), Ejemplo
Customer:
Cliente Ejemplo S.L.
B11111111
Calle Cliente 2
Madrid (28001), Madrid, Spain
DESCRIPTION
PRICE
QUANTITY
DISC.
VAT
TOTAL
Tinto Ejemplo 2025 0,75 L
LOT: L25-T01-B1
€10.00
12
21%
€145.20
TAXABLE AMOUNT
€120.00
VAT 21%
€25.20
TOTAL
€145.20
Due date: 9 April 2026 €145.20
Payment method: Bank transfer
Page 1 of 1`;

const GOLDEN_ES_CVPO = `CVPO
FACTURA #CF26-0001
Fecha: 10/03/2026
Comercializadora (CVPO)
B00000000
Calle Ejemplo 1
Ejemplo (00000), Ejemplo
Cliente:
Cliente Ejemplo S.L.
B11111111
Calle Cliente 2
Madrid (28001), Madrid, España
CONCEPTO
UNIDADES
PRECIO
SUBTOTAL
IVA
TOTAL
Tinto Ejemplo 2025 0,75 L
LOTE: L25-T01-B1
12 ud
10,00€
120,00€
21%
145,20€
BASE IMPONIBLE
120,00€
IVA 21%
25,20€
TOTAL
145,20€
Vencimiento: 09/04/2026 145,20€
Forma de pago: Transferencia
Pág. 1 de 1`;

/** Coordenada y (origen abajo) de la aparición `nth` de un texto. */
function yOf(bytes: Uint8Array, text: string, nth = 0): number {
  const found = extractPlacedText(bytes).filter((item) => item.text === text)[nth];
  if (!found) throw new Error(`No hay texto «${text}»`);
  return found.y;
}

describe('renderInvoicePdf', () => {
  it('fija el texto en español de una factura con IVA 21 (plantilla PO)', async () => {
    expect(await textOf(build({ taxCode: IVA21 }), 'es')).toBe(GOLDEN_ES_PO);
  });

  it('fija el texto en inglés de la misma factura', async () => {
    expect(await textOf(build({ taxCode: IVA21 }), 'en')).toBe(GOLDEN_EN_PO);
  });

  it('la plantilla CVPO cambia el orden de las columnas y añade la unidad', async () => {
    expect(await textOf(build({ taxCode: IVA21, profile: { variant: 'cvpo' } }), 'es')).toBe(GOLDEN_ES_CVPO);
  });

  it('coloca el texto en las coordenadas de las plantillas de Holded', async () => {
    const bytes = await renderInvoicePdf(build({ taxCode: IVA21 }), 'es');
    const top = (text: string, nth = 0): number => 841.89 - yOf(bytes, text, nth);
    expect(top('FACTURA #CF26-0001')).toBeCloseTo(42.2, 1);
    expect(top('Fecha: 10/03/2026')).toBeCloseTo(54.71, 1);
    expect(top('Comercializadora (CVPO)')).toBeCloseTo(98.39, 1);
    expect(top('B00000000')).toBeCloseTo(111.41, 1);
    expect(top('Cliente:')).toBeCloseTo(156.35, 1);
    expect(top('CONCEPTO')).toBeCloseTo(top('PRECIO'), 3);
    expect(top('BASE IMPONIBLE')).toBeGreaterThan(top('CONCEPTO'));
    expect(top('Pág. 1 de 1')).toBeCloseTo(824.86, 1);
    const header = top('CONCEPTO');
    expect(top('Tinto Ejemplo 2025 0,75 L') - header).toBeCloseTo(23.08 - 14.65 + 14.66, 1);
    expect(top('TOTAL', 1) - top('BASE IMPONIBLE')).toBeCloseTo(2 * 22.8, 1);
  });

  it('muestra recargo, retención, exención, intracomunitaria y no sujeción', async () => {
    const surcharge = await textOf(build({ taxCode: IVA21_RE, qty: '1', unitPrice: '100.00', description: 'Generoso' }), 'es');
    expect(surcharge).toContain('RECARGO DE EQUIVALENCIA 5,2%\n5,20€');
    expect(surcharge).toContain('TOTAL\n126,20€');
    expect(surcharge).not.toContain('TOTAL A PAGAR');

    const withholding = await textOf(build({ taxCode: IVA21_ALQ, qty: '1', unitPrice: '1000.00', description: 'Local' }), 'es');
    expect(withholding).toContain('RETENCIÓN IRPF 19%\n-190,00€');
    expect(withholding).toContain('TOTAL\n1.210,00€');
    expect(withholding).toContain('TOTAL A PAGAR\n1.020,00€');

    const exported = await textOf(build({ taxCode: EXP_E2, qty: '1', unitPrice: '80.00', description: 'Exportación' }), 'es');
    expect(exported).toContain('Operación exenta de IVA por exportación (art. 21 Ley 37/1992).');
    expect(exported).toContain('TOTAL\n80,00€');

    const intra = await textOf(build({ taxCode: INTRA_E5, qty: '1', unitPrice: '50.00', description: 'Entrega UE' }), 'es');
    expect(intra).toContain('Entrega intracomunitaria exenta de IVA (art. 25 Ley 37/1992).');

    const notSubject = await textOf(build({ taxCode: NS_LOC, qty: '1', unitPrice: '40.00', description: 'Servicio' }), 'es');
    expect(notSubject).toContain('Operación no sujeta al IVA español por reglas de localización.');

    const englishExport = await textOf(build({ taxCode: EXP_E2, qty: '1', unitPrice: '80.00', description: 'Exportación' }), 'en');
    expect(englishExport).toContain('VAT exempt export (Art. 21 Spanish VAT Act 37/1992).');
    expect(englishExport).not.toContain('Operación exenta de IVA por exportación');
    expect(englishExport).toContain('TAXABLE AMOUNT');
    expect(englishExport).not.toContain('BASE IMPONIBLE');
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

  it('titula la rectificativa y la simplificada y sustituye en lugar de rectificar', async () => {
    const rectification = {
      rectifiedNumber: 'CF25-0007',
      rectifiedIssueDate: '2026-02-01',
      rectifiedIssuerTaxId: 'B00000000',
      relation: 'substituted' as const,
      reason: 'Error en el precio',
    };
    const base = build({ taxCode: IVA21, rectifications: [rectification] });
    const corrective = await textOf({ ...base, invoiceType: 'R1' }, 'es');
    expect(corrective).toContain('FACTURA RECTIFICATIVA #CF26-0001');
    expect(corrective).toContain('Sustituye la factura CF25-0007 del 01/02/2026, NIF B00000000');
    const english = await textOf({ ...base, invoiceType: 'R1' }, 'en');
    expect(english).toContain('CORRECTIVE INVOICE #CF26-0001');
    expect(english).toContain('Replaces invoice CF25-0007 of 1 February 2026, NIF B00000000');
    const simplified = await textOf({ ...base, invoiceType: 'F2', rectifications: [] }, 'es');
    expect(simplified).toContain('FACTURA SIMPLIFICADA #CF26-0001');
  });

  it('imprime dirección de envío, referencias del cliente y albarán de origen', async () => {
    const text = await textOf(build({
      taxCode: IVA21,
      shipTo: SHIP_TO,
      customerReferences: 'PEDIDO 0001\nCENTRO 0059\n\nPROVEEDOR 0007',
      deliveryNoteNumbers: ['A260143', 'A260142', 'A260142'],
      customer: { phone: '+34 000 000 000', email: 'compras@example.com' },
    }), 'es');
    expect(text).toContain('Dirección de envío\nAlmacén Central Ejemplo\nAvenida del Almacén 20\nGranada (18000), Granada, España');
    expect(text).toContain('PEDIDO 0001\nCENTRO 0059\nPROVEEDOR 0007');
    expect(text).toContain('Madrid (28001), Madrid, España\n+34 000 000 000\ncompras@example.com');
    expect(text).toContain('Albaranes:\nA260142, A260143');
    const single = await textOf(build({ taxCode: IVA21, deliveryNoteNumbers: ['A260142'] }), 'es');
    expect(single).toContain('Albarán:\nA260142');
    const english = await textOf(build({ taxCode: IVA21, shipTo: SHIP_TO }), 'en');
    expect(english).toContain('Shipping address\n');
  });

  it('imprime el perfil documental: contacto del emisor y líneas del pie', async () => {
    const text = await textOf(build({
      taxCode: IVA21,
      profile: { email: 'info@example.com', phone: '+34 000 000 000', footerLines: FOOTER },
    }), 'es');
    expect(text).toContain('Ejemplo (00000), Ejemplo\ninfo@example.com\n+34 000 000 000');
    expect(text).toContain('www.ejemplo.example.com\nNº de cuenta: IBAN ES00-SINTETICO\nNº Operador SHC: AN0000EJEMPLO');
  });

  it('con pie, vencimientos, referencias y albarán estrecha los huecos antes que abrir una hoja para una línea', async () => {
    const text = await textOf(build({
      taxCode: IVA21,
      lines: [
        { qty: '48', unitPrice: '7.90', description: 'Tinto Ejemplo 2023', lotCode: 'E2023A' },
        { qty: '18', unitPrice: '7.35', description: 'Blanco Ejemplo Reserva Especial 2024' },
        { qty: '30', unitPrice: '6.30', description: 'Rosado Ejemplo Reserva Especial 2024', lotCode: 'E2024R' },
      ],
      shipTo: SHIP_TO,
      customerReferences: 'PEDIDO 0001\nCENTRO 0059\nPROVEEDOR 0007\nCONTRATO 0042\nRUTA 12',
      deliveryNoteNumbers: ['A260142'],
      dues: [{ seq: 1, dueDate: '2026-04-09', amount: '100.00' }],
      profile: { variant: 'cvpo', email: 'info@example.com', footerLines: [...FOOTER, '', 'Pie de ejemplo 1', '', 'Pie de ejemplo 2', ''] },
    }), 'es');
    expect(text).toContain('Pág. 1 de 1');
    expect(text).toContain('Pie de ejemplo 2\nAlbarán:\nA260142');
  });

  it('pone el descuento por línea y su total solo si hay descuentos', async () => {
    const plain = await textOf(build({ taxCode: IVA21, qty: '6', unitPrice: '8.25' }), 'es');
    expect(plain).not.toContain('DESCUENTO POR ITEM');

    const po = await textOf(build({ taxCode: IVA21, qty: '6', unitPrice: '8.25', discountPct: '0.3' }), 'es');
    expect(po).toContain('0,3%');
    expect(po).toContain('DESCUENTO POR ITEM\n0,15€\nBASE IMPONIBLE\n49,35€\nIVA 21%\n10,36€\nTOTAL\n59,71€');

    const cvpo = await textOf(build({ taxCode: IVA21, qty: '6', unitPrice: '8.25', discountPct: '0.3', profile: { variant: 'cvpo' } }), 'es');
    expect(cvpo).toContain('Dto. 0,3%');
    expect(cvpo).toContain('DESCUENTO POR ITEM\n0,15€');
  });

  it('agrupa los vencimientos en una línea y mantiene la forma de pago', async () => {
    const text = await textOf(build({
      taxCode: IVA21,
      dues: [
        { seq: 2, dueDate: '2026-05-09', amount: '72.60' },
        { seq: 1, dueDate: '2026-04-09', amount: '72.60' },
      ],
    }), 'es');
    expect(text).toContain('Vencimientos: 09/04/2026 72,60€ · 09/05/2026 72,60€\nForma de pago: Transferencia');
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

    const cvpo = await renderInvoicePdf({ ...invoice, profile: { ...invoice.profile, variant: 'cvpo' } }, 'es');
    expect(Buffer.compare(first, cvpo)).not.toBe(0);
  });

  it('el QR solo ocupa sitio y se pinta si Verifactu está activo', async () => {
    expect(QR_SIZE_MM).toBeGreaterThanOrEqual(30);
    expect(QR_SIZE_MM).toBeLessThanOrEqual(40);
    expect(QR_MARGIN_MM).toBeGreaterThanOrEqual(2);

    const invoice = build({ taxCode: IVA21 });
    const bytes = await renderInvoicePdf(invoice, 'es');
    expect(extractPdfText(bytes)).not.toContain(QR_LABEL);
    expect(extractPdfText(bytes)).not.toContain(QR_LEGEND);
    const sizes = (data: Uint8Array): boolean => {
      const numbers = pdfStreams(data).join('\n').match(/\d+\.\d+/gu)?.map(Number) ?? [];
      return numbers.some((value) => Math.abs(value - QR_SIZE_PT) < 0.001);
    };
    expect(sizes(bytes)).toBe(false);

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
    const activeBytes = await renderInvoicePdf(active, 'en');
    const activeText = extractPdfText(activeBytes);
    expect(activeText).toContain(QR_LABEL);
    expect(activeText).toContain(QR_LEGEND);
    expect(sizes(activeBytes)).toBe(true);
    const placed = extractPlacedText(activeBytes);
    const label = placed.find((item) => item.text === QR_LABEL);
    const legend = placed.find((item) => item.text === QR_LEGEND);
    const issuer = placed.find((item) => item.text === 'Comercializadora (CVPO)');
    expect(label?.y).toBeGreaterThan(legend?.y ?? Infinity);
    expect(issuer?.y).toBeLessThan(legend?.y ?? 0);
    expect((label?.y ?? 0) - (legend?.y ?? 0)).toBeGreaterThan(QR_SIZE_PT);

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

  it('usa el logotipo en el hueco de marca y el nombre comercial solo si no lo hay', async () => {
    const branded = build({ taxCode: IVA21, tradeName: 'Marca Ejemplo', logo: PNG_1X1 });
    const bytes = await renderInvoicePdf(branded, 'es');
    const text = extractPdfText(bytes);
    expect(text).toContain('Comercializadora (CVPO)');
    expect(text).not.toContain('Marca Ejemplo');
    expect(Buffer.from(bytes).toString('latin1')).toContain('/Image');
    const again = await renderInvoicePdf(branded, 'es');
    expect(Buffer.compare(bytes, again)).toBe(0);

    const withoutLogo = await renderInvoicePdf(build({ taxCode: IVA21, tradeName: 'Marca Ejemplo' }), 'es');
    expect(extractPdfText(withoutLogo)).toContain('Marca Ejemplo');
    expect(Buffer.from(withoutLogo).toString('latin1')).not.toContain('/Image');

    const otherLogo = await renderInvoicePdf(build({ taxCode: IVA21, tradeName: 'Marca Ejemplo', logo: PNG_2X2 }), 'es');
    expect(Buffer.compare(bytes, otherLogo)).not.toBe(0);

    let broken: unknown;
    try {
      await renderInvoicePdf(build({ taxCode: IVA21, logo: Uint8Array.from([1, 2, 3]) }), 'es');
    } catch (error) {
      broken = error;
    }
    expect(broken).toBeInstanceOf(DomainError);
  });

  it('sigue en otra página con el título, la cabecera de la tabla y «Pág. x de y»', async () => {
    const lines = Array.from({ length: 50 }, (_, index) => ({
      qty: '1',
      unitPrice: '10.00',
      description: `Linea ${index + 1}`,
      lotCode: null,
    }));
    const bytes = await renderInvoicePdf(build({ taxCode: IVA21, lines }), 'es');
    const text = extractPdfText(bytes);
    const pages = Number(/Pág\. 1 de (\d+)/u.exec(text)?.[1] ?? '0');
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(text).toContain(`Pág. ${pages} de ${pages}`);
    expect(text.match(/FACTURA #CF26-0001/gu)?.length).toBe(pages);
    expect(text).toContain('(continuación)');
    expect(text.match(/^CONCEPTO$/gmu)?.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Linea 50');
    expect(text).not.toContain(QR_LABEL);
    expect(text.match(/^BASE IMPONIBLE$/gmu)?.length).toBe(1);
  });
});
