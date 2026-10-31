import { sql } from '../../db/sql';
import { domainError } from '../../errors';
import { money } from '../../money';
import type { SqlReader } from './documents';
import { addAmounts, subAmounts, sameAmount } from './format';
import type {
  InvoiceLineView,
  InvoiceTaxView,
  IssuedInvoice,
  PartyIdentity,
  PostalAddress,
  RectificationView,
  TaxIdType,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAX_TYPES = new Set(['nif', 'nie', 'vat_eu', 'passport', 'foreign_id', 'none']);
const SENT = new Set(['download', 'email', 'edi', 'portal', 'paper']);

export interface LoadedInvoice extends IssuedInvoice {
  legalEntityId: string;
  customerId: string | null;
  status: 'issued' | 'voided';
  sentAt: string | null;
  sentBy: string | null;
  sentChannel: 'download' | 'email' | 'edi' | 'portal' | 'paper' | null;
}

export type InvoiceLookup =
  | { kind: 'missing' }
  | { kind: 'not_issued'; legalEntityId: string; status: string }
  | { kind: 'ready'; legalEntityId: string; invoice: LoadedInvoice };

export async function loadInvoiceDocument(reader: SqlReader, id: string): Promise<InvoiceLookup> {
  if (!UUID.test(id)) return { kind: 'missing' };
  const headers = await reader.read<Record<string, unknown>>(sql`
    SELECT
      i.id, i.legal_entity_id, i.status, i.invoice_type, i.number, i.issue_date, i.operation_date,
      i.customer_id, i.customer_snapshot, i.currency, i.language, i.description,
      i.subtotal, i.tax_total, i.surcharge_total, i.withholding_total, i.total,
      i.payment_method, i.notes, i.incoterm, i.pdf_attachment_id, i.legal_mentions,
      i.sent_at, i.sent_by, i.sent_channel,
      e.code AS entity_code, e.legal_name AS issuer_name, e.trade_name AS issuer_trade,
      e.tax_id AS issuer_tax_id, e.address_line, e.postal_code, e.city, e.province,
      e.country_code AS issuer_country, e.registry_data,
      s.code AS series_code,
      EXISTS (
        SELECT 1 FROM regulatory.verifactu_installation v
        WHERE v.legal_entity_id = i.legal_entity_id
          AND v.is_active
          AND v.starts_on <= i.issue_date
      ) AS verifactu_active,
      (
        SELECT r.qr_url FROM regulatory.verifactu_record r
        WHERE r.invoice_id = i.id AND r.record_type = 'alta' AND r.qr_url IS NOT NULL
        ORDER BY r.created_at DESC
        LIMIT 1
      ) AS qr_url
    FROM billing.invoice i
    JOIN core.legal_entity e ON e.id = i.legal_entity_id
    JOIN core.number_series s ON s.id = i.series_id
    WHERE i.id = CAST(${id} AS UUID)
  `);
  const header = headers[0];
  if (!header) return { kind: 'missing' };
  const legalEntityId = text(header.legal_entity_id);
  const status = text(header.status);
  if (status !== 'issued' && status !== 'voided') {
    return { kind: 'not_issued', legalEntityId, status };
  }

  const [lineRows, taxRows, dueRows, rectificationRows, linkRows, sentRows] = await Promise.all([
    reader.read<Record<string, unknown>>(sql`
      SELECT line_no, sku, description, lot_code, quantity, unit, unit_price, discount_pct, tax_code, line_base
      FROM billing.invoice_line
      WHERE invoice_id = CAST(${id} AS UUID)
      ORDER BY line_no
    `),
    reader.read<Record<string, unknown>>(sql`
      SELECT t.tax_code, t.rate, t.base, t.quota, t.surcharge_rate, t.surcharge_quota,
             t.withholding_rate, t.withholding, c.legal_mention_es, c.legal_mention_en,
             c.exemption, c.qualification
      FROM billing.invoice_tax t
      JOIN billing.tax_code c ON c.code = t.tax_code
      WHERE t.invoice_id = CAST(${id} AS UUID)
      ORDER BY t.tax_code
    `),
    reader.read<Record<string, unknown>>(sql`
      SELECT seq, due_date, amount
      FROM billing.invoice_due
      WHERE invoice_id = CAST(${id} AS UUID)
      ORDER BY seq
    `),
    reader.read<Record<string, unknown>>(sql`
      SELECT rectified_number, rectified_issue_date, rectified_issuer_tax_id, relation, reason
      FROM billing.invoice_rectification
      WHERE rectifying_invoice_id = CAST(${id} AS UUID)
      ORDER BY rectified_issue_date, rectified_number
    `),
    reader.read<{ attachment_id: string }>(sql`
      SELECT attachment_id
      FROM core.attachment_link
      WHERE entity_table = 'billing.invoice'
        AND entity_id = CAST(${id} AS UUID)
        AND role = 'invoice_pdf'
      ORDER BY created_at
      LIMIT 1
    `),
    reader.read<{ payload: unknown; occurred_at: string }>(sql`
      SELECT payload, occurred_at
      FROM ops.outbox_event
      WHERE event_type = 'billing.invoice.sent'
        AND aggregate_id = CAST(${id} AS UUID)
      ORDER BY id DESC
      LIMIT 1
    `),
  ]);

  const language = text(header.language);
  if (language !== 'es' && language !== 'en') {
    throw domainError('WC_VALIDATION', { language: 'El idioma de la factura no es válido' });
  }
  const subtotal = moneyText(header.subtotal, 'subtotal');
  const taxTotal = moneyText(header.tax_total, 'tax_total');
  const surchargeTotal = moneyText(header.surcharge_total, 'surcharge_total');
  const withholdingTotal = moneyText(header.withholding_total, 'withholding_total');
  const totalToPay = moneyText(header.total, 'total');
  const importeTotal = addAmounts([subtotal, taxTotal, surchargeTotal]);
  if (!sameAmount(subAmounts(importeTotal, withholdingTotal), totalToPay)) {
    throw domainError('WC_VALIDATION', { total: 'El total a pagar no cuadra con el desglose' });
  }

  const issueDate = asDate(header.issue_date);
  const operationRaw = header.operation_date == null ? null : asDate(header.operation_date);
  const columnChannel = header.sent_channel == null ? null : text(header.sent_channel);
  if (columnChannel !== null && !SENT.has(columnChannel)) {
    throw domainError('WC_VALIDATION', { sent_channel: 'Canal de envío desconocido' });
  }
  const recordedSend = sendFrom(sentRows[0]);
  const sentChannel = (columnChannel ?? recordedSend?.channel ?? null) as LoadedInvoice['sentChannel'];
  const sentAt = header.sent_at == null ? recordedSend?.at ?? null : text(header.sent_at);
  const sentBy = header.sent_by == null ? recordedSend?.by ?? null : text(header.sent_by);
  const linkedPdf = linkRows[0] ? text(linkRows[0].attachment_id) : null;

  const invoice: LoadedInvoice = {
    id: text(header.id),
    legalEntityId,
    legalEntityCode: text(header.entity_code),
    seriesCode: text(header.series_code),
    number: text(header.number),
    invoiceType: text(header.invoice_type),
    issueDate,
    operationDate: operationRaw === issueDate ? null : operationRaw,
    language,
    description: text(header.description),
    currency: text(header.currency),
    issuer: issuerFrom(header),
    customer: customerFrom(header.customer_snapshot),
    customerId: header.customer_id == null ? null : text(header.customer_id),
    lines: lineRows.map(lineFrom),
    taxes: taxRows.map(taxFrom),
    subtotal,
    taxTotal,
    surchargeTotal,
    withholdingTotal,
    importeTotal,
    totalToPay,
    dues: dueRows.map((row) => ({
      seq: Number(row.seq),
      dueDate: asDate(row.due_date),
      amount: moneyText(row.amount, 'due'),
    })),
    legalMentions: asStringArray(header.legal_mentions),
    notes: optionalText(header.notes),
    incoterm: optionalText(header.incoterm),
    paymentMethod: optionalText(header.payment_method),
    rectifications: rectificationRows.map(rectificationFrom),
    branding: { logo: null, accentRgb: null },
    verifactu: {
      active: asBool(header.verifactu_active),
      qrUrl: optionalText(header.qr_url),
      // The module matrix is M4. Active installations fail closed in the renderer.
      qrModules: null,
    },
    pdfAttachmentId: header.pdf_attachment_id == null ? linkedPdf : text(header.pdf_attachment_id),
    status,
    sentAt,
    sentBy,
    sentChannel,
  };
  return { kind: 'ready', legalEntityId, invoice };
}

export async function invoiceRecipients(reader: SqlReader, customerId: string | null): Promise<string[]> {
  if (!customerId) return [];
  const rows = await reader.read<{ email: string }>(sql`
    SELECT lower(email) AS email
    FROM party.contact_person
    WHERE contact_id = CAST(${customerId} AS UUID)
      AND archived_at IS NULL
      AND receives_invoices
      AND email IS NOT NULL
    ORDER BY email
  `);
  const seen = new Set<string>();
  for (const row of rows) {
    const email = text(row.email).trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) seen.add(email);
  }
  return [...seen];
}

