import { Decimal } from 'decimal.js';
import { duplicateKey } from '../../../src/core/party/duplicateKey';
import { normalizeTaxId } from '../../../src/core/party/taxId';
import type { KbClient } from '../../../src/core/db/client';
import { sql } from '../../../src/core/db/sql';
import { sha256Hex } from '../../../src/core/hash';
import { newId } from '../../../src/core/ids';
import type { WriteOp } from '../apply';
import { sealIban } from '../ibanStore';
import {
  cleanText,
  integerText,
  normalizeAccount,
  normalizeEmails,
  normalizePhone,
  normalizePostal,
  parseDate,
  parseLooseDecimal,
} from '../money';
import { bump, positive, type MigrationReport, type MigrationSource } from '../report';
import type { HoldedTable } from '../xlsx';

type DataKey = Buffer | null;

export interface ContactDraft {
  legalName: string;
  kind: 'company' | 'person';
  taxId: string | null;
  taxType: string;
  taxCountry: string | null;
  country: string;
  language: 'es' | 'en';
  currency: string;
  isCustomer: boolean;
  isSupplier: boolean;
  lead: boolean;
  paymentMethod: string | null;
  includeM347: boolean;
  email: string | null;
  phone: string | null;
  line1: string | null;
  city: string | null;
  postal: string | null;
  province: string | null;
  discount: Decimal;
  customerAccount: string | null;
  supplierAccount: string | null;
  ibanEnc: Uint8Array | null;
  ibanLast4: string | null;
  sepaRef: string | null;
  marketing: boolean;
  marketingSource: string | null;
  legacy: Record<string, string>;
  nameHash: string;
  nameKey: string;
  rowKey: string;
  entityKey: string;
  score: number;
}

interface LiveContact {
  id: string;
  origin: 'db' | 'batch';
  legalName: string;
  kind: 'company' | 'person';
  taxId: string | null;
  taxType: string;
  taxCountry: string | null;
  country: string;
  language: 'es' | 'en';
  currency: string;
  isCustomer: boolean;
  isSupplier: boolean;
  leadOnly: boolean;
  paymentMethod: string | null;
  includeM347: boolean;
  email: string | null;
  phone: string | null;
  personId: string | null;
  line1: string | null;
  city: string | null;
  postal: string | null;
  province: string | null;
  addressId: string | null;
  ibanLast4: string | null;
  ibanEnc: Uint8Array | null;
  sepaRef: string | null;
  marketing: boolean;
  marketingSource: string | null;
  legacy: Record<string, unknown>;
  rowKeys: Set<string>;
  nameKey: string;
  score: number;
  dirty: boolean;
  personDirty: boolean;
  addressDirty: boolean;
}

interface TermPlan {
  contactId: string;
  entityId: string;
  customerAccount: string | null;
  supplierAccount: string | null;
  discount: Decimal;
}

interface StubPlan {
  id: string;
  survivorId: string;
  draft: ContactDraft;
  rule: 'same_tax_id' | 'same_email' | 'same_name_postal_code';
  choices: Record<string, string>;
}

export interface ContactPlan {
  ops: WriteOp[];
  report: MigrationReport;
}

