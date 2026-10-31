import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { money } from '../money';
import { knowledgeBaseInvoiceDocuments } from './pdf/documents';
import { openDeliveryOnIssue } from './delivery/service';
import type { LoadedInvoice } from './pdf/load';
import type { InvoiceLang, PartyIdentity, TaxIdType } from './pdf/types';
import type { ComputedInvoice } from './compute';
import type { InvoiceView, TaxView } from './readModel';

export async function openIssuedDelivery(
  tx: Tx,
  view: InvoiceView,
  number: string,
  issueDate: string,
  totals: {
    subtotal: string;
    tax_total: string;
    surcharge_total: string;
    withholding_total: string;
    importe_total: string;
    total: string;
  },
  taxes: TaxView[],
  computed: ComputedInvoice,
  now: Date,
): Promise<void> {
  const invoice = await loadedInvoice(tx, view, number, issueDate, totals, taxes, computed);
  await openDeliveryOnIssue(tx, invoice, knowledgeBaseInvoiceDocuments(), now);
}

async function loadedInvoice(
  tx: Tx,
  view: InvoiceView,
  number: string,
  issueDate: string,
  totals: {
    subtotal: string;
    tax_total: string;
    surcharge_total: string;
    withholding_total: string;
    importe_total: string;
    total: string;
  },
  taxes: TaxView[],
  computed: ComputedInvoice,
): Promise<LoadedInvoice> {
  const customer = view.customer;
  if (!customer) throw domainError('WC_INV_TAX_ID_REQUIRED');
  const address = customer.address ?? await anyAddress(tx, customer.id) ?? fallbackAddress(customer);
  const issuerRows = await tx.read<Record<string, unknown>>(sql`
    SELECT legal_name, trade_name, tax_id, address_line, postal_code, city, province, country_code, registry_data
    FROM core.legal_entity
    WHERE id = CAST(${view.header.legalEntityId} AS UUID)
  `);
  const issuer = issuerRows[0];
  if (!issuer) throw domainError('WC_NOT_FOUND');
  const seriesRows = await tx.read<{ code: unknown }>(sql`
    SELECT code FROM core.number_series WHERE id = CAST(${view.header.seriesId} AS UUID)
  `);
  const seriesCode = seriesRows[0] ? String(seriesRows[0].code) : '';
  const language: InvoiceLang = view.header.language === 'en' ? 'en' : 'es';
  return {
    id: view.header.id,
    legalEntityId: view.header.legalEntityId,
    customerId: view.header.customerId,
    status: 'issued',
    sentAt: null,
    sentBy: null,
    sentChannel: null,
    legalEntityCode: view.entity.code,
    seriesCode,
    number,
    invoiceType: view.header.invoiceType,
    issueDate,
    operationDate: view.header.operationDate,
    language,
    description: view.header.description,
    currency: view.header.currency,
    issuer: {
      legalName: String(issuer.legal_name),
      tradeName: issuer.trade_name == null ? null : String(issuer.trade_name),
      taxId: String(issuer.tax_id),
      taxIdType: 'nif',
      address: {
        line1: String(issuer.address_line),
        line2: null,
        postalCode: String(issuer.postal_code),
        city: String(issuer.city),
        province: issuer.province == null ? null : String(issuer.province),
        countryCode: String(issuer.country_code),
      },
      registryData: issuer.registry_data == null ? null : String(issuer.registry_data),
    },
    customer: customerParty(customer, address),
    lines: view.lines.map((line, index) => ({
      lineNo: line.lineNo,
      sku: line.sku,
      description: line.description,
      lotCode: line.lotCode,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      discountPct: line.discountPct,
      taxCode: line.taxCode,
      lineBase: computed.lines[index] ? money.toString(computed.lines[index].lineBase) : line.lineBase,
    })),
    taxes: taxes.map((tax) => ({
      taxCode: tax.taxCode,
      rate: tax.rate,
      base: tax.base,
      quota: tax.quota,
      surchargeRate: tax.surchargeRate,
      surchargeQuota: tax.surchargeQuota,
      withholdingRate: tax.withholdingRate,
      withholding: tax.withholding,
      legalMentionEs: null,
      legalMentionEn: null,
      exemption: tax.exemption,
      qualification: tax.qualification,
    })),
    subtotal: totals.subtotal,
    taxTotal: totals.tax_total,
    surchargeTotal: totals.surcharge_total,
    withholdingTotal: totals.withholding_total,
    importeTotal: totals.importe_total,
    totalToPay: totals.total,
    dues: computed.dues.map((due, index) => ({
      seq: index + 1,
      dueDate: due.dueDate,
      amount: money.toString(due.amount),
    })),
    legalMentions: [],
    notes: view.header.notes,
    incoterm: view.header.incoterm,
    paymentMethod: view.header.paymentMethod,
    rectifications: view.rectifications.map((row) => ({
      rectifiedNumber: row.number,
      rectifiedIssueDate: row.issueDate,
      rectifiedIssuerTaxId: row.issuerTaxId,
      relation: row.relation === 'substituted' ? 'substituted' : 'rectified',
      reason: row.reason,
    })),
    branding: { logo: null, accentRgb: null },
    verifactu: { active: false, qrUrl: null, qrModules: null },
    pdfAttachmentId: null,
  };
}

async function anyAddress(tx: Tx, contactId: string): Promise<NonNullable<InvoiceView['customer']>['address']> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT line1, line2, postal_code, city, province, country_code
    FROM party.contact_address
    WHERE contact_id = CAST(${contactId} AS UUID) AND archived_at IS NULL
    ORDER BY is_default DESC, created_at
    LIMIT 1
  `);
  const address = rows[0];
  if (!address) return null;
  return {
    line1: String(address.line1),
    line2: address.line2 == null ? null : String(address.line2),
    postalCode: String(address.postal_code),
    city: String(address.city),
    province: address.province == null ? null : String(address.province),
    countryCode: String(address.country_code),
  };
}

function fallbackAddress(customer: NonNullable<InvoiceView['customer']>): NonNullable<NonNullable<InvoiceView['customer']>['address']> {
  const country = /^[A-Za-z]{2}$/.test(customer.country) ? customer.country.toUpperCase() : 'ES';
  return {
    line1: customer.legalName.slice(0, 120),
    line2: null,
    postalCode: '00000',
    city: 'Sin domicilio de facturación',
    province: null,
    countryCode: country,
  };
}

function customerParty(
  customer: NonNullable<InvoiceView['customer']>,
  address: NonNullable<NonNullable<InvoiceView['customer']>['address']>,
): PartyIdentity {
  return {
    legalName: customer.legalName,
    tradeName: customer.tradeName,
    taxId: customer.taxId ?? '',
    taxIdType: taxType(customer.taxIdType),
    address: {
      line1: address.line1,
      line2: address.line2,
      postalCode: address.postalCode,
      city: address.city,
      province: address.province,
      countryCode: address.countryCode,
    },
    registryData: null,
  };
}

function taxType(value: string): TaxIdType {
  if (value === 'nif' || value === 'nie' || value === 'vat_eu' || value === 'passport' || value === 'foreign_id' || value === 'none') {
    return value;
  }
  return 'nif';
}
