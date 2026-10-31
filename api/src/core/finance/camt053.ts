import { domainError } from '../errors';
import { compact } from './support';
import { child, children, descendants, parseXml, textAt, type XmlNode } from './xml';
import type { ParsedMovement, ParsedStatement } from './n43';

export function parseCamt053(source: string): ParsedStatement {
  let root: XmlNode;
  try {
    root = parseXml(source);
  } catch {
    throw domainError('WC_VALIDATION', { content: 'El XML no es un extracto CAMT.053 válido' });
  }
  const statement = child(root, 'BkToCstmrStmt') ?? (root.name === 'BkToCstmrStmt' ? root : null);
  if (!statement) throw domainError('WC_VALIDATION', { content: 'El XML no es un extracto CAMT.053 válido' });
  const stmts = children(statement, 'Stmt');
  if (stmts.length === 0) throw domainError('WC_VALIDATION', { content: 'El extracto CAMT.053 no tiene movimientos' });

  const movements: ParsedMovement[] = [];
  const accounts = new Set<string>();
  let periodFrom: string | null = null;
  let periodTo: string | null = null;

  for (const stmt of stmts) {
    const accountKey = textAt(stmt, 'Acct', 'Id', 'IBAN') || textAt(stmt, 'Acct', 'Id', 'Othr', 'Id') || 'CUENTA';
    accounts.add(accountKey);
    const from = datePart(textAt(stmt, 'FrToDt', 'FrDtTm') || textAt(stmt, 'FrToDt', 'FrDt'));
    const to = datePart(textAt(stmt, 'FrToDt', 'ToDtTm') || textAt(stmt, 'FrToDt', 'ToDt'));
    if (from && (periodFrom === null || from < periodFrom)) periodFrom = from;
    if (to && (periodTo === null || to > periodTo)) periodTo = to;
    for (const entry of children(stmt, 'Ntry')) movements.push(movementOf(entry, accountKey));
  }

  if (movements.length === 0) {
    throw domainError('WC_VALIDATION', { content: 'El extracto CAMT.053 no tiene movimientos' });
  }
  if (accounts.size > 1) throw domainError('WC_VALIDATION', { content: 'El extracto mezcla varias cuentas' });
  const bookings = movements.map((item) => item.bookingDate).sort();
  return {
    format: 'camt053',
    periodFrom: periodFrom ?? bookings[0] ?? movements[0]!.bookingDate,
    periodTo: periodTo ?? bookings.at(-1) ?? movements[0]!.bookingDate,
    movements,
  };
}

function movementOf(entry: XmlNode, accountKey: string): ParsedMovement {
  const amountNode = child(entry, 'Amt');
  const rawAmount = amountNode?.text ?? '';
  if (!/^\d+\.\d{2}$/.test(rawAmount)) {
    throw domainError('WC_VALIDATION', { content: 'El extracto CAMT.053 tiene un importe no válido' });
  }
  if (rawAmount === '0.00') {
    throw domainError('WC_VALIDATION', { content: 'El extracto CAMT.053 tiene un importe cero' });
  }
  const indicator = textAt(entry, 'CdtDbtInd');
  if (indicator !== 'CRDT' && indicator !== 'DBIT') {
    throw domainError('WC_VALIDATION', { content: 'El extracto CAMT.053 no indica abono o cargo' });
  }
  const booking = datePart(textAt(entry, 'BookgDt', 'Dt') || textAt(entry, 'BookgDt', 'DtTm'));
  if (!booking) throw domainError('WC_VALIDATION', { content: 'El extracto CAMT.053 no tiene fecha de apunte' });
  const value = datePart(textAt(entry, 'ValDt', 'Dt') || textAt(entry, 'ValDt', 'DtTm'));
  const amount = indicator === 'DBIT' ? `-${rawAmount}` : rawAmount;
  const acctSvcrRef = textAt(entry, 'AcctSvcrRef');
  const endToEnd = descendants(entry, 'EndToEndId').map((node) => node.text).find((item) => item !== '') ?? '';
  const ustrd = descendants(entry, 'Ustrd').map((node) => node.text).filter((item) => item !== '');
  const extra = textAt(entry, 'AddtlNtryInf');
  const description = [...ustrd, extra].filter((item) => item !== '').join(' ').trim() || acctSvcrRef || 'Apunte';
  const party = indicator === 'DBIT'
    ? descendants(entry, 'Cdtr').map((node) => textAt(node, 'Nm')).find((item) => item !== '')
    : descendants(entry, 'Dbtr').map((node) => textAt(node, 'Nm')).find((item) => item !== '');
  const reference = [endToEnd, acctSvcrRef].filter((item) => item !== '').join(' ') || null;
  const last4 = accountKey.replace(/\s/g, '').slice(-4);
  const fingerprint = acctSvcrRef
    ? ['camt', accountKey, acctSvcrRef].join('|')
    : ['camt', accountKey, booking, value ?? '', amount, endToEnd, compact(description)].join('|');
  return {
    bookingDate: booking,
    valueDate: value,
    amount,
    description,
    counterpartyName: party ?? null,
    reference,
    accountKey,
    accountLast4: last4,
    fingerprint,
  };
}

function datePart(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match?.[1]) return null;
  const iso = match[1];
  const time = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== iso) return null;
  return iso;
}
