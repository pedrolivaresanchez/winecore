import { domainError } from '../errors';
import { compact } from './support';

export interface ParsedMovement {
  bookingDate: string;
  valueDate: string | null;
  /** Importe con signo y dos decimales: abono positivo, cargo negativo. */
  amount: string;
  description: string;
  counterpartyName: string | null;
  reference: string | null;
  accountKey: string;
  accountLast4: string;
  fingerprint: string;
}

export interface ParsedStatement {
  format: 'n43' | 'camt053';
  periodFrom: string;
  periodTo: string;
  movements: ParsedMovement[];
}

interface OpenMovement {
  accountKey: string;
  accountLast4: string;
  bookingDate: string;
  valueDate: string;
  amount: string;
  document: string;
  ref1: string;
  ref2: string;
  concepts: string[];
}

export function parseN43(source: string): ParsedStatement {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  const movements: OpenMovement[] = [];
  let current: OpenMovement | null = null;
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  const accounts = new Set<string>();

  const close = () => {
    if (current) movements.push(current);
    current = null;
  };

  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') return;
    const code = line.slice(0, 2);
    const at = index + 1;
    if (code === '11') {
      close();
      if (line.length < 32) invalid(at);
      const account = line.slice(2, 20);
      if (!/^\d{18}$/.test(account)) invalid(at);
      accounts.add(account);
      const from = yymmdd(line.slice(20, 26), at);
      const to = yymmdd(line.slice(26, 32), at);
      periodFrom = periodFrom === null || from < periodFrom ? from : periodFrom;
      periodTo = periodTo === null || to > periodTo ? to : periodTo;
      return;
    }
    if (code === '22') {
      close();
      if (line.length < 80) invalid(at);
      const accountKey = [...accounts].at(-1);
      if (!accountKey) invalid(at);
      const sign = line.slice(27, 28);
      const bookingDate = yymmdd(line.slice(10, 16), at);
      const valueDate = yymmdd(line.slice(16, 22), at);
      current = {
        accountKey,
        accountLast4: accountKey.slice(-4),
        bookingDate,
        valueDate,
        amount: signedAmount(sign, line.slice(28, 42), at),
        document: line.slice(42, 52).trim(),
        ref1: line.slice(52, 64).trim(),
        ref2: line.slice(64, 80).trim(),
        concepts: [],
      };
      return;
    }
    if (code === '23') {
      if (!current || line.length < 5) invalid(at);
      const first = line.slice(4, Math.min(42, line.length)).trim();
      const second = line.length > 42 ? line.slice(42, 80).trim() : '';
      if (first) current.concepts.push(first);
      if (second) current.concepts.push(second);
      return;
    }
    if (code === '24' || code === '33' || code === '88') {
      if (code === '33' || code === '88') close();
      return;
    }
    invalid(at);
  });
  close();

  if (movements.length === 0) {
    throw domainError('WC_VALIDATION', { content: 'La Norma 43 no tiene movimientos' });
  }
  if (accounts.size > 1) {
    throw domainError('WC_VALIDATION', { content: 'El extracto mezcla varias cuentas' });
  }
  const parsed = movements.map(finish);
  const bookings = parsed.map((item) => item.bookingDate).sort();
  return {
    format: 'n43',
    periodFrom: periodFrom ?? bookings[0] ?? parsed[0]!.bookingDate,
    periodTo: periodTo ?? bookings.at(-1) ?? parsed[0]!.bookingDate,
    movements: parsed,
  };
}

function finish(movement: OpenMovement): ParsedMovement {
  const reference = [movement.document, movement.ref1, movement.ref2].filter((part) => part !== '').join(' ');
  const description = movement.concepts.join(' ').trim() || `Apunte ${movement.document || movement.bookingDate}`;
  const fingerprint = [
    'n43',
    movement.accountKey,
    movement.bookingDate,
    movement.valueDate,
    movement.amount,
    compact(reference),
    compact(description),
  ].join('|');
  return {
    bookingDate: movement.bookingDate,
    valueDate: movement.valueDate,
    amount: movement.amount,
    description,
    counterpartyName: null,
    reference: reference || null,
    accountKey: movement.accountKey,
    accountLast4: movement.accountLast4,
    fingerprint,
  };
}

function invalid(line: number): never {
  throw domainError('WC_VALIDATION', { content: `La Norma 43 no es válida en la línea ${line}` });
}

function yymmdd(value: string, line: number): string {
  if (!/^\d{6}$/.test(value)) invalid(line);
  const yy = Number(value.slice(0, 2));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const iso = `${year}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  const time = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== iso) invalid(line);
  return iso;
}

function signedAmount(sign: string, digits: string, line: number): string {
  if ((sign !== '1' && sign !== '2') || !/^\d{14}$/.test(digits)) invalid(line);
  const whole = digits.slice(0, 12).replace(/^0+/, '') || '0';
  const text = `${whole}.${digits.slice(12)}`;
  if (text === '0.00') invalid(line);
  return sign === '1' ? `-${text}` : text;
}
