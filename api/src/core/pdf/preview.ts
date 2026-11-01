import { renderInvoicePdf } from '../billing/pdf/render';
import type { InvoiceLang, PartyIdentity } from '../billing/pdf/types';
import { renderDocumentPdf, type DocumentPdfSeller } from './document';
import type { DocumentProfileView } from './profile';
import {
  DOCUMENT_SAMPLE_KINDS,
  INVOICE_SAMPLE_KINDS,
  sampleDocument,
  sampleInvoice,
  type DocumentSampleKind,
  type InvoiceSampleKind,
} from './sample';

export type PreviewKind = InvoiceSampleKind | DocumentSampleKind;

export const PREVIEW_KINDS: readonly PreviewKind[] = [...INVOICE_SAMPLE_KINDS, ...DOCUMENT_SAMPLE_KINDS];

export function isPreviewKind(value: unknown): value is PreviewKind {
  return typeof value === 'string' && (PREVIEW_KINDS as readonly string[]).includes(value);
}

export interface PreviewIssuer {
  legalName: string;
  tradeName: string | null;
  taxId: string;
  addressLine: string;
  postalCode: string;
  city: string;
  province: string;
  countryCode: string;
  registryData: string | null;
}

/**
 * PDF de muestra con el emisor y el perfil recibidos y todo lo demás inventado. Sirve para ver
 * cómo quedará la plantilla de una sociedad antes de emitir nada: no guarda ni numera nada.
 */
export async function renderPreviewPdf(options: {
  issuer: PreviewIssuer;
  profile: DocumentProfileView;
  kind: PreviewKind;
  lang: InvoiceLang;
}): Promise<Uint8Array> {
  const { issuer, profile, kind, lang } = options;
  if ((DOCUMENT_SAMPLE_KINDS as readonly string[]).includes(kind)) {
    const seller: DocumentPdfSeller = {
      legalName: issuer.legalName,
      tradeName: issuer.tradeName,
      taxId: issuer.taxId,
      addressLine: issuer.addressLine,
      postalCode: issuer.postalCode,
      city: issuer.city,
      province: issuer.province,
      countryCode: issuer.countryCode,
    };
    return renderDocumentPdf(sampleDocument({ seller, profile, lang, kind: kind as DocumentSampleKind }));
  }
  const party: PartyIdentity = {
    legalName: issuer.legalName,
    tradeName: issuer.tradeName,
    taxId: issuer.taxId,
    taxIdType: 'nif',
    address: {
      line1: issuer.addressLine,
      line2: null,
      postalCode: issuer.postalCode,
      city: issuer.city,
      province: issuer.province,
      countryCode: issuer.countryCode,
    },
    registryData: issuer.registryData,
  };
  return renderInvoicePdf(sampleInvoice({ issuer: party, profile, lang, kind: kind as InvoiceSampleKind }), lang);
}
