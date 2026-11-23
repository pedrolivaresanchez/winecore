/**
 * Puesta al día de las facturas de Holded cobradas en Winecore antes de que el
 * cobro de la partida (`legacy.open_item`) se reflejara en la factura proyectada.
 *
 * Solo mira facturas `issued` de origen `holded_import` cuya partida tiene algún
 * cobro registrado en Winecore; el resto conserva lo que trajo la importación.
 * Idempotente: una segunda pasada no cambia nada. `dryRun` lista sin escribir.
 */
import type { Tx } from '../db/writer';
import { syncHoldedInvoicePaid } from './store';
import { decimalOf } from './support';
import { Decimal } from 'decimal.js';

export interface HoldedSyncChange {
  invoice_id: string;
  number: string;
  open_item_id: string;
  before: { amount_paid: string; payment_status: string };
  after: { amount_paid: string; payment_status: string };
}

export async function backfillHoldedInvoicePaid(
  tx: Tx,
  input: { dryRun: boolean; now?: Date },
): Promise<{ dry_run: boolean; checked: number; changes: HoldedSyncChange[] }> {
  const now = input.now ?? new Date();
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT CAST(bi.id AS VARCHAR) AS invoice_id, bi.number, bi.total, bi.amount_paid, bi.payment_status,
           CAST(oi.id AS VARCHAR) AS open_item_id, CAST(oi.holded_invoice_id AS VARCHAR) AS holded_invoice_id,
           oi.amount AS open_amount, oi.amount_paid AS open_paid
    FROM billing.invoice bi
    JOIN legacy.open_item oi ON oi.holded_invoice_id = bi.holded_invoice_id
    WHERE bi.origin = 'holded_import'
      AND bi.status = 'issued'
      AND oi.direction = 'receivable'
      AND oi.status <> 'written_off'
      AND EXISTS (
        SELECT 1 FROM finance.payment_allocation a
        JOIN finance.payment p ON p.id = a.payment_id AND p.status = 'registered'
        WHERE a.target_table = 'legacy.open_item' AND a.target_id = oi.id
      )
    ORDER BY bi.number
  `);
  const changes: HoldedSyncChange[] = [];
  for (const row of rows) {
    const openAmount = decimalOf(row.open_amount ?? 0);
    const openPaid = decimalOf(row.open_paid ?? 0);
    const total = decimalOf(row.total ?? 0);
    const outstanding = Decimal.max(openAmount.minus(openPaid), 0);
    const paid = Decimal.min(Decimal.max(total.minus(outstanding), 0), total);
    const status = paid.eq(0) ? 'unpaid' : paid.lt(total) ? 'partially_paid' : 'paid';
    const before = { amount_paid: decimalOf(row.amount_paid ?? 0).toFixed(2), payment_status: String(row.payment_status) };
    const after = { amount_paid: paid.toFixed(2), payment_status: status };
    if (before.amount_paid === after.amount_paid && before.payment_status === after.payment_status) continue;
    if (!input.dryRun) {
      await syncHoldedInvoicePaid(tx, { holdedInvoiceId: String(row.holded_invoice_id), openAmount, openPaid, now });
    }
    changes.push({
      invoice_id: String(row.invoice_id),
      number: String(row.number ?? ''),
      open_item_id: String(row.open_item_id),
      before,
      after,
    });
  }
  return { dry_run: input.dryRun, checked: rows.length, changes };
}