function issuerFrom(header: Record<string, unknown>): PartyIdentity {
  return {
    legalName: required(header.issuer_name, 'issuer'),
    tradeName: optionalText(header.issuer_trade),
    taxId: required(header.issuer_tax_id, 'issuer'),
    taxIdType: 'nif',
    address: {
      line1: required(header.address_line, 'issuer'),
      line2: null,
      postalCode: required(header.postal_code, 'issuer'),
      city: required(header.city, 'issuer'),
      province: optionalText(header.province),
      countryCode: required(header.issuer_country, 'issuer').toUpperCase(),
    },
    registryData: optionalText(header.registry_data),
  };
}

function customerFrom(snapshot: unknown): PartyIdentity {
  const row = asObject(snapshot);
  if (!row) throw domainError('WC_VALIDATION', { customer_snapshot: 'Falta el cliente congelado' });
  const address = asObject(row.address);
  if (!address) throw domainError('WC_VALIDATION', { customer_snapshot: 'Falta la dirección del cliente' });
  return {
    legalName: required(row.legal_name, 'customer_snapshot'),
    tradeName: optionalText(row.trade_name),
    taxId: required(row.tax_id, 'customer_snapshot'),
    taxIdType: taxType(row.tax_id_type),
    address: addressFrom(address),
    registryData: null,
  };
}

