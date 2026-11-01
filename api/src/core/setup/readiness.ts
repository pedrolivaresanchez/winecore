import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { validateEori } from '../billing/export/eori';
import { normalizeTaxId } from '../party/taxId';
import type { DocType } from '../series/numbering';
import { businessDate } from '../time';

type Read = Writer['read'];

export const OPENING_COUNT_DATE = '2026-12-31';

const ENTITY_FIRST = 'ABCDEFGHJNPQRSUVW';

const DOC_LABEL: Record<DocType, string> = {
  invoice: 'facturas',
  credit_note: 'rectificativas',
  simplified_invoice: 'facturas simplificadas',
  intercompany_invoice: 'facturas intercompañía',
  delivery_note: 'albaranes',
  quote: 'presupuestos',
  sales_order: 'pedidos',
  proforma: 'proformas',
  cellar_operation: 'operaciones de bodega',
  inventory_count: 'aforos',
};

const SERIES_PLAN: Record<DocType, { code: string; verifactu: boolean }> = {
  invoice: { code: 'FA', verifactu: true },
  credit_note: { code: 'RC', verifactu: true },
  simplified_invoice: { code: 'FS', verifactu: true },
  intercompany_invoice: { code: 'FI', verifactu: true },
  delivery_note: { code: 'AL', verifactu: false },
  quote: { code: 'PR', verifactu: false },
  sales_order: { code: 'PE', verifactu: false },
  proforma: { code: 'PF', verifactu: false },
  cellar_operation: { code: 'OB', verifactu: false },
  inventory_count: { code: 'AF', verifactu: false },
};

const BILLING_DOCS: DocType[] = ['invoice', 'credit_note', 'simplified_invoice', 'intercompany_invoice'];
const SALES_DOCS: DocType[] = ['quote', 'sales_order', 'delivery_note', 'proforma'];

export type CheckStatus = 'ok' | 'missing' | 'warning';

export type SeriesSeed = {
  legal_entity_id: string;
  legal_entity_code: string;
  doc_type: DocType;
  code: string;
  year: number;
  prefix: string;
  padding: number;
  is_default: boolean;
  verifactu: boolean;
};

export type EntityForm = {
  code: string;
  legal_name: string;
  tax_id: string;
  address_line: string;
  postal_code: string;
  city: string;
  province: string;
  country_code: string;
  eori: string | null;
};

export type BankSeed = {
  id: string;
  code: string;
  legal_name: string;
};

export type SetupAction =
  | { kind: 'patch_entity'; entity: EntityForm }
  | { kind: 'create_series'; items: SeriesSeed[] }
  | { kind: 'create_bank'; entities: BankSeed[] }
  | { kind: 'register_mcp' }
  | { kind: 'rotate_mcp'; id: string };

export type SetupCheck = {
  id: string;
  status: CheckStatus;
  title: string;
  detail: string;
  href: string | null;
  action?: SetupAction;
};

export type SetupModule = {
  id: string;
  name: string;
  pending: number;
  checks: SetupCheck[];
};

export type ReadinessReport = {
  generated_at: string;
  pending: number;
  modules: SetupModule[];
};

type EntityFact = EntityForm & {
  id: string;
  person_type: 'natural' | 'legal';
};

type BankFact = {
  entityId: string;
  last4: string;
  bankName: string;
  creditor: boolean;
};

type OpeningFact = { date: string; status: string };

type WarehouseFact = { cae: string; test: boolean };

type Facts = {
  entities: EntityFact[] | undefined;
  series: Set<string> | undefined;
  contactTotal: number | undefined;
  badCompanyTax: number | undefined;
  customersWithoutAddress: number | undefined;
  exportContacts: number | undefined;
  exportWithoutEori: number | undefined;
  exportLines: number | undefined;
  priceLists: number | undefined;
  billingSets: number | undefined;
  billingDefaults: number | undefined;
  banks: BankFact[] | undefined;
  categories: number | undefined;
  vessels: number | undefined;
  opening: OpeningFact[] | undefined;
  warehouses: WarehouseFact[] | undefined;
  exercises: { year: number; status: string }[] | undefined;
  ledgers: { total: number; reviewed: number } | undefined;
  parcels: number | undefined;
  cvbot: { state: 'missing' | 'revoked' | 'no-token' | 'ok'; id: string | null } | undefined;
  passkeys: number | undefined;
};

const HREF = {
  contacts: '/contactos',
  tariffs: '/catalogo/tarifas',
  sales: '/ventas/presupuestos',
  invoices: '/facturas',
  approvals: '/aprobaciones',
  cobros: '/cobros',
  gastos: '/gastos',
  vessels: '/bodega/depositos',
  counts: '/stock/aforos/nuevo?kind=opening',
  security: 'settings:security',
  setup: '/ajustes/puesta-en-marcha',
} as const;

export function maskCae(cae: string): string {
  const clean = cae.trim().toUpperCase();
  if (clean.length < 4) return '····';
  return `${clean.slice(0, 2)}${'·'.repeat(clean.length - 4)}${clean.slice(-2)}`;
}

export function maskAccount(last4: string): string {
  const tail = last4.replace(/\s/g, '');
  if (!/^[A-Z0-9]{2,4}$/i.test(tail)) return '····';
  return `···· ${tail}`;
}

