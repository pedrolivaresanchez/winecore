import { Decimal } from 'decimal.js';
import { money } from '../../money';
import { lineAmount, quantityText, weightKg } from './amounts';
import { EXP_E2 } from './constants';
import { validateEori } from './eori';
import type { CountryExportRequirements, ExportInvoice, ExportLine, ExportParty } from './types';

export interface PartyView {
  legal_name: string;
  tax_id: string | null;
  eori: string | null;
  address: string | null;
}

export interface CommercialLineView {
  line_no: number;
  description: string;
  sku: string | null;
  lot_code: string | null;
  nc_code: string | null;
  origin_country: string | null;
  quantity: string;
  unit: string;
  unit_price: string | null;
  discount_pct: string | null;
  amount: string;
  net_kg: string | null;
  gross_kg: string | null;
}

export interface ExportTaxView {
  code: typeof EXP_E2.code;
  tax: typeof EXP_E2.tax;
  regime_key: typeof EXP_E2.regime_key;
  exemption: typeof EXP_E2.exemption;
  rate: null;
  quota: null;
  mention: string;
}

export interface CommercialInvoiceDocument {
  language: 'es' | 'en';
  banner: string | null;
  exporter: PartyView;
  customer: PartyView;
  destination_country: string;
  number: string | null;
  issue_date: string | null;
  incoterm: string | null;
  origin_country: string | null;
  currency: string;
  packages: number | null;
  lines: CommercialLineView[];
  subtotal: string;
  tax: ExportTaxView | null;
  total: string;
  net_kg: string | null;
  gross_kg: string | null;
  sscc: string[];
}

export interface PackingLineView {
  line_no: number;
  description: string;
  sku: string | null;
  lot_code: string | null;
  quantity: string;
  unit: string;
  net_kg: string | null;
  gross_kg: string | null;
}

export interface PackingListDocument {
  language: 'es' | 'en';
  banner: string | null;
  exporter: PartyView;
  customer: PartyView;
  destination_country: string;
  number: string | null;
  issue_date: string | null;
  incoterm: string | null;
  origin_country: string | null;
  packages: number | null;
  lines: PackingLineView[];
  net_kg: string | null;
  gross_kg: string | null;
  sscc: string[];
}

const COPY = {
  es: {
    commercial: 'FACTURA COMERCIAL',
    packing: 'LISTA DE BULTOS',
    exporter: 'Exportador',
    customer: 'Cliente',
    taxId: 'NIF',
    eori: 'EORI',
    address: 'Dirección',
    destination: 'País de destino',
    number: 'Número',
    date: 'Fecha',
    unnumbered: 'sin número',
    undated: 'sin fecha',
    incoterm: 'Incoterm',
    origin: 'Origen',
    currency: 'Divisa',
    packages: 'Bultos',
    line: 'Línea',
    nc: 'Código NC',
    qty: 'Cantidad',
    unitPrice: 'Precio unitario',
    discount: 'Descuento',
    amount: 'Importe',
    net: 'Peso neto (kg)',
    gross: 'Peso bruto (kg)',
    sku: 'SKU',
    lot: 'Lote',
    base: 'Base imponible',
    rate: 'Tipo impositivo',
    quota: 'Cuota',
    notReported: 'no se informa',
    mention: 'Mención',
    total: 'Total',
    netTotal: 'Peso neto total (kg)',
    grossTotal: 'Peso bruto total (kg)',
    sscc: 'SSCC',
    example: 'EJEMPLO sin confirmar. Pedro y el asesor deben confirmar los requisitos de este país.',
    unconfirmed: 'Sin confirmar. Pedro y el asesor deben confirmar los requisitos de este país.',
  },
  en: {
    commercial: 'COMMERCIAL INVOICE',
    packing: 'PACKING LIST',
    exporter: 'Exporter',
    customer: 'Customer',
    taxId: 'Tax ID',
    eori: 'EORI',
    address: 'Address',
    destination: 'Destination country',
    number: 'Number',
    date: 'Date',
    unnumbered: 'unnumbered',
    undated: 'undated',
    incoterm: 'Incoterm',
    origin: 'Origin',
    currency: 'Currency',
    packages: 'Packages',
    line: 'Line',
    nc: 'NC code',
    qty: 'Quantity',
    unitPrice: 'Unit price',
    discount: 'Discount',
    amount: 'Amount',
    net: 'Net weight (kg)',
    gross: 'Gross weight (kg)',
    sku: 'SKU',
    lot: 'Lot',
    base: 'Taxable base',
    rate: 'VAT rate',
    quota: 'VAT amount',
    notReported: 'not reported',
    mention: 'Mention',
    total: 'Total',
    netTotal: 'Total net weight (kg)',
    grossTotal: 'Total gross weight (kg)',
    sscc: 'SSCC',
    example: "UNCONFIRMED EXAMPLE. Pedro and the adviser must confirm this country's requirements.",
    unconfirmed: "UNCONFIRMED. Pedro and the adviser must confirm this country's requirements.",
  },
} as const;