function addressFrom(row: Record<string, unknown>): PostalAddress {
  return {
    line1: required(row.line1, 'customer_snapshot'),
    line2: optionalText(row.line2),
    postalCode: required(row.postal_code, 'customer_snapshot'),
    city: required(row.city, 'customer_snapshot'),
    province: optionalText(row.province),
    countryCode: required(row.country_code, 'customer_snapshot').toUpperCase(),
  };
}

function lineFrom(row: Record<string, unknown>): InvoiceLineView {
  return {
    lineNo: Number(row.line_no),
    sku: optionalText(row.sku),
    description: required(row.description, 'lines'),
    lotCode: optionalText(row.lot_code),
    quantity: decimalText(row.quantity, 'lines'),
    unit: required(row.unit, 'lines'),
    unitPrice: decimalText(row.unit_price, 'lines'),
    discountPct: decimalText(row.discount_pct, 'lines'),
    taxCode: required(row.tax_code, 'lines'),
    lineBase: moneyText(row.line_base, 'lines'),
  };
}

function taxFrom(row: Record<string, unknown>): InvoiceTaxView {
  return {
    taxCode: required(row.tax_code, 'taxes'),
    rate: decimalText(row.rate, 'taxes'),
    base: moneyText(row.base, 'taxes'),
    quota: moneyText(row.quota, 'taxes'),
    surchargeRate: decimalText(row.surcharge_rate, 'taxes'),
    surchargeQuota: moneyText(row.surcharge_quota, 'taxes'),
    withholdingRate: decimalText(row.withholding_rate, 'taxes'),
    withholding: moneyText(row.withholding, 'taxes'),
    legalMentionEs: optionalText(row.legal_mention_es),
    legalMentionEn: optionalText(row.legal_mention_en),
    exemption: optionalText(row.exemption),
    qualification: optionalText(row.qualification),
  };
}

function rectificationFrom(row: Record<string, unknown>): RectificationView {
  const relation = text(row.relation);
  if (relation !== 'rectified' && relation !== 'substituted') {
    throw domainError('WC_VALIDATION', { rectification: 'La relación de la rectificativa no es válida' });
  }
  return {
    rectifiedNumber: required(row.rectified_number, 'rectification'),
    rectifiedIssueDate: asDate(row.rectified_issue_date),
    rectifiedIssuerTaxId: required(row.rectified_issuer_tax_id, 'rectification'),
    relation,
    reason: required(row.reason, 'rectification'),
  };
}

function moneyText(value: unknown, field: string): string {
  return money.toString(money.fromString(decimalText(value, field)));
}

function decimalText(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim() !== '') return money.fromString(value.trim()).toFixed();
  if (typeof value === 'number' && Number.isFinite(value)) return money.fromString(String(value)).toFixed();
  if (typeof value === 'bigint') return money.fromString(value.toString()).toFixed();
  throw domainError('WC_VALIDATION', { [field]: 'Importe ilegible' });
}

function asDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/u.exec(value);
    if (match?.[1]) return match[1];
  }
  throw domainError('WC_VALIDATION', { date: 'Fecha ilegible' });
}

function sendFrom(row: { payload: unknown; occurred_at: string } | undefined): {
  at: string;
  by: string | null;
  channel: 'download' | 'email' | 'edi' | 'portal' | 'paper';
} | null {
  if (!row) return null;
  const payload = asObject(row.payload);
  const channel = payload ? text(payload.channel) : '';
  if (!SENT.has(channel)) return null;
  const by = payload?.sent_by == null ? null : text(payload.sent_by);
  const at = payload?.sent_at == null ? text(row.occurred_at) : text(payload.sent_at);
  return { at, by, channel: channel as 'download' | 'email' | 'edi' | 'portal' | 'paper' };
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === 'true';
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter((item) => item.trim() !== '');
  return [];
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function taxType(value: unknown): TaxIdType {
  const type = typeof value === 'string' ? value : '';
  if (TAX_TYPES.has(type)) return type as TaxIdType;
  return 'nif';
}

function required(value: unknown, field: string): string {
  const parsed = optionalText(value);
  if (!parsed) throw domainError('WC_VALIDATION', { [field]: 'Dato obligatorio vacío' });
  return parsed;
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  const parsed = text(value).trim();
  return parsed === '' ? null : parsed;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}
