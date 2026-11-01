import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';

export type Reader = { read: Tx['read'] };
import { domainError } from '../errors';
import { newId } from '../ids';
import { contactLinkCtes, contactLinkSql, type ContactMatch } from '../legacy/contactLink';
import { bytesOfBlob, openIban } from './ibanSeal';
import {
  dateOnly,
  decimalOf,
  moneyText,
  textOf,
  type TargetTable,
} from './support';

export interface PayableDocument {
  targetTable: TargetTable;
  targetId: string;
  /** Documento que se abre en el visor: la factura de Holded de una partida abierta, o el propio target. */
  documentId: string;
  legalEntityId: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  counterpartyKind: string | null;
  /** En Holded el contacto puede venir del NIF o del nombre, no solo del guardado al importar. */
  counterpartyMatch: ContactMatch | null;
  /** Nombre escrito en el documento de origen (Holded); null en los de WineCore. */
  sourceName: string | null;
  direction: 'in' | 'out';
  documentNumber: string;
  total: Decimal;
  amountPaid: Decimal;
  outstanding: Decimal;
  payable: boolean;
  paymentStatus: string;
  issueDate: string;
  dueDate: string | null;
  origin: 'winecore' | 'holded';
}

export interface PartyBank {
  id: string;
  legalName: string;
  kind: string;
  isCustomer: boolean;
  isSupplier: boolean;
  iban: string | null;
  ibanLast4: string | null;
  mandateRef: string | null;
  mandateDate: string | null;
}

export async function loadDocument(tx: Reader, table: TargetTable, id: string): Promise<PayableDocument | null> {
  if (table === 'billing.invoice') return oneInvoice(tx, id);
  if (table === 'purchasing.supplier_invoice') return oneSupplier(tx, id);
  return oneOpenItem(tx, id);
}

export async function listOpenDocuments(tx: Reader, entityId: string | null): Promise<PayableDocument[]> {
  const invoices = await tx.read<Record<string, unknown>>(sql`
    SELECT i.id, i.legal_entity_id, i.customer_id, c.legal_name, c.kind,
           i.number, i.status, i.payment_status, i.total, i.amount_paid, i.issue_date,
           (SELECT min(d.due_date) FROM billing.invoice_due d WHERE d.invoice_id = i.id) AS due_date
    FROM billing.invoice i
    LEFT JOIN party.contact c ON c.id = i.customer_id
    WHERE i.status = 'issued'
      AND i.payment_status IN ('unpaid', 'partially_paid')
      AND i.total > i.amount_paid
      AND (${entityId} IS NULL OR i.legal_entity_id = CAST(${entityId} AS UUID))
  `);
  const suppliers = await tx.read<Record<string, unknown>>(sql`
    SELECT s.id, s.legal_entity_id, s.supplier_id, c.legal_name, c.kind,
           s.supplier_invoice_number, s.status, s.payment_status, s.total, s.amount_paid,
           s.issue_date, s.due_date
    FROM purchasing.supplier_invoice s
    LEFT JOIN party.contact c ON c.id = s.supplier_id
    WHERE s.status = 'approved'
      AND s.payment_status IN ('unpaid', 'partially_paid')
      AND s.total > s.amount_paid
      AND (${entityId} IS NULL OR s.legal_entity_id = CAST(${entityId} AS UUID))
  `);
  const openItems = await tx.read<Record<string, unknown>>(openItemQuery(sql`
    o.status IN ('open', 'partially_paid')
      AND o.amount > o.amount_paid
      AND (${entityId} IS NULL OR o.entity_id = CAST(${entityId} AS UUID))
  `));
  return [
    ...invoices.map(invoiceOf),
    ...suppliers.map(supplierOf),
    ...openItems.map(openItemOf),
  ];
}

