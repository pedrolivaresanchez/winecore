import type { Tx } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import type { Exemption, Qualification, TaxCode, TaxKind } from './taxCodes';
import {
  day,
  decimalOf,
  fixed,
  flag,
  idOf,
  importeOf,
  isUuid,
  jsonObject,
  moneyText,
  rectificationDetail,
  stamp,
  text,
} from './format';

type Read = Pick<Tx, 'read'>;

export interface HeaderView {
  id: string;
  legalEntityId: string;
  seriesId: string | null;
  number: string | null;
  status: string;
  invoiceType: string;
  rectificationKind: 'S' | 'I' | null;
  issueDate: string | null;
  operationDate: string | null;
  customerId: string | null;
  customerSnapshot: Record<string, unknown> | null;
  shipTo: Record<string, unknown> | null;
  customerReferences: string | null;
  channel: string | null;
  salesOrderId: string | null;
  currency: string;
  language: string;
  description: string;
  notes: string | null;
  incoterm: string | null;
  subtotal: string | null;
  taxTotal: string | null;
  surchargeTotal: string | null;
  withholdingTotal: string | null;
  total: string | null;
  amountPaid: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paymentTermsDays: number | null;
  approvalRequestId: string | null;
  issuedAt: string | null;
  verifactuRecordId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  legacyRefs: Record<string, unknown>;
  noPhysicalReturn: boolean | null;
  returnDeliveryNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LineView {
  id: string;
  lineNo: number;
  productId: string | null;
  sku: string | null;
  description: string;
  lotId: string | null;
  lotCode: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
  lineBase: string;
  taxCode: string;
  deliveryNoteLineId: string | null;
  orderLineId: string | null;
  unitCost: string | null;
}

export interface TaxView {
  taxCode: string;
  tax: string;
  regimeKey: string;
  qualification: string | null;
  exemption: string | null;
  rate: string;
  base: string;
  quota: string;
  surchargeRate: string;
  surchargeQuota: string;
  withholdingRate: string;
  withholding: string;
}

export interface DueView {
  seq: number;
  dueDate: string;
  amount: string;
}

export interface RectView {
  id: string;
  rectifiedInvoiceId: string | null;
  number: string;
  issueDate: string;
  issuerTaxId: string;
  relation: string;
  baseRectified: string | null;
  quotaRectified: string | null;
  surchargeRectified: string | null;
  reason: string;
}

export interface CustomerView {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  taxIdType: string;
  taxIdCountry: string | null;
  country: string;
  language: string;
  currency: string;
  paymentMethod: string | null;
  paymentTermsDays: number;
  defaultPriceListId: string | null;
  defaultChannel: string | null;
  archived: boolean;
  vatValidatedAt: string | null;
  /** Teléfono y correo de la persona de contacto (la que recibe facturas, si la hay). */
  phone: string | null;
  email: string | null;
  address: {
    line1: string;
    line2: string | null;
    postalCode: string;
    city: string;
    province: string | null;
    countryCode: string;
  } | null;
}

export interface EntityView {
  id: string;
  code: string;
  legalName: string;
  taxId: string;
  personType: string;
  incomeTax: string;
  active: boolean;
}

export interface SeriesView {
  id: string;
  legalEntityId: string;
  docType: string;
  year: number;
  active: boolean;
  isDefault: boolean;
}

export interface ProductView {
  id: string;
  sku: string;
  name: string;
  kind: string;
  unit: string;
  defaultTaxCode: string | null;
  requiresLot: boolean;
  active: boolean;
}

export interface InvoiceView {
  header: HeaderView;
  lines: LineView[];
  taxes: TaxView[];
  dues: DueView[];
  rectifications: RectView[];
  customer: CustomerView | null;
  entity: EntityView;
  series: SeriesView | null;
  products: Map<string, ProductView>;
}

function intOf(value: unknown): number | null {
  if (value == null) return null;
  const number = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isInteger(number) ? number : null;
}

export function headerOf(row: Record<string, unknown>): HeaderView {
  const kind = text(row.rectification_kind);
  const legacyRefs = jsonObject(row.legacy_refs) ?? {};
  const physical = rectificationDetail(legacyRefs);
  return {
    id: idOf(row.id),
    legalEntityId: idOf(row.legal_entity_id),
    seriesId: row.series_id == null ? null : idOf(row.series_id),
    number: text(row.number),
    status: String(row.status),
    invoiceType: String(row.invoice_type),
    rectificationKind: kind === 'S' || kind === 'I' ? kind : null,
    issueDate: day(row.issue_date),
    operationDate: day(row.operation_date),
    customerId: row.customer_id == null ? null : idOf(row.customer_id),
    customerSnapshot: jsonObject(row.customer_snapshot),
    shipTo: jsonObject(row.ship_to),
    customerReferences: text(row.customer_references),
    channel: text(row.channel),
    salesOrderId: row.sales_order_id == null ? null : idOf(row.sales_order_id),
    currency: String(row.currency),
    language: String(row.language),
    description: String(row.description),
    notes: text(row.notes),
    incoterm: text(row.incoterm),
    subtotal: moneyText(row.subtotal),
    taxTotal: moneyText(row.tax_total),
    surchargeTotal: moneyText(row.surcharge_total),
    withholdingTotal: moneyText(row.withholding_total),
    total: moneyText(row.total),
    amountPaid: moneyText(row.amount_paid) ?? '0.00',
    paymentStatus: String(row.payment_status),
    paymentMethod: text(row.payment_method),
    paymentTermsDays: intOf(row.payment_terms_days),
    approvalRequestId: row.approval_request_id == null ? null : idOf(row.approval_request_id),
    issuedAt: stamp(row.issued_at),
    verifactuRecordId: row.verifactu_record_id == null ? null : idOf(row.verifactu_record_id),
    voidedAt: stamp(row.voided_at),
    voidReason: text(row.void_reason),
    legacyRefs,
    noPhysicalReturn: physical.noPhysicalReturn,
    returnDeliveryNote: physical.returnDeliveryNote,
    createdAt: stamp(row.created_at) ?? '',
    updatedAt: stamp(row.updated_at) ?? '',
  };
}

function lineOf(row: Record<string, unknown>): LineView {
  return {
    id: idOf(row.id),
    lineNo: intOf(row.line_no) ?? 0,
    productId: row.product_id == null ? null : idOf(row.product_id),
    sku: text(row.sku),
    description: String(row.description),
    lotId: row.lot_id == null ? null : idOf(row.lot_id),
    lotCode: text(row.lot_code),
    quantity: fixed(row.quantity, 3),
    unit: String(row.unit),
    unitPrice: fixed(row.unit_price, 6),
    discountPct: fixed(row.discount_pct, 2),
    lineBase: fixed(row.line_base, 2),
    taxCode: String(row.tax_code),
    deliveryNoteLineId: row.delivery_note_line_id == null ? null : idOf(row.delivery_note_line_id),
    orderLineId: row.order_line_id == null ? null : idOf(row.order_line_id),
    unitCost: row.unit_cost_snapshot == null ? null : fixed(row.unit_cost_snapshot, 6),
  };
}

export async function loadHeader(tx: Read, id: string): Promise<HeaderView> {
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  const rows = await tx.read(sql`SELECT * FROM billing.invoice WHERE id = CAST(${id} AS UUID)`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return headerOf(row);
}

export async function loadLines(tx: Read, invoiceId: string): Promise<LineView[]> {
  const rows = await tx.read(sql`
    SELECT * FROM billing.invoice_line
    WHERE invoice_id = CAST(${invoiceId} AS UUID)
    ORDER BY line_no
  `);
  return rows.map((row) => lineOf(row));
}

export async function loadTaxes(tx: Read, invoiceId: string): Promise<TaxView[]> {
  const rows = await tx.read(sql`
    SELECT * FROM billing.invoice_tax
    WHERE invoice_id = CAST(${invoiceId} AS UUID)
    ORDER BY tax_code
  `);
  return rows.map((row) => ({
    taxCode: String(row.tax_code),
    tax: String(row.tax),
    regimeKey: String(row.regime_key),
    qualification: text(row.qualification),
    exemption: text(row.exemption),
    rate: fixed(row.rate, 2),
    base: fixed(row.base, 2),
    quota: fixed(row.quota, 2),
    surchargeRate: fixed(row.surcharge_rate, 2),
    surchargeQuota: fixed(row.surcharge_quota, 2),
    withholdingRate: fixed(row.withholding_rate, 2),
    withholding: fixed(row.withholding, 2),
  }));
}

export async function loadDues(tx: Read, invoiceId: string): Promise<DueView[]> {
  const rows = await tx.read(sql`
    SELECT seq, due_date, amount FROM billing.invoice_due
    WHERE invoice_id = CAST(${invoiceId} AS UUID)
    ORDER BY seq
  `);
  return rows.map((row) => ({
    seq: intOf(row.seq) ?? 0,
    dueDate: day(row.due_date) ?? '',
    amount: fixed(row.amount, 2),
  }));
}

export async function loadRectifications(tx: Read, invoiceId: string): Promise<RectView[]> {
  const rows = await tx.read(sql`
    SELECT * FROM billing.invoice_rectification
    WHERE rectifying_invoice_id = CAST(${invoiceId} AS UUID)
    ORDER BY rectified_issue_date, rectified_number
  `);
  return rows.map((row) => ({
    id: idOf(row.id),
    rectifiedInvoiceId: row.rectified_invoice_id == null ? null : idOf(row.rectified_invoice_id),
    number: String(row.rectified_number),
    issueDate: day(row.rectified_issue_date) ?? '',
    issuerTaxId: String(row.rectified_issuer_tax_id),
    relation: String(row.relation),
    baseRectified: moneyText(row.base_rectified),
    quotaRectified: moneyText(row.quota_rectified),
    surchargeRectified: moneyText(row.surcharge_rectified),
    reason: String(row.reason),
  }));
}

export async function loadCustomer(tx: Read, id: string): Promise<CustomerView | null> {
  if (!isUuid(id)) return null;
  const rows = await tx.read(sql`SELECT * FROM party.contact WHERE id = CAST(${id} AS UUID)`);
  const row = rows[0];
  if (!row) return null;
  const addresses = await tx.read(sql`
    SELECT * FROM party.contact_address
    WHERE contact_id = CAST(${id} AS UUID) AND archived_at IS NULL AND kind IN ('billing', 'both')
    ORDER BY is_default DESC, created_at
    LIMIT 1
  `);
  const address = addresses[0];
  const people = await tx.read(sql`
    SELECT email, phone FROM party.contact_person
    WHERE contact_id = CAST(${id} AS UUID) AND archived_at IS NULL
    ORDER BY receives_invoices DESC, created_at
  `);
  const email = people.map((person) => text(person.email)).find((value) => value !== null) ?? null;
  const phone = people.map((person) => text(person.phone)).find((value) => value !== null) ?? null;
  return {
    id: idOf(row.id),
    legalName: String(row.legal_name),
    tradeName: text(row.trade_name),
    taxId: text(row.tax_id),
    taxIdType: String(row.tax_id_type),
    taxIdCountry: text(row.tax_id_country),
    country: String(row.country_code),
    language: String(row.language),
    currency: String(row.currency),
    paymentMethod: text(row.payment_method),
    paymentTermsDays: intOf(row.payment_terms_days) ?? 30,
    defaultPriceListId: row.default_price_list_id == null ? null : idOf(row.default_price_list_id),
    defaultChannel: text(row.default_channel),
    archived: row.archived_at != null,
    vatValidatedAt: stamp(row.vat_id_validated_at),
    phone,
    email,
    address: address ? {
      line1: String(address.line1),
      line2: text(address.line2),
      postalCode: String(address.postal_code),
      city: String(address.city),
      province: text(address.province),
      countryCode: String(address.country_code),
    } : null,
  };
}

export async function loadEntity(tx: Read, id: string): Promise<EntityView | null> {
  if (!isUuid(id)) return null;
  const rows = await tx.read(sql`
    SELECT id, code, legal_name, tax_id, person_type, income_tax, is_active
    FROM core.legal_entity WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: idOf(row.id),
    code: String(row.code),
    legalName: String(row.legal_name),
    taxId: String(row.tax_id).toUpperCase(),
    personType: String(row.person_type),
    incomeTax: String(row.income_tax),
    active: flag(row.is_active),
  };
}

export async function loadEntityByCode(tx: Read, code: string): Promise<EntityView | null> {
  const rows = await tx.read<{ id: unknown }>(sql`
    SELECT id FROM core.legal_entity WHERE code = ${code} LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return loadEntity(tx, idOf(row.id));
}

export async function loadSeries(tx: Read, id: string): Promise<SeriesView | null> {
  if (!isUuid(id)) return null;
  const rows = await tx.read(sql`
    SELECT id, legal_entity_id, doc_type, "year" AS series_year, is_active, is_default
    FROM core.number_series WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: idOf(row.id),
    legalEntityId: idOf(row.legal_entity_id),
    docType: String(row.doc_type),
    year: intOf(row.series_year) ?? 0,
    active: flag(row.is_active),
    isDefault: flag(row.is_default),
  };
}

export function seriesFits(
  series: SeriesView | null,
  entityId: string,
  docType: string,
  year: number,
): series is SeriesView {
  return series != null && series.active && series.legalEntityId === entityId && series.docType === docType && series.year === year;
}

export async function findDefaultSeries(
  tx: Read,
  entityId: string,
  docType: string,
  year: number,
): Promise<SeriesView | null> {
  const rows = await tx.read<{ id: unknown }>(sql`
    SELECT id FROM core.number_series
    WHERE legal_entity_id = CAST(${entityId} AS UUID)
      AND doc_type = ${docType}
      AND "year" = ${year}
      AND is_active
    ORDER BY is_default DESC, created_at
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return loadSeries(tx, idOf(row.id));
}

export async function loadProduct(tx: Read, id: string): Promise<ProductView | null> {
  if (!isUuid(id)) return null;
  const rows = await tx.read(sql`
    SELECT id, sku, name, kind, unit, default_tax_code, requires_lot, is_active
    FROM catalog.product WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: idOf(row.id),
    sku: String(row.sku),
    name: String(row.name),
    kind: String(row.kind),
    unit: String(row.unit),
    defaultTaxCode: text(row.default_tax_code),
    requiresLot: flag(row.requires_lot),
    active: flag(row.is_active),
  };
}

export async function loadTaxCodes(tx: Read): Promise<Map<string, TaxCode>> {
  const rows = await tx.read(sql`SELECT * FROM billing.tax_code WHERE is_active`);
  const map = new Map<string, TaxCode>();
  for (const row of rows) {
    const qualification = text(row.qualification) as Qualification | null;
    const exemption = text(row.exemption) as Exemption | null;
    const code = String(row.code);
    map.set(code, {
      code,
      nameEs: String(row.name_es),
      tax: String(row.tax) as TaxKind,
      regimeKey: String(row.regime_key),
      qualification,
      exemption,
      rate: decimalOf(row.rate),
      surchargeRate: decimalOf(row.surcharge_rate),
      withholdingRate: decimalOf(row.withholding_rate),
      exempt: exemption != null,
      notSubject: qualification === 'N1' || qualification === 'N2',
      legalMentionEs: text(row.legal_mention_es),
      legalMentionEn: text(row.legal_mention_en),
      requiresVatId: flag(row.requires_vat_id),
    });
  }
  return map;
}

export async function loadInvoice(tx: Read, id: string): Promise<InvoiceView> {
  const header = await loadHeader(tx, id);
  const [lines, taxes, dues, rectifications, customer, entity, series] = await Promise.all([
    loadLines(tx, id),
    loadTaxes(tx, id),
    loadDues(tx, id),
    loadRectifications(tx, id),
    header.customerId ? loadCustomer(tx, header.customerId) : Promise.resolve(null),
    loadEntity(tx, header.legalEntityId),
    header.seriesId ? loadSeries(tx, header.seriesId) : Promise.resolve(null),
  ]);
  if (!entity) throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });
  const products = new Map<string, ProductView>();
  for (const line of lines) {
    if (!line.productId || products.has(line.productId)) continue;
    const product = await loadProduct(tx, line.productId);
    if (product) products.set(product.id, product);
  }
  return { header, lines, taxes, dues, rectifications, customer, entity, series, products };
}

export function presentInvoice(
  view: InvoiceView,
  extras?: { taxes?: TaxView[]; dues?: DueView[] },
): Record<string, unknown> {
  const header = view.header;
  const taxes = extras?.taxes ?? view.taxes;
  const dues = extras?.dues ?? view.dues;
  const snapshotName = text(header.customerSnapshot?.name);
  return {
    id: header.id,
    legal_entity_id: header.legalEntityId,
    entity_code: view.entity.code,
    series_id: header.seriesId,
    number: header.number,
    status: header.status,
    invoice_type: header.invoiceType,
    rectification_kind: header.rectificationKind,
    issue_date: header.issueDate,
    operation_date: header.operationDate,
    customer_id: header.customerId,
    customer_name: snapshotName ?? view.customer?.legalName ?? null,
    customer_snapshot: header.customerSnapshot,
    ship_to: header.shipTo,
    customer_references: header.customerReferences,
    channel: header.channel,
    sales_order_id: header.salesOrderId,
    currency: header.currency,
    language: header.language,
    description: header.description,
    notes: header.notes,
    no_physical_return: header.noPhysicalReturn,
    return_delivery_note: header.returnDeliveryNote,
    incoterm: header.incoterm,
    subtotal: header.subtotal,
    tax_total: header.taxTotal,
    surcharge_total: header.surchargeTotal,
    withholding_total: header.withholdingTotal,
    importe_total: importeOf(header.subtotal, header.taxTotal, header.surchargeTotal),
    total: header.total,
    amount_paid: header.amountPaid,
    payment_status: header.paymentStatus,
    payment_method: header.paymentMethod,
    payment_terms_days: header.paymentTermsDays,
    approval_request_id: header.approvalRequestId,
    issued_at: header.issuedAt,
    verifactu_record_id: header.verifactuRecordId,
    qr_url: null,
    voided_at: header.voidedAt,
    void_reason: header.voidReason,
    created_at: header.createdAt,
    updated_at: header.updatedAt,
    lines: view.lines.map((line) => ({
      id: line.id,
      line_no: line.lineNo,
      product_id: line.productId,
      sku: line.sku,
      description: line.description,
      lot_id: line.lotId,
      lot_code: line.lotCode,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unitPrice,
      discount_pct: line.discountPct,
      line_base: line.lineBase,
      tax_code: line.taxCode,
      delivery_note_line_id: line.deliveryNoteLineId,
      order_line_id: line.orderLineId,
    })),
    taxes: taxes.map((tax) => ({
      tax_code: tax.taxCode,
      tax: tax.tax,
      regime_key: tax.regimeKey,
      qualification: tax.qualification,
      exemption: tax.exemption,
      rate: tax.rate,
      base: tax.base,
      quota: tax.quota,
      surcharge_rate: tax.surchargeRate,
      surcharge_quota: tax.surchargeQuota,
      withholding_rate: tax.withholdingRate,
      withholding: tax.withholding,
    })),
    dues: dues.map((due) => ({ seq: due.seq, due_date: due.dueDate, amount: due.amount })),
    rectifications: view.rectifications.map((row) => ({
      id: row.id,
      rectified_invoice_id: row.rectifiedInvoiceId,
      number: row.number,
      issue_date: row.issueDate,
      issuer_tax_id: row.issuerTaxId,
      relation: row.relation,
      base_rectified: row.baseRectified,
      quota_rectified: row.quotaRectified,
      surcharge_rectified: row.surchargeRectified,
      reason: row.reason,
    })),
  };
}

export async function lastIssuedDate(tx: Read, seriesId: string, exceptId: string): Promise<string | null> {
  const rows = await tx.read<{ last_date: unknown }>(sql`
    SELECT max(issue_date) AS last_date
    FROM billing.invoice
    WHERE series_id = CAST(${seriesId} AS UUID)
      AND status IN ('issued', 'voided')
      AND id <> CAST(${exceptId} AS UUID)
  `);
  return day(rows[0]?.last_date);
}

export async function countAllocations(tx: Read, invoiceId: string): Promise<number> {
  const rows = await tx.read<{ n: unknown }>(sql`
    SELECT count(*)::INTEGER AS n
    FROM finance.payment_allocation
    WHERE target_table = 'billing.invoice' AND target_id = CAST(${invoiceId} AS UUID)
  `);
  return intOf(rows[0]?.n) ?? 0;
}