export async function loadTableNames(read: Read): Promise<Set<string>> {
  const rows = await read<{ name: string }>(`
    SELECT lower(table_schema) || '.' || lower(table_name) AS name
    FROM information_schema.tables
    WHERE lower(table_type) = 'base table'
  `);
  return new Set(rows.map((row) => String(row.name)));
}

export async function assessReadiness(
  writer: Writer,
  options: { now: Date; deliveryAlertHours: number },
  tables?: Set<string>,
): Promise<ReadinessReport> {
  const names = tables ?? (await loadTableNames((statement) => writer.read(statement)));
  const today = businessDate(options.now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const facts = await loadFacts((statement) => writer.read(statement), names, today, options.now);
  const modules = buildModules(facts, { year, month, hours: options.deliveryAlertHours });
  const seen = new Set<string>();
  let pending = 0;
  for (const module of modules) {
    for (const item of module.checks) {
      if (item.status === 'ok' || seen.has(item.id)) continue;
      seen.add(item.id);
      pending += 1;
    }
  }
  return { generated_at: options.now.toISOString(), pending, modules };
}

function buildModules(facts: Facts, clock: { year: number; month: number; hours: number }): SetupModule[] {
  const years: [number, number] = [clock.year, clock.year + 1];
  const producers = facts.entities?.filter((entity) => entity.person_type === 'natural' || entity.code === 'PO');
  const companies = facts.entities?.filter((entity) => entity.person_type === 'legal' && entity.code !== 'PO');
  const exportsExist = (facts.exportContacts ?? 0) > 0 || (facts.exportLines ?? 0) > 0;
  const priceLists = priceListCheck(facts.priceLists);
  const rules = billingRulesCheck(facts.billingSets, facts.billingDefaults);
  const hours = deliveryHoursCheck(clock.hours);
  const passkey = passkeyCheck(facts.passkeys);
  const opening = openingCheck(facts.opening);

  return [
    moduleOf('contactos', 'Contactos', [
      contactTaxCheck(facts.contactTotal, facts.badCompanyTax),
      contactAddressCheck(facts.contactTotal, facts.customersWithoutAddress),
      contactEoriCheck(facts.exportContacts, facts.exportWithoutEori),
    ]),
    moduleOf('catalogo', 'Catálogo', [priceLists]),
    moduleOf('ventas', 'Ventas', [
      seriesCheck('series.sales', 'Series de venta', HREF.sales, facts.entities, SALES_DOCS, years, facts.series),
      priceLists,
      rules,
    ]),
    moduleOf('facturacion_po', 'Facturación P.O', [
      ...entityChecks(producers, exportsExist, 'PO'),
      seriesCheck('series.billing.po', 'Series de facturación', HREF.invoices, producers, BILLING_DOCS, years, facts.series),
      rules,
      hours,
      passkey,
    ]),
    moduleOf('facturacion_cvpo', 'Facturación CVPO', [
      ...entityChecks(companies, exportsExist, 'CVPO'),
      seriesCheck('series.billing.cvpo', 'Series de facturación', HREF.invoices, companies, BILLING_DOCS, years, facts.series),
      rules,
      hours,
      passkey,
    ]),
    moduleOf('cobros', 'Cobros y SEPA', [bankCheck(facts.banks, facts.entities), passkey]),
    moduleOf('gastos', 'Gastos', [categoryCheck(facts.categories)]),
    moduleOf('bodega', 'Bodega', [
      vesselCheck(facts.vessels),
      opening,
      seriesCheck('series.cellar', 'Series de bodega', HREF.vessels, facts.entities, ['cellar_operation'], years, facts.series),
    ]),
    moduleOf('existencias', 'Existencias', [
      seriesCheck('series.stock', 'Series de aforo', HREF.counts, facts.entities, ['inventory_count'], years, facts.series),
      opening,
    ]),
    moduleOf('silicie', 'SILICIE', [
      warehouseCheck(facts.warehouses),
      exerciseCheck(facts.warehouses, facts.exercises, clock.year, clock.month),
      ledgerCheck(facts.ledgers),
    ]),
    moduleOf('vinedo', 'Viñedo', [parcelCheck(facts.parcels)]),
    moduleOf('cvbot', 'CVBOT/MCP', [mcpCheck(facts.cvbot)]),
  ];
}

async function loadFacts(read: Read, tables: Set<string>, today: string, now: Date): Promise<Facts> {
  const has = (name: string) => tables.has(name);
  const entities = has('core.legal_entity') ? await loadEntities(read) : undefined;
  const series = has('core.number_series') ? await loadSeries(read, today) : undefined;
  const contacts = has('party.contact') ? await loadContacts(read) : undefined;
  const customersWithoutAddress = has('party.contact') && has('party.contact_address')
    ? await countCustomersWithoutAddress(read)
    : undefined;
  const exportLines = has('billing.invoice_line') ? await countExportLines(read) : undefined;
  const priceLists = has('catalog.price_list') && has('catalog.price_list_version')
    ? await countPriceLists(read, today)
    : undefined;
  const billing = has('billing.billing_rule_set') && has('billing.billing_rule')
    ? await loadBillingRules(read)
    : undefined;
  const banks = has('finance.bank_account') ? await loadBanks(read) : undefined;
  const categories = has('purchasing.expense_category') ? await countCategories(read) : undefined;
  const vessels = has('cellar.vessel') ? await countVessels(read) : undefined;
  const opening = has('inventory.inventory_count') ? await loadOpening(read) : undefined;
  const warehouses = has('inventory.tax_warehouse') ? await loadWarehouses(read) : undefined;
  const exercises = has('regulatory.silicie_exercise') && has('inventory.tax_warehouse')
    ? await loadExercises(read)
    : undefined;
  const ledgers = has('regulatory.silicie_ledger') ? await loadLedgers(read) : undefined;
  const parcels = has('vineyard.parcel') ? await countParcels(read) : undefined;
  const cvbot = has('core.api_client') ? await loadCvbot(read, now, has('core.api_token')) : undefined;
  const passkeys = has('core.user_credential') && has('core.user_role') ? await countPasskeys(read) : undefined;

  return {
    entities,
    series,
    contactTotal: contacts?.total,
    badCompanyTax: contacts?.badCompanyTax,
    customersWithoutAddress,
    exportContacts: contacts?.exportContacts,
    exportWithoutEori: contacts?.exportWithoutEori,
    exportLines,
    priceLists,
    billingSets: billing?.sets,
    billingDefaults: billing?.defaults,
    banks,
    categories,
    vessels,
    opening,
    warehouses,
    exercises,
    ledgers,
    parcels,
    cvbot,
    passkeys,
  };
}

async function loadEntities(read: Read): Promise<EntityFact[]> {
  const rows = await read<Record<string, unknown>>(sql`
    SELECT id, code, legal_name, tax_id, person_type, address_line, postal_code, city, province, country_code, eori
    FROM core.legal_entity
    WHERE is_active
    ORDER BY code
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    code: text(row.code),
    legal_name: text(row.legal_name),
    tax_id: text(row.tax_id),
    person_type: text(row.person_type) === 'legal' ? 'legal' : 'natural',
    address_line: text(row.address_line),
    postal_code: text(row.postal_code),
    city: text(row.city),
    province: text(row.province),
    country_code: text(row.country_code) || 'ES',
    eori: row.eori == null || text(row.eori) === '' ? null : text(row.eori),
  }));
}

async function loadSeries(read: Read, today: string): Promise<Set<string>> {
  const year = Number(today.slice(0, 4));
  const rows = await read<Record<string, unknown>>(sql`
    SELECT legal_entity_id, doc_type, "year" AS series_year
    FROM core.number_series
    WHERE is_active AND "year" IN (${year}, ${year + 1})
  `);
  const keys = new Set<string>();
  for (const row of rows) keys.add(`${idOf(row.legal_entity_id)}|${text(row.doc_type)}|${int(row.series_year)}`);
  return keys;
}

async function loadContacts(read: Read): Promise<{
  total: number;
  badCompanyTax: number;
  exportContacts: number;
  exportWithoutEori: number;
}> {
  const rows = await read<Record<string, unknown>>(sql`
    SELECT kind, tax_id, tax_id_country, is_customer, is_supplier, vat_regime, eori
    FROM party.contact
    WHERE archived_at IS NULL AND merged_into_id IS NULL
  `);
  let badCompanyTax = 0;
  let exportContacts = 0;
  let exportWithoutEori = 0;
  for (const row of rows) {
    const company = text(row.kind) === 'company';
    const party = flag(row.is_customer) || flag(row.is_supplier);
    const country = row.tax_id_country == null ? null : text(row.tax_id_country);
    if (company && party && taxProblem(row.tax_id == null ? null : text(row.tax_id), country)) badCompanyTax += 1;
    if (text(row.vat_regime) === 'export') {
      exportContacts += 1;
      const raw = row.eori == null ? '' : text(row.eori).trim();
      if (raw === '' || !validateEori(raw).ok) exportWithoutEori += 1;
    }
  }
  return { total: rows.length, badCompanyTax, exportContacts, exportWithoutEori };
}

async function countCustomersWithoutAddress(read: Read): Promise<number> {
  const rows = await read<{ total: unknown }>(sql`
    SELECT count(*)::INTEGER AS total
    FROM party.contact c
    WHERE c.archived_at IS NULL
      AND c.merged_into_id IS NULL
      AND c.is_customer
      AND NOT EXISTS (
        SELECT 1 FROM party.contact_address a
        WHERE a.contact_id = c.id
          AND a.archived_at IS NULL
          AND a.kind IN ('billing', 'both')
      )
  `);
  return int(rows[0]?.total);
}

async function countExportLines(read: Read): Promise<number> {
  const rows = await read<{ total: unknown }>(sql`
    SELECT count(*)::INTEGER AS total FROM billing.invoice_line WHERE tax_code = 'EXP_E2'
  `);
  return int(rows[0]?.total);
}

async function countPriceLists(read: Read, today: string): Promise<number> {
  const rows = await read<{ total: unknown }>(sql`
    SELECT count(DISTINCT p.id)::INTEGER AS total
    FROM catalog.price_list p
    JOIN catalog.price_list_version v ON v.price_list_id = p.id
    WHERE p.is_active
      AND v.status = 'active'
      AND v.valid_from <= CAST(${today} AS DATE)
      AND (v.valid_to IS NULL OR v.valid_to > CAST(${today} AS DATE))
  `);
  return int(rows[0]?.total);
}

async function loadBillingRules(read: Read): Promise<{ sets: number; defaults: number }> {
  const rows = await read<Record<string, unknown>>(sql`
    SELECT s.id, r.scope
    FROM billing.billing_rule_set s
    LEFT JOIN billing.billing_rule r ON r.rule_set_id = s.id
    WHERE s.status = 'active'
  `);
  const sets = new Set(rows.map((row) => idOf(row.id)));
  const defaults = rows.filter((row) => text(row.scope) === 'default').length;
  return { sets: sets.size, defaults };
}

async function loadBanks(read: Read): Promise<BankFact[]> {
  const rows = await read<Record<string, unknown>>(sql`
    SELECT legal_entity_id, bank_name, iban_last4, sepa_creditor_id
    FROM finance.bank_account
    WHERE is_active
  `);
  return rows.map((row) => ({
    entityId: idOf(row.legal_entity_id),
    bankName: text(row.bank_name),
    last4: text(row.iban_last4),
    creditor: row.sepa_creditor_id != null && text(row.sepa_creditor_id).trim() !== '',
  }));
}

async function countCategories(read: Read): Promise<number> {
  const rows = await read<{ total: unknown }>(sql`
    SELECT count(*)::INTEGER AS total FROM purchasing.expense_category WHERE is_active
  `);
  return int(rows[0]?.total);
}

async function countVessels(read: Read): Promise<number> {
  const rows = await read<{ total: unknown }>(sql`
    SELECT count(*)::INTEGER AS total FROM cellar.vessel WHERE status <> 'retired'
  `);
  return int(rows[0]?.total);
}

async function loadOpening(read: Read): Promise<OpeningFact[]> {
  const rows = await read<Record<string, unknown>>(sql`
    SELECT counted_at, status
    FROM inventory.inventory_count
    WHERE kind = 'opening' AND status <> 'cancelled'
  `);
  return rows.map((row) => ({ date: civil(row.counted_at), status: text(row.status) }));
}

async function loadWarehouses(read: Read): Promise<WarehouseFact[]> {
  const rows = await read<Record<string, unknown>>(sql`
    SELECT cae, is_test FROM inventory.tax_warehouse WHERE is_active
  `);
  return rows.map((row) => ({ cae: text(row.cae), test: flag(row.is_test) }));
}

async function loadExercises(read: Read): Promise<{ year: number; status: string }[]> {
  const rows = await read<Record<string, unknown>>(sql`
    SELECT e."year" AS exercise_year, e.status
    FROM regulatory.silicie_exercise e
    JOIN inventory.tax_warehouse w ON w.id = e.tax_warehouse_id
    WHERE w.is_active
  `);
  return rows.map((row) => ({ year: int(row.exercise_year), status: text(row.status) }));
}

async function loadLedgers(read: Read): Promise<{ total: number; reviewed: number }> {
  const rows = await read<Record<string, unknown>>(sql`
    SELECT
      count(*)::INTEGER AS total,
      sum(CASE WHEN validated_by IS NOT NULL THEN 1 ELSE 0 END)::INTEGER AS reviewed
    FROM regulatory.silicie_ledger
    WHERE is_active
  `);
  return { total: int(rows[0]?.total), reviewed: int(rows[0]?.reviewed) };
}

async function countParcels(read: Read): Promise<number> {
  const rows = await read<{ total: unknown }>(sql`
    SELECT count(*)::INTEGER AS total FROM vineyard.parcel WHERE is_active
  `);
  return int(rows[0]?.total);
}

async function loadCvbot(read: Read, now: Date, tokens: boolean): Promise<Facts['cvbot']> {
  const rows = await read<Record<string, unknown>>(sql`
    SELECT id, revoked_at FROM core.api_client WHERE lower(code) = 'cvbot'
  `);
  const client = rows[0];
  if (!client) return { state: 'missing', id: null };
  const id = idOf(client.id);
  if (client.revoked_at != null) return { state: 'revoked', id };
  if (!tokens) return { state: 'no-token', id };
  const live = await read<Record<string, unknown>>(sql`
    SELECT t.expires_at
    FROM core.api_token t
    JOIN core.api_client c ON c.id = t.client_id
    WHERE lower(c.code) = 'cvbot' AND c.revoked_at IS NULL AND t.revoked_at IS NULL
  `);
  const fresh = live.some((row) => {
    const expires = row.expires_at instanceof Date ? row.expires_at : new Date(text(row.expires_at));
    return !Number.isNaN(expires.getTime()) && expires.getTime() > now.getTime();
  });
  return { state: fresh ? 'ok' : 'no-token', id };
}

async function countPasskeys(read: Read): Promise<number> {
  const rows = await read<{ total: unknown }>(sql`
    SELECT count(*)::INTEGER AS total
    FROM core.user_credential c
    JOIN core.user_role r ON r.user_id = c.user_id
    WHERE c.kind = 'passkey'
      AND c.revoked_at IS NULL
      AND r.role_code = 'owner'
      AND r.revoked_at IS NULL
  `);
  return int(rows[0]?.total);
}

function moduleOf(id: string, name: string, checks: SetupCheck[]): SetupModule {
  return { id, name, pending: checks.filter((item) => item.status !== 'ok').length, checks };
}

function contactTaxCheck(total: number | undefined, bad: number | undefined): SetupCheck {
  if (total === undefined || bad === undefined) return notDeployed('contacts.tax_id', 'NIF de contactos');
  if (total === 0) {
    return item('contacts.tax_id', 'missing', 'NIF de contactos', 'No hay contactos cargados.', HREF.contacts);
  }
  if (bad > 0) {
    return item(
      'contacts.tax_id',
      'missing',
      'NIF de contactos',
      bad === 1
        ? 'Hay 1 contacto de empresa sin un NIF válido.'
        : `Hay ${bad} contactos de empresa sin un NIF válido.`,
      HREF.contacts,
    );
  }
  return item('contacts.tax_id', 'ok', 'NIF de contactos', 'Los contactos de empresa tienen NIF.', HREF.contacts);
}

function contactAddressCheck(total: number | undefined, missing: number | undefined): SetupCheck {
  if (missing === undefined) return notDeployed('contacts.address', 'Direcciones');
  if ((total ?? 0) === 0) {
    return item('contacts.address', 'ok', 'Direcciones', 'Sin contactos no hay direcciones que revisar.', HREF.contacts);
  }
  if (missing > 0) {
    return item(
      'contacts.address',
      'warning',
      'Direcciones',
      missing === 1
        ? 'Hay 1 cliente sin dirección de facturación.'
        : `Hay ${missing} clientes sin dirección de facturación.`,
      HREF.contacts,
    );
  }
  return item('contacts.address', 'ok', 'Direcciones', 'Los clientes tienen dirección de facturación.', HREF.contacts);
}

function contactEoriCheck(total: number | undefined, missing: number | undefined): SetupCheck {
  if (total === undefined || missing === undefined) return notDeployed('contacts.export_eori', 'EORI de exportación');
  if (total === 0) {
    return item('contacts.export_eori', 'ok', 'EORI de exportación', 'No hay contactos de exportación.', HREF.contacts);
  }
  if (missing > 0) {
    return item(
      'contacts.export_eori',
      'missing',
      'EORI de exportación',
      missing === 1
        ? 'Hay 1 contacto de exportación sin EORI válido.'
        : `Hay ${missing} contactos de exportación sin EORI válido.`,
      HREF.contacts,
    );
  }
  return item('contacts.export_eori', 'ok', 'EORI de exportación', 'Los contactos de exportación tienen EORI.', HREF.contacts);
}

function priceListCheck(total: number | undefined): SetupCheck {
  if (total === undefined) return notDeployed('catalog.price_lists', 'Tarifas activas');
  if (total === 0) {
    return item('catalog.price_lists', 'missing', 'Tarifas activas', 'No hay ninguna tarifa activa en vigor.', HREF.tariffs);
  }
  return item(
    'catalog.price_lists',
    'ok',
    'Tarifas activas',
    total === 1 ? 'Hay 1 tarifa activa en vigor.' : `Hay ${total} tarifas activas en vigor.`,
    HREF.tariffs,
  );
}

function billingRulesCheck(sets: number | undefined, defaults: number | undefined): SetupCheck {
  if (sets === undefined || defaults === undefined) return notDeployed('billing.rules', 'Reglas de entidad');
  if (sets === 0) {
    return item(
      'billing.rules',
      'missing',
      'Reglas de entidad',
      'No hay un conjunto de reglas de entidad facturadora (D3) activo. Sin él no se pueden crear presupuestos, pedidos ni albaranes: apruébalo en Aprobaciones.',
      HREF.approvals,
    );
  }
  if (defaults === 0) {
    return item(
      'billing.rules',
      'warning',
      'Reglas de entidad',
      'El conjunto activo no tiene regla por defecto.',
      HREF.invoices,
    );
  }
  return item('billing.rules', 'ok', 'Reglas de entidad', 'Las reglas de entidad facturadora están activas.', HREF.invoices);
}

function deliveryHoursCheck(hours: number): SetupCheck {
  const detail = `Los avisos de factura sin enviar saltan a las ${hours} horas.`;
  if (hours > 72) {
    return item('billing.delivery_hours', 'warning', 'Avisos de envío', `${detail} Puede ser tarde para reclamar el envío.`, HREF.invoices);
  }
  return item('billing.delivery_hours', 'ok', 'Avisos de envío', detail, HREF.invoices);
}

function passkeyCheck(total: number | undefined): SetupCheck {
  if (total === undefined) return notDeployed('auth.owner_passkey', 'Passkey del propietario');
  if (total === 0) {
    return item(
      'auth.owner_passkey',
      'missing',
      'Passkey del propietario',
      'Ningún propietario tiene una passkey para aprobar.',
      HREF.security,
    );
  }
  return item('auth.owner_passkey', 'ok', 'Passkey del propietario', 'Hay una passkey de propietario activa.', HREF.security);
}

function entityChecks(entities: EntityFact[] | undefined, exportsExist: boolean, code: string): SetupCheck[] {
  const label = entityLabel(code);
  if (entities === undefined) {
    return [
      notDeployed(`entity.${code}.nif`, 'NIF real'),
      notDeployed(`entity.${code}.address`, 'Dirección fiscal'),
      notDeployed(`entity.${code}.eori`, 'EORI'),
    ];
  }
  if (entities.length === 0) {
    return [item(`entity.${code}.nif`, 'missing', 'Entidad', `No está la entidad ${label}.`, HREF.setup)];
  }
  return entities.flatMap((entity) => [
    nifCheck(entity),
    addressCheck(entity),
    eoriCheck(entity, exportsExist),
  ]);
}

function nifCheck(entity: EntityFact): SetupCheck {
  const label = entityLabel(entity.code);
  const id = `entity.${entity.code}.nif`;
  if (entity.tax_id.toUpperCase() === 'PENDIENTE') {
    return item(id, 'missing', 'NIF real', `${label} sigue con el NIF PENDIENTE.`, HREF.setup, {
      kind: 'patch_entity',
      entity: formOf(entity),
    });
  }
  const parsed = normalizeTaxId(entity.tax_id, 'ES');
  const shape = entity.person_type === 'legal' ? isCompanyTax(entity.tax_id) : isPersonTax(entity.tax_id);
  if (!parsed.valid || !shape) {
    return item(id, 'missing', 'NIF real', `El NIF de ${label} no supera la validación.`, HREF.setup, {
      kind: 'patch_entity',
      entity: formOf(entity),
    });
  }
  return item(id, 'ok', 'NIF real', `${label} tiene un NIF válido.`, HREF.setup);
}

function addressCheck(entity: EntityFact): SetupCheck {
  const label = entityLabel(entity.code);
  const id = `entity.${entity.code}.address`;
  const issue = addressIssue(entity);
  if (issue) {
    return item(id, 'missing', 'Dirección fiscal', `${label}: ${issue}.`, HREF.setup, {
      kind: 'patch_entity',
      entity: formOf(entity),
    });
  }
  return item(id, 'ok', 'Dirección fiscal', `${label} tiene dirección fiscal.`, HREF.setup);
}

function eoriCheck(entity: EntityFact, exportsExist: boolean): SetupCheck {
  const label = entityLabel(entity.code);
  const id = `entity.${entity.code}.eori`;
  if (!exportsExist) {
    return item(id, 'ok', 'EORI', `No hay exportaciones. El EORI de ${label} no es obligatorio.`, HREF.setup);
  }
  const raw = entity.eori?.trim() ?? '';
  if (raw === '') {
    return item(id, 'missing', 'EORI', `Hay exportaciones y ${label} no tiene EORI.`, HREF.setup, {
      kind: 'patch_entity',
      entity: formOf(entity),
    });
  }
  if (!validateEori(raw).ok) {
    return item(id, 'missing', 'EORI', `El EORI de ${label} no es válido.`, HREF.setup, {
      kind: 'patch_entity',
      entity: formOf(entity),
    });
  }
  return item(id, 'ok', 'EORI', `${label} tiene EORI.`, HREF.setup);
}

function seriesCheck(
  id: string,
  title: string,
  href: string,
  entities: EntityFact[] | undefined,
  docs: readonly DocType[],
  years: [number, number],
  active: Set<string> | undefined,
): SetupCheck {
  if (active === undefined || entities === undefined) return notDeployed(id, title);
  if (entities.length === 0) {
    return item(id, 'missing', title, 'No hay entidades a las que abrir series.', href);
  }
  const seeds: SeriesSeed[] = [];
  for (const entity of entities) {
    for (const doc of docs) {
      for (const year of years) {
        if (active.has(`${entity.id}|${doc}|${year}`)) continue;
        const plan = SERIES_PLAN[doc];
        seeds.push({
          legal_entity_id: entity.id,
          legal_entity_code: entity.code,
          doc_type: doc,
          code: plan.code,
          year,
          prefix: `${plan.code}${String(year).slice(2)}-`,
          padding: 4,
          is_default: true,
          verifactu: plan.verifactu,
        });
      }
    }
  }
  if (seeds.length === 0) {
    return item(id, 'ok', title, `Hay serie activa para ${years[0]} y ${years[1]}.`, href);
  }
  const labels = [...new Set(seeds.map((seed) => DOC_LABEL[seed.doc_type]))];
  const who = [...new Set(seeds.map((seed) => entityLabel(seed.legal_entity_code)))];
  return item(
    id,
    'missing',
    title,
    `Faltan ${seeds.length} series (${joinEs(labels)}) de ${years[0]} y ${years[1]} para ${joinEs(who)}.`,
    href,
    { kind: 'create_series', items: seeds },
  );
}

function bankCheck(banks: BankFact[] | undefined, entities: EntityFact[] | undefined): SetupCheck {
  if (banks === undefined || entities === undefined) return notDeployed('finance.sepa', 'Cuentas SEPA');
  if (entities.length === 0) {
    return item('finance.sepa', 'missing', 'Cuentas SEPA', 'No hay entidades a las que asociar una cuenta.', HREF.cobros);
  }
  const ready: string[] = [];
  const missing: BankSeed[] = [];
  let withoutCreditor = 0;
  for (const entity of entities) {
    const accounts = banks.filter((bank) => bank.entityId === entity.id);
    const good = accounts.find((bank) => bank.creditor);
    if (good) {
      ready.push(`${entityLabel(entity.code)} ${maskAccount(good.last4)}`);
      continue;
    }
    if (accounts.length > 0) withoutCreditor += 1;
    missing.push({ id: entity.id, code: entity.code, legal_name: entity.legal_name });
  }
  if (missing.length === 0) {
    return item('finance.sepa', 'ok', 'Cuentas SEPA', `Hay cuenta para adeudos: ${joinEs(ready)}.`, HREF.cobros);
  }
  const who = joinEs(missing.map((entity) => entityLabel(entity.code)));
  if (withoutCreditor > 0 && missing.length === withoutCreditor) {
    const verb = missing.length === 1 ? 'tiene' : 'tienen';
    return item(
      'finance.sepa',
      'warning',
      'Cuentas SEPA',
      `${who} ${verb} cuenta, pero falta el identificador de acreedor.`,
      HREF.cobros,
    );
  }
  const verb = missing.length === 1 ? 'no tiene' : 'no tienen';
  return item('finance.sepa', 'missing', 'Cuentas SEPA', `${who} ${verb} cuenta para adeudos SEPA.`, HREF.cobros, {
    kind: 'create_bank',
    entities: missing,
  });
}

function categoryCheck(total: number | undefined): SetupCheck {
  if (total === undefined) return notDeployed('purchasing.categories', 'Categorías de gasto');
  if (total === 0) {
    return item('purchasing.categories', 'missing', 'Categorías de gasto', 'No hay categorías de gasto activas.', HREF.gastos);
  }
  return item(
    'purchasing.categories',
    'ok',
    'Categorías de gasto',
    total === 1 ? 'Hay 1 categoría de gasto activa.' : `Hay ${total} categorías de gasto activas.`,
    HREF.gastos,
  );
}

function vesselCheck(total: number | undefined): SetupCheck {
  if (total === undefined) return notDeployed('cellar.vessels', 'Recipientes');
  if (total === 0) {
    return item('cellar.vessels', 'missing', 'Recipientes', 'No hay recipientes cargados.', HREF.vessels);
  }
  return item(
    'cellar.vessels',
    'ok',
    'Recipientes',
    total === 1 ? 'Hay 1 recipiente en servicio.' : `Hay ${total} recipientes en servicio.`,
    HREF.vessels,
  );
}

function openingCheck(rows: OpeningFact[] | undefined): SetupCheck {
  const title = 'Aforo de arranque';
  if (rows === undefined) return notDeployed('inventory.opening_count', title);
  const planned = rows.filter((row) => row.date === OPENING_COUNT_DATE);
  const posted = planned.find((row) => row.status === 'posted' || row.status === 'approved');
  if (posted) {
    return item(
      'inventory.opening_count',
      'ok',
      title,
      'El aforo de arranque del 31-12-2026 está cerrado.',
      HREF.counts,
    );
  }
  if (planned.length > 0) {
    return item(
      'inventory.opening_count',
      'warning',
      title,
      'El aforo de arranque del 31-12-2026 está previsto y aún no cerrado.',
      HREF.counts,
    );
  }
  return item(
    'inventory.opening_count',
    'missing',
    title,
    'No hay aforo de arranque con fecha 31-12-2026.',
    HREF.counts,
  );
}

function warehouseCheck(rows: WarehouseFact[] | undefined): SetupCheck {
  if (rows === undefined) return notDeployed('silicie.warehouse', 'Depósito fiscal');
  if (rows.length === 0) {
    return item('silicie.warehouse', 'missing', 'Depósito fiscal', 'No hay depósito fiscal con CAE.', null);
  }
  const real = rows.find((row) => !row.test);
  const shown = maskCae((real ?? rows[0])?.cae ?? '');
  if (!real) {
    return item(
      'silicie.warehouse',
      'warning',
      'Depósito fiscal',
      `El depósito fiscal usa un CAE de pruebas (${shown}).`,
      null,
    );
  }
  return item('silicie.warehouse', 'ok', 'Depósito fiscal', `Hay depósito fiscal (${shown}).`, null);
}

function exerciseCheck(
  warehouses: WarehouseFact[] | undefined,
  rows: { year: number; status: string }[] | undefined,
  year: number,
  month: number,
): SetupCheck {
  if (rows === undefined || warehouses === undefined) return notDeployed('silicie.exercise', 'Ejercicio SILICIE');
  if (warehouses.length === 0) {
    return item('silicie.exercise', 'missing', 'Ejercicio SILICIE', 'Sin depósito fiscal no hay ejercicio SILICIE.', null);
  }
  const open = (value: number) => rows.some((row) => row.year === value && row.status === 'open');
  if (!open(year)) {
    return item('silicie.exercise', 'missing', 'Ejercicio SILICIE', `No hay ejercicio SILICIE abierto para ${year}.`, null);
  }
  if (month >= 10 && !open(year + 1)) {
    return item(
      'silicie.exercise',
      'warning',
      'Ejercicio SILICIE',
      `El ejercicio ${year} está abierto. Falta abrir ${year + 1}.`,
      null,
    );
  }
  return item('silicie.exercise', 'ok', 'Ejercicio SILICIE', `El ejercicio ${year} está abierto.`, null);
}

function ledgerCheck(ledgers: { total: number; reviewed: number } | undefined): SetupCheck {
  if (ledgers === undefined) return notDeployed('silicie.ledgers', 'Mayores SILICIE');
  if (ledgers.total === 0) {
    return item('silicie.ledgers', 'missing', 'Mayores SILICIE', 'No hay mayores de SILICIE.', null);
  }
  if (ledgers.reviewed === 0) {
    return item(
      'silicie.ledgers',
      'warning',
      'Mayores SILICIE',
      ledgers.total === 1
        ? 'Hay 1 mayor activo sin la revisión del asesor.'
        : `Hay ${ledgers.total} mayores activos sin la revisión del asesor.`,
      null,
    );
  }
  return item(
    'silicie.ledgers',
    'ok',
    'Mayores SILICIE',
    ledgers.total === 1 ? 'Hay 1 mayor de SILICIE.' : `Hay ${ledgers.total} mayores de SILICIE.`,
    null,
  );
}

function parcelCheck(total: number | undefined): SetupCheck {
  if (total === undefined) return notDeployed('vineyard.parcels', 'Parcelas');
  if (total === 0) {
    return item('vineyard.parcels', 'missing', 'Parcelas', 'No hay parcelas cargadas.', null);
  }
  return item(
    'vineyard.parcels',
    'ok',
    'Parcelas',
    total === 1 ? 'Hay 1 parcela activa.' : `Hay ${total} parcelas activas.`,
    null,
  );
}

function mcpCheck(cvbot: Facts['cvbot']): SetupCheck {
  if (cvbot === undefined) return notDeployed('mcp.cvbot', 'Cliente CVBOT');
  if (cvbot.state === 'ok') return item('mcp.cvbot', 'ok', 'Cliente CVBOT', 'CVBOT está registrado.', null);
  if (cvbot.state === 'no-token' && cvbot.id) {
    return item('mcp.cvbot', 'warning', 'Cliente CVBOT', 'CVBOT está registrado, pero el token no está vigente.', null, {
      kind: 'rotate_mcp',
      id: cvbot.id,
    });
  }
  if (cvbot.state === 'revoked') {
    return item('mcp.cvbot', 'missing', 'Cliente CVBOT', 'CVBOT está revocado.', null);
  }
  return item('mcp.cvbot', 'missing', 'Cliente CVBOT', 'CVBOT no está registrado como cliente MCP.', null, {
    kind: 'register_mcp',
  });
}

function notDeployed(id: string, title: string): SetupCheck {
  return item(id, 'missing', title, 'Esta función no está desplegada en la base de datos.', null);
}

function item(
  id: string,
  status: CheckStatus,
  title: string,
  detail: string,
  href: string | null,
  action?: SetupAction,
): SetupCheck {
  const row: SetupCheck = { id, status, title, detail, href };
  if (action && status !== 'ok') row.action = action;
  return row;
}

function formOf(entity: EntityFact): EntityForm {
  return {
    code: entity.code,
    legal_name: entity.legal_name,
    tax_id: entity.tax_id,
    address_line: entity.address_line,
    postal_code: entity.postal_code,
    city: entity.city,
    province: entity.province,
    country_code: entity.country_code,
    eori: entity.eori,
  };
}

function entityLabel(code: string): string {
  if (code === 'PO') return 'P.O';
  return code;
}

function addressIssue(entity: EntityForm): string | null {
  const line = entity.address_line.trim().toLowerCase();
  const city = entity.city.trim().toLowerCase();
  const province = entity.province.trim().toLowerCase();
  if (entity.postal_code === '00000') return 'el código postal es 00000';
  if (line === '' || line === 'pendiente' || line === 'calle ejemplo 1') return 'la dirección es de ejemplo';
  if (city === 'pendiente' || city === 'ejemplo' || province === 'pendiente' || province === 'ejemplo') {
    return 'la localidad es de ejemplo';
  }
  return null;
}

function taxProblem(taxId: string | null, country: string | null): boolean {
  if (taxId == null || taxId.trim() === '' || taxId.toUpperCase() === 'PENDIENTE') return true;
  const hint = country && /^[A-Za-z]{2}$/.test(country) ? country : 'ES';
  const parsed = normalizeTaxId(taxId, hint);
  return !parsed.valid;
}

function isCompanyTax(taxId: string): boolean {
  const parsed = normalizeTaxId(taxId, 'ES');
  return parsed.valid && parsed.type === 'nif' && ENTITY_FIRST.includes(taxId.trim().toUpperCase().charAt(0));
}

function isPersonTax(taxId: string): boolean {
  const parsed = normalizeTaxId(taxId, 'ES');
  if (!parsed.valid || (parsed.type !== 'nif' && parsed.type !== 'nie')) return false;
  return !ENTITY_FIRST.includes(taxId.trim().toUpperCase().charAt(0));
}

function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  const head = parts.slice(0, -1).join(', ');
  return `${head} y ${parts[parts.length - 1] ?? ''}`;
}

function idOf(value: unknown): string {
  return text(value).toLowerCase();
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function int(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return 0;
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === 't';
}

function civil(value: unknown): string {
  if (value instanceof Date) return businessDate(value);
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return businessDate(parsed);
}
