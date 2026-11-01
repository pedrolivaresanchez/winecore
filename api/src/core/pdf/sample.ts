import { computeInvoice } from '../billing/compute';
import { IVA21, IVA21_ALQ, type TaxCode } from '../billing/taxCodes';
import type { InvoiceLang, InvoiceLineView, IssuedInvoice, PartyIdentity } from '../billing/pdf/types';
import { money } from '../money';
import type { DocumentPdfInput, DocumentPdfLine, DocumentPdfSeller } from './document';
import type { DocumentProfileView } from './profile';
import type { ShipToView } from './ship-to';

/**
 * Documentos de muestra con datos inventados (cliente, líneas, referencias). El emisor y el
 * perfil son los de la sociedad, para que la vista previa enseñe lo que saldrá de verdad.
 */
export type InvoiceSampleKind = 'invoice' | 'discount' | 'corrective' | 'withholding' | 'multipage';

export const INVOICE_SAMPLE_KINDS: readonly InvoiceSampleKind[] = ['invoice', 'discount', 'corrective', 'withholding', 'multipage'];

export const SAMPLE_CUSTOMER: PartyIdentity = {
  legalName: 'Distribuciones Ejemplo S.L.',
  tradeName: null,
  taxId: 'B00000001',
  taxIdType: 'nif',
  address: {
    line1: 'Calle del Ejemplo, 12',
    line2: 'Polígono Industrial Sur',
    postalCode: '28000',
    city: 'Madrid',
    province: 'Madrid',
    countryCode: 'ES',
  },
  registryData: null,
  phone: '+34 000 000 000',
  email: 'compras@example.com',
};

interface SampleLine {
  description: string;
  lotCode: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
}

const BASE_LINES: readonly SampleLine[] = [
  { description: 'TINTO DE EJEMPLO 2023', lotCode: 'E2023A', quantity: '48', unit: 'Botellas', unitPrice: '7.90', discountPct: '0' },
  { description: 'BLANCO DE EJEMPLO 2024', lotCode: null, quantity: '18', unit: 'Botellas', unitPrice: '7.35', discountPct: '0' },
  { description: 'ROSADO DE EJEMPLO 2024', lotCode: 'E2024R', quantity: '30', unit: 'Botellas', unitPrice: '6.30', discountPct: '0' },
];

const DISCOUNT_LINES: readonly SampleLine[] = [
  { description: 'TINTO ECOLÓGICO DE EJEMPLO 21-22', lotCode: 'E202122', quantity: '6', unit: 'Botellas', unitPrice: '8.25', discountPct: '0.3' },
];

function linesFor(kind: InvoiceSampleKind): readonly SampleLine[] {
  if (kind === 'discount') return DISCOUNT_LINES;
  if (kind === 'withholding') {
    return [{ description: 'ALQUILER DE LOCAL (EJEMPLO)', lotCode: null, quantity: '1', unit: 'ud', unitPrice: '1000.00', discountPct: '0' }];
  }
  if (kind === 'multipage') {
    return Array.from({ length: 46 }, (_, index) => ({
      description: `VINO DE EJEMPLO ${String(index + 1).padStart(2, '0')}`,
      lotCode: index % 3 === 0 ? `E${String(2000 + index)}` : null,
      quantity: String(6 + (index % 5)),
      unit: 'Botellas',
      unitPrice: (5 + (index % 7) * 0.65).toFixed(2),
      discountPct: '0',
    }));
  }
  return BASE_LINES;
}

export function sampleInvoice(options: {
  issuer: PartyIdentity;
  profile: DocumentProfileView;
  lang: InvoiceLang;
  kind?: InvoiceSampleKind;
}): IssuedInvoice {
  const kind = options.kind ?? 'invoice';
  const taxCode: TaxCode = kind === 'withholding' ? IVA21_ALQ : IVA21;
  const inputs = linesFor(kind);
  const issueDate = '2026-10-29';
  const computed = computeInvoice({
    lines: inputs.map((line) => ({
      qty: money.fromString(line.quantity),
      unitPrice: money.fromString(line.unitPrice),
      discountPct: money.fromString(line.discountPct),
      taxCode,
    })),
    paymentTerms: { days: [30] },
    issueDate,
  });
  const lines: InvoiceLineView[] = inputs.map((line, index) => ({
    lineNo: index + 1,
    sku: null,
    description: line.description,
    lotCode: line.lotCode,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    discountPct: line.discountPct,
    taxCode: taxCode.code,
    lineBase: money.toString(computed.lines[index]?.lineBase ?? money.fromString('0')),
  }));
  const corrective = kind === 'corrective';
  return {
    id: '00000000-0000-7000-8000-000000000000',
    legalEntityCode: 'MUESTRA',
    seriesCode: 'F',
    number: corrective ? 'R260003' : 'F260086',
    invoiceType: corrective ? 'R1' : 'F1',
    issueDate,
    operationDate: null,
    language: options.lang,
    description: 'Venta de vino',
    currency: 'EUR',
    issuer: options.issuer,
    customer: SAMPLE_CUSTOMER,
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
    importeTotal: money.toString(computed.importeTotal),
    totalToPay: money.toString(computed.totalToPay),
    dues: computed.dues.map((due, index) => ({
      seq: index + 1,
      dueDate: due.dueDate,
      amount: money.toString(due.amount),
    })),
    legalMentions: [],
    notes: null,
    incoterm: null,
    paymentMethod: 'transfer',
    rectifications: corrective
      ? [{
        rectifiedNumber: 'F260086',
        rectifiedIssueDate: '2026-10-29',
        rectifiedIssuerTaxId: options.issuer.taxId,
        relation: 'rectified',
        reason: 'Devolución de mercancía',
      }]
      : [],
    profile: options.profile,
    shipTo: kind === 'withholding'
      ? null
      : {
        name: 'ALMACÉN CENTRAL DE EJEMPLO',
        line1: 'Avenida del Almacén, 20-22',
        line2: null,
        postalCode: '18000',
        city: 'Granada',
        province: 'Granada',
        countryCode: 'ES',
      },
    customerReferences: kind === 'withholding' ? null : 'PEDIDO 00000001\nCENTRO 0059\nPROVEEDOR 0001929',
    deliveryNoteNumbers: kind === 'invoice' || kind === 'multipage' ? ['A260142'] : [],
    verifactu: { active: false, qrUrl: null, qrModules: null },
    pdfAttachmentId: null,
  };
}

