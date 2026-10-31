/**
 * Export tax treatment EXP_E2, copied from the billing.tax_code seed
 * (docs/02-ddl/0009_billing.sql) and verifactu.md §6.
 * With OperacionExenta, rate and quota are not reported (verifactu.md §5–§6).
 */
export const EXP_E2 = {
  code: 'EXP_E2',
  tax: '01',
  regime_key: '02',
  exemption: 'E2',
  mentionEs: 'Operación exenta de IVA por exportación (art. 21 Ley 37/1992).',
  mentionEn: 'VAT exempt export (Art. 21 Spanish VAT Act 37/1992).',
} as const;

/** Incoterms 2020 codes already allowed on sales.quote. */
export const INCOTERMS = [
  'EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF',
] as const;

export const INCOTERM_SET = new Set<string>(INCOTERMS);

export const ENTITY_EORI_MISSING =
  'La factura de exportación no se emite: falta el EORI de la entidad.';

export const GENERATED_DOCUMENT_CODES = ['commercial_invoice', 'packing_list'] as const;

export type GeneratedDocumentCode = (typeof GENERATED_DOCUMENT_CODES)[number];

export function isGeneratedDocument(code: string): code is GeneratedDocumentCode {
  return code === 'commercial_invoice' || code === 'packing_list';
}
