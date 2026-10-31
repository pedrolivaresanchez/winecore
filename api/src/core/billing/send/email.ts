import { formatDate, formatMoney, isZeroAmount } from '../pdf/format';
import type { InvoiceLang, IssuedInvoice } from '../pdf/types';

export interface InvoiceEmailDraft {
  to: string[];
  subject: string;
  text: string;
}

/** Customer-facing text. It does not say whether WineCore itself sent the message. */
export function invoiceEmailDraft(
  invoice: IssuedInvoice,
  lang: InvoiceLang,
  recipients: readonly string[],
): InvoiceEmailDraft {
  const total = formatMoney(invoice.importeTotal, lang, invoice.currency);
  const lines = [
    lang === 'es'
      ? `Adjuntamos la factura ${invoice.number}.`
      : `Please find invoice ${invoice.number}.`,
    '',
    lang === 'es'
      ? `Fecha de expedición: ${formatDate(invoice.issueDate, lang)}`
      : `Issue date: ${formatDate(invoice.issueDate, lang)}`,
    lang === 'es'
      ? `Emisor: ${invoice.issuer.legalName} (NIF ${invoice.issuer.taxId})`
      : `Issuer: ${invoice.issuer.legalName} (NIF ${invoice.issuer.taxId})`,
    lang === 'es'
      ? `Cliente: ${invoice.customer.legalName} (NIF ${invoice.customer.taxId})`
      : `Customer: ${invoice.customer.legalName} (NIF ${invoice.customer.taxId})`,
    lang === 'es'
      ? `Importe total de la factura: ${total}`
      : `Invoice total amount: ${total}`,
  ];
  if (!isZeroAmount(invoice.withholdingTotal)) {
    const due = formatMoney(invoice.totalToPay, lang, invoice.currency);
    lines.push(lang === 'es' ? `Total a pagar: ${due}` : `Amount due: ${due}`);
  }
  return {
    to: [...recipients],
    subject: lang === 'es'
      ? `Factura ${invoice.number} - ${invoice.issuer.legalName}`
      : `Invoice ${invoice.number} - ${invoice.issuer.legalName}`,
    text: lines.join('\n'),
  };
}
