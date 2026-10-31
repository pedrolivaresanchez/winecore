import { canonicalJson } from '../db/audit';
import { sha256Hex } from '../hash';
import { newId } from '../ids';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { seesPersonalContactData, type UserCtx } from '../auth/permissions';
import { normalizeTaxId, type TaxIdResult } from './taxId';
import { clearOtherDefaultAddresses, findLiveTaxId } from './guards';

const KINDS = new Set(['company', 'person']);
const LANGUAGES = new Set(['es', 'en']);
const VAT = new Set([
  'general', 'equivalence_surcharge', 'export', 'intra_eu', 'canary_ceuta_melilla', 'exempt_other',
]);
const PAYMENTS = new Set(['transfer', 'direct_debit', 'card', 'cash', 'stripe', 'other']);
const ADDRESS_KINDS = new Set(['billing', 'shipping', 'both']);
const ROLES = new Set(['customer', 'supplier', 'carrier', 'logistics_operator']);

export interface ContactInput {
  kind: string;
  legal_name: string;
  trade_name?: string;
  tax_id?: string;
  country_code: string;
  language: string;
  is_customer: boolean;
  is_supplier: boolean;
  is_carrier: boolean;
  is_logistics_operator: boolean;
  vat_regime: string;
  payment_method?: string;
  payment_terms_days: number;
  notes?: string;
  excise_number?: string;
  eori?: string;
  email?: string;
  phone?: string;
}

export interface AddressInput {
  kind: string;
  label?: string | null;
  line1: string;
  line2?: string | null;
  postal_code: string;
  city: string;
  province?: string | null;
  country_code: string;
  is_default: boolean;
}

export interface PersonInput {
  full_name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  receives_invoices: boolean;
  receives_dunning: boolean;
}

export interface ContactListQuery {
  q: string | null;
  kind: string | null;
  role: string | null;
  country: string | null;
  archived: boolean;
  cursor: string | null;
  limit: number;
}

interface StoredTax {
  taxId: string | null;
  taxIdType: string;
  taxIdCountry: string | null;
  warning: string | null;
}

