export type InvoiceLang = 'es' | 'en';

export type TaxIdType = 'nif' | 'nie' | 'vat_eu' | 'passport' | 'foreign_id' | 'none';

export interface PostalAddress {
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  province: string | null;
  countryCode: string;
}

/** Issuer or customer as printed. The customer is the snapshot frozen at issue. */
export interface PartyIdentity {
  legalName: string;
  tradeName: string | null;
  taxId: string;
  taxIdType: TaxIdType;
  address: PostalAddress;
  registryData: string | null;
}

export interface InvoiceLineView {
  lineNo: number;
  sku: string | null;
  description: string;
  lotCode: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
  taxCode: string;
  lineBase: string;
}

export interface InvoiceTaxView {
  taxCode: string;
  rate: string;
  base: string;
  quota: string;
  surchargeRate: string;
  surchargeQuota: string;
  withholdingRate: string;
  withholding: string;
  legalMentionEs: string | null;
  legalMentionEn: string | null;
  exemption: string | null;
  qualification: string | null;
}

export interface InvoiceDueView {
  seq: number;
  dueDate: string;
  amount: string;
}

export interface RectificationView {
  rectifiedNumber: string;
  rectifiedIssueDate: string;
  rectifiedIssuerTaxId: string;
  relation: 'rectified' | 'substituted';
  reason: string;
}

export interface BrandingSlot {
  /** PNG or JPEG. Absent: the slot shows the trade name, or only the colour bar. */
  logo: Uint8Array | null;
  /** RGB components in 0..1. Absent: the default wine colour. */
  accentRgb: readonly [number, number, number] | null;
}

/**
 * Verifactu is M4. `active` is true only when the entity has an installation
 * active on the issue date. The QR matrix is supplied by that module; until
 * then the renderer keeps the reserved area and refuses to pretend the QR exists.
 */
export interface VerifactuSlot {
  active: boolean;
  qrUrl: string | null;
  qrModules: readonly (readonly boolean[])[] | null;
}

export interface IssuedInvoice {
  id: string;
  legalEntityCode: string;
  seriesCode: string;
  number: string;
  invoiceType: string;
  issueDate: string;
  operationDate: string | null;
  language: InvoiceLang;
  description: string;
  currency: string;
  issuer: PartyIdentity;
  customer: PartyIdentity;
  lines: readonly InvoiceLineView[];
  taxes: readonly InvoiceTaxView[];
  subtotal: string;
  taxTotal: string;
  surchargeTotal: string;
  withholdingTotal: string;
  /** Verifactu ImporteTotal: base + VAT + surcharge. Withholding stays out. */
  importeTotal: string;
  /** Amount to collect. */
  totalToPay: string;
  dues: readonly InvoiceDueView[];
  legalMentions: readonly string[];
  notes: string | null;
  incoterm: string | null;
  paymentMethod: string | null;
  rectifications: readonly RectificationView[];
  branding: BrandingSlot;
  verifactu: VerifactuSlot;
  /** Set once the PDF is stored. The renderer does not draw it. */
  pdfAttachmentId: string | null;
}