export function buildCommercialInvoice(
  invoice: ExportInvoice,
  country: CountryExportRequirements,
): { document: CommercialInvoiceDocument; text: string } {
  const language = invoice.language;
  const labels = COPY[language];
  const lines: CommercialLineView[] = [];
  let subtotal = new Decimal(0);
  let net = new Decimal(0);
  let gross = new Decimal(0);
  let anyNet = false;
  let anyGross = false;
  for (const line of invoice.lines) {
    const amount = lineAmount(line);
    if (!amount) continue;
    subtotal = money.add(subtotal, amount);
    const netKg = weightKg(line, 'net');
    const grossKg = weightKg(line, 'gross');
    if (netKg) {
      net = net.add(new Decimal(netKg));
      anyNet = true;
    }
    if (grossKg) {
      gross = gross.add(new Decimal(grossKg));
      anyGross = true;
    }
    const quantity = quantityText(new Decimal(line.quantity));
    lines.push({
      line_no: line.line_no,
      description: line.description,
      sku: line.sku,
      lot_code: line.lot_code,
      nc_code: digits(line.nc_code),
      origin_country: lineOrigin(invoice, line),
      quantity,
      unit: line.unit,
      unit_price: line.unit_price ? money.toString(money.fromString(line.unit_price)) : null,
      discount_pct: discountText(line.discount_pct),
      amount: money.toString(amount),
      net_kg: netKg,
      gross_kg: grossKg,
    });
  }
  const tax = invoice.tax_treatment === EXP_E2.code
    ? {
      code: EXP_E2.code,
      tax: EXP_E2.tax,
      regime_key: EXP_E2.regime_key,
      exemption: EXP_E2.exemption,
      rate: null,
      quota: null,
      mention: language === 'en' ? EXP_E2.mentionEn : EXP_E2.mentionEs,
    }
    : null;
  const total = money.toString(subtotal);
  const document: CommercialInvoiceDocument = {
    language,
    banner: banner(country, language),
    exporter: partyView(invoice.entity),
    customer: partyView(invoice.customer),
    destination_country: invoice.destination_country,
    number: invoice.number,
    issue_date: invoice.issue_date,
    incoterm: invoice.incoterm ? invoice.incoterm.toUpperCase() : null,
    origin_country: headerOrigin(invoice),
    currency: invoice.currency,
    packages: invoice.packages,
    lines,
    subtotal: total,
    tax,
    total,
    net_kg: anyNet ? net.toFixed(3) : null,
    gross_kg: anyGross ? gross.toFixed(3) : null,
    sscc: invoice.sscc.filter((code) => /^\d{18}$/.test(code)),
  };
  return { document, text: commercialText(document, labels) };
}

