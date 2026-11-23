/**
 * Factura de Holded que nunca llegó a emitirse ("nunca emitida").
 *
 * Algunas facturas importadas de Holded (origin `holded_import`) eran en realidad
 * borradores que nadie llegó a enviar ni cobrar. Anularlas por la vía normal
 * (`POST /v1/invoices/:id/void`) no sirve: pide un motivo que no es cierto
 * (duplicada, entidad o cliente equivocado), abre una solicitud de aprobación,
 * avisa por el outbox y deja viva la partida pendiente de `legacy.open_item`.
 *
 * Esto la saca de lo emitido sin rectificativa:
 *   - `billing.invoice`: status `voided`, `void_reason` = `never_issued: <motivo>`.
 *     Las facturas `voided` no cuentan como ventas; el libro de emitidas las omite.
 *   - `legacy.open_item` enlazada (si existe): status `written_off`, así deja de
 *     figurar como deuda del cliente.
 *   - Rastro: una fila de auditoría por tabla con quién, cuándo y el motivo.
 *
 * No crea registro Verifactu, no envía nada a la AEAT ni al cliente, no escribe
 * en el outbox y no mueve stock. Solo se admite si la factura es de Holded, está
 * emitida, no tiene registro Verifactu, ni cobros, ni líneas con producto, lote o
 * albarán, ni movimientos de stock, ni rectificativas, ni envíos.
 */
