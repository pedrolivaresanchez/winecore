import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { renderDocumentPdf, type DocumentPdfLang } from '../pdf/document';
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
  const sellers = await db.read<Record<string, unknown>>(sql`
    SELECT legal_name, tax_id, address_line, postal_code, city, province
    FROM core.legal_entity WHERE id = CAST(${String(quote.legal_entity_id)} AS UUID)
  `);
  const customers = await db.read<{ legal_name: string }>(sql`
    SELECT legal_name FROM party.contact WHERE id = CAST(${String(quote.customer_id)} AS UUID)
  `);
  const seller = sellers[0] ?? {};
  const raw = Array.isArray(quote.lines) ? (quote.lines as Record<string, unknown>[]) : [];
  const lines = raw.map((line) => {
    const discount = decOf(line.discount_pct ?? '0');
    const base = decOf(line.quantity).mul(decOf(line.unit_price)).mul(decOf(100).sub(discount)).div(100);
    return {
      description: discount.isZero() ? String(line.description) : `${String(line.description)} (-${discount.toString()} %)`,
      quantity: String(line.quantity),
      unit_price: String(line.unit_price),
      line_base: base.toFixed(2),
      tax_code: line.tax_code == null ? null : String(line.tax_code),
    };
  });
  const title = proforma ? 'Proforma' : (english ? 'Quote' : 'Presupuesto');
  const number = typeof quote.number === 'string' && quote.number !== '' ? quote.number : null;
  const bytes = await renderDocumentPdf({
    lang,
    title,
    number: number ?? (english ? 'Draft' : 'Borrador'),
    issueDate: typeof quote.issue_date === 'string' ? quote.issue_date : null,
    dueLabel: english ? 'Valid until' : 'Válido hasta',
    dueDate: typeof quote.valid_until === 'string' ? quote.valid_until : null,
    status: STATUS[lang][String(quote.status)] ?? String(quote.status),
    meta: typeof quote.incoterm === 'string' && quote.incoterm !== '' ? [`Incoterm ${quote.incoterm}`] : [],
    partyLabel: english ? 'Customer' : 'Cliente',
    seller: {
      legalName: text(seller.legal_name),
      taxId: text(seller.tax_id),
      addressLine: text(seller.address_line),
      postalCode: text(seller.postal_code),
      city: text(seller.city),
      province: text(seller.province),
    },
    customerName: customers[0] ? String(customers[0].legal_name) : (english ? 'Customer' : 'Cliente'),
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

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function safeName(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean === '' ? 'borrador' : clean.slice(0, 60);
}
