import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { idOf, isUuid } from './format';

type Read = Pick<Tx, 'read'>;

export async function deliveryStatusPlan(
  tx: Read,
  input: { invoiceId: string; coveredLineIds: readonly string[]; countThisInvoice: boolean },
): Promise<{ deliveryNoteId: string; status: 'not_invoiced' | 'partially_invoiced' | 'invoiced' }[]> {
  const covered = input.coveredLineIds.filter((id) => isUuid(id));
  if (covered.length === 0) return [];
  const list = covered.map((id) => sql`CAST(${id} AS UUID)`).join(', ');
  const owners = await tx.read<{ line_id: unknown; delivery_note_id: unknown }>(`
    SELECT id AS line_id, delivery_note_id
    FROM sales.delivery_note_line
    WHERE id IN (${list})
  `);
  const noteIds = [...new Set(owners.map((row) => idOf(row.delivery_note_id)))];
  if (noteIds.length === 0) return [];
  const noteList = noteIds.map((id) => sql`CAST(${id} AS UUID)`).join(', ');
  const noteLines = await tx.read<{ line_id: unknown; delivery_note_id: unknown }>(`
    SELECT id AS line_id, delivery_note_id
    FROM sales.delivery_note_line
    WHERE delivery_note_id IN (${noteList})
  `);
  const elsewhere = await tx.read<{ delivery_note_line_id: unknown }>(sql`
    SELECT l.delivery_note_line_id
    FROM billing.invoice_line l
    JOIN billing.invoice i ON i.id = l.invoice_id
    WHERE i.status = 'issued'
      AND i.id <> CAST(${input.invoiceId} AS UUID)
      AND l.delivery_note_line_id IS NOT NULL
  `);
  const coveredSet = new Set<string>(elsewhere.map((row) => idOf(row.delivery_note_line_id)));
  if (input.countThisInvoice) {
    for (const id of covered) coveredSet.add(id);
  }
  return noteIds.map((deliveryNoteId) => {
    const lines = noteLines.filter((row) => idOf(row.delivery_note_id) === deliveryNoteId);
    const hit = lines.filter((row) => coveredSet.has(idOf(row.line_id))).length;
    const status = hit === 0 ? 'not_invoiced' : hit === lines.length ? 'invoiced' : 'partially_invoiced';
    return { deliveryNoteId, status };
  });
}

export function writeDeliveryStatuses(
  tx: Tx,
  updates: readonly { deliveryNoteId: string; status: string }[],
  now: Date,
): void {
  for (const update of updates) {
    tx.write(sql`
      UPDATE sales.delivery_note
      SET invoicing_status = ${update.status}, updated_at = ${now}
      WHERE id = CAST(${update.deliveryNoteId} AS UUID)
    `);
    tx.audit({
      table: 'sales.delivery_note',
      rowId: update.deliveryNoteId,
      action: 'UPDATE',
      before: null,
      after: { invoicing_status: update.status },
    });
  }
}