export function parseHoldedContacts(table: HoldedTable, entity: string, key: DataKey): {
  drafts: ContactDraft[];
  skipped: Record<string, number>;
  warnings: Record<string, number>;
  nifWarnings: number;
} {
  const skipped: Record<string, number> = {};
  const warnings: Record<string, number> = {};
  let nifWarnings = 0;
  const drafts: ContactDraft[] = [];
  const entityKey = `holded_${entity.toLowerCase()}`;
  for (const row of table.rows) {
    const legalName = cleanText(row.Nombre).slice(0, 120);
    if (cleanText(row.Nombre) === '') {
      bump(skipped, 'missing_name');
      continue;
    }
    if (cleanText(row.Nombre).length > 120) bump(warnings, 'NAME_TRUNCATED');
    const country = countryCode(row['Código país'], warnings);
    const tax = classifyTax(row.ID, country, warnings);
    if (tax.warning) nifWarnings += 1;
    const emails = normalizeEmails(row.Email);
    if (emails.invalid) bump(warnings, 'INVALID_EMAIL');
    if (emails.emails.length > 1) bump(warnings, 'MULTIPLE_EMAILS');
    const phoneA = normalizePhone(row['Teléfono']);
    const phoneB = normalizePhone(row['Móvil']);
    if (phoneA.warning || phoneB.warning) bump(warnings, 'INVALID_PHONE');
    const phone = phoneA.phone ?? phoneB.phone;
    const postal = normalizePostal(row['Código postal'], country);
    const line1 = cleanText(row['Dirección']);
    const city = cleanText(row['Población']);
    if (line1 !== '' && (city === '' || postal === null)) bump(warnings, 'MISSING_ADDRESS');
    const roles = contactRoles(row.Tipo, warnings);
    const accounts = accountsFor(roles, normalizeAccount(row.Cuenta), warnings);
    const payment = paymentMethod(row['F.Pago'], warnings);
    const currency = currencyCode(row.Moneda, warnings);
    const iban = sealIban(row.IBAN ?? '', key);
    if (iban.warning) bump(warnings, iban.warning);
    const legacy: Record<string, string> = {};
    const created = parseDate(row.Creado);
    if (created) legacy.holded_created_at = created;
    const reference = cleanText(row.Referencia);
    if (reference) legacy.referencia = reference;
    const tags = cleanText(row.Tags);
    if (tags) legacy.tags = tags;
    const portal = cleanText(row['Visibilidad Portal']);
    if (portal) legacy.visibilidad_portal = portal;
    const swift = cleanText(row.Swift);
    if (swift) legacy.swift = swift;
    const nameKey = duplicateKey({ name: legalName, postalCode: postal });
    const nameHash = sha256Hex(nameKey);
    legacy[entityKey] = nameHash;
    const draft = draftOf({
      legalName,
      kind: kindOf(row['Tipo de contacto']),
      taxId: tax.taxId,
      taxType: tax.taxType,
      taxCountry: tax.taxCountry,
      country,
      language: languageOf(row.Idioma),
      currency,
      isCustomer: roles.customer,
      isSupplier: roles.supplier,
      lead: roles.lead,
      paymentMethod: payment,
      includeM347: model347(row['Acumula en modelo 347']),
      email: emails.emails[0] ?? null,
      phone,
      line1: line1 || null,
      city: city || null,
      postal,
      province: cleanText(row.Provincia) || null,
      discount: discountOf(row['Dto. %'], warnings),
      customerAccount: accounts.customer,
      supplierAccount: accounts.supplier,
      ibanEnc: iban.enc,
      ibanLast4: iban.last4,
      sepaRef: cleanText(row['Ref. mandato']) || null,
      marketing: false,
      marketingSource: null,
      legacy,
      nameHash,
      nameKey,
      entityKey,
      rowKey: '',
      score: 0,
    });
    draft.rowKey = contactRowKey(draft);
    draft.score = draftScore(draft);
    drafts.push(draft);
  }
  return { drafts, skipped, warnings, nifWarnings };
}

export async function planContacts(input: {
  client: KbClient;
  source: MigrationSource;
  entity: string;
  entityId: string | null;
  fileSha256: string;
  drafts: ContactDraft[];
  rowsRead: number;
  skipped: Record<string, number>;
  warnings: Record<string, number>;
  nifWarnings: number;
  actorId: string;
  now: Date;
}): Promise<ContactPlan> {
  const state = await loadLive(input.client);
  const skipped = { ...input.skipped };
  const warnings = { ...input.warnings };
  let created = 0;
  let merged = 0;
  let proposals = 0;
  const stubs: StubPlan[] = [];
  const terms: TermPlan[] = [];
  const fresh: LiveContact[] = [];

  for (const draft of input.drafts) {
    if (state.rowKeys.has(draft.rowKey)) {
      bump(skipped, 'already_present');
      continue;
    }
    const shopifyId = draft.legacy.shopify;
    if (shopifyId && state.shopify.has(shopifyId)) {
      state.rowKeys.add(draft.rowKey);
      bump(skipped, 'already_present');
      continue;
    }
    const byTax = draft.taxId ? state.byTax.get(draft.taxId) : undefined;
    if (byTax) {
      absorb(state, byTax, draft, 'same_tax_id', input, terms, stubs, warnings);
      merged += 1;
      continue;
    }
    const byEmail = draft.email ? state.byEmail.get(draft.email) : undefined;
    if (byEmail && taxesCompatible(byEmail.taxId, draft.taxId)) {
      absorb(state, byEmail, draft, 'same_email', input, terms, stubs, warnings);
      merged += 1;
      continue;
    }
    const natural = draft.taxId ? undefined : state.natural.get(`${draft.entityKey}:${draft.nameHash}`);
    if (natural) {
      absorb(state, natural, draft, 'same_name_postal_code', input, terms, stubs, warnings);
      merged += 1;
      continue;
    }
    const live = fromDraft(draft, 'batch');
    fresh.push(live);
    remember(state, live);
    addTerm(terms, live.id, draft, input.entityId, warnings);
    created += 1;
    if (byEmail && !taxesCompatible(byEmail.taxId, draft.taxId)) {
      proposals += 1;
      bump(warnings, 'TAX_ID_CONFLICT');
    } else if (proposalName(state, live)) {
      proposals += 1;
    }
  }

  const ops: WriteOp[] = [];
  for (const live of fresh) ops.push(...insertContactOps(live, input.actorId, input.now));
  for (const live of state.loaded) {
    if (live.dirty) ops.push(...updateContactOps(live, input.now));
  }
  for (const term of terms) ops.push(termOp(term, input.now));
  for (const stub of stubs) ops.push(...stubOps(stub, input.actorId, input.now));

  const withoutTax = input.drafts.filter((draft) => draft.taxId === null).length;
  const report: MigrationReport = {
    source: input.source,
    entity: input.entity,
    dataset: 'contacts',
    file_sha256: input.fileSha256,
    rows_read: input.rowsRead,
    created,
    merged_duplicates: merged,
    proposals_pending: proposals,
    nif_warnings: input.nifWarnings,
    skipped: positive(skipped),
    warnings: positive(warnings),
    totals: {},
    resulting: {
      without_tax_id: withoutTax,
      archived_leads: fresh.filter((live) => live.leadOnly && !live.isCustomer && !live.isSupplier).length,
    },
  };
  return { ops, report };
}

