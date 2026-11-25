import { Decimal } from 'decimal.js';
import { domainError } from '../errors';
import { decimalOf } from './format';
import { issue, type IssueItem } from './issues';

/** Canales de venta al público: el tope de la simplificada sube a 3.000 €. */
export const RETAIL_CHANNELS = ['web', 'cellar_shop', 'cellar_sales'] as const;

const RETAIL = new Set<string>(RETAIL_CHANNELS);
const GENERAL_CAP = new Decimal('400');
const RETAIL_CAP = new Decimal('3000');

export function isSimplifiedInvoice(invoiceType: string): boolean {
  return invoiceType === 'F2' || invoiceType === 'R5';
}

export function lacksTaxId(taxId: string | null | undefined, taxIdType: string | null | undefined): boolean {
  return taxId == null || taxId.trim() === '' || taxIdType === 'none';
}

/**
 * Sin tipo pedido, CVPO factura simplificada a una persona sin NIF
 * que compra por la web o en la bodega.
 */
export function defaultSimplified(input: {
  entityCode: string;
  kind: string | null;
  taxId: string | null;
  taxIdType: string | null;
  channel: string | null;
}): boolean {
  return input.entityCode === 'CVPO'
    && input.kind === 'person'
    && lacksTaxId(input.taxId, input.taxIdType)
    && input.channel != null
    && RETAIL.has(input.channel);
}

export function simplifiedIssues(input: {
  invoiceType: string;
  entityCode: string;
  channel: string | null;
  total: string | null;
}): IssueItem[] {
  if (!isSimplifiedInvoice(input.invoiceType)) return [];
  const errors: IssueItem[] = [];
  if (input.entityCode !== 'CVPO') {
    errors.push(issue('WC_VALIDATION', 'La factura simplificada solo se emite en CVPO', 'legal_entity_id'));
  }
  if (input.total != null) {
    const total = decimalOf(input.total).abs();
    const retail = input.channel != null && RETAIL.has(input.channel);
    const cap = retail ? RETAIL_CAP : GENERAL_CAP;
    if (total.gt(cap)) {
      errors.push(issue(
        'WC_VALIDATION',
        retail
          ? 'La venta de bodega no puede superar 3.000 €'
          : 'La factura simplificada no puede superar 400 €',
        'total',
      ));
    }
  }
  return errors;
}

export function assertSimplifiedInvoice(input: {
  invoiceType: string;
  entityCode: string;
  channel: string | null;
  total: string | null;
}): void {
  const first = simplifiedIssues(input)[0];
  if (!first) return;
  throw domainError('WC_VALIDATION', { [first.field ?? 'invoice_type']: first.message });
}

export interface AnonymousAddress {
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  province: string | null;
  countryCode: string;
}

/** Cliente sin identificar de una simplificada. No lleva NIF. */
export function anonymousSnapshot(address: AnonymousAddress | null): Record<string, unknown> {
  const place = address ?? {
    line1: 'Venta en bodega',
    line2: null,
    postalCode: '00000',
    city: 'Bodega',
    province: null,
    countryCode: 'ES',
  };
  return {
    legal_name: 'Consumidor final',
    name: 'Consumidor final',
    trade_name: null,
    tax_id: null,
    tax_id_type: 'none',
    tax_id_country: null,
    country: place.countryCode,
    language: 'es',
    phone: null,
    email: null,
    address: {
      line1: place.line1,
      line2: place.line2,
      postal_code: place.postalCode,
      city: place.city,
      province: place.province,
      country_code: place.countryCode,
    },
  };
}
