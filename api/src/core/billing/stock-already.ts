import { sql } from '../db/sql';
import type { Tx } from '../db/writer';

export interface StockAlready {
  deducted: boolean;
  reason: string | null;
}

const EMPTY: StockAlready = { deducted: false, reason: null };

type Read = Pick<Tx, 'read'>;

/** Fila lateral. Sin fila, la factura mueve stock como siempre. */
export async function readStockAlready(reader: Read, invoiceId: string): Promise<StockAlready> {
  const rows = await reader.read<{ reason: unknown }>(sql`
    SELECT reason FROM billing.invoice_stock_already
    WHERE invoice_id = CAST(${invoiceId} AS UUID)
  `);
  const reason = rows[0]?.reason == null ? null : String(rows[0].reason);
  if (!reason) return EMPTY;
  return { deducted: true, reason };
}

/**
 * La factura no mueve stock si ella está marcada o si rectifica una factura
 * de WineCore que lo está. Así una rectificativa no devuelve ni vuelve a
 * descontar mercancía que ya había salido.
 */
export async function skipsStock(reader: Read, invoiceId: string, ownDeducted = false): Promise<boolean> {
  if (ownDeducted) return true;
  const own = await readStockAlready(reader, invoiceId);
  if (own.deducted) return true;
  const rows = await reader.read<{ n: unknown }>(sql`
    SELECT count(*)::INTEGER AS n
    FROM billing.invoice_rectification r
    JOIN billing.invoice_stock_already s ON s.invoice_id = r.rectified_invoice_id
    WHERE r.rectifying_invoice_id = CAST(${invoiceId} AS UUID)
  `);
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Borra y, si sigue marcada, inserta. No hace UPDATE: la tabla podría
 * quedar referenciada y DuckDB rechazaría el cambio de la fila.
 */
export function writeStockAlready(tx: Tx, invoiceId: string, next: StockAlready, before: StockAlready, now: Date): void {
  if (next.deducted === before.deducted && next.reason === before.reason) return;
  tx.write(sql`DELETE FROM billing.invoice_stock_already WHERE invoice_id = CAST(${invoiceId} AS UUID)`);
  if (!next.deducted || !next.reason) {
    if (before.deducted) {
      tx.audit({
        table: 'billing.invoice_stock_already',
        rowId: invoiceId,
        action: 'DELETE',
        before: { reason: before.reason },
        after: null,
      });
    }
    return;
  }
  tx.write(sql`
    INSERT INTO billing.invoice_stock_already (invoice_id, reason, created_at, updated_at)
    VALUES (CAST(${invoiceId} AS UUID), ${next.reason}, ${now}, ${now})
  `);
  tx.audit({
    table: 'billing.invoice_stock_already',
    rowId: invoiceId,
    action: before.deducted ? 'UPDATE' : 'INSERT',
    before: before.deducted ? { reason: before.reason } : null,
    after: { reason: next.reason },
  });
}
