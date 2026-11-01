import { sessionOf } from '../../auth/guard';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { loadCustomerParty, loadSellerContext, loadTaxRates } from '../pdf/context';
import { renderDocumentPdf, type DocumentPdfLine } from '../pdf/document';
import { shipToFrom } from '../pdf/ship-to';
import { decOf } from './db';
import { getSalesOrder } from './orders';

type ReadDb = Pick<Tx, 'read'>;

const NO_ENTITY = '00000000-0000-0000-0000-000000000000';

const STATUSES: Record<string, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmado',
  partially_delivered: 'Entregado en parte',
  delivered: 'Entregado',
  closed: 'Cerrado',
  cancelled: 'Anulado',
};

/** Pedido de venta con la misma maqueta que el presupuesto y el albarán. No es una factura. */
export async function renderSalesOrderPdf(db: ReadDb, order: Record<string, unknown>): Promise<{ bytes: Uint8Array; filename: string }> {
  const { seller, profile } = await loadSellerContext(db, issuingEntityId(order));
  const customer = await loadCustomerParty(db, textOf(order.customer_id));
  const rates = await loadTaxRates(db);
  const raw = Array.isArray(order.lines) ? (order.lines as Record<string, unknown>[]) : [];
  const lines: DocumentPdfLine[] = raw.map((line) => {
    const discount = decOf(line.discount_pct ?? '0');
    const base = decOf(line.quantity).mul(decOf(line.unit_price)).mul(decOf(100).sub(discount)).div(100);
    const taxCode = line.tax_code == null ? null : String(line.tax_code);
    return {
      description: String(line.description),
      quantity: String(line.quantity),
      unit_price: String(line.unit_price),
      line_base: base.toFixed(2),
      tax_code: taxCode,
      tax_rate: taxCode == null ? null : rates.get(taxCode) ?? null,
      discount_pct: discount.toString(),
      unit: line.unit == null ? null : String(line.unit),
    };
  });
  const number = textOf(order.number);
  const meta: string[] = [`Canal ${await channelName(db, String(order.channel))}`];
  const customerRef = textOf(order.customer_order_ref);
  if (customerRef) meta.push(`Pedido del cliente ${customerRef}`);
  const incoterm = textOf(order.incoterm);
  if (incoterm) meta.push(`Incoterm ${incoterm}`);
  const notes = textOf(order.notes);
  const bytes = await renderDocumentPdf({
    title: 'Pedido',
    number,
    issueDate: textOf(order.order_date),
    dueLabel: order.requested_date ? 'Entrega solicitada' : null,
    dueDate: textOf(order.requested_date),
    status: STATUSES[String(order.status)] ?? String(order.status),
    meta,
    partyLabel: 'Cliente',
    seller,
    profile,
    customer,
    customerName: customer?.legalName ?? 'Cliente',
    shipTo: shipToFrom(order.ship_to),
    customerReferences: textOf(order.customer_references),
    description: notes,
    lines,
    totals: {
      subtotal: String(order.subtotal),
      vat: String(order.tax_total),
      withholding: null,
      total: String(order.total),
    },
    settlement: null,
    note: 'Pedido de venta. No es una factura.',
  });
  return { bytes, filename: `pedido-${safeName(number ?? 'borrador')}.pdf` };
}

export async function salesOrderPdf(writer: Writer, request: Request, id: string): Promise<Response> {
  sessionOf(request);
  const order = await getSalesOrder(writer, id);
  const { bytes, filename } = await renderSalesOrderPdf(writer, order);
  return new Response(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"` },
  });
}

async function channelName(db: ReadDb, code: string): Promise<string> {
  const rows = await db.read<{ name_es: string }>(sql`SELECT name_es FROM sales.channel WHERE code = ${code}`);
  return rows[0] ? String(rows[0].name_es) : code;
}

/** Un pedido en borrador aún no tiene sociedad: la decide la regla de facturación al confirmar. */
function issuingEntityId(order: Record<string, unknown>): string {
  const own = textOf(order.legal_entity_id);
  if (own) return own;
  const preview = order.issuing_preview;
  const previewed = preview && typeof preview === 'object' ? textOf((preview as Record<string, unknown>).entity_id) : null;
  return previewed ?? NO_ENTITY;
}

function textOf(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function safeName(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean === '' ? 'borrador' : clean.slice(0, 60);
}
