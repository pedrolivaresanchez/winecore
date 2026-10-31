import { canonicalJson } from '../db/audit';
import { domainError } from '../errors';

/** Campos que una factura emitida todavía puede cambiar (WC080). El resto se rectifica. */
export const ISSUED_MUTABLE = [
  'amount_paid',
  'payment_status',
  'sent_at',
  'sent_by',
  'sent_channel',
  'pdf_attachment_id',
  'verifactu_record_id',
  'status',
  'voided_at',
  'void_reason',
  'updated_at',
] as const;

const MUTABLE = new Set<string>(ISSUED_MUTABLE);

export function assertWc080(
  status: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  if (status === 'discarded') throw domainError('WC080');
  if (status !== 'issued' && status !== 'voided') return;
  for (const key of Object.keys(after)) {
    if (MUTABLE.has(key)) continue;
    if (canonicalJson(before[key] ?? null) !== canonicalJson(after[key] ?? null)) {
      throw domainError('WC080', { [key]: 'La factura está emitida; crea una rectificativa' });
    }
  }
  const next = after.status;
  if (next === undefined) return;
  if (status === 'issued' && next !== 'issued' && next !== 'voided') throw domainError('WC080');
  if (status === 'voided' && next !== 'voided') throw domainError('WC080');
}

export function assertEditable(status: string): void {
  if (status === 'issued' || status === 'voided' || status === 'discarded') throw domainError('WC080');
  if (status !== 'draft' && status !== 'pending_approval') throw domainError('WC_INV_NOT_DRAFT');
}
