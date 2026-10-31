import { sessionOf } from '../auth/guard';
import { seesPersonalContactData } from '../core/auth/permissions';
import { sql } from '../core/db/sql';
import type { Writer } from '../core/db/writer';
import { emitEvent } from '../core/events/emit';
import { domainError } from '../core/errors';
import { newId } from '../core/ids';
import {
  addressOf,
  assertTaxAvailable,
  bodyHash,
  contactOf,
  encodeCursor,
  insertAddress,
  insertContact,
  insertPerson,
  listFilters,
  parseAddressInput,
  parseContactInput,
  parseListQuery,
  parsePersonInput,
  personOf,
  resolveTax,
  sameVersion,
  setArchived,
  SUMMARY_SELECT,
  summaryOf,
  touchContact,
  updateAddressRow,
  updateContact,
  updatePersonRow,
} from '../core/party/contacts';

const ROUTE = 'POST /v1/contacts';

export async function listContacts(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const query = parseListQuery(new URL(request.url));
  const where = listFilters(query).join(' AND ');
  const countWhere = listFilters({ ...query, cursor: null }).join(' AND ');
  const rows = await writer.read(`${SUMMARY_SELECT} WHERE ${where} ORDER BY c.updated_at DESC, c.id DESC LIMIT ${query.limit + 1}`);
  const totalRows = await writer.read<{ total: number }>(
    `SELECT count(*)::INTEGER AS total FROM party.contact c WHERE ${countWhere}`,
  );
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((row) => summaryOf(row, user)),
    next_cursor: hasMore && last ? encodeCursor(String(last.updated_at), String(last.id)) : null,
    total: Number(totalRows[0]?.total ?? 0),
  };
}

export async function exportContacts(writer: Writer, request: Request): Promise<Response> {
  const user = sessionOf(request);
  const url = new URL(request.url);
  url.searchParams.delete('cursor');
  url.searchParams.delete('limit');
  const query = parseListQuery(url);
  const where = listFilters({ ...query, cursor: null }).join(' AND ');
  const rows = await writer.read(`${SUMMARY_SELECT} WHERE ${where} ORDER BY c.legal_name, c.id`);
  const header = [
    'Nombre fiscal', 'Nombre comercial', 'NIF', 'Tipo de NIF', 'País', 'Tipo',
    'Cliente', 'Proveedor', 'Transportista', 'Operador logístico',
    'Ciudad', 'Provincia', 'Correo', 'Teléfono', 'Archivado', 'Actualizado',
  ];
  const lines = [header.join(';')];
  for (const row of rows) {
    const item = summaryOf(row, user);
    lines.push([
      item.legal_name,
      item.trade_name,
      item.tax_id,
      item.tax_id_type,
      item.country_code,
      item.kind === 'person' ? 'Persona' : 'Empresa',
      yes(item.is_customer),
      yes(item.is_supplier),
      yes(item.is_carrier),
      yes(item.is_logistics_operator),
      item.city,
      item.province,
      item.email,
      item.phone,
      item.archived_at ? 'Sí' : 'No',
      item.updated_at,
    ].map(csv).join(';'));
  }
  const bytes = Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
  return new Response(bytes, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contactos.csv"',
    },
  });
}

export async function createContact(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const key = idempotencyKey(request);
  const raw = await readJson(request);
  const input = parseContactInput(raw);
  const hash = bodyHash(raw);
  const tax = resolveTax(input.tax_id, input.country_code);
  const now = new Date();
  const id = newId();
  const personId = input.email || input.phone ? newId() : null;
  const outcome = await writer.withWrite(actor(user, request), async (tx) => {
    const prior = await tx.read<{ request_sha256: string; status_code: number; response: unknown }>(sql`
      SELECT request_sha256, status_code, response
      FROM ops.idempotency_key
      WHERE principal = ${principal(user.id)} AND key = ${key}
    `);
    const stored = prior[0];
    if (stored) {
      if (stored.request_sha256 !== hash) throw domainError('WC_IDEMPOTENCY_MISMATCH');
      return { status: Number(stored.status_code), body: stored.response, replay: true };
    }
    const duplicate = await liveDuplicate(tx, tax, undefined);
    if (duplicate) {
      const body = {
        code: 'WC_CONTACT_DUPLICATE_TAX_ID',
        message: `Ya existe ${duplicate.existing_name} con este NIF`,
        details: duplicate,
      };
      remember(tx, user.id, key, hash, 409, body, now);
      return { status: 409, body, replay: false };
    }
    insertContact(tx, id, input, tax, user.id, now);
    if (personId) {
      insertPerson(tx, id, personId, {
        full_name: input.legal_name,
        role: null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        receives_invoices: true,
        receives_dunning: false,
      }, now);
    }
    emitEvent(tx, {
      type: 'party.contact.created',
      aggregate: 'party.contact',
      aggregateId: id,
      payload: { contact_id: id, link: `/contactos/${id}` },
    });
    const body = createdBody(id, input, tax, personId, now, user);
    remember(tx, user.id, key, hash, 201, body, now);
    return { status: 201, body, replay: false };
  });
  return outcome;
}