export async function loadParty(tx: Reader, id: string, key: Uint8Array | null): Promise<PartyBank | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, legal_name, kind, is_customer, is_supplier, iban_enc, iban_last4,
           sepa_mandate_ref, sepa_mandate_date
    FROM party.contact
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  const blob = bytesOfBlob(row.iban_enc);
  return {
    id: String(row.id).toLowerCase(),
    legalName: String(row.legal_name),
    kind: String(row.kind),
    isCustomer: row.is_customer === true,
    isSupplier: row.is_supplier === true,
    iban: blob && key ? openIban(blob, key) : null,
    ibanLast4: textOf(row.iban_last4),
    mandateRef: textOf(row.sepa_mandate_ref),
    mandateDate: dateOnly(row.sepa_mandate_date),
  };
}

export async function findEntity(tx: Reader, value: string): Promise<{ id: string; code: string; legalName: string; taxId: string } | null> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const rows = await tx.read<Record<string, unknown>>(uuid ? sql`
    SELECT id, code, legal_name, tax_id
    FROM core.legal_entity
    WHERE id = CAST(${value} AS UUID)
    LIMIT 1
  ` : sql`
    SELECT id, code, legal_name, tax_id
    FROM core.legal_entity
    WHERE code = ${value.toUpperCase()}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id).toLowerCase(),
    code: String(row.code),
    legalName: String(row.legal_name),
    taxId: String(row.tax_id),
  };
}

export function writeDocumentPaid(
  tx: Tx,
  doc: PayableDocument,
  paid: Decimal,
  now: Date,
): { paymentStatus: string; outstanding: string } {
  const status = doc.origin === 'holded'
    ? (paid.eq(0) ? 'open' : paid.lt(doc.total) ? 'partially_paid' : 'paid')
    : (paid.eq(0) ? 'unpaid' : paid.lt(doc.total) ? 'partially_paid' : 'paid');
  const outstanding = moneyText(doc.total.minus(paid));
  if (doc.targetTable === 'billing.invoice') {
    tx.write(sql`
      UPDATE billing.invoice
      SET amount_paid = ${paid}, payment_status = ${status}, updated_at = ${now}
      WHERE id = CAST(${doc.targetId} AS UUID)
    `);
  } else if (doc.targetTable === 'purchasing.supplier_invoice') {
    tx.write(sql`
      UPDATE purchasing.supplier_invoice
      SET amount_paid = ${paid}, payment_status = ${status}, updated_at = ${now}
      WHERE id = CAST(${doc.targetId} AS UUID)
    `);
  } else {
    tx.write(sql`
      UPDATE legacy.open_item
      SET amount_paid = ${paid}, status = ${status}
      WHERE id = CAST(${doc.targetId} AS UUID)
    `);
  }
  tx.audit({
    table: doc.targetTable,
    rowId: doc.targetId,
    action: 'UPDATE',
    before: { amount_paid: moneyText(doc.amountPaid), payment_status: doc.paymentStatus },
    after: { amount_paid: moneyText(paid), payment_status: status },
  });
  return { paymentStatus: status, outstanding };
}

export async function registeredPaid(tx: Reader, table: string, id: string, exceptPaymentId: string | null): Promise<Decimal> {
  const rows = await tx.read<{ paid: unknown }>(sql`
    SELECT coalesce(sum(a.amount), 0) AS paid
    FROM finance.payment_allocation a
    JOIN finance.payment p ON p.id = a.payment_id AND p.status = 'registered'
    WHERE a.target_table = ${table}
      AND a.target_id = CAST(${id} AS UUID)
      AND (${exceptPaymentId} IS NULL OR p.id <> CAST(${exceptPaymentId} AS UUID))
  `);
  return decimalOf(rows[0]?.paid ?? 0);
}

export async function storeBytes(
  tx: Tx,
  input: {
    bytes: Uint8Array;
    filename: string;
    mime: string;
    classification: 'internal' | 'personal_data';
    createdBy: string;
    now: Date;
  },
): Promise<{ id: string; sha256: string }> {
  if (input.bytes.length === 0) throw domainError('WC_VALIDATION', { content: 'El fichero está vacío' });
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const existing = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.attachment
    WHERE sha256 = ${sha256} AND storage_backend = 'knowledge_base'
    LIMIT 1
  `);
  const found = existing[0];
  if (found) return { id: String(found.id).toLowerCase(), sha256 };
  const content = await tx.read<{ sha256: string }>(sql`
    SELECT sha256 FROM core.attachment_content WHERE sha256 = ${sha256}
  `);
  if (!content[0]) {
    tx.write(sql`
      INSERT INTO core.attachment_content (sha256, content)
      VALUES (${sha256}, ${input.bytes})
    `);
  }
  const id = newId();
  tx.write(sql`
    INSERT INTO core.attachment (
      id, sha256, storage_backend, storage_key, filename, mime_type, size_bytes, classification, created_by, created_at
    ) VALUES (
      CAST(${id} AS UUID), ${sha256}, 'knowledge_base', ${sha256}, ${safeName(input.filename)},
      ${input.mime}, ${input.bytes.length}, ${input.classification}, ${input.createdBy}, ${input.now}
    )
  `);
  tx.audit({
    table: 'core.attachment',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { sha256, filename: safeName(input.filename), mime_type: input.mime },
  });
  return { id, sha256 };
}

