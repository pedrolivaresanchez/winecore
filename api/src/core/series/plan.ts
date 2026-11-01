import type { DocType } from './numbering';

export const SERIES_PLAN: Record<DocType, { code: string; verifactu: boolean }> = {
  invoice: { code: 'FA', verifactu: true },
  credit_note: { code: 'RC', verifactu: true },
  simplified_invoice: { code: 'FS', verifactu: true },
  intercompany_invoice: { code: 'FI', verifactu: true },
  delivery_note: { code: 'AL', verifactu: false },
  quote: { code: 'PR', verifactu: false },
  sales_order: { code: 'PE', verifactu: false },
  proforma: { code: 'PF', verifactu: false },
  cellar_operation: { code: 'OB', verifactu: false },
  inventory_count: { code: 'AF', verifactu: false },
};

/**
 * Las únicas que se abren solas con el primer documento: no son facturas.
 * La numeración fiscal la decide la empresa (seguir la de Holded o empezar de cero).
 */
export const AUTOMATIC_SERIES: readonly DocType[] = ['quote', 'sales_order', 'delivery_note', 'proforma'];

export const PLAN_PADDING = 4;
export const MIN_PADDING = 2;
export const MAX_PADDING = 8;

export function planPrefix(docType: DocType, year: number): string {
  return `${SERIES_PLAN[docType].code}${String(year % 100).padStart(2, '0')}-`;
}
