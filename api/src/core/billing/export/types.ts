export const EXPORT_FIELDS = [
  'entity_eori',
  'customer_eori',
  'incoterm',
  'nc_code',
  'origin',
  'net_weight',
  'gross_weight',
  'packages',
] as const;

export type ExportField = (typeof EXPORT_FIELDS)[number];

export interface ExportDocumentSpec {
  code: string;
  name_es: string;
  name_en: string;
}

export interface CountryExportRequirements {
  example: boolean;
  confirmed: boolean;
  required_fields: ExportField[];
  documents: ExportDocumentSpec[];
  notes: string;
}

export interface ExportDocumentsSetting {
  notice: string;
  countries: Record<string, CountryExportRequirements>;
}

export interface ExportParty {
  legal_name: string;
  tax_id: string | null;
  eori: string | null;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  country_code: string;
}

export interface ExportLine {
  line_no: number;
  description: string;
  kind: 'wine' | 'other';
  quantity: string;
  unit: string;
  unit_price: string | null;
  discount_pct: string | null;
  line_base: string | null;
  nc_code: string | null;
  origin_country: string | null;
  unit_net_weight_g: number | null;
  unit_gross_weight_g: number | null;
  sku: string | null;
  lot_code: string | null;
}

export interface ExportInvoice {
  destination_country: string;
  language: 'es' | 'en';
  tax_treatment: string | null;
  incoterm: string | null;
  packages: number | null;
  origin_country: string | null;
  currency: string;
  number: string | null;
  issue_date: string | null;
  entity: ExportParty;
  customer: ExportParty;
  lines: ExportLine[];
  sscc: string[];
}

export interface ChecklistItem {
  code: string;
  name_es: string;
  name_en: string;
  source: 'invoice' | 'external';
  status: 'generated' | 'pending';
}

export interface ExportAssessment {
  ready: boolean;
  confirmation_required: boolean;
  example: boolean;
  confirmed: boolean;
  notice: string | null;
  notes: string | null;
  destination_country: string;
  entity_eori_missing: boolean;
  missing: string[];
  items: ChecklistItem[];
}
