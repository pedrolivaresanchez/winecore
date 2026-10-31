import { formatDate, formatMoney } from '../pdf/format';

export interface SpanishDeliveryMessage {
  subject: string;
  body: string;
}

/** Text CVBOT pastes into Outlook. WineCore does not send it. */
export function spanishDeliveryMessage(input: {
  number: string;
  issuerName: string;
  total: string;
  currency: string;
  dueDate: string | null;
}): SpanishDeliveryMessage {
  const amount = formatMoney(input.total, 'es', input.currency);
  const due = input.dueDate
    ? ` El vencimiento es el ${formatDate(input.dueDate, 'es')}.`
    : '';
  return {
    subject: `Factura ${input.number} de ${input.issuerName}`,
    body: [
      'Buenos días:',
      '',
      `Adjuntamos la factura ${input.number} por un importe de ${amount}.${due}`,
      '',
      'Quedamos a su disposición.',
      input.issuerName,
    ].join('\n'),
  };
}