export type DocumentSampleKind = 'quote' | 'order' | 'delivery_note';

export const DOCUMENT_SAMPLE_KINDS: readonly DocumentSampleKind[] = ['quote', 'order', 'delivery_note'];

const SAMPLE_SHIP_TO: ShipToView = {
  name: 'ALMACÉN CENTRAL DE EJEMPLO',
  line1: 'Avenida del Almacén, 20-22',
  line2: null,
  postalCode: '18000',
  city: 'Granada',
  province: 'Granada',
  countryCode: 'ES',
};

/** Presupuesto o albarán de muestra para la vista previa del perfil documental. */
export function sampleDocument(options: {
  seller: DocumentPdfSeller;
  profile: DocumentProfileView;
  lang: InvoiceLang;
  kind: DocumentSampleKind;
}): DocumentPdfInput {
  const english = options.lang === 'en';
  const order = options.kind === 'order';
  const quote = options.kind === 'quote' || order;
  const lines: DocumentPdfLine[] = BASE_LINES.map((line) => {
    const base = money.round2(money.mul(money.fromString(line.quantity), money.fromString(line.unitPrice)));
    return {
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unitPrice,
      discount_pct: line.discountPct,
      line_base: money.toString(base),
      tax_code: 'IVA21',
      tax_rate: '21',
      lot: quote ? null : line.lotCode ?? 'Sin lote',
    };
  });
  const subtotal = lines.reduce((sum, line) => money.add(sum, money.fromString(line.line_base ?? '0')), money.fromString('0'));
  const vat = money.round2(money.mul(subtotal, money.fromString('0.21')));
  return {
    lang: options.lang,
    title: order
      ? (english ? 'Order' : 'Pedido')
      : quote ? (english ? 'Quote' : 'Presupuesto') : (english ? 'Delivery note' : 'Albarán'),
    number: order ? 'PE260031' : quote ? 'P260012' : 'A260142',
    issueDate: '2026-10-29',
    dueLabel: order
      ? (english ? 'Requested delivery' : 'Entrega solicitada')
      : quote ? (english ? 'Valid until' : 'Válido hasta') : null,
    dueDate: quote ? '2026-11-28' : null,
    status: order
      ? (english ? 'Confirmed' : 'Confirmado')
      : quote ? (english ? 'Sent' : 'Enviado') : (english ? 'Issued' : 'Emitido'),
    meta: order ? [english ? 'Channel Direct' : 'Canal Venta directa'] : quote ? [] : [english ? 'Type Sale' : 'Clase Venta'],
    partyLabel: english ? 'Customer' : 'Cliente',
    seller: options.seller,
    profile: options.profile,
    customer: SAMPLE_CUSTOMER,
    customerName: SAMPLE_CUSTOMER.legalName,
    shipTo: SAMPLE_SHIP_TO,
    customerReferences: 'PEDIDO 00000001\nCENTRO 0059\nPROVEEDOR 0001929',
    description: null,
    lines,
    priced: quote,
    totals: quote
      ? { subtotal: money.toString(subtotal), vat: money.toString(vat), withholding: null, total: money.toString(money.add(subtotal, vat)) }
      : null,
    settlement: null,
    note: order
      ? (english ? 'Sales order. This is not an invoice.' : 'Pedido de venta. No es una factura.')
      : quote
      ? (english ? 'This document is not a tax invoice.' : 'Este documento no es una factura fiscal.')
      : (english ? 'Delivery note. This is not an invoice.' : 'Albarán de entrega. No es una factura.'),
  };
}
