import { loadCustomer, type CustomerView } from '../billing/readModel';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import type { DocumentPdfSeller } from './document';
import type { PartyLike } from './parties';
import { logPdfFallback } from './fallback';
import { loadDocumentProfileSafe, type DocumentProfileView } from './profile';

type Read = Pick<Tx, 'read'>;

export interface SellerContext {
  seller: DocumentPdfSeller;
  profile: DocumentProfileView;
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

/** Datos de la sociedad que firma el documento y su perfil documental (logotipo, pie, variante). */
export async function loadSellerContext(db: Read, legalEntityId: string): Promise<SellerContext> {
  const rows = await db.read<Record<string, unknown>>(sql`
    SELECT legal_name, trade_name, tax_id, address_line, postal_code, city, province, country_code
    FROM core.legal_entity WHERE id = CAST(${legalEntityId} AS UUID)
  `);
  const row = rows[0] ?? {};
  const trade = text(row.trade_name).trim();
  return {
    seller: {
      legalName: text(row.legal_name),
      tradeName: trade === '' ? null : trade,
      taxId: text(row.tax_id),
      addressLine: text(row.address_line),
      postalCode: text(row.postal_code),
      city: text(row.city),
      province: text(row.province),
      countryCode: text(row.country_code) || 'ES',
    },
    profile: await loadDocumentProfileSafe(db, legalEntityId),
  };
}

export function partyFromCustomer(view: CustomerView): PartyLike {
  const address = view.address;
  return {
    legalName: view.legalName,
    taxId: view.taxId ?? '',
    taxIdType: view.taxIdType,
    phone: view.phone,
    email: view.email,
    address: {
      line1: address?.line1 ?? '',
      line2: address?.line2 ?? null,
      postalCode: address?.postalCode ?? '',
      city: address?.city ?? '',
      province: address?.province ?? null,
      countryCode: address?.countryCode ?? '',
    },
  };
}

/** Cliente completo para la caja del documento; `null` si el contacto ya no existe. */
export async function loadCustomerParty(db: Read, customerId: string | null): Promise<PartyLike | null> {
  if (!customerId) return null;
  try {
    const view = await loadCustomer(db, customerId);
    return view ? partyFromCustomer(view) : null;
  } catch (error) {
    logPdfFallback('customer', error);
    return null;
  }
}

/** Porcentaje de cada código de impuesto (21 para IVA21) para calcular el total de cada línea. */
export async function loadTaxRates(db: Read): Promise<Map<string, string>> {
  const rows = await db.read<{ code: unknown; rate: unknown }>(sql`SELECT code, rate FROM billing.tax_code`);
  return new Map(rows.map((row) => [String(row.code), String(row.rate)]));
}