export function parseContactInput(value: unknown): ContactInput {
  if (!value || typeof value !== 'object') {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  const body = value as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const kind = stringField(body.kind);
  if (!KINDS.has(kind)) fields.kind = 'Debe ser company o person';
  const legalName = stringField(body.legal_name);
  if (legalName.length < 2 || legalName.length > 120) fields.legal_name = 'Debe tener entre 2 y 120 caracteres';
  const country = stringField(body.country_code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) fields.country_code = 'Debe ser un código de país de 2 letras';
  const language = stringField(body.language);
  if (!LANGUAGES.has(language)) fields.language = 'Debe ser es o en';
  const vat = stringField(body.vat_regime);
  if (!VAT.has(vat)) fields.vat_regime = 'Régimen de IVA no válido';
  const terms = body.payment_terms_days;
  if (typeof terms !== 'number' || !Number.isInteger(terms) || terms < 0 || terms > 180) {
    fields.payment_terms_days = 'Debe ser un entero entre 0 y 180';
  }
  for (const flag of ['is_customer', 'is_supplier', 'is_carrier', 'is_logistics_operator'] as const) {
    if (typeof body[flag] !== 'boolean') fields[flag] = 'Debe ser verdadero o falso';
  }
  const payment = optionalString(body.payment_method);
  if (payment && !PAYMENTS.has(payment)) fields.payment_method = 'Forma de pago no válida';
  const email = optionalString(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Correo no válido';
  const phone = optionalString(body.phone);
  if (phone && phone.length > 40) fields.phone = 'Teléfono demasiado largo';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return {
    kind,
    legal_name: legalName,
    trade_name: optionalString(body.trade_name),
    tax_id: optionalString(body.tax_id),
    country_code: country,
    language,
    is_customer: body.is_customer === true,
    is_supplier: body.is_supplier === true,
    is_carrier: body.is_carrier === true,
    is_logistics_operator: body.is_logistics_operator === true,
    vat_regime: vat,
    payment_method: payment,
    payment_terms_days: terms as number,
    notes: optionalString(body.notes),
    excise_number: optionalString(body.excise_number),
    eori: optionalString(body.eori),
    email: email?.toLowerCase(),
    phone,
  };
}

export function parseAddressInput(value: unknown): AddressInput {
  if (!value || typeof value !== 'object') {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  const body = value as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const kind = stringField(body.kind);
  if (!ADDRESS_KINDS.has(kind)) fields.kind = 'Debe ser billing, shipping o both';
  const line1 = stringField(body.line1);
  if (line1.length < 1 || line1.length > 120) fields.line1 = 'La dirección es obligatoria';
  const city = stringField(body.city);
  if (city.length < 1 || city.length > 80) fields.city = 'La ciudad es obligatoria';
  const postal = stringField(body.postal_code);
  if (postal.length < 1 || postal.length > 12) fields.postal_code = 'El código postal es obligatorio';
  const country = stringField(body.country_code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) fields.country_code = 'Debe ser un código de país de 2 letras';
  if (typeof body.is_default !== 'boolean') fields.is_default = 'Debe ser verdadero o falso';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return {
    kind,
    label: optionalString(body.label) ?? null,
    line1,
    line2: optionalString(body.line2) ?? null,
    postal_code: postal,
    city,
    province: optionalString(body.province) ?? null,
    country_code: country,
    is_default: body.is_default === true,
  };
}

export function parsePersonInput(value: unknown): PersonInput {
  if (!value || typeof value !== 'object') {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  const body = value as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const name = stringField(body.full_name);
  if (name.length < 2 || name.length > 80) fields.full_name = 'Debe tener entre 2 y 80 caracteres';
  const email = optionalString(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Correo no válido';
  const phone = optionalString(body.phone);
  if (phone && phone.length > 40) fields.phone = 'Teléfono demasiado largo';
  if (typeof body.receives_invoices !== 'boolean') fields.receives_invoices = 'Debe ser verdadero o falso';
  if (typeof body.receives_dunning !== 'boolean') fields.receives_dunning = 'Debe ser verdadero o falso';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return {
    full_name: name,
    role: optionalString(body.role) ?? null,
    email: email?.toLowerCase() ?? null,
    phone: phone ?? null,
    receives_invoices: body.receives_invoices === true,
    receives_dunning: body.receives_dunning === true,
  };
}

export function parseListQuery(url: URL): ContactListQuery {
  const fields: Record<string, string> = {};
  const kind = url.searchParams.get('kind')?.trim() || null;
  if (kind && !KINDS.has(kind)) fields.kind = 'Debe ser company o person';
  const role = url.searchParams.get('role')?.trim() || null;
  if (role && !ROLES.has(role)) fields.role = 'Rol no válido';
  const country = url.searchParams.get('country')?.trim().toUpperCase() || null;
  if (country && !/^[A-Z]{2}$/.test(country)) fields.country = 'Debe ser un código de país de 2 letras';
  const archivedRaw = url.searchParams.get('archived');
  const archived = archivedRaw === 'true';
  if (archivedRaw && archivedRaw !== 'true' && archivedRaw !== 'false') fields.archived = 'Debe ser true o false';
  const limitRaw = url.searchParams.get('limit');
  let limit = 50;
  if (limitRaw && limitRaw.trim() !== '') {
    if (!/^\d{1,3}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 100) {
      fields.limit = 'Debe ser un entero entre 1 y 100';
    } else {
      limit = Number(limitRaw);
    }
  }
  const cursor = url.searchParams.get('cursor')?.trim() || null;
  if (cursor && !decodeCursor(cursor)) fields.cursor = 'Cursor no válido';
  const q = url.searchParams.get('q')?.trim() || null;
  if (q && q.length > 120) fields.q = 'La búsqueda es demasiado larga';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return { q, kind, role, country, archived, cursor, limit };
}

export function resolveTax(raw: string | undefined, country: string): StoredTax {
  if (!raw) return { taxId: null, taxIdType: 'none', taxIdCountry: null, warning: null };
  const result = normalizeTaxId(raw, country);
  if (result.normalized == null) {
    throw domainError('WC_VALIDATION', { tax_id: 'El identificador fiscal no se puede almacenar' });
  }
  return {
    taxId: result.normalized,
    taxIdType: result.type,
    taxIdCountry: result.country,
    warning: result.valid ? null : result.warning ?? null,
  };
}

export function warningFor(taxId: string | null, taxIdType: string, country: string | null): string | null {
  if (!taxId || taxIdType !== 'none') return null;
  const result: TaxIdResult = normalizeTaxId(taxId, country ?? undefined);
  return result.valid ? null : result.warning ?? null;
}

export function listFilters(query: ContactListQuery): string[] {
  const filters = [
    'c.merged_into_id IS NULL',
    query.archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL',
  ];
  if (query.kind) filters.push(sql`c.kind = ${query.kind}`);
  if (query.country) filters.push(sql`c.country_code = ${query.country}`);
  if (query.role === 'customer') filters.push('c.is_customer');
  if (query.role === 'supplier') filters.push('c.is_supplier');
  if (query.role === 'carrier') filters.push('c.is_carrier');
  if (query.role === 'logistics_operator') filters.push('c.is_logistics_operator');
  if (query.q) {
    const folded = `%${escapeLike(fold(query.q))}%`;
    const tax = `%${normalizeTaxId(query.q).normalized ?? fold(query.q).toUpperCase()}%`;
    filters.push(sql`(
      strip_accents(lower(c.legal_name)) LIKE ${folded}
      OR strip_accents(lower(coalesce(c.trade_name, ''))) LIKE ${folded}
      OR coalesce(c.tax_id, '') LIKE ${tax}
      OR EXISTS (
        SELECT 1 FROM party.contact_person p
        WHERE p.contact_id = c.id AND p.archived_at IS NULL
          AND strip_accents(lower(coalesce(p.email, ''))) LIKE ${folded}
      )
    )`);
  }
  const decoded = query.cursor ? decodeCursor(query.cursor) : null;
  if (decoded) {
    filters.push(sql`(
      c.updated_at < CAST(${decoded.at} AS TIMESTAMPTZ)
      OR (c.updated_at = CAST(${decoded.at} AS TIMESTAMPTZ) AND c.id < CAST(${decoded.id} AS UUID))
    )`);
  }
  return filters;
}

export const SUMMARY_SELECT = `
  SELECT c.id, c.kind, c.legal_name, c.trade_name, c.tax_id, c.tax_id_type, c.tax_id_country,
         c.country_code, c.is_customer, c.is_supplier, c.is_carrier, c.is_logistics_operator,
         c.language, c.vat_regime, c.payment_method, c.payment_terms_days, c.notes,
         c.excise_number, c.eori, c.archived_at, c.created_at, c.updated_at,
         (SELECT a.city FROM party.contact_address a
           WHERE a.contact_id = c.id AND a.archived_at IS NULL AND a.kind IN ('billing', 'both')
           ORDER BY a.is_default DESC, a.created_at LIMIT 1) AS city,
         (SELECT a.province FROM party.contact_address a
           WHERE a.contact_id = c.id AND a.archived_at IS NULL AND a.kind IN ('billing', 'both')
           ORDER BY a.is_default DESC, a.created_at LIMIT 1) AS province,
         (SELECT p.email FROM party.contact_person p
           WHERE p.contact_id = c.id AND p.archived_at IS NULL
           ORDER BY p.receives_invoices DESC, p.created_at LIMIT 1) AS email,
         (SELECT p.phone FROM party.contact_person p
           WHERE p.contact_id = c.id AND p.archived_at IS NULL
           ORDER BY p.receives_invoices DESC, p.created_at LIMIT 1) AS phone
  FROM party.contact c
`;

export function summaryOf(row: Record<string, unknown>, viewer: UserCtx) {
  const personal = seesPersonalContactData(viewer);
  return {
    id: String(row.id),
    kind: String(row.kind),
    legal_name: String(row.legal_name),
    trade_name: text(row.trade_name),
    tax_id: text(row.tax_id),
    tax_id_type: text(row.tax_id_type),
    country_code: String(row.country_code),
    is_customer: row.is_customer === true,
    is_supplier: row.is_supplier === true,
    is_carrier: row.is_carrier === true,
    is_logistics_operator: row.is_logistics_operator === true,
    city: text(row.city),
    province: text(row.province),
    email: personal ? text(row.email) : null,
    phone: personal ? text(row.phone) : null,
    archived_at: text(row.archived_at),
    updated_at: String(row.updated_at),
  };
}

export function contactOf(
  row: Record<string, unknown>,
  viewer: UserCtx,
  addresses: Record<string, unknown>[],
  persons: Record<string, unknown>[],
) {
  return {
    ...summaryOf(row, viewer),
    language: String(row.language),
    vat_regime: String(row.vat_regime),
    payment_method: text(row.payment_method),
    payment_terms_days: Number(row.payment_terms_days),
    notes: text(row.notes),
    excise_number: text(row.excise_number),
    eori: text(row.eori),
    tax_id_warning: warningFor(text(row.tax_id), String(row.tax_id_type), text(row.tax_id_country)),
    created_at: String(row.created_at),
    addresses: addresses.map((address) => addressOf(address, viewer)),
    persons: persons.map((person) => personOf(person, viewer)),
  };
}

export function addressOf(row: Record<string, unknown>, viewer?: UserCtx) {
  const personal = viewer === undefined || seesPersonalContactData(viewer);
  return {
    id: String(row.id),
    kind: String(row.kind),
    label: personal ? text(row.label) : null,
    line1: personal ? String(row.line1) : null,
    line2: personal ? text(row.line2) : null,
    postal_code: personal ? String(row.postal_code) : null,
    city: String(row.city),
    province: text(row.province),
    country_code: String(row.country_code),
    is_default: row.is_default === true,
  };
}

export function personOf(row: Record<string, unknown>, viewer: UserCtx) {
  const personal = seesPersonalContactData(viewer);
  return {
    id: String(row.id),
    full_name: String(row.full_name),
    role: text(row.role),
    email: personal ? text(row.email) : null,
    phone: personal ? text(row.phone) : null,
    receives_invoices: row.receives_invoices === true,
    receives_dunning: row.receives_dunning === true,
  };
}

export function insertContact(tx: Tx, id: string, input: ContactInput, tax: StoredTax, actorId: string, now: Date): void {
  tx.write(sql`
    INSERT INTO party.contact (
      id, kind, legal_name, trade_name, tax_id, tax_id_type, tax_id_country, country_code,
      language, is_customer, is_supplier, is_carrier, is_logistics_operator, vat_regime,
      payment_method, payment_terms_days, notes, excise_number, eori, created_by, created_at, updated_at
    ) VALUES (
      CAST(${id} AS UUID), ${input.kind}, ${input.legal_name}, ${input.trade_name ?? null},
      ${tax.taxId}, ${tax.taxIdType}, ${tax.taxIdCountry}, ${input.country_code},
      ${input.language}, ${input.is_customer}, ${input.is_supplier}, ${input.is_carrier},
      ${input.is_logistics_operator}, ${input.vat_regime}, ${input.payment_method ?? null},
      ${input.payment_terms_days}, ${input.notes ?? null}, ${input.excise_number ?? null},
      ${input.eori ?? null}, ${actorId}, ${now}, ${now}
    )
  `);
  tx.audit({
    table: 'party.contact',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: contactAudit(input, tax),
  });
}

export function updateContact(tx: Tx, id: string, before: Record<string, unknown>, input: ContactInput, tax: StoredTax, now: Date): void {
  tx.write(sql`
    UPDATE party.contact SET
      kind = ${input.kind},
      legal_name = ${input.legal_name},
      trade_name = ${input.trade_name ?? null},
      tax_id = ${tax.taxId},
      tax_id_type = ${tax.taxIdType},
      tax_id_country = ${tax.taxIdCountry},
      country_code = ${input.country_code},
      language = ${input.language},
      is_customer = ${input.is_customer},
      is_supplier = ${input.is_supplier},
      is_carrier = ${input.is_carrier},
      is_logistics_operator = ${input.is_logistics_operator},
      vat_regime = ${input.vat_regime},
      payment_method = ${input.payment_method ?? null},
      payment_terms_days = ${input.payment_terms_days},
      notes = ${input.notes ?? null},
      excise_number = ${input.excise_number ?? null},
      eori = ${input.eori ?? null},
      updated_at = ${now}
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({
    table: 'party.contact',
    rowId: id,
    action: 'UPDATE',
    before: contactSnapshot(before),
    after: contactAudit(input, tax),
  });
}

export function insertPerson(tx: Tx, contactId: string, personId: string, input: PersonInput, now: Date): void {
  tx.write(sql`
    INSERT INTO party.contact_person (
      id, contact_id, full_name, role, email, phone, receives_invoices, receives_dunning, created_at
    ) VALUES (
      CAST(${personId} AS UUID), CAST(${contactId} AS UUID), ${input.full_name}, ${input.role ?? null},
      ${input.email ?? null}, ${input.phone ?? null}, ${input.receives_invoices}, ${input.receives_dunning}, ${now}
    )
  `);
  tx.audit({
    table: 'party.contact_person',
    rowId: personId,
    action: 'INSERT',
    before: null,
    after: { ...input, contact_id: contactId },
  });
}

export function updatePersonRow(tx: Tx, personId: string, before: Record<string, unknown>, input: PersonInput): void {
  tx.write(sql`
    UPDATE party.contact_person SET
      full_name = ${input.full_name},
      role = ${input.role ?? null},
      email = ${input.email ?? null},
      phone = ${input.phone ?? null},
      receives_invoices = ${input.receives_invoices},
      receives_dunning = ${input.receives_dunning}
    WHERE id = CAST(${personId} AS UUID) AND archived_at IS NULL
  `);
  tx.audit({
    table: 'party.contact_person',
    rowId: personId,
    action: 'UPDATE',
    before: {
      full_name: before.full_name,
      role: before.role ?? null,
      email: before.email ?? null,
      phone: before.phone ?? null,
      receives_invoices: before.receives_invoices === true,
      receives_dunning: before.receives_dunning === true,
    },
    after: { ...input },
  });
}

export function insertAddress(tx: Tx, contactId: string, addressId: string, input: AddressInput, now: Date): void {
  if (input.is_default) clearOtherDefaultAddresses(tx, contactId, input.kind, addressId);
  tx.write(sql`
    INSERT INTO party.contact_address (
      id, contact_id, kind, label, line1, line2, postal_code, city, province, country_code, is_default, created_at
    ) VALUES (
      CAST(${addressId} AS UUID), CAST(${contactId} AS UUID), ${input.kind}, ${input.label ?? null},
      ${input.line1}, ${input.line2 ?? null}, ${input.postal_code}, ${input.city}, ${input.province ?? null},
      ${input.country_code}, ${input.is_default}, ${now}
    )
  `);
  tx.audit({
    table: 'party.contact_address',
    rowId: addressId,
    action: 'INSERT',
    before: null,
    after: { ...input, contact_id: contactId },
  });
}

export function updateAddressRow(tx: Tx, contactId: string, addressId: string, before: Record<string, unknown>, input: AddressInput): void {
  if (input.is_default) clearOtherDefaultAddresses(tx, contactId, input.kind, addressId);
  tx.write(sql`
    UPDATE party.contact_address SET
      kind = ${input.kind},
      label = ${input.label ?? null},
      line1 = ${input.line1},
      line2 = ${input.line2 ?? null},
      postal_code = ${input.postal_code},
      city = ${input.city},
      province = ${input.province ?? null},
      country_code = ${input.country_code},
      is_default = ${input.is_default}
    WHERE id = CAST(${addressId} AS UUID) AND contact_id = CAST(${contactId} AS UUID) AND archived_at IS NULL
  `);
  tx.audit({
    table: 'party.contact_address',
    rowId: addressId,
    action: 'UPDATE',
    before: {
      kind: before.kind,
      label: before.label ?? null,
      line1: before.line1,
      city: before.city,
      is_default: before.is_default === true,
    },
    after: { ...input },
  });
}

export async function assertTaxAvailable(tx: Tx, tax: StoredTax, exceptId?: string): Promise<void> {
  if (!tax.taxId) return;
  const existing = await findLiveTaxId(tx, tax.taxId, exceptId);
  if (!existing) return;
  throw domainError('WC_CONTACT_DUPLICATE_TAX_ID', undefined, {
    existing_id: existing.id,
    existing_name: existing.legal_name,
  });
}

export function setArchived(
  tx: Tx,
  table: 'party.contact' | 'party.contact_address' | 'party.contact_person',
  id: string,
  now: Date,
  restore: boolean,
): void {
  const when = restore ? null : now;
  if (table === 'party.contact') {
    tx.write(sql`
      UPDATE party.contact
      SET archived_at = ${when}, updated_at = ${now}
      WHERE id = CAST(${id} AS UUID)
    `);
    return;
  }
  if (table === 'party.contact_address') {
    tx.write(sql`
      UPDATE party.contact_address
      SET archived_at = ${when}
      WHERE id = CAST(${id} AS UUID) AND contact_id IS NOT NULL
    `);
    return;
  }
  tx.write(sql`
    UPDATE party.contact_person
    SET archived_at = ${when}
    WHERE id = CAST(${id} AS UUID)
  `);
}

export function touchContact(tx: Tx, id: string, now: Date): void {
  tx.write(sql`UPDATE party.contact SET updated_at = ${now} WHERE id = CAST(${id} AS UUID)`);
}

export function sameVersion(current: string, offered: string | null): boolean {
  if (!offered) return false;
  const left = Date.parse(current);
  const right = Date.parse(offered.replace(/^"|"$/g, ''));
  return Number.isFinite(left) && left === right;
}

export function bodyHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function newContactId(): string {
  return newId();
}

export function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(`${updatedAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { at: string; id: string } | null {
  try {
    const text = Buffer.from(cursor, 'base64url').toString('utf8');
    const split = text.lastIndexOf('|');
    if (split <= 0) return null;
    const at = text.slice(0, split);
    const id = text.slice(split + 1);
    if (!Number.isFinite(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

function contactAudit(input: ContactInput, tax: StoredTax) {
  return {
    kind: input.kind,
    legal_name: input.legal_name,
    trade_name: input.trade_name ?? null,
    tax_id: tax.taxId,
    tax_id_type: tax.taxIdType,
    country_code: input.country_code,
    language: input.language,
    is_customer: input.is_customer,
    is_supplier: input.is_supplier,
    is_carrier: input.is_carrier,
    is_logistics_operator: input.is_logistics_operator,
    vat_regime: input.vat_regime,
    payment_method: input.payment_method ?? null,
    payment_terms_days: input.payment_terms_days,
    notes: input.notes ?? null,
  };
}

function contactSnapshot(row: Record<string, unknown>) {
  return {
    kind: row.kind,
    legal_name: row.legal_name,
    trade_name: row.trade_name ?? null,
    tax_id: row.tax_id ?? null,
    tax_id_type: row.tax_id_type,
    country_code: row.country_code,
    language: row.language,
    is_customer: row.is_customer === true,
    is_supplier: row.is_supplier === true,
    is_carrier: row.is_carrier === true,
    is_logistics_operator: row.is_logistics_operator === true,
    vat_regime: row.vat_regime,
    payment_method: row.payment_method ?? null,
    payment_terms_days: Number(row.payment_terms_days),
    notes: row.notes ?? null,
  };
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const rendered = String(value);
  return rendered === '' ? null : rendered;
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
