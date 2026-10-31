import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { newId } from '../ids';
import type { IssuedInvoice } from './issued';

/**
 * Fiscal stock leaves with the invoice of the entity that holds the CAE
 * (P.O, or a natural person under IRPF). CVPO has no CAE.
 *
 * SILICIE entries (A08 / justificante J03 vs J11) stay with the existing
 * engine (`entriesFor`). The justificante and the fiscal regime for a
 * domestic sale are still open: Q-010.
 */
export async function postInvoiceFiscalExits(tx: Tx, invoice: IssuedInvoice): Promise<void> {
  if (!caeEntity(invoice)) return;
  const warehouse = await tx.read<{ id: unknown }>(sql`
    SELECT id
    FROM inventory.tax_warehouse
    WHERE legal_entity_id = CAST(${invoice.legalEntityId} AS UUID)
      AND is_active
    ORDER BY created_at
    LIMIT 1
  `);
  const warehouseId = warehouse[0] ? String(warehouse[0].id).toLowerCase() : null;
  if (!warehouseId) return;

  const volumes = new Map<string, { kind: string; nominalMl: number | null }>();
  for (const productId of new Set(invoice.lines.flatMap((line) => line.productId ? [line.productId] : []))) {
    const rows = await tx.read<{ id: unknown; kind: unknown; nominal_volume_ml: unknown }>(sql`
      SELECT p.id, p.kind, f.nominal_volume_ml
      FROM catalog.product p
      LEFT JOIN catalog.format f ON f.id = p.format_id
      WHERE p.id = CAST(${productId} AS UUID)
    `);
    const row = rows[0];
    if (!row) continue;
    const nominal = row.nominal_volume_ml == null ? null : Number(row.nominal_volume_ml);
    volumes.set(String(row.id).toLowerCase(), {
      kind: String(row.kind),
      nominalMl: nominal != null && Number.isFinite(nominal) ? nominal : null,
    });
  }

  for (const line of invoice.lines) {
    const posted = fiscalLine(line, volumes);
    if (!posted) continue;
    const id = newId();
    tx.write(sql`
      INSERT INTO inventory.fiscal_move (
        id, tax_warehouse_id, fiscal_date, physical_date, move_type, product_class, lot_id, product_id,
        volume_ml, units, justification_type, justification_ref,
        counterparty_contact_id, fiscal_trigger, source_table, source_id, source_line_id, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${warehouseId} AS UUID),
        CAST(${invoice.issueDate} AS DATE),
        CAST(${invoice.operationDate ?? invoice.issueDate} AS DATE),
        ${posted.moveType},
        ${posted.productClass},
        CAST(${line.lotId} AS UUID),
        CAST(${line.productId} AS UUID),
        ${posted.volumeMl},
        ${posted.units},
        'invoice',
        ${invoice.number},
        CAST(${invoice.customerId} AS UUID),
        'invoice',
        'billing.invoice',
        CAST(${invoice.id} AS UUID),
        CAST(${line.id} AS UUID),
        'invoice-issue'
      )
    `);
    tx.audit({
      table: 'inventory.fiscal_move',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: {
        move_type: posted.moveType,
        invoice_id: invoice.id,
        volume_ml: posted.volumeMl,
      },
    });
  }
  // TODO(Q-010): call entriesFor() once the justificante (J03 delivery note vs J11 invoice)
  // and the domestic tax regime are confirmed. The fiscal move above is the input.
}

function caeEntity(invoice: IssuedInvoice): boolean {
  if (invoice.entityCode === 'CVPO') return false;
  return invoice.entityCode === 'PO' || invoice.personType === 'natural' || invoice.incomeTax === 'IRPF';
}

function fiscalLine(
  line: IssuedInvoice['lines'][number],
  volumes: Map<string, { kind: string; nominalMl: number | null }>,
): { moveType: 'exit_domestic'; productClass: 'packaged' | 'bulk'; volumeMl: number; units: number } | null {
  const qty = Number(line.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const product = line.productId ? volumes.get(line.productId.toLowerCase()) : undefined;
  const unit = line.unit.trim().toLowerCase();
  if (product?.kind === 'wine' && product.nominalMl && Number.isInteger(qty)) {
    return {
      moveType: 'exit_domestic',
      productClass: 'packaged',
      volumeMl: -qty * product.nominalMl,
      units: -qty,
    };
  }
  if (unit === 'l' || unit === 'lt' || unit === 'ltr') {
    const ml = Math.round(qty * 1000);
    if (ml <= 0) return null;
    return { moveType: 'exit_domestic', productClass: 'bulk', volumeMl: -ml, units: 0 };
  }
  return null;
}