export async function getContact(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const row = await oneContact(writer, id);
  const addresses = await writer.read(sql`
    SELECT * FROM party.contact_address
    WHERE contact_id = CAST(${id} AS UUID) AND archived_at IS NULL
    ORDER BY is_default DESC, created_at
  `);
  const persons = await writer.read(sql`
    SELECT * FROM party.contact_person
    WHERE contact_id = CAST(${id} AS UUID) AND archived_at IS NULL
    ORDER BY receives_invoices DESC, created_at
  `);
  return contactOf(row, user, addresses, persons);
}

export async function patchContact(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const input = parseContactInput(await readJson(request));
  const offered = request.headers.get('if-match');
  if (!offered) throw domainError('WC_VALIDATION', { 'if-match': 'Falta la versión del contacto' });
  const tax = resolveTax(input.tax_id, input.country_code);
  const now = new Date();
  await writer.withWrite(actor(user, request), async (tx) => {
    const current = await requireContact(tx, id);
    if (!sameVersion(String(current.updated_at), offered)) throw domainError('WC_STALE_VERSION');
    await assertTaxAvailable(tx, tax, id);
    updateContact(tx, id, current, input, tax, now);
    await syncPrimaryPerson(tx, id, input, now);
  });
  return getContact(writer, request, id);
}

export async function archiveContact(writer: Writer, request: Request, id: string, restore: boolean) {
  const user = sessionOf(request);
  const now = new Date();
  await writer.withWrite(actor(user, request), async (tx) => {
    const current = await requireContact(tx, id);
    const wasArchived = current.archived_at != null;
    if (restore && taxOf(current)) await assertTaxAvailable(tx, taxOf(current), id);
    setArchived(tx, 'party.contact', id, now, restore);
    tx.audit({
      table: 'party.contact',
      rowId: id,
      action: 'UPDATE',
      before: { archived_at: current.archived_at ?? null },
      after: { archived_at: restore ? null : now.toISOString() },
    });
    if (!restore && !wasArchived) {
      emitEvent(tx, {
        type: 'party.contact.archived',
        aggregate: 'party.contact',
        aggregateId: id,
        payload: { contact_id: id, link: `/contactos/${id}` },
      });
    }
  });
  return getContact(writer, request, id);
}

