import type { Tx } from '../db/writer';
import { loadCustomerParty, loadSellerContext, loadTaxRates } from '../pdf/context';
import { renderDocumentPdf, type DocumentPdfLang } from '../pdf/document';
import { shipToFrom } from '../pdf/ship-to';
import { decOf } from './db';

type ReadDb = Pick<Tx, 'read'>;

const STATUS: Record<DocumentPdfLang, Record<string, string>> = {
  es: {
    draft: 'Borrador',
    sent: 'Enviado',
    accepted: 'Aceptado',
    rejected: 'Rechazado',
    expired: 'Caducado',
    converted: 'Convertido en pedido',
  },
  en: {
    draft: 'Draft',
    sent: 'Sent',
    accepted: 'Accepted',
    rejected: 'Rejected',
    expired: 'Expired',
    converted: 'Converted to order',
  },
};

/** Presupuesto o proforma en el idioma del documento. No es factura ni toca Verifactu. */
export async function renderQuotePdf(db: ReadDb, quote: Record<string, unknown>): Promise<{ bytes: Uint8Array; filename: string }> {
  const lang: DocumentPdfLang = quote.language === 'en' ? 'en' : 'es';
  const english = lang === 'en';
  const proforma = quote.is_proforma === true;
  const { seller, profile } = await loadSellerContext(db, String(quote.legal_entity_id));
  const customer = await loadCustomerParty(db, String(quote.customer_id));
  const rates = await loadTaxRates(db);
  const raw = Array.isArray(quote.lines) ? (quote.lines as Record<string, unknown>[]) : [];
  const lines = raw.map((line) => {
    const discount = decOf(line.discount_pct ?? '0');
    const base = decOf(line.quantity).mul(decOf(line.unit_price)).mul(decOf(100).sub(discount)).div(100);
    const taxCode = line.tax_code == null ? null : String(line.tax_code);
    return {
      description: String(line.description),
      quantity: String(line.quantity),
      unit_price: String(line.unit_price),
      line_base: base.toFixed(2),
      tax_code: taxCode,
      tax_rate: taxCode == null ? null : rates.get(taxCode) ?? null,
      discount_pct: discount.toString(),
      unit: line.unit == null ? null : String(line.unit),
    };
  });
  const title = proforma ? 'Proforma' : (english ? 'Quote' : 'Presupuesto');
  const number = typeof quote.number === 'string' && quote.number !== '' ? quote.number : null;
  const bytes = await renderDocumentPdf({
    lang,
    title,
    number,
    issueDate: typeof quote.issue_date === 'string' ? quote.issue_date : null,
    dueLabel: english ? 'Valid until' : 'Válido hasta',
    dueDate: typeof quote.valid_until === 'string' ? quote.valid_until : null,
    status: STATUS[lang][String(quote.status)] ?? String(quote.status),
    meta: typeof quote.incoterm === 'string' && quote.incoterm !== '' ? [`Incoterm ${quote.incoterm}`] : [],
    partyLabel: english ? 'Customer' : 'Cliente',
    seller,
    profile,
    customer,
    customerName: customer?.legalName ?? (english ? 'Customer' : 'Cliente'),
    shipTo: shipToFrom(quote.ship_to),
    customerReferences: typeof quote.customer_references === 'string' ? quote.customer_references : null,
    description: typeof quote.notes === 'string' && quote.notes.trim() !== '' ? quote.notes : null,
    lines,
    totals: {
      subtotal: String(quote.subtotal),
      vat: String(quote.tax_total),
      withholding: null,
      total: String(quote.total),
    },
    settlement: null,
    note: english ? 'This document is not a tax invoice.' : 'Este documento no es una factura fiscal.',
  });
  const stem = proforma ? 'proforma' : (english ? 'quote' : 'presupuesto');
  return { bytes, filename: `${stem}-${safeName(number ?? (english ? 'draft' : 'borrador'))}.pdf` };
}

function safeName(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean === '' ? 'borrador' : clean.slice(0, 60);
}