export async function loadLive(client: KbClient): Promise<FoldState> {
  const state = emptyState();
  const contacts = await client.query<Record<string, unknown>>(sql`
    SELECT id, legal_name, tax_id, tax_id_type, tax_id_country, kind, country_code, language,
           currency, is_customer, is_supplier, payment_method, include_in_m347, vat_regime,
           legacy_refs, archived_at, iban_last4, marketing_consent, marketing_consent_source,
           sepa_mandate_ref
    FROM party.contact
    WHERE merged_into_id IS NULL
  `);
  const persons = await client.query<Record<string, unknown>>(sql`
    SELECT id, contact_id, email, phone
    FROM party.contact_person
    WHERE archived_at IS NULL
  `);
  const addresses = await client.query<Record<string, unknown>>(sql`
    SELECT id, contact_id, line1, postal_code, city, province
    FROM party.contact_address
    WHERE archived_at IS NULL AND is_default
  `);
  const personByContact = new Map<string, Record<string, unknown>>();
  for (const person of persons) personByContact.set(String(person.contact_id), person);
  const addressByContact = new Map<string, Record<string, unknown>>();
  for (const address of addresses) addressByContact.set(String(address.contact_id), address);
  for (const row of contacts) {
    const legacy = asObject(row.legacy_refs);
    const rowKeys = new Set<string>();
    const storedKeys = legacy.row_keys;
    if (Array.isArray(storedKeys)) {
      for (const key of storedKeys) if (typeof key === 'string') rowKeys.add(key);
    }
    const person = personByContact.get(String(row.id));
    const address = addressByContact.get(String(row.id));
    const live: LiveContact = {
      id: String(row.id),
      origin: 'db',
      legalName: String(row.legal_name),
      kind: row.kind === 'person' ? 'person' : 'company',
      taxId: textOrNull(row.tax_id),
      taxType: String(row.tax_id_type ?? 'none'),
      taxCountry: textOrNull(row.tax_id_country),
      country: String(row.country_code ?? 'ES'),
      language: row.language === 'en' ? 'en' : 'es',
      currency: String(row.currency ?? 'EUR'),
      isCustomer: row.is_customer === true,
      isSupplier: row.is_supplier === true,
      leadOnly: row.archived_at != null && row.is_customer !== true && row.is_supplier !== true,
      paymentMethod: textOrNull(row.payment_method),
      includeM347: row.include_in_m347 !== false,
      email: textOrNull(person?.email),
      phone: textOrNull(person?.phone),
      personId: person ? String(person.id) : null,
      line1: textOrNull(address?.line1),
      city: textOrNull(address?.city),
      postal: textOrNull(address?.postal_code),
      province: textOrNull(address?.province),
      addressId: address ? String(address.id) : null,
      ibanLast4: textOrNull(row.iban_last4),
      ibanEnc: null,
      sepaRef: textOrNull(row.sepa_mandate_ref),
      marketing: row.marketing_consent === true,
      marketingSource: textOrNull(row.marketing_consent_source),
      legacy,
      rowKeys,
      nameKey: duplicateKey({
        name: String(row.legal_name),
        postalCode: textOrNull(address?.postal_code),
      }),
      score: 0,
      dirty: false,
      personDirty: false,
      addressDirty: false,
    };
    live.score = liveScore(live);
    state.loaded.push(live);
    remember(state, live);
  }
  return state;
}