export async function readBytes(tx: Reader, attachmentId: string): Promise<{ filename: string; mime: string; bytes: Uint8Array; sha256: string } | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT a.filename, a.mime_type, a.sha256, c.content
    FROM core.attachment a
    JOIN core.attachment_content c ON c.sha256 = a.sha256
    WHERE a.id = CAST(${attachmentId} AS UUID)
  `);
  const row = rows[0];
  const bytes = row ? bytesOfBlob(row.content) : null;
  if (!row || !bytes) return null;
  return {
    filename: String(row.filename),
    mime: String(row.mime_type),
    bytes,
    sha256: String(row.sha256),
  };
}

async function oneInvoice(tx: Reader, id: string): Promise<PayableDocument | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT i.id, i.legal_entity_id, i.customer_id, c.legal_name, c.kind,
           i.number, i.status, i.payment_status, i.total, i.amount_paid, i.issue_date,
           (SELECT min(d.due_date) FROM billing.invoice_due d WHERE d.invoice_id = i.id) AS due_date
    FROM billing.invoice i
    LEFT JOIN party.contact c ON c.id = i.customer_id
    WHERE i.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  return row ? invoiceOf(row) : null;
}

async function oneSupplier(tx: Reader, id: string): Promise<PayableDocument | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT s.id, s.legal_entity_id, s.supplier_id, c.legal_name, c.kind,
           s.supplier_invoice_number, s.status, s.payment_status, s.total, s.amount_paid,
           s.issue_date, s.due_date
    FROM purchasing.supplier_invoice s
    LEFT JOIN party.contact c ON c.id = s.supplier_id
    WHERE s.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  return row ? supplierOf(row) : null;
}

async function oneOpenItem(tx: Reader, id: string): Promise<PayableDocument | null> {
  const rows = await tx.read<Record<string, unknown>>(openItemQuery(sql`o.id = CAST(${id} AS UUID)`));
  const row = rows[0];
  return row ? openItemOf(row) : null;
}

/** Sin contacto guardado, la partida se enlaza por NIF o nombre único; el cobro valida la contraparte contra este enlace. */
function openItemQuery(where: string): string {
  const link = contactLinkSql({
    alias: 'o',
    stored: 'COALESCE(o.counterparty_contact_id, h.counterparty_contact_id)',
    entity: 'h.entity_id',
    kind: 'h.kind',
    number: 'h.number',
    date: 'h.issue_date',
    name: 'h.counterparty_name',
  });
  return `
    WITH ${contactLinkCtes(['sale', 'purchase'])}
    SELECT o.id, o.holded_invoice_id, o.entity_id, ${link.id} AS counterparty_contact_id, ${link.match} AS contact_match,
           c.legal_name, c.kind, COALESCE(NULLIF(trim(h.counterparty_name), ''), ${link.lineName}) AS source_name,
           o.direction, o.document_number, o.document_date, o.due_date, o.amount, o.amount_paid, o.status
    FROM legacy.open_item o
    JOIN legacy.holded_invoice h ON h.id = o.holded_invoice_id
    ${link.joins}
    LEFT JOIN party.contact c ON c.id = CAST(${link.id} AS UUID)
    WHERE ${where}`;
}

function invoiceOf(row: Record<string, unknown>): PayableDocument {
  const total = decimalOf(row.total ?? 0);
  const amountPaid = decimalOf(row.amount_paid ?? 0);
  const status = String(row.status);
  const paymentStatus = String(row.payment_status);
  return {
    targetTable: 'billing.invoice',
    targetId: String(row.id).toLowerCase(),
    documentId: String(row.id).toLowerCase(),
    legalEntityId: String(row.legal_entity_id).toLowerCase(),
    counterpartyId: row.customer_id == null ? null : String(row.customer_id).toLowerCase(),
    counterpartyName: textOf(row.legal_name),
    counterpartyKind: textOf(row.kind),
    counterpartyMatch: row.customer_id == null ? null : 'contact',
    sourceName: null,
    direction: 'in',
    documentNumber: textOf(row.number) ?? '',
    total,
    amountPaid,
    outstanding: total.minus(amountPaid),
    payable: status === 'issued' && paymentStatus !== 'uncollectible',
    paymentStatus,
    issueDate: dateOnly(row.issue_date) ?? '',
    dueDate: dateOnly(row.due_date),
    origin: 'winecore',
  };
}

function supplierOf(row: Record<string, unknown>): PayableDocument {
  const total = decimalOf(row.total ?? 0);
  const amountPaid = decimalOf(row.amount_paid ?? 0);
  const status = String(row.status);
  return {
    targetTable: 'purchasing.supplier_invoice',
    targetId: String(row.id).toLowerCase(),
    documentId: String(row.id).toLowerCase(),
    legalEntityId: String(row.legal_entity_id).toLowerCase(),
    counterpartyId: row.supplier_id == null ? null : String(row.supplier_id).toLowerCase(),
    counterpartyName: textOf(row.legal_name),
    counterpartyKind: textOf(row.kind),
    counterpartyMatch: row.supplier_id == null ? null : 'contact',
    sourceName: null,
    direction: 'out',
    documentNumber: textOf(row.supplier_invoice_number) ?? '',
    total,
    amountPaid,
    outstanding: total.minus(amountPaid),
    payable: status === 'approved',
    paymentStatus: String(row.payment_status),
    issueDate: dateOnly(row.issue_date) ?? '',
    dueDate: dateOnly(row.due_date),
    origin: 'winecore',
  };
}

function openItemOf(row: Record<string, unknown>): PayableDocument {
  const total = decimalOf(row.amount ?? 0);
  const amountPaid = decimalOf(row.amount_paid ?? 0);
  const status = String(row.status);
  const direction = row.direction === 'payable' ? 'out' : 'in';
  const match = row.contact_match;
  const sourceName = textOf(row.source_name);
  return {
    targetTable: 'legacy.open_item',
    targetId: String(row.id).toLowerCase(),
    documentId: String(row.holded_invoice_id).toLowerCase(),
    legalEntityId: String(row.entity_id).toLowerCase(),
    counterpartyId: row.counterparty_contact_id == null ? null : String(row.counterparty_contact_id).toLowerCase(),
    counterpartyName: textOf(row.legal_name) ?? sourceName,
    counterpartyKind: textOf(row.kind),
    counterpartyMatch: match === 'contact' || match === 'tax_id' || match === 'name' ? match : null,
    sourceName,
    direction,
    documentNumber: String(row.document_number),
    total,
    amountPaid,
    outstanding: total.minus(amountPaid),
    payable: status === 'open' || status === 'partially_paid',
    paymentStatus: status,
    issueDate: dateOnly(row.document_date) ?? '',
    dueDate: dateOnly(row.due_date),
    origin: 'holded',
  };
}

function safeName(filename: string): string {
  const clean = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  return clean === '' ? 'fichero.bin' : clean;
}
