import { randomBytes } from 'node:crypto';
import { createTestApp } from '../helpers';
import { sql } from '../../src/core/db/sql';
import type { Writer } from '../../src/core/db/writer';
import { dataKeyFor } from '../../src/core/finance/runtime';
import { sealIban } from '../../src/core/finance/ibanSeal';
import { newId } from '../../src/core/ids';
import { ibanLast4 } from '../../src/core/party/iban';

let taxSeq = 1;

export function financeEnv(): { WINECORE_DATA_KEY: string } {
  return { WINECORE_DATA_KEY: Buffer.from(randomBytes(32)).toString('base64') };
}

export function financeApp() {
  return createTestApp({ env: financeEnv() });
}

export async function world(writer: Writer) {
  const entities = await writer.read<{ id: string; code: string; legal_name: string; tax_id: string }>(
    'SELECT id, code, legal_name, tax_id FROM core.legal_entity',
  );
  const users = await writer.read<{ id: string; email: string }>('SELECT id, email FROM core.app_user');
  const entity = (code: string) => {
    const row = entities.find((item) => item.code === code);
    if (!row) throw new Error(code);
    return { id: String(row.id).toLowerCase(), legalName: String(row.legal_name), taxId: String(row.tax_id) };
  };
  const user = (email: string) => {
    const row = users.find((item) => item.email === email);
    if (!row) throw new Error(email);
    return String(row.id).toLowerCase();
  };
  return { po: entity('PO'), cvpo: entity('CVPO'), ownerId: user('owner@winecore.test') };
}

export async function insertContact(
  writer: Writer,
  ownerId: string,
  input: {
    name: string;
    customer?: boolean;
    supplier?: boolean;
    iban?: string | null;
    mandateRef?: string | null;
    mandateDate?: string | null;
  },
) {
  const id = newId();
  const key = input.iban ? dataKeyFor(writer) : null;
  if (input.iban && !key) throw new Error('Falta la clave de cifrado en la prueba');
  const tax = `Q${String(taxSeq).padStart(7, '0')}A`;
  taxSeq += 1;
  await writer.withWrite({ type: 'user', id: ownerId, requestId: `fixture-${id}` }, async (tx) => {
    tx.write(sql`
      INSERT INTO party.contact (
        id, kind, legal_name, tax_id, tax_id_type, country_code, is_customer, is_supplier,
        payment_method, iban_enc, iban_last4, sepa_mandate_ref, sepa_mandate_date, created_by
      ) VALUES (
        CAST(${id} AS UUID), 'company', ${input.name}, ${tax}, 'none', 'ES',
        ${input.customer ?? false}, ${input.supplier ?? false},
        ${input.mandateRef ? 'direct_debit' : 'transfer'},
        ${input.iban && key ? sealIban(input.iban, key) : null},
        ${input.iban ? ibanLast4(input.iban) : null},
        ${input.mandateRef ?? null},
        CAST(${input.mandateDate ?? null} AS DATE),
        ${ownerId}
      )
    `);
  });
  return id;
}

async function seriesId(writer: Writer, ownerId: string, entityId: string): Promise<string> {
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id FROM core.number_series
    WHERE legal_entity_id = CAST(${entityId} AS UUID) AND doc_type = 'invoice' AND code = 'FS' AND year = 2026
  `);
  const existing = rows[0];
  if (existing) return String(existing.id).toLowerCase();
  const id = newId();
  await writer.withWrite({ type: 'user', id: ownerId, requestId: `series-${id}` }, async (tx) => {
    tx.write(sql`
      INSERT INTO core.number_series (id, legal_entity_id, doc_type, code, year, prefix)
      VALUES (CAST(${id} AS UUID), CAST(${entityId} AS UUID), 'invoice', 'FS', 2026, ${`FS${entityId.slice(0, 4)}`})
    `);
  });
  return id;
}

export async function insertInvoice(
  writer: Writer,
  ownerId: string,
  input: {
    entityId: string;
    customerId: string;
    total: string;
    dueDate: string;
    issueDate?: string;
    number?: string;
    status?: string;
  },
) {
  const series = await seriesId(writer, ownerId, input.entityId);
  const id = newId();
  const number = input.number ?? `FS26-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
  const status = input.status ?? 'issued';
  const issueDate = input.issueDate ?? input.dueDate;
  await writer.withWrite({ type: 'user', id: ownerId, requestId: `invoice-${id}` }, async (tx) => {
    tx.write(sql`
      INSERT INTO billing.invoice (
        id, legal_entity_id, series_id, number, status, invoice_type, issue_date, customer_id,
        customer_snapshot, subtotal, tax_total, total, amount_paid, payment_status, issued_at, created_by
      ) VALUES (
        CAST(${id} AS UUID), CAST(${input.entityId} AS UUID), CAST(${series} AS UUID), ${number},
        ${status}, 'F1', CAST(${issueDate} AS DATE), CAST(${input.customerId} AS UUID),
        ${sql.json({ name: 'Cliente de prueba' })}, ${input.total}, '0.00', ${input.total},
        '0.00', 'unpaid', ${status === 'issued' ? new Date() : null}, ${ownerId}
      )
    `);
    if (status === 'issued') {
      tx.write(sql`
        INSERT INTO billing.invoice_due (id, invoice_id, seq, due_date, amount)
        VALUES (CAST(${newId()} AS UUID), CAST(${id} AS UUID), 1, CAST(${input.dueDate} AS DATE), ${input.total})
      `);
    }
  });
  return { id, number };
}