interface FoldState {
  loaded: LiveContact[];
  byTax: Map<string, LiveContact>;
  byEmail: Map<string, LiveContact>;
  natural: Map<string, LiveContact>;
  shopify: Map<string, LiveContact>;
  byName: Map<string, LiveContact[]>;
  rowKeys: Set<string>;
}

function emptyState(): FoldState {
  return {
    loaded: [],
    byTax: new Map(),
    byEmail: new Map(),
    natural: new Map(),
    shopify: new Map(),
    byName: new Map(),
    rowKeys: new Set(),
  };
}

function remember(state: FoldState, live: LiveContact): void {
  for (const key of live.rowKeys) state.rowKeys.add(key);
  if (live.taxId && !state.byTax.has(live.taxId)) state.byTax.set(live.taxId, live);
  if (live.email && !state.byEmail.has(live.email)) state.byEmail.set(live.email, live);
  const shopifyId = live.legacy.shopify;
  if (typeof shopifyId === 'string' && shopifyId !== '' && !state.shopify.has(shopifyId)) {
    state.shopify.set(shopifyId, live);
  }
  for (const key of ['holded_cvpo', 'holded_po'] as const) {
    const hash = live.legacy[key];
    if (typeof hash === 'string' && hash !== '') state.natural.set(`${key}:${hash}`, live);
  }
  const list = state.byName.get(live.nameKey) ?? [];
  if (!list.includes(live)) {
    list.push(live);
    state.byName.set(live.nameKey, list);
  }
}

function absorb(
  state: FoldState,
  survivor: LiveContact,
  draft: ContactDraft,
  rule: StubPlan['rule'],
  input: { entityId: string | null; now: Date },
  terms: TermPlan[],
  stubs: StubPlan[],
  absorbWarnings: Record<string, number>,
): void {
  const choices: Record<string, string> = {};
  const preferIncoming = survivor.origin === 'batch' && draft.score > survivor.score;
  takeText(choices, 'legal_name', survivor.legalName, draft.legalName, preferIncoming, (value) => {
    survivor.legalName = value;
  });
  takeText(choices, 'email', survivor.email, draft.email, preferIncoming, (value) => {
    survivor.email = value;
    survivor.personDirty = true;
  });
  takeText(choices, 'phone', survivor.phone, draft.phone, preferIncoming, (value) => {
    survivor.phone = value;
    survivor.personDirty = true;
  });
  takeText(choices, 'line1', survivor.line1, draft.line1, preferIncoming, (value) => {
    survivor.line1 = value;
    survivor.addressDirty = true;
  });
  takeText(choices, 'city', survivor.city, draft.city, preferIncoming, (value) => {
    survivor.city = value;
    survivor.addressDirty = true;
  });
  takeText(choices, 'postal', survivor.postal, draft.postal, preferIncoming, (value) => {
    survivor.postal = value;
    survivor.addressDirty = true;
  });
  takeText(choices, 'province', survivor.province, draft.province, preferIncoming, (value) => {
    survivor.province = value;
    survivor.addressDirty = true;
  });
  if (!survivor.taxId && draft.taxId) {
    survivor.taxId = draft.taxId;
    survivor.taxType = draft.taxType;
    survivor.taxCountry = draft.taxCountry;
    choices.tax_id = 'incoming';
  } else {
    choices.tax_id = 'survivor';
  }
  if (!survivor.paymentMethod && draft.paymentMethod) survivor.paymentMethod = draft.paymentMethod;
  if (!survivor.ibanLast4 && draft.ibanEnc) {
    survivor.ibanEnc = draft.ibanEnc;
    survivor.ibanLast4 = draft.ibanLast4;
    survivor.sepaRef = draft.sepaRef;
  }
  if (draft.marketing) {
    survivor.marketing = true;
    survivor.marketingSource = draft.marketingSource;
  }
  survivor.isCustomer = survivor.isCustomer || draft.isCustomer;
  survivor.isSupplier = survivor.isSupplier || draft.isSupplier;
  if (!draft.lead) survivor.leadOnly = false;
  for (const [key, value] of Object.entries(draft.legacy)) {
    if (survivor.legacy[key] == null || survivor.legacy[key] === '') survivor.legacy[key] = value;
  }
  survivor.rowKeys.add(draft.rowKey);
  survivor.legacy.row_keys = [...survivor.rowKeys];
  survivor.dirty = true;
  survivor.score = Math.max(survivor.score, draft.score);
  remember(state, survivor);
  addTerm(terms, survivor.id, draft, input.entityId, absorbWarnings);
  stubs.push({ id: newId(), survivorId: survivor.id, draft, rule, choices });
}

