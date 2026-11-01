import Decimal from 'decimal.js';
import type { DocumentPdfInput } from '../pdf/document';
import type { PartyLike } from '../pdf/parties';
import type { DocumentProfileView } from '../pdf/profile';
import type { HoldedDocumentLoaded, HoldedInvoiceLoaded } from './detail';

const INVOICE_NOTE = 'Copia generada desde el histórico de Holded. No es un registro Verifactu.';
const DOCUMENT_NOTE = 'Copia generada desde el histórico de Holded.';

/** Lo que el histórico no guarda y el PDF sí imprime: el perfil de la sociedad y el cliente enlazado. */
export interface HoldedPdfExtras {
  profile?: DocumentProfileView | null;
  customer?: PartyLike | null;
}

export function holdedPdfInput(loaded: HoldedInvoiceLoaded, extras: HoldedPdfExtras = {}): DocumentPdfInput {
  const detail = loaded.detail;
  return {
    title: holdedInvoiceTitle(detail.number, detail.total),
    number: detail.number,
    issueDate: detail.issue_date,
    dueLabel: 'Vencimiento',
    dueDate: detail.due_date,
    status: detail.status_holded,
    partyLabel: detail.kind === 'purchase' ? 'Proveedor' : 'Cliente',
    seller: loaded.seller,
    profile: extras.profile ?? null,
    customer: extras.customer ?? null,
    customerName: detail.counterparty_name,
    description: detail.description,
    lines: detail.lines,
    totals: { subtotal: detail.subtotal, vat: detail.vat, withholding: detail.withholding, total: detail.total },
    settlement: { paid: detail.paid, pending: detail.pending },
    note: INVOICE_NOTE,
  };
}

export function holdedDocumentPdfInput(loaded: HoldedDocumentLoaded, extras: HoldedPdfExtras = {}): DocumentPdfInput {
  const detail = loaded.detail;
  const quote = detail.kind === 'quote';
  return {
    title: quote ? 'Presupuesto' : 'Albarán',
    number: detail.number,
    issueDate: detail.issue_date,
    dueLabel: quote ? 'Válido hasta' : null,
    dueDate: detail.due_date,
    status: detail.status_holded,
    partyLabel: quote ? 'Cliente' : 'Destino',
    seller: loaded.seller,
    profile: extras.profile ?? null,
    customer: extras.customer ?? null,
    customerName: detail.counterparty_name,
    description: detail.description,
    lines: detail.lines,
    totals: { subtotal: detail.subtotal, vat: detail.vat, withholding: detail.withholding, total: detail.total },
    settlement: null,
    note: DOCUMENT_NOTE,
  };
}

export function holdedInvoiceTitle(number: string, total: string): 'Factura' | 'Factura rectificativa' {
  if (/^CN/i.test(number.trim())) return 'Factura rectificativa';
  try {
    if (new Decimal(total).isNeg()) return 'Factura rectificativa';
  } catch {
    // Un total ilegible no convierte el documento en rectificativa.
  }
  return 'Factura';
}

export function holdedPdfFilename(number: string, prefix: 'factura' | 'presupuesto' | 'albaran' = 'factura'): string {
  const safe = number.replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 80);
  return `${prefix}-${safe === '' ? 'sin-numero' : safe}.pdf`;
}