import { can, type UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { decimalOf, idOf, isUuid, text } from './format';
import { assertWc080 } from './wc080';

export const NEVER_ISSUED_PREFIX = 'never_issued';

/** Condición SQL: la factura `alias` se anuló como nunca emitida. */
export function neverIssuedSql(alias: string): string {
  return `(${alias}.status = 'voided' AND starts_with(COALESCE(${alias}.void_reason, ''), '${NEVER_ISSUED_PREFIX}:'))`;
}

export function isNeverIssuedReason(reason: unknown): boolean {
  return typeof reason === 'string' && reason.startsWith(`${NEVER_ISSUED_PREFIX}:`);
}

export interface NeverIssuedOutcome {
  id: string;
  number: string;
  status: 'voided';
  void_reason: string;
  voided_at: string;
  replayed: boolean;
  open_item: { id: string; status_before: string; status_after: 'written_off' } | null;
}

async function count(tx: Tx, statement: string): Promise<number> {
  const rows = await tx.read<{ n: unknown }>(statement);
  return Number(rows[0]?.n ?? 0);
}

export async function markHoldedInvoiceNeverIssued(
  tx: Tx,
  input: { invoiceId: string; reason: unknown; user: UserCtx; now?: Date },
): Promise<NeverIssuedOutcome> {
  const now = input.now ?? new Date();
  if (!isUuid(input.invoiceId)) throw domainError('WC_NOT_FOUND');
  const reasonText = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reasonText.length < 3 || reasonText.length > 300) {
    throw domainError('WC_VALIDATION', { reason: 'Indica el motivo (de 3 a 300 caracteres)' });
  }
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, legal_entity_id, number, status, origin, verifactu_record_id, amount_paid,
           void_reason, voided_at, holded_invoice_id
    FROM billing.invoice
    WHERE id = CAST(${input.invoiceId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const id = idOf(row.id);
  const entityId = idOf(row.legal_entity_id);
  if (!can(input.user, 'billing.void', entityId)) throw domainError('WC_FORBIDDEN');
  const number = String(row.number ?? '');
  const status = String(row.status);

  if (status === 'voided' && isNeverIssuedReason(row.void_reason)) {
    const voidedAt = row.voided_at instanceof Date ? row.voided_at.toISOString() : String(row.voided_at ?? '');
    return {
      id, number, status: 'voided', void_reason: String(row.void_reason), voided_at: voidedAt, replayed: true, open_item: null,
    };
  }
  if (String(row.origin ?? '') !== 'holded_import') {
    throw domainError('WC_VALIDATION', { origin: 'Solo una factura importada de Holded puede marcarse como nunca emitida' });
  }
  if (status !== 'issued') {
    throw domainError('WC_VALIDATION', { status: 'Solo una factura que figura como emitida' });
  }
  if (row.verifactu_record_id != null) {
    throw domainError('WC_VALIDATION', { verifactu: 'Tiene registro Verifactu: se rectifica, no se marca como nunca emitida' });
  }
  if (await count(tx, sql`
    SELECT count(*)::INTEGER AS n FROM regulatory.verifactu_record WHERE invoice_id = CAST(${id} AS UUID)
  `) > 0) {
    throw domainError('WC_VALIDATION', { verifactu: 'Tiene registro Verifactu: se rectifica, no se marca como nunca emitida' });
  }
  if (decimalOf(row.amount_paid ?? 0).gt(0) || await count(tx, sql`
    SELECT count(*)::INTEGER AS n FROM finance.payment_allocation
    WHERE target_table = 'billing.invoice' AND target_id = CAST(${id} AS UUID)
  `) > 0) {
    throw domainError('WC_INV_PAYMENTS');
  }
  if (await count(tx, sql`
    SELECT count(*)::INTEGER AS n FROM billing.invoice_line
    WHERE invoice_id = CAST(${id} AS UUID)
      AND (product_id IS NOT NULL OR lot_id IS NOT NULL OR delivery_note_line_id IS NOT NULL)
  `) > 0 || await count(tx, sql`
    SELECT count(*)::INTEGER AS n FROM inventory.stock_move
    WHERE source_table = 'billing.invoice' AND source_id = CAST(${id} AS UUID)
  `) > 0) {
    throw domainError('WC_VALIDATION', { lines: 'Tiene líneas con producto, lote o albarán, o movimientos de stock' });
  }
  if (await count(tx, sql`
    SELECT count(*)::INTEGER AS n FROM billing.invoice_rectification
    WHERE rectified_invoice_id = CAST(${id} AS UUID) OR rectifying_invoice_id = CAST(${id} AS UUID)
  `) > 0) {
    throw domainError('WC_VALIDATION', { rectification: 'Tiene rectificativas' });
  }
  if (await count(tx, sql`
    SELECT count(*)::INTEGER AS n FROM billing.invoice_delivery
    WHERE invoice_id = CAST(${id} AS UUID) AND channel <> 'download'
  `) > 0) {
    throw domainError('WC_VALIDATION', { delivery: 'Consta un envío al cliente' });
  }

  let openItem: NeverIssuedOutcome['open_item'] = null;
  const holdedId = text(row.holded_invoice_id);
  if (holdedId) {
    const items = await tx.read<Record<string, unknown>>(sql`
      SELECT id, status, amount_paid, direction, entity_id
      FROM legacy.open_item
      WHERE holded_invoice_id = CAST(${holdedId} AS UUID)
    `);
    const item = items[0];
    if (item) {
      const itemId = idOf(item.id);
      if (String(item.direction) !== 'receivable' || idOf(item.entity_id) !== entityId) {
        throw domainError('WC_VALIDATION', { open_item: 'La partida pendiente no es un cobro de esta sociedad' });
      }
      if (decimalOf(item.amount_paid ?? 0).gt(0) || await count(tx, sql`
        SELECT count(*)::INTEGER AS n FROM finance.payment_allocation a
        JOIN finance.payment p ON p.id = a.payment_id AND p.status = 'registered'
        WHERE a.target_table = 'legacy.open_item' AND a.target_id = CAST(${itemId} AS UUID)
      `) > 0) {
        throw domainError('WC_INV_PAYMENTS');
      }
      const before = String(item.status);
      if (before !== 'written_off') {
        if (before !== 'open') {
          throw domainError('WC_VALIDATION', { open_item: `La partida pendiente está ${before}` });
        }
        tx.write(sql`
          UPDATE legacy.open_item
          SET status = 'written_off',
              notes = ${`Nunca emitida (${now.toISOString().slice(0, 10)}): ${reasonText}`.slice(0, 500)}
          WHERE id = CAST(${itemId} AS UUID) AND status = 'open'
        `);
        tx.audit({
          table: 'legacy.open_item',
          rowId: itemId,
          action: 'UPDATE',
          before: { status: before },
          after: { status: 'written_off', reason: `${NEVER_ISSUED_PREFIX}: ${reasonText}`, invoice_id: id },
        });
      }
      openItem = { id: itemId, status_before: before, status_after: 'written_off' };
    }
  }

  const storedReason = `${NEVER_ISSUED_PREFIX}: ${reasonText}`;
  assertWc080('issued', { status: 'issued' }, {
    status: 'voided',
    voided_at: now.toISOString(),
    void_reason: storedReason,
    updated_at: now.toISOString(),
  });
  tx.write(sql`
    UPDATE billing.invoice
    SET status = 'voided', voided_at = ${now}, void_reason = ${storedReason}, updated_at = ${now}
    WHERE id = CAST(${id} AS UUID) AND status = 'issued'
  `);
  tx.audit({
    table: 'billing.invoice',
    rowId: id,
    action: 'UPDATE',
    before: { status: 'issued' },
    after: { status: 'voided', void_reason: storedReason, never_issued: true },
  });
  return {
    id, number, status: 'voided', void_reason: storedReason, voided_at: now.toISOString(), replayed: false, open_item: openItem,
  };
}