function proposalName(state: FoldState, live: LiveContact): boolean {
  const name = live.nameKey.slice(0, live.nameKey.indexOf('|'));
  const postal = live.nameKey.slice(live.nameKey.indexOf('|') + 1);
  if (name.length < 3 || postal.length === 0) return false;
  const others = state.byName.get(live.nameKey) ?? [];
  return others.some((other) => other !== live);
}

function fromDraft(draft: ContactDraft, origin: 'batch'): LiveContact {
  const legacy: Record<string, unknown> = { ...draft.legacy };
  const rowKeys = new Set([draft.rowKey]);
  legacy.row_keys = [...rowKeys];
  return {
    id: newId(),
    origin,
    legalName: draft.legalName,
    kind: draft.kind,
    taxId: draft.taxId,
    taxType: draft.taxType,
    taxCountry: draft.taxCountry,
    country: draft.country,
    language: draft.language,
    currency: draft.currency,
    isCustomer: draft.isCustomer,
    isSupplier: draft.isSupplier,
    leadOnly: draft.lead && !draft.isCustomer && !draft.isSupplier,
    paymentMethod: draft.paymentMethod,
    includeM347: draft.includeM347,
    email: draft.email,
    phone: draft.phone,
    personId: null,
    line1: draft.line1,
    city: draft.city,
    postal: draft.postal,
    province: draft.province,
    addressId: null,
    ibanLast4: draft.ibanLast4,
    ibanEnc: draft.ibanEnc,
    sepaRef: draft.sepaRef,
    marketing: draft.marketing,
    marketingSource: draft.marketingSource,
    legacy,
    rowKeys,
    nameKey: draft.nameKey,
    score: draft.score,
    dirty: true,
    personDirty: draft.email !== null || draft.phone !== null,
    addressDirty: Boolean(draft.line1 && draft.city && draft.postal),
  };
}

function addTerm(
  terms: TermPlan[],
  contactId: string,
  draft: ContactDraft,
  entityId: string | null,
  warnings: Record<string, number>,
): void {
  if (!entityId || draft.entityKey === 'shopify') return;
  const existing = terms.find((term) => term.contactId === contactId && term.entityId === entityId);
  if (existing) {
    if (existing.customerAccount && draft.customerAccount && existing.customerAccount !== draft.customerAccount) {
      bump(warnings, 'ACCOUNT_CONFLICT');
    }
    if (!existing.customerAccount && draft.customerAccount) existing.customerAccount = draft.customerAccount;
    if (!existing.supplierAccount && draft.supplierAccount) existing.supplierAccount = draft.supplierAccount;
    return;
  }
  terms.push({
    contactId,
    entityId,
    customerAccount: draft.customerAccount,
    supplierAccount: draft.supplierAccount,
    discount: draft.discount,
  });
}

function insertContactOps(live: LiveContact, actorId: string, now: Date): WriteOp[] {
  const ops: WriteOp[] = [contactInsert(live, actorId, now, null)];
  if (live.email || live.phone) ops.push(personInsert(live, now));
  if (live.line1 && live.city && live.postal) ops.push(addressInsert(live, now));
  return ops;
}

function updateContactOps(live: LiveContact, now: Date): WriteOp[] {
  const ops: WriteOp[] = [contactUpdate(live, now)];
  if ((live.email || live.phone) && live.personId === null) ops.push(personInsert(live, now));
  else if (live.personDirty && live.personId) ops.push(personUpdate(live));
  if (live.line1 && live.city && live.postal && live.addressId === null) ops.push(addressInsert(live, now));
  else if (live.addressDirty && live.addressId) ops.push(addressUpdate(live));
  return ops;
}

