import type { ModelCode, Period } from './period';

export interface EntityProfile {
  id: string;
  code: string;
  personType: 'natural' | 'legal';
  incomeTax: 'IRPF' | 'IS';
}

export interface TaxSlice {
  taxCode: string;
  regimeKey: string;
  rate: string;
  base: string;
  quota: string;
  surchargeRate: string;
  surchargeQuota: string;
  exemption: string | null;
  qualification: string | null;
  withholding: string;
}

export interface IssuedDoc {
  id: string;
  number: string;
  issueDate: string;
  operationDate: string | null;
  invoiceType: string;
  customerId: string | null;
  customerName: string;
  customerTaxId: string;
  customerCountry: string;
  includeIn347: boolean;
  subtotal: string;
  taxTotal: string;
  surchargeTotal: string;
  withholdingTotal: string;
  total: string;
  verifactuStatus: string | null;
  verifactuCsv: string | null;
  rectified: { number: string; issueDate: string }[];
  taxes: TaxSlice[];
}

export interface ReceivedLine {
  rate: string;
  base: string;
  quota: string;
  withholdingRate: string;
  deductiblePct: string;
}

export interface ReceivedDoc {
  id: string;
  number: string;
  issueDate: string;
  accountingDate: string;
  categoryCode: string;
  categoryName: string;
  supplierId: string;
  supplierName: string;
  supplierTaxId: string;
  supplierTaxIdType: string;
  supplierCountry: string;
  supplierVatRegime: string;
  includeIn347: boolean;
  subtotal: string;
  taxTotal: string;
  withholdingTotal: string;
  total: string;
  lines: ReceivedLine[];
}

export interface CashIn {
  id: string;
  counterpartyId: string | null;
  name: string;
  taxId: string;
  country: string;
  includeIn347: boolean;
  amount: string;
  valueDate: string;
}

export interface FiscalPack {
  entity: EntityProfile;
  period: Period;
  issued: IssuedDoc[];
  received: ReceivedDoc[];
  cash: CashIn[];
  verifactuEnabled: boolean;
}

export interface BookCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface BookTotals {
  invoices: number;
  base: string;
  quota: string;
  surcharge: string;
  withholding: string;
  total: string;
}

export interface MissingSection {
  code: string;
  label: string;
  reason: string;
}

export interface BookRow {
  id: string;
  cells: string[];
}

export interface BookModel {
  book: 'issued' | 'received';
  columns: string[];
  rows: BookRow[];
  checks: BookCheck[];
  totals: BookTotals;
  missing: MissingSection[];
  notes: string[];
}

export interface Box {
  code: string;
  casilla: string | null;
  label: string;
  amount: string;
}

export interface SourceDoc {
  id: string;
  kind: 'issued' | 'received' | 'payment';
  number: string;
  date: string;
  counterparty: string;
  tax_id: string;
  amount: string;
  boxes: string[];
}

export interface ExcludedDoc {
  id: string;
  kind: 'issued' | 'received' | 'payment';
  number: string;
  reason: string;
}

export interface DraftLine {
  clave: string;
  tax_id: string;
  name: string;
  period: string;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  annual: string;
  rate: string | null;
  rectification: boolean;
  document_ids: string[];
}

export interface Reconciliation {
  name: string;
  label: string;
  book: string;
  draft: string;
  ok: boolean;
}

export interface DraftModel {
  model: ModelCode;
  period: string;
  applies: boolean;
  boxes: Box[];
  lines: DraftLine[];
  documents: SourceDoc[];
  excluded: ExcludedDoc[];
  reconciliation: Reconciliation[];
  missing: MissingSection[];
  notes: string[];
  result: string | null;
}
