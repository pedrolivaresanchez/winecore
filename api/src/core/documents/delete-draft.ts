import { can, type Permission, type UserCtx } from '../auth/permissions';
import { PERMANENT_LINK_ROLES } from '../attachments/store';
import type { Actor, Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { asDomainError, domainError } from '../errors';
import { idOf } from '../sales/db';

/**
 * Borra un documento que nunca se emitió. DuckDB rehace un UPDATE como
 * DELETE + INSERT y lo rechaza si otra fila apunta a la clave: aquí se
 * borran primero las hijas y luego la cabecera, sin actualizarla.
 */

export const DRAFT_KINDS = ['delivery_note', 'quote', 'sales_order', 'invoice', 'supplier_invoice'] as const;

export type DraftKind = (typeof DRAFT_KINDS)[number];

export type DeletedDraft = {
  deleted: true;
  id: string;
  kind: DraftKind;
};

const PERMANENT = new Set<string>(PERMANENT_LINK_ROLES);

const PERMISSION: Record<DraftKind, Permission> = {
  delivery_note: 'sales.write',
  quote: 'sales.write',
  sales_order: 'sales.write',
  invoice: 'billing.write',
  supplier_invoice: 'purchasing.write',
};

const TABLE: Record<DraftKind, string> = {
  delivery_note: 'sales.delivery_note',
  quote: 'sales.quote',
  sales_order: 'sales.sales_order',
  invoice: 'billing.invoice',
  supplier_invoice: 'purchasing.supplier_invoice',
};

type Row = Record<string, unknown>;

function blocked(message?: string): never {
  throw domainError('WC_DRAFT_DELETE', undefined, message);
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  return raw.length === 0 ? null : raw;
}

function numbered(value: unknown): boolean {
  return text(value) != null;
}

async function one(tx: Tx, statement: string): Promise<boolean> {
  const rows = await tx.read(statement);
  return rows.length > 0;
}

async function rowsOf(tx: Tx, statement: string): Promise<Row[]> {
  return tx.read<Row>(statement);
}

function auditGone(tx: Tx, table: string, rows: readonly Row[], before?: (row: Row) => unknown): void {
  for (const row of rows) {
    tx.audit({
      table,
      rowId: idOf(row.id),
      action: 'DELETE',
      before: before ? before(row) : { id: idOf(row.id) },
      after: null,
    });
  }
}

async function pointedAt(
  tx: Tx,
  table: string,
  id: string,
  child: { table: string; column: string } | null,
): Promise<boolean> {
  if (!child) {
    return one(tx, sql`
      SELECT id FROM ${sql.raw(table)}
      WHERE source_id = CAST(${id} AS UUID)
      LIMIT 1
    `);
  }
  return one(tx, sql`
    SELECT id FROM ${sql.raw(table)}
    WHERE source_id = CAST(${id} AS UUID)
       OR source_id IN (
         SELECT id FROM ${sql.raw(child.table)} WHERE ${sql.raw(child.column)} = CAST(${id} AS UUID)
       )
    LIMIT 1
  `);
}

async function assertNoTraces(
  tx: Tx,
  id: string,
  child: { table: string; column: string } | null,
): Promise<void> {
  if (await pointedAt(tx, 'inventory.stock_move', id, child)) blocked('Tiene movimientos de stock. No se elimina.');
  if (await pointedAt(tx, 'inventory.fiscal_move', id, child)) blocked('Tiene movimientos fiscales. No se elimina.');
  if (await pointedAt(tx, 'cellar.bottled_move', id, child)) blocked('Tiene movimientos de embotellado. No se elimina.');
  if (await one(tx, sql`
    SELECT id FROM accounting.journal_entry WHERE source_id = CAST(${id} AS UUID) LIMIT 1
  `)) blocked('Tiene un asiento. No se elimina.');
  if (await one(tx, sql`
    SELECT id FROM finance.payment_allocation WHERE target_id = CAST(${id} AS UUID) LIMIT 1
  `)) blocked('Tiene cobros o pagos imputados. No se elimina.');
  if (await one(tx, sql`
    SELECT id FROM regulatory.verifactu_record WHERE invoice_id = CAST(${id} AS UUID) LIMIT 1
  `)) blocked('Tiene registro Verifactu. No se elimina.');
}

async function dropQuoteLineLinks(tx: Tx, column: 'quote_id' | 'order_id', id: string): Promise<void> {
  const links = await rowsOf(tx, sql`
    SELECT quote_line_id, quote_id, order_id, order_line_id
    FROM sales.quote_line_link
    WHERE ${sql.raw(column)} = CAST(${id} AS UUID)
  `);
  for (const link of links) {
    tx.audit({
      table: 'sales.quote_line_link',
      rowId: idOf(link.quote_line_id),
      action: 'DELETE',
      before: {
        quote_id: idOf(link.quote_id),
        order_id: idOf(link.order_id),
        order_line_id: idOf(link.order_line_id),
      },
      after: null,
    });
  }
  if (links.length > 0) {
    tx.write(sql`DELETE FROM sales.quote_line_link WHERE ${sql.raw(column)} = CAST(${id} AS UUID)`);
  }
}

async function dropLinks(tx: Tx, table: string, ids: readonly string[]): Promise<void> {
  const links: Row[] = [];
  for (const id of ids) {
    links.push(...await rowsOf(tx, sql`
      SELECT id, role, entity_table, entity_id
      FROM core.attachment_link
      WHERE entity_table = ${table} AND entity_id = CAST(${id} AS UUID)
    `));
  }
  if (links.some((row) => PERMANENT.has(String(row.role)))) {
    blocked('Hay un documento de evidencia que no se puede desvincular. No se elimina.');
  }
  auditGone(tx, 'core.attachment_link', links, (row) => ({
    role: row.role,
    entity_table: row.entity_table,
    entity_id: row.entity_id == null ? null : idOf(row.entity_id),
  }));
  for (const id of ids) {
    if (!links.some((row) => idOf(row.entity_id) === id)) continue;
    tx.write(sql`
      DELETE FROM core.attachment_link
      WHERE entity_table = ${table} AND entity_id = CAST(${id} AS UUID)
    `);
  }
}

/**
 * Quita las hijas de un albarán. La cabecera va en otra escritura: DuckDB no
 * deja borrar una fila mientras, en la misma transacción, alguna hija la referenciaba.
 */
export async function eraseDeliveryChildren(tx: Tx, id: string): Promise<void> {
  const incidents = await rowsOf(tx, sql`
    SELECT id, kind, status FROM sales.shipping_incident
    WHERE delivery_note_id = CAST(${id} AS UUID)
  `);
  await dropLinks(tx, 'sales.delivery_note', [id]);
  await dropLinks(tx, 'sales.shipping_incident', incidents.map((row) => idOf(row.id)));
  const units = await rowsOf(tx, sql`
    SELECT id, sscc FROM sales.handling_unit WHERE delivery_note_id = CAST(${id} AS UUID)
  `);
  const lines = await rowsOf(tx, sql`
    SELECT id, line_no, product_id, quantity FROM sales.delivery_note_line
    WHERE delivery_note_id = CAST(${id} AS UUID)
  `);
  auditGone(tx, 'sales.shipping_incident', incidents);
  auditGone(tx, 'sales.handling_unit', units);
  auditGone(tx, 'sales.delivery_note_line', lines, (row) => ({
    line_no: row.line_no,
    product_id: row.product_id == null ? null : idOf(row.product_id),
    quantity: row.quantity,
  }));
  if (incidents.length > 0) {
    tx.write(sql`DELETE FROM sales.shipping_incident WHERE delivery_note_id = CAST(${id} AS UUID)`);
  }
  if (units.length > 0) {
    tx.write(sql`DELETE FROM sales.handling_unit WHERE delivery_note_id = CAST(${id} AS UUID)`);
  }
  if (lines.length > 0) {
    tx.write(sql`DELETE FROM sales.delivery_note_line WHERE delivery_note_id = CAST(${id} AS UUID)`);
  }
}

/** Borra la cabecera cuando ya no la referencia ninguna hija. */
export async function eraseDeliveryHeader(tx: Tx, id: string, before: Row): Promise<void> {
  tx.audit({
    table: 'sales.delivery_note',
    rowId: id,
    action: 'DELETE',
    before: {
      status: before.status,
      number: text(before.number),
      legal_entity_id: idOf(before.legal_entity_id),
      kind: before.kind,
    },
    after: null,
  });
  tx.write(sql`DELETE FROM sales.delivery_note WHERE id = CAST(${id} AS UUID)`);
}

/** Motivo por el que un albarán (borrador o anulado sin movimiento) no se puede borrar. */
export async function deliveryEraseBlock(tx: Tx, id: string): Promise<string | null> {
  try {
    await deliveryBlockers(tx, id);
    const incidents = await rowsOf(tx, sql`
      SELECT id FROM sales.shipping_incident WHERE delivery_note_id = CAST(${id} AS UUID)
    `);
    const linked: readonly (readonly [string, string])[] = [
      ['sales.delivery_note', id],
      ...incidents.map((row) => ['sales.shipping_incident', idOf(row.id)] as const),
    ];
    for (const [table, entityId] of linked) {
      const links = await rowsOf(tx, sql`
        SELECT role FROM core.attachment_link
        WHERE entity_table = ${table} AND entity_id = CAST(${entityId} AS UUID)
      `);
      if (links.some((row) => PERMANENT.has(String(row.role)))) {
        return 'Hay un documento de evidencia que no se puede desvincular. No se elimina.';
      }
    }
    return null;
  } catch (error) {
    const domain = asDomainError(error);
    if (domain?.code === 'WC_DRAFT_DELETE') return domain.message;
    throw error;
  }
}

async function deliveryBlockers(tx: Tx, id: string): Promise<void> {
  await assertNoTraces(tx, id, { table: 'sales.delivery_note_line', column: 'delivery_note_id' });
  if (await one(tx, sql`
    SELECT id FROM billing.invoice_line
    WHERE delivery_note_line_id IN (
      SELECT id FROM sales.delivery_note_line WHERE delivery_note_id = CAST(${id} AS UUID)
    )
    LIMIT 1
  `)) blocked('El albarán está facturado. No se elimina.');
  if (await one(tx, sql`
    SELECT id FROM billing.intercompany_settlement_line
    WHERE source_table = 'sales.delivery_note_line'
      AND source_id IN (
        SELECT id FROM sales.delivery_note_line WHERE delivery_note_id = CAST(${id} AS UUID)
      )
    LIMIT 1
  `)) blocked('El albarán tiene liquidación intercompañía. No se elimina.');
  if (await one(tx, sql`
    SELECT id FROM regulatory.emcs_document WHERE delivery_note_id = CAST(${id} AS UUID) LIMIT 1
  `)) blocked('El albarán tiene un e-DA. No se elimina.');
}

async function loadHeader(tx: Tx, kind: DraftKind, id: string): Promise<Row> {
  const rows = await rowsOf(tx, sql`SELECT * FROM ${sql.raw(TABLE[kind])} WHERE id = CAST(${id} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

function assertDraftHeader(kind: DraftKind, row: Row): void {
  if (kind === 'supplier_invoice') {
    if (String(row.status) !== 'captured') {
      blocked('Solo se elimina un gasto capturado, antes de validarlo. Uno aprobado se queda en el libro.');
    }
    const paid = Number(row.amount_paid ?? 0);
    if (Number.isFinite(paid) && paid > 0) blocked('Tiene pagos. No se elimina.');
    return;
  }
  const status = String(row.status);
  if (status !== 'draft' || numbered(row.number)) {
    blocked('Solo se elimina un borrador sin número. Un documento emitido o numerado se anula o se rectifica.');
  }
}

async function guardDraft(writer: Writer, user: UserCtx, kind: DraftKind, id: string): Promise<Row> {
  return writer.withWrite({ type: 'user', id: user.id, requestId: 'draft-guard' }, async (tx) => {
    const row = await loadHeader(tx, kind, id);
    const entityId = idOf(row.legal_entity_id);
    if (!can(user, PERMISSION[kind], entityId)) throw domainError('WC_FORBIDDEN');
    assertDraftHeader(kind, row);
    if (kind === 'delivery_note') await deliveryBlockers(tx, id);
    if (kind === 'quote') {
      await assertNoTraces(tx, id, { table: 'sales.quote_line', column: 'quote_id' });
      if (await one(tx, sql`SELECT id FROM sales.sales_order WHERE quote_id = CAST(${id} AS UUID) LIMIT 1`)) {
        blocked('Hay un pedido que sale de este presupuesto. No se elimina.');
      }
    }
    if (kind === 'sales_order') {
      await assertNoTraces(tx, id, { table: 'sales.sales_order_line', column: 'order_id' });
      if (await one(tx, sql`SELECT id FROM sales.delivery_note WHERE sales_order_id = CAST(${id} AS UUID) LIMIT 1`)) {
        blocked('Hay albaranes de este pedido. Elimínalos antes, o anula los emitidos.');
      }
      if (await one(tx, sql`SELECT id FROM billing.invoice WHERE sales_order_id = CAST(${id} AS UUID) LIMIT 1`)) {
        blocked('Hay una factura de este pedido. No se elimina.');
      }
    }
    if (kind === 'invoice') {
      await assertNoTraces(tx, id, { table: 'billing.invoice_line', column: 'invoice_id' });
      if (text(row.verifactu_record_id)) blocked('Tiene registro Verifactu. No se elimina.');
      if (await one(tx, sql`
        SELECT id FROM billing.invoice_rectification WHERE rectified_invoice_id = CAST(${id} AS UUID) LIMIT 1
      `)) blocked('Hay una rectificativa de esta factura. No se elimina.');
    }
    if (kind === 'supplier_invoice') {
      await assertNoTraces(tx, id, { table: 'purchasing.supplier_invoice_line', column: 'supplier_invoice_id' });
    }
    return row;
  });
}

export async function deleteDraft(
  writer: Writer,
  actor: Actor,
  user: UserCtx,
  kind: DraftKind,
  id: string,
): Promise<DeletedDraft> {
  const row = await guardDraft(writer, user, kind, id);
  const entityId = idOf(row.legal_entity_id);
  if (kind === 'delivery_note') {
    await writer.withWrite(actor, (tx) => eraseDeliveryChildren(tx, id));
    const fresh = await guardDraft(writer, user, kind, id);
    await writer.withWrite(actor, (tx) => eraseDeliveryHeader(tx, id, fresh));
    return { deleted: true, id, kind };
  }
  if (kind === 'quote') {
    await writer.withWrite(actor, async (tx) => {
      await dropLinks(tx, 'sales.quote', [id]);
      await dropQuoteLineLinks(tx, 'quote_id', id);
      const lines = await rowsOf(tx, sql`
        SELECT id, line_no, product_id, quantity FROM sales.quote_line WHERE quote_id = CAST(${id} AS UUID)
      `);
      auditGone(tx, 'sales.quote_line', lines);
      if (lines.length > 0) tx.write(sql`DELETE FROM sales.quote_line WHERE quote_id = CAST(${id} AS UUID)`);
    });
    await writer.withWrite(actor, async (tx) => {
      const fresh = await loadHeader(tx, kind, id);
      assertDraftHeader(kind, fresh);
      tx.audit({
        table: 'sales.quote',
        rowId: id,
        action: 'DELETE',
        before: { status: fresh.status, number: text(fresh.number), legal_entity_id: entityId },
        after: null,
      });
      tx.write(sql`DELETE FROM sales.quote WHERE id = CAST(${id} AS UUID)`);
    });
    return { deleted: true, id, kind };
  }
  if (kind === 'sales_order') {
    await writer.withWrite(actor, async (tx) => {
      await dropLinks(tx, 'sales.sales_order', [id]);
      await dropQuoteLineLinks(tx, 'order_id', id);
      const lines = await rowsOf(tx, sql`
        SELECT id, line_no, product_id, quantity FROM sales.sales_order_line WHERE order_id = CAST(${id} AS UUID)
      `);
      auditGone(tx, 'sales.sales_order_line', lines);
      if (lines.length > 0) tx.write(sql`DELETE FROM sales.sales_order_line WHERE order_id = CAST(${id} AS UUID)`);
    });
    await writer.withWrite(actor, async (tx) => {
      const fresh = await loadHeader(tx, kind, id);
      assertDraftHeader(kind, fresh);
      if (await one(tx, sql`SELECT id FROM sales.delivery_note WHERE sales_order_id = CAST(${id} AS UUID) LIMIT 1`)) {
        blocked('Hay albaranes de este pedido. Elimínalos antes, o anula los emitidos.');
      }
      tx.audit({
        table: 'sales.sales_order',
        rowId: id,
        action: 'DELETE',
        before: { status: fresh.status, number: text(fresh.number), legal_entity_id: entityId },
        after: null,
      });
      tx.write(sql`DELETE FROM sales.sales_order WHERE id = CAST(${id} AS UUID)`);
    });
    return { deleted: true, id, kind };
  }
  await writer.withWrite(actor, async (tx) => {
    const fresh = await loadHeader(tx, kind, id);
    assertDraftHeader(kind, fresh);
    if (kind === 'invoice') {
      if (text(fresh.verifactu_record_id)) blocked('Tiene registro Verifactu. No se elimina.');
      await dropLinks(tx, 'billing.invoice', [id]);
      const lines = await rowsOf(tx, sql`SELECT id, line_no FROM billing.invoice_line WHERE invoice_id = CAST(${id} AS UUID)`);
      const taxes = await rowsOf(tx, sql`SELECT id, tax_code FROM billing.invoice_tax WHERE invoice_id = CAST(${id} AS UUID)`);
      const dues = await rowsOf(tx, sql`SELECT id, seq FROM billing.invoice_due WHERE invoice_id = CAST(${id} AS UUID)`);
      const rects = await rowsOf(tx, sql`
        SELECT id FROM billing.invoice_rectification WHERE rectifying_invoice_id = CAST(${id} AS UUID)
      `);
      auditGone(tx, 'billing.invoice_line', lines);
      auditGone(tx, 'billing.invoice_tax', taxes);
      auditGone(tx, 'billing.invoice_due', dues);
      auditGone(tx, 'billing.invoice_rectification', rects);
      if (lines.length > 0) tx.write(sql`DELETE FROM billing.invoice_line WHERE invoice_id = CAST(${id} AS UUID)`);
      if (taxes.length > 0) tx.write(sql`DELETE FROM billing.invoice_tax WHERE invoice_id = CAST(${id} AS UUID)`);
      if (dues.length > 0) tx.write(sql`DELETE FROM billing.invoice_due WHERE invoice_id = CAST(${id} AS UUID)`);
      if (rects.length > 0) tx.write(sql`DELETE FROM billing.invoice_rectification WHERE rectifying_invoice_id = CAST(${id} AS UUID)`);
      tx.audit({
        table: 'billing.invoice',
        rowId: id,
        action: 'DELETE',
        before: { status: fresh.status, number: text(fresh.number), legal_entity_id: entityId },
        after: null,
      });
      tx.write(sql`DELETE FROM billing.invoice WHERE id = CAST(${id} AS UUID)`);
      return;
    }
    await dropLinks(tx, 'purchasing.supplier_invoice', [id]);
    const lines = await rowsOf(tx, sql`
      SELECT id, line_no FROM purchasing.supplier_invoice_line WHERE supplier_invoice_id = CAST(${id} AS UUID)
    `);
    auditGone(tx, 'purchasing.supplier_invoice_line', lines);
    if (lines.length > 0) {
      tx.write(sql`DELETE FROM purchasing.supplier_invoice_line WHERE supplier_invoice_id = CAST(${id} AS UUID)`);
    }
    tx.audit({
      table: 'purchasing.supplier_invoice',
      rowId: id,
      action: 'DELETE',
      before: { status: fresh.status, legal_entity_id: entityId },
      after: null,
    });
    tx.write(sql`DELETE FROM purchasing.supplier_invoice WHERE id = CAST(${id} AS UUID)`);
  });
  return { deleted: true, id, kind };
}