function stubOps(stub: StubPlan, actorId: string, now: Date): WriteOp[] {
  const legacy = { ...stub.draft.legacy, row_keys: [stub.draft.rowKey] };
  const insert = sql`
    INSERT INTO party.contact (
      id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, language, currency,
      is_customer, is_supplier, vat_regime, include_in_m347, marketing_consent, legacy_refs,
      merged_into_id, archived_at, created_by, created_at, updated_at
    ) VALUES (
      CAST(${stub.id} AS UUID),
      ${stub.draft.kind},
      ${stub.draft.legalName},
      NULL,
      'none',
      NULL,
      ${stub.draft.country},
      ${stub.draft.language},
      ${stub.draft.currency},
      FALSE,
      FALSE,
      'general',
      ${stub.draft.includeM347},
      FALSE,
      ${sql.json(legacy)},
      CAST(${stub.survivorId} AS UUID),
      ${now},
      ${actorId},
      ${now},
      ${now}
    )
  `;
  const merge = sql`
    INSERT INTO party.contact_merge (id, survivor_id, merged_id, rule, field_choices, merged_by, merged_at)
    VALUES (
      CAST(${newId()} AS UUID),
      CAST(${stub.survivorId} AS UUID),
      CAST(${stub.id} AS UUID),
      ${stub.rule},
      ${sql.json(stub.choices)},
      ${actorId},
      ${now}
    )
  `;
  return [
    { sql: insert, audit: { table: 'party.contact', rowId: stub.id, action: 'INSERT', before: null, after: { merged: true, rule: stub.rule } } },
    { sql: merge, audit: { table: 'party.contact_merge', rowId: stub.id, action: 'INSERT', before: null, after: { rule: stub.rule } } },
  ];
}

function contactInsert(live: LiveContact, actorId: string, now: Date, mergedInto: string | null): WriteOp {
  const archived = live.leadOnly && !live.isCustomer && !live.isSupplier;
  return {
    sql: sql`
      INSERT INTO party.contact (
        id, kind, legal_name, tax_id, tax_id_type, tax_id_country, country_code, language, currency,
        is_customer, is_supplier, is_carrier, is_logistics_operator, vat_regime, payment_method,
        payment_terms_days, iban_enc, iban_last4, sepa_mandate_ref, include_in_m347,
        marketing_consent, marketing_consent_at, marketing_consent_source, legacy_refs,
        merged_into_id, archived_at, created_by, created_at, updated_at
      ) VALUES (
        CAST(${live.id} AS UUID),
        ${live.kind},
        ${live.legalName},
        ${live.taxId},
        ${live.taxId ? live.taxType : 'none'},
        ${live.taxCountry},
        ${live.country},
        ${live.language},
        ${live.currency},
        ${live.isCustomer},
        ${live.isSupplier},
        FALSE,
        FALSE,
        'general',
        ${live.paymentMethod},
        30,
        ${live.ibanEnc},
        ${live.ibanLast4},
        ${live.sepaRef},
        ${live.includeM347},
        ${live.marketing},
        ${live.marketing ? now : null},
        ${live.marketingSource},
        ${sql.json(live.legacy)},
        ${mergedInto === null ? null : sql.raw(`CAST('${assertUuid(mergedInto)}' AS UUID)`)},
        ${archived ? now : null},
        ${actorId},
        ${now},
        ${now}
      )
    `,
    audit: {
      table: 'party.contact',
      rowId: live.id,
      action: 'INSERT',
      before: null,
      after: {
        kind: live.kind,
        tax_id_type: live.taxId ? live.taxType : 'none',
        is_customer: live.isCustomer,
        is_supplier: live.isSupplier,
        archived,
      },
    },
  };
}

function contactUpdate(live: LiveContact, now: Date): WriteOp {
  const archived = live.leadOnly && !live.isCustomer && !live.isSupplier;
  return {
    sql: sql`
      UPDATE party.contact SET
        legal_name = ${live.legalName},
        kind = ${live.kind},
        tax_id = ${live.taxId},
        tax_id_type = ${live.taxId ? live.taxType : 'none'},
        tax_id_country = ${live.taxCountry},
        country_code = ${live.country},
        is_customer = ${live.isCustomer},
        is_supplier = ${live.isSupplier},
        payment_method = ${live.paymentMethod},
        iban_enc = COALESCE(iban_enc, ${live.ibanEnc}),
        iban_last4 = COALESCE(iban_last4, ${live.ibanLast4}),
        sepa_mandate_ref = COALESCE(sepa_mandate_ref, ${live.sepaRef}),
        marketing_consent = marketing_consent OR ${live.marketing},
        marketing_consent_at = COALESCE(marketing_consent_at, ${live.marketing ? now : null}),
        marketing_consent_source = COALESCE(marketing_consent_source, ${live.marketingSource}),
        legacy_refs = ${sql.json(live.legacy)},
        archived_at = ${archived ? now : null},
        updated_at = ${now}
      WHERE id = CAST(${live.id} AS UUID)
    `,
    audit: {
      table: 'party.contact',
      rowId: live.id,
      action: 'UPDATE',
      before: null,
      after: { is_customer: live.isCustomer, is_supplier: live.isSupplier, archived },
    },
  };
}

