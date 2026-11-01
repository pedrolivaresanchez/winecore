import { taxIdLabel } from '../billing/pdf/format';
import type { CustomerSpec, IssuerSpec, PdfLang } from './holded-layout';
import type { DocumentProfileView } from './profile';
import { townLine } from './ship-to';

export interface PartyAddressLike {
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  province: string | null;
  countryCode: string;
}

export interface PartyLike {
  legalName: string;
  taxId: string;
  taxIdType?: string;
  address: PartyAddressLike;
  phone?: string | null;
  email?: string | null;
}

/** Plantilla de Holded: el NIF va solo; un identificador extranjero lleva su etiqueta. */
function taxIdText(party: PartyLike, lang: PdfLang): string {
  const id = party.taxId.trim();
  if (id === '') return '';
  const type = party.taxIdType ?? 'nif';
  if (type === 'nif' || type === 'nie' || type === 'none') return id;
  return `${taxIdLabel(type, lang)} ${id}`;
}

/** Emisor: nombre grande, NIF, domicilio, correo y teléfono de su perfil documental. */
export function issuerSpec(party: PartyLike, profile: DocumentProfileView, lang: PdfLang): IssuerSpec {
  const address = party.address;
  const lines = [
    taxIdText(party, lang),
    address.line1,
    address.line2 ?? '',
    townLine(address, lang, { country: address.countryCode.toUpperCase() !== 'ES' }),
    profile.email ?? '',
    profile.phone ?? '',
  ].filter((line) => line.trim() !== '');
  return { name: party.legalName, lines };
}

export function customerSpec(party: PartyLike, lang: PdfLang): CustomerSpec {
  const address = party.address;
  const lines = [
    taxIdText(party, lang),
    address.line1,
    address.line2 ?? '',
    townLine(address, lang, { country: true }),
  ].filter((line) => line.trim() !== '');
  const contact = [party.phone ?? '', party.email ?? ''].filter((line) => line.trim() !== '');
  return { label: lang === 'es' ? 'Cliente:' : 'Customer:', name: party.legalName, lines, contact };
}