export async function createAddress(writer: Writer, request: Request, contactId: string) {
  const user = sessionOf(request);
  const input = parseAddressInput(await readJson(request));
  const addressId = newId();
  const now = new Date();
  await writer.withWrite(actor(user, request), async (tx) => {
    await requireContact(tx, contactId);
    insertAddress(tx, contactId, addressId, input, now);
    touchContact(tx, contactId, now);
  });
  const rows = await writer.read(sql`SELECT * FROM party.contact_address WHERE id = CAST(${addressId} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return addressOf(row, user);
}

export async function patchAddress(writer: Writer, request: Request, contactId: string, addressId: string) {
  const user = sessionOf(request);
  const input = parseAddressInput(await readJson(request));
  const now = new Date();
  await writer.withWrite(actor(user, request), async (tx) => {
    const current = await requireAddress(tx, contactId, addressId);
    updateAddressRow(tx, contactId, addressId, current, input);
    touchContact(tx, contactId, now);
  });
  const rows = await writer.read(sql`SELECT * FROM party.contact_address WHERE id = CAST(${addressId} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return addressOf(row, user);
}

export async function archiveAddress(writer: Writer, request: Request, contactId: string, addressId: string) {
  const user = sessionOf(request);
  const now = new Date();
  await writer.withWrite(actor(user, request), async (tx) => {
    const current = await requireAddress(tx, contactId, addressId);
    setArchived(tx, 'party.contact_address', addressId, now, false);
    tx.audit({
      table: 'party.contact_address',
      rowId: addressId,
      action: 'UPDATE',
      before: { archived_at: null },
      after: { archived_at: now.toISOString() },
    });
    touchContact(tx, contactId, now);
    void current;
  });
  return { archived: true };
}

export async function createPerson(writer: Writer, request: Request, contactId: string) {
  const user = sessionOf(request);
  const input = parsePersonInput(await readJson(request));
  const personId = newId();
  const now = new Date();
  await writer.withWrite(actor(user, request), async (tx) => {
    await requireContact(tx, contactId);
    insertPerson(tx, contactId, personId, input, now);
    touchContact(tx, contactId, now);
  });
  const rows = await writer.read(sql`SELECT * FROM party.contact_person WHERE id = CAST(${personId} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return personOf(row, user);
}

export async function patchPerson(writer: Writer, request: Request, contactId: string, personId: string) {
  const user = sessionOf(request);
  const input = parsePersonInput(await readJson(request));
  const now = new Date();
  await writer.withWrite(actor(user, request), async (tx) => {
    const current = await requirePerson(tx, contactId, personId);
    updatePersonRow(tx, personId, current, input);
    touchContact(tx, contactId, now);
  });
  const rows = await writer.read(sql`SELECT * FROM party.contact_person WHERE id = CAST(${personId} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return personOf(row, user);
}

export async function archivePerson(writer: Writer, request: Request, contactId: string, personId: string) {
  const user = sessionOf(request);
  const now = new Date();
  await writer.withWrite(actor(user, request), async (tx) => {
    await requirePerson(tx, contactId, personId);
    setArchived(tx, 'party.contact_person', personId, now, false);
    tx.audit({
      table: 'party.contact_person',
      rowId: personId,
      action: 'UPDATE',
      before: { archived_at: null },
      after: { archived_at: now.toISOString() },
    });
    touchContact(tx, contactId, now);
  });
  return { archived: true };
}

async function oneContact(writer: Writer, id: string) {
  requireUuid(id);
  const rows = await writer.read(`${SUMMARY_SELECT} WHERE c.id = CAST(${sqlQuote(id)} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

function sqlQuote(id: string): string {
  return `'${id}'`;
}

async function requireContact(tx: { read: Writer['read'] }, id: string) {
  requireUuid(id);
  const rows = await tx.read(sql`SELECT * FROM party.contact WHERE id = CAST(${id} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function requireAddress(tx: { read: Writer['read'] }, contactId: string, addressId: string) {
  requireUuid(contactId);
  requireUuid(addressId);
  const rows = await tx.read(sql`
    SELECT * FROM party.contact_address
    WHERE id = CAST(${addressId} AS UUID) AND contact_id = CAST(${contactId} AS UUID) AND archived_at IS NULL
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function requirePerson(tx: { read: Writer['read'] }, contactId: string, personId: string) {
  requireUuid(contactId);
  requireUuid(personId);
  const rows = await tx.read(sql`
    SELECT * FROM party.contact_person
    WHERE id = CAST(${personId} AS UUID) AND contact_id = CAST(${contactId} AS UUID) AND archived_at IS NULL
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function liveDuplicate(
  tx: { read: Writer['read'] },
  tax: { taxId: string | null },
  exceptId: string | undefined,
) {
  if (!tax.taxId) return null;
  const rows = await tx.read<{ id: string; legal_name: string }>(sql`
    SELECT id, legal_name FROM party.contact
    WHERE tax_id = ${tax.taxId} AND archived_at IS NULL AND merged_into_id IS NULL
      AND (${exceptId ?? null} IS NULL OR id <> CAST(${exceptId ?? null} AS UUID))
    LIMIT 1
  `);
  const row = rows[0];
  return row ? { existing_id: row.id, existing_name: row.legal_name } : null;
}

function taxOf(row: Record<string, unknown>) {
  return {
    taxId: row.tax_id == null ? null : String(row.tax_id),
    taxIdType: String(row.tax_id_type),
    taxIdCountry: row.tax_id_country == null ? null : String(row.tax_id_country),
    warning: null,
  };
}

async function syncPrimaryPerson(
  tx: { read: Writer['read']; write: (sql: string) => void; audit: Parameters<typeof insertPerson>[0]['audit'] },
  contactId: string,
  input: { legal_name: string; email?: string; phone?: string },
  now: Date,
) {
  if (!input.email && !input.phone) return;
  const people = await tx.read(sql`
    SELECT * FROM party.contact_person
    WHERE contact_id = CAST(${contactId} AS UUID) AND archived_at IS NULL
    ORDER BY receives_invoices DESC, created_at LIMIT 1
  `);
  const current = people[0];
  if (!current) {
    insertPerson(tx as Parameters<typeof insertPerson>[0], contactId, newId(), {
      full_name: input.legal_name,
      role: null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      receives_invoices: true,
      receives_dunning: false,
    }, now);
    return;
  }
  updatePersonRow(tx as Parameters<typeof updatePersonRow>[0], String(current.id), current, {
    full_name: String(current.full_name),
    role: current.role == null ? null : String(current.role),
    email: input.email ?? null,
    phone: input.phone ?? null,
    receives_invoices: current.receives_invoices === true,
    receives_dunning: current.receives_dunning === true,
  });
}

function remember(
  tx: { write: (sql: string) => void },
  userId: string,
  key: string,
  hash: string,
  status: number,
  body: unknown,
  now: Date,
) {
  tx.write(sql`
    INSERT INTO ops.idempotency_key (key, principal, route, request_sha256, status_code, response, created_at)
    VALUES (${key}, ${principal(userId)}, ${ROUTE}, ${hash}, ${status}, ${sql.json(body)}, ${now})
  `);
}

function createdBody(
  id: string,
  input: ReturnType<typeof parseContactInput>,
  tax: ReturnType<typeof resolveTax>,
  personId: string | null,
  now: Date,
  user: ReturnType<typeof sessionOf>,
) {
  const iso = now.toISOString();
  const personal = seesPersonalContactData(user);
  return {
    id,
    kind: input.kind,
    legal_name: input.legal_name,
    trade_name: input.trade_name ?? null,
    tax_id: tax.taxId,
    tax_id_type: tax.taxIdType,
    country_code: input.country_code,
    is_customer: input.is_customer,
    is_supplier: input.is_supplier,
    is_carrier: input.is_carrier,
    is_logistics_operator: input.is_logistics_operator,
    city: null,
    province: null,
    email: personal ? input.email ?? null : null,
    phone: personal ? input.phone ?? null : null,
    archived_at: null,
    updated_at: iso,
    language: input.language,
    vat_regime: input.vat_regime,
    payment_method: input.payment_method ?? null,
    payment_terms_days: input.payment_terms_days,
    notes: input.notes ?? null,
    excise_number: input.excise_number ?? null,
    eori: input.eori ?? null,
    tax_id_warning: tax.warning,
    created_at: iso,
    addresses: [],
    persons: personId ? [{
      id: personId,
      full_name: input.legal_name,
      role: null,
      email: personal ? input.email ?? null : null,
      phone: personal ? input.phone ?? null : null,
      receives_invoices: true,
      receives_dunning: false,
    }] : [],
  };
}

function actor(user: { id: string }, request: Request) {
  return {
    type: 'user' as const,
    id: user.id,
    requestId: request.headers.get('x-request-id') ?? newId(),
  };
}

function principal(userId: string): string {
  return `user:${userId}`;
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (key.length < 8 || key.length > 128) {
    throw domainError('WC_VALIDATION', { 'idempotency-key': 'La clave debe tener entre 8 y 128 caracteres' });
  }
  return key;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}

function requireUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw domainError('WC_NOT_FOUND');
  }
}

function yes(value: boolean): string {
  return value ? 'Sí' : 'No';
}

function csv(value: string | null): string {
  const text = value ?? '';
  if (/[;"\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
