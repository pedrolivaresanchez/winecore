import { Decimal } from 'decimal.js';
import { compact, decimalOf } from './support';

export interface SuggestCandidate {
  targetTable: string;
  targetId: string;
  documentNumber: string;
  contactName: string | null;
  outstanding: Decimal;
  direction: 'in' | 'out';
}

export interface Suggestion {
  target_table: string;
  target_id: string;
  document_number: string;
  score: string;
  reason: string;
}

export interface SuggestLine {
  amount: string;
  description: string;
  reference: string | null;
  counterpartyName: string | null;
}

const NUMBER_POINTS = 50;
const AMOUNT_POINTS = 35;
const NAME_POINTS = 15;
const KEEP_FROM = 35;

/**
 * 1,00 solo si el número de factura está en el texto y el pendiente coincide.
 * El resto suma número (0,50), importe exacto (0,35) y contraparte (0,15).
 */
export function suggestForLine(line: SuggestLine, candidates: readonly SuggestCandidate[]): Suggestion[] {
  const amount = decimalOf(line.amount).abs();
  const direction = decimalOf(line.amount).isNegative() ? 'out' : 'in';
  const text = compact(`${line.description} ${line.reference ?? ''} ${line.counterpartyName ?? ''}`);
  const ranked: Array<Suggestion & { points: number }> = [];
  for (const candidate of candidates) {
    if (candidate.direction !== direction) continue;
    if (!candidate.outstanding.gt(0)) continue;
    const numberHit = numberInText(candidate.documentNumber, text);
    const amountHit = candidate.outstanding.eq(amount);
    const nameHit = nameInText(candidate.contactName, text, line.counterpartyName);
    if (!numberHit && !amountHit && !nameHit) continue;
    const exact = numberHit && amountHit;
    const points = exact ? 100 : (numberHit ? NUMBER_POINTS : 0) + (amountHit ? AMOUNT_POINTS : 0) + (nameHit ? NAME_POINTS : 0);
    if (points < KEEP_FROM) continue;
    ranked.push({
      target_table: candidate.targetTable,
      target_id: candidate.targetId,
      document_number: candidate.documentNumber,
      score: points === 100 ? '1.00' : (points / 100).toFixed(2),
      reason: reasonFor(numberHit, amountHit, nameHit, exact),
      points,
    });
  }
  ranked.sort((left, right) => right.points - left.points || left.document_number.localeCompare(right.document_number));
  return ranked.slice(0, 5).map(({ points: _points, ...suggestion }) => suggestion);
}

function numberInText(number: string, text: string): boolean {
  const token = compact(number).replace(/\s/g, '');
  if (token.length < 4) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:[^A-Z0-9]|$)`).test(text);
}

function nameInText(contactName: string | null, text: string, counterparty: string | null): boolean {
  if (!contactName) return false;
  const name = compact(contactName);
  if (name.length < 4) return false;
  if (text.includes(name)) return true;
  return counterparty !== null && compact(counterparty).includes(name);
}

function reasonFor(numberHit: boolean, amountHit: boolean, nameHit: boolean, exact: boolean): string {
  if (exact) return 'importe exacto y número de factura';
  const parts: string[] = [];
  if (numberHit) parts.push('número de factura');
  if (amountHit) parts.push('importe exacto');
  if (nameHit) parts.push('contraparte');
  if (parts.length === 1) {
    if (numberHit) return 'número de factura en el concepto';
    if (amountHit) return 'importe exacto';
    return 'contraparte';
  }
  return parts.join(' y ');
}