export function buildPackingList(
  invoice: ExportInvoice,
  country: CountryExportRequirements,
): { document: PackingListDocument; text: string } {
  const language = invoice.language;
  const labels = COPY[language];
  const lines: PackingLineView[] = [];
  let net = new Decimal(0);
  let gross = new Decimal(0);
  let anyNet = false;
  let anyGross = false;
  for (const line of invoice.lines) {
    const netKg = weightKg(line, 'net');
    const grossKg = weightKg(line, 'gross');
    if (netKg) {
      net = net.add(new Decimal(netKg));
      anyNet = true;
    }
    if (grossKg) {
      gross = gross.add(new Decimal(grossKg));
      anyGross = true;
    }
    lines.push({
      line_no: line.line_no,
      description: line.description,
      sku: line.sku,
      lot_code: line.lot_code,
      quantity: quantityText(new Decimal(line.quantity)),
      unit: line.unit,
      net_kg: netKg,
      gross_kg: grossKg,
    });
  }
  const document: PackingListDocument = {
    language,
    banner: banner(country, language),
    exporter: partyView(invoice.entity),
    customer: partyView(invoice.customer),
    destination_country: invoice.destination_country,
    number: invoice.number,
    issue_date: invoice.issue_date,
    incoterm: invoice.incoterm ? invoice.incoterm.toUpperCase() : null,
    origin_country: headerOrigin(invoice),
    packages: invoice.packages,
    lines,
    net_kg: anyNet ? net.toFixed(3) : null,
    gross_kg: anyGross ? gross.toFixed(3) : null,
    sscc: invoice.sscc.filter((code) => /^\d{18}$/.test(code)),
  };
  return { document, text: packingText(document, labels) };
}

type Copy = (typeof COPY)[keyof typeof COPY];

function commercialText(document: CommercialInvoiceDocument, labels: Copy): string {
  const lines = headerLines(document, labels, labels.commercial);
  for (const line of document.lines) {
    lines.push(`${labels.line} ${line.line_no}: ${line.description}`);
    if (line.sku) lines.push(`${labels.sku}: ${line.sku}`);
    if (line.lot_code) lines.push(`${labels.lot}: ${line.lot_code}`);
    if (line.nc_code) lines.push(`${labels.nc}: ${line.nc_code}`);
    if (line.origin_country && line.origin_country !== document.origin_country) {
      lines.push(`${labels.origin}: ${line.origin_country}`);
    }
    lines.push(`${labels.qty}: ${line.quantity} ${line.unit}`);
    if (line.unit_price) lines.push(`${labels.unitPrice}: ${line.unit_price}`);
    if (line.discount_pct) lines.push(`${labels.discount}: ${line.discount_pct}%`);
    lines.push(`${labels.amount}: ${line.amount}`);
    if (line.net_kg) lines.push(`${labels.net}: ${line.net_kg}`);
    if (line.gross_kg) lines.push(`${labels.gross}: ${line.gross_kg}`);
  }
  lines.push(`${labels.base}: ${document.subtotal}`);
  if (document.tax) {
    lines.push(`${labels.rate}: ${labels.notReported}`);
    lines.push(`${labels.quota}: ${labels.notReported}`);
    lines.push(`${labels.mention}: ${document.tax.mention}`);
  }
  lines.push(`${labels.total}: ${document.total}`);
  if (document.net_kg) lines.push(`${labels.netTotal}: ${document.net_kg}`);
  if (document.gross_kg) lines.push(`${labels.grossTotal}: ${document.gross_kg}`);
  return lines.join('\n');
}