function personInsert(live: LiveContact, now: Date): WriteOp {
  const id = newId();
  live.personId = id;
  return {
    sql: sql`
      INSERT INTO party.contact_person (id, contact_id, full_name, role, email, phone, receives_invoices, receives_dunning, created_at)
      VALUES (
        CAST(${id} AS UUID), CAST(${live.id} AS UUID), 'General', 'general',
        ${live.email}, ${live.phone}, FALSE, FALSE, ${now}
      )
    `,
    audit: {
      table: 'party.contact_person',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { role: 'general', has_email: live.email !== null, has_phone: live.phone !== null },
    },
  };
}

function personUpdate(live: LiveContact): WriteOp {
  return {
    sql: sql`
      UPDATE party.contact_person SET
        email = COALESCE(email, ${live.email}),
        phone = COALESCE(phone, ${live.phone})
      WHERE id = CAST(${live.personId} AS UUID)
    `,
    audit: {
      table: 'party.contact_person',
      rowId: live.personId,
      action: 'UPDATE',
      before: null,
      after: { filled: true },
    },
  };
}

function addressInsert(live: LiveContact, now: Date): WriteOp {
  const id = newId();
  live.addressId = id;
  return {
    sql: sql`
      INSERT INTO party.contact_address (
        id, contact_id, kind, line1, postal_code, city, province, country_code, is_default, created_at
      ) VALUES (
        CAST(${id} AS UUID), CAST(${live.id} AS UUID), 'both', ${live.line1}, ${live.postal},
        ${live.city}, ${live.province}, ${live.country}, TRUE, ${now}
      )
    `,
    audit: {
      table: 'party.contact_address',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { kind: 'both', country: live.country },
    },
  };
}

function addressUpdate(live: LiveContact): WriteOp {
  return {
    sql: sql`
      UPDATE party.contact_address SET
        line1 = COALESCE(NULLIF(line1, ''), ${live.line1}),
        postal_code = COALESCE(NULLIF(postal_code, ''), ${live.postal}),
        city = COALESCE(NULLIF(city, ''), ${live.city}),
        province = COALESCE(province, ${live.province})
      WHERE id = CAST(${live.addressId} AS UUID)
    `,
    audit: {
      table: 'party.contact_address',
      rowId: live.addressId,
      action: 'UPDATE',
      before: null,
      after: { filled: true },
    },
  };
}

function termOp(term: TermPlan, now: Date): WriteOp {
  return {
    sql: sql`
      INSERT INTO party.contact_entity_terms (
        contact_id, legal_entity_id, customer_account, supplier_account, discount_pct, created_at
      )
      SELECT
        CAST(${term.contactId} AS UUID),
        CAST(${term.entityId} AS UUID),
        ${term.customerAccount},
        ${term.supplierAccount},
        ${term.discount},
        ${now}
      WHERE NOT EXISTS (
        SELECT 1 FROM party.contact_entity_terms
        WHERE contact_id = CAST(${term.contactId} AS UUID)
          AND legal_entity_id = CAST(${term.entityId} AS UUID)
      )
    `,
    audit: {
      table: 'party.contact_entity_terms',
      rowId: term.contactId,
      action: 'INSERT',
      before: null,
      after: { has_customer_account: term.customerAccount !== null, has_supplier_account: term.supplierAccount !== null },
    },
  };
}

function draftOf(draft: ContactDraft): ContactDraft {
  return draft;
}

export function finalizeDraft(draft: ContactDraft): ContactDraft {
  draft.rowKey = contactRowKey(draft);
  draft.score = draftScore(draft);
  return draft;
}

function contactRowKey(draft: ContactDraft): string {
  return sha256Hex([
    draft.entityKey,
    draft.taxId ?? '',
    draft.nameHash,
    draft.email ?? '',
    draft.customerAccount ?? '',
    draft.supplierAccount ?? '',
    draft.legacy.shopify ?? '',
  ].join('|'));
}

function draftScore(draft: ContactDraft): number {
  let score = 0;
  for (const value of [
    draft.legalName, draft.taxId, draft.email, draft.phone, draft.line1, draft.city, draft.postal,
    draft.province, draft.customerAccount, draft.supplierAccount,
  ]) {
    if (value) score += 1;
  }
  if (!draft.lead) score += 5;
  return score;
}

function liveScore(live: LiveContact): number {
  let score = 0;
  for (const value of [live.legalName, live.taxId, live.email, live.phone, live.line1, live.city, live.postal, live.province]) {
    if (value) score += 1;
  }
  if (!live.leadOnly) score += 5;
  return score;
}

function taxesCompatible(left: string | null, right: string | null): boolean {
  if (!left || !right) return true;
  return left === right;
}