export async function insertOpenItem(
  writer: Writer,
  ownerId: string,
  input: {
    entityId: string;
    contactId: string;
    amount: string;
    dueDate: string;
    number: string;
    direction?: 'receivable' | 'payable';
  },
) {
  const batchId = newId();
  const holdedId = newId();
  const id = newId();
  await writer.withWrite({ type: 'user', id: ownerId, requestId: `open-${id}` }, async (tx) => {
    tx.write(sql`
      INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
      VALUES (
        CAST(${batchId} AS UUID), 'holded', CAST(${input.entityId} AS UUID), 'open_items',
        'sintetico.xlsx', ${sha(batchId)}, 'load', ${ownerId}
      )
    `);
    tx.write(sql`
      INSERT INTO legacy.holded_invoice (
        id, batch_id, entity_id, kind, number, issue_date, due_date, counterparty_name,
        counterparty_contact_id, subtotal, total, status_holded, raw
      ) VALUES (
        CAST(${holdedId} AS UUID), CAST(${batchId} AS UUID), CAST(${input.entityId} AS UUID),
        ${input.direction === 'payable' ? 'purchase' : 'sale'}, ${input.number},
        CAST(${input.dueDate} AS DATE), CAST(${input.dueDate} AS DATE), 'Cliente Holded',
        CAST(${input.contactId} AS UUID), ${input.amount}, ${input.amount}, 'Pendiente', ${sql.json({})}
      )
    `);
    tx.write(sql`
      INSERT INTO legacy.open_item (
        id, entity_id, direction, holded_invoice_id, counterparty_contact_id,
        document_number, document_date, due_date, amount
      ) VALUES (
        CAST(${id} AS UUID), CAST(${input.entityId} AS UUID), ${input.direction ?? 'receivable'},
        CAST(${holdedId} AS UUID), CAST(${input.contactId} AS UUID), ${input.number},
        CAST(${input.dueDate} AS DATE), CAST(${input.dueDate} AS DATE), ${input.amount}
      )
    `);
  });
  return id;
}

export async function insertSupplierInvoice(
  writer: Writer,
  ownerId: string,
  input: {
    entityId: string;
    supplierId: string;
    total: string;
    dueDate: string;
    number: string;
    status?: string;
  },
) {
  const id = newId();
  const status = input.status ?? 'approved';
  await writer.withWrite({ type: 'user', id: ownerId, requestId: `supplier-${id}` }, async (tx) => {
    tx.write(sql`
      INSERT INTO purchasing.supplier_invoice (
        id, legal_entity_id, supplier_id, supplier_invoice_number, issue_date, due_date,
        source, status, total, amount_paid, payment_status, approved_by, approved_at, created_by
      ) VALUES (
        CAST(${id} AS UUID), CAST(${input.entityId} AS UUID), CAST(${input.supplierId} AS UUID),
        ${input.number}, CAST(${input.dueDate} AS DATE), CAST(${input.dueDate} AS DATE),
        'upload', ${status}, ${input.total}, '0.00', 'unpaid',
        CAST(${status === 'approved' ? ownerId : null} AS UUID),
        ${status === 'approved' ? new Date() : null}, ${ownerId}
      )
    `);
  });
  return id;
}

function sha(seed: string): string {
  return seed.replaceAll('-', '').padEnd(64, 'a').slice(0, 64);
}

export async function bodyOf(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}