function packingText(document: PackingListDocument, labels: Copy): string {
  const lines = headerLines(document, labels, labels.packing);
  for (const line of document.lines) {
    lines.push(`${labels.line} ${line.line_no}: ${line.description}`);
    if (line.sku) lines.push(`${labels.sku}: ${line.sku}`);
    if (line.lot_code) lines.push(`${labels.lot}: ${line.lot_code}`);
    lines.push(`${labels.qty}: ${line.quantity} ${line.unit}`);
    if (line.net_kg) lines.push(`${labels.net}: ${line.net_kg}`);
    if (line.gross_kg) lines.push(`${labels.gross}: ${line.gross_kg}`);
  }
  if (document.net_kg) lines.push(`${labels.netTotal}: ${document.net_kg}`);
  if (document.gross_kg) lines.push(`${labels.grossTotal}: ${document.gross_kg}`);
  return lines.join('\n');
}

function headerLines(
  document: {
    banner: string | null;
    exporter: PartyView;
    customer: PartyView;
    destination_country: string;
    number: string | null;
    issue_date: string | null;
    incoterm: string | null;
    origin_country: string | null;
    currency?: string;
    packages: number | null;
    sscc: string[];
  },
  labels: Copy,
  title: string,
): string[] {
  const lines = [title];
  if (document.banner) lines.push(document.banner);
  lines.push(`${labels.exporter}: ${document.exporter.legal_name}`);
  if (document.exporter.tax_id) lines.push(`${labels.taxId}: ${document.exporter.tax_id}`);
  if (document.exporter.eori) lines.push(`${labels.eori}: ${document.exporter.eori}`);
  if (document.exporter.address) lines.push(`${labels.address}: ${document.exporter.address}`);
  lines.push(`${labels.customer}: ${document.customer.legal_name}`);
  if (document.customer.tax_id) lines.push(`${labels.taxId}: ${document.customer.tax_id}`);
  if (document.customer.eori) lines.push(`${labels.eori}: ${document.customer.eori}`);
  if (document.customer.address) lines.push(`${labels.address}: ${document.customer.address}`);
  lines.push(`${labels.destination}: ${document.destination_country}`);
  lines.push(`${labels.number}: ${document.number ?? labels.unnumbered}`);
  lines.push(`${labels.date}: ${document.issue_date ?? labels.undated}`);
  if (document.incoterm) lines.push(`${labels.incoterm}: ${document.incoterm}`);
  if (document.origin_country) lines.push(`${labels.origin}: ${document.origin_country}`);
  if (document.currency) lines.push(`${labels.currency}: ${document.currency}`);
  if (document.packages != null) lines.push(`${labels.packages}: ${document.packages}`);
  for (const code of document.sscc) lines.push(`${labels.sscc}: ${code}`);
  return lines;
}

function banner(country: CountryExportRequirements, language: 'es' | 'en'): string | null {
  if (country.confirmed && !country.example) return null;
  const labels = COPY[language];
  return country.example ? labels.example : labels.unconfirmed;
}

function partyView(party: ExportParty): PartyView {
  const eori = party.eori ? validateEori(party.eori) : null;
  return {
    legal_name: party.legal_name,
    tax_id: party.tax_id,
    eori: eori && eori.ok ? eori.normalized : null,
    address: addressOf(party),
  };
}

function addressOf(party: ExportParty): string | null {
  const parts = [party.address_line, party.postal_code, party.city, party.province, party.country_code]
    .filter((part): part is string => part != null && part.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : null;
}

function headerOrigin(invoice: ExportInvoice): string | null {
  const header = invoice.origin_country?.trim().toUpperCase() ?? '';
  if (/^[A-Z]{2}$/.test(header)) return header;
  return null;
}

function lineOrigin(invoice: ExportInvoice, line: ExportLine): string | null {
  const own = line.origin_country?.trim().toUpperCase() ?? '';
  if (/^[A-Z]{2}$/.test(own)) return own;
  return headerOrigin(invoice);
}

function digits(value: string | null): string | null {
  if (value == null) return null;
  return /^\d{8}$/.test(value.trim()) ? value.trim() : null;
}

function discountText(value: string | null): string | null {
  if (value == null) return null;
  const parsed = new Decimal(value);
  if (parsed.lte(0)) return null;
  return quantityText(parsed);
}