function takeText(
  choices: Record<string, string>,
  field: string,
  current: string | null,
  incoming: string | null,
  preferIncoming: boolean,
  assign: (value: string) => void,
): void {
  if (!incoming) {
    choices[field] = 'survivor';
    return;
  }
  if (!current) {
    assign(incoming);
    choices[field] = 'incoming';
    return;
  }
  if (preferIncoming && incoming !== current) {
    assign(incoming);
    choices[field] = 'incoming';
    return;
  }
  choices[field] = 'survivor';
}

function classifyTax(
  raw: string | undefined,
  country: string,
  warnings: Record<string, number>,
): { taxId: string | null; taxType: string; taxCountry: string | null; warning: boolean } {
  const text = integerText(raw);
  if (text === '') return { taxId: null, taxType: 'none', taxCountry: null, warning: false };
  const parsed = normalizeTaxId(text, country);
  if (parsed.valid && parsed.normalized && parsed.type !== 'none') {
    return { taxId: parsed.normalized, taxType: parsed.type, taxCountry: parsed.country, warning: false };
  }
  bump(warnings, parsed.warning ? 'INVALID_TAX_ID' : 'UNRECOGNIZED_TAX_ID');
  return { taxId: null, taxType: 'none', taxCountry: null, warning: true };
}

function contactRoles(raw: string | undefined, warnings: Record<string, number>): { customer: boolean; supplier: boolean; lead: boolean } {
  const text = cleanText(raw).toLowerCase();
  if (text === '') {
    bump(warnings, 'MISSING_TYPE');
    return { customer: false, supplier: false, lead: false };
  }
  if (text.startsWith('client')) return { customer: true, supplier: false, lead: false };
  if (text.startsWith('prove')) return { customer: false, supplier: true, lead: false };
  if (text.startsWith('lead')) return { customer: false, supplier: false, lead: true };
  bump(warnings, 'MISSING_TYPE');
  return { customer: false, supplier: false, lead: false };
}

function accountsFor(
  roles: { customer: boolean; supplier: boolean },
  account: string,
  warnings: Record<string, number>,
): { customer: string | null; supplier: string | null } {
  if (account === '') return { customer: null, supplier: null };
  const customer = /^43\d{6}$/.test(account) ? account : null;
  const supplier = /^4[01]\d{6}$/.test(account) ? account : null;
  if (roles.customer && !customer) bump(warnings, 'ACCOUNT_PATTERN');
  if (roles.supplier && !supplier) bump(warnings, 'ACCOUNT_PATTERN');
  if (!roles.customer && !roles.supplier && !customer && !supplier) bump(warnings, 'ACCOUNT_PATTERN');
  return {
    customer: roles.customer ? customer : null,
    supplier: roles.supplier ? supplier : null,
  };
}

function paymentMethod(raw: string | undefined, warnings: Record<string, number>): string | null {
  const text = cleanText(raw).toLowerCase();
  if (text === '') return null;
  if (text.includes('contado')) return 'cash';
  if (text.includes('transfer')) return 'transfer';
  if (text.includes('tarjeta')) return 'card';
  if (text.includes('domicilia')) return 'direct_debit';
  bump(warnings, 'PAYMENT_METHOD');
  return null;
}

function currencyCode(raw: string | undefined, warnings: Record<string, number>): string {
  const text = cleanText(raw).toLowerCase();
  if (text === '' || text.startsWith('euro') || text === 'eur') return 'EUR';
  if (text.includes('dollar') || text === 'usd') return 'USD';
  bump(warnings, 'CURRENCY');
  return 'EUR';
}

function languageOf(raw: string | undefined): 'es' | 'en' {
  const text = cleanText(raw).toLowerCase();
  if (text.startsWith('ing') || text === 'en' || text === 'english') return 'en';
  return 'es';
}

function kindOf(raw: string | undefined): 'company' | 'person' {
  return cleanText(raw).toLowerCase().startsWith('person') ? 'person' : 'company';
}

function model347(raw: string | undefined): boolean {
  return !cleanText(raw).toLowerCase().startsWith('n');
}

function countryCode(raw: string | undefined, warnings: Record<string, number>): string {
  const text = cleanText(raw).toUpperCase();
  if (text === '') return 'ES';
  if (/^[A-Z]{2}$/.test(text)) return text;
  bump(warnings, 'COUNTRY');
  return 'ES';
}

function discountOf(raw: string | undefined, warnings: Record<string, number>): Decimal {
  const parsed = parseLooseDecimal(raw);
  if (parsed === null) return new Decimal(0);
  if (parsed.lt(0) || parsed.gt(100)) {
    bump(warnings, 'DISCOUNT');
    return new Decimal(0);
  }
  return parsed.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function assertUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('UUID');
  }
  return value;
}
