import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { Decimal } from 'decimal.js';
import { loadCustomerParty, loadSellerContext, loadTaxRates } from '../pdf/context';
import { renderDocumentPdf, type DocumentPdfLine } from '../pdf/document';
import { shipToFrom } from '../pdf/ship-to';
import { dateOf, decOf, pathId, textOf } from './db';

const KINDS: Record<string, string> = {
  sale: 'Venta',
  consignment: 'Consigna',
  transfer: 'Traspaso',
  return: 'Devolución',
  sample: 'Muestra',
};

const STATUSES: Record<string, string> = {
  draft: 'Borrador',
  issued: 'Emitido',
  shipped: 'Expedido',
  delivered: 'Entregado',
  cancelled: 'Anulado',
};

/** Albarán en español, con el lote de cada línea. Solo lleva precios si está valorado. */
export async function deliveryNotePdf(writer: Writer, id: string): Promise<Response> {
  const noteId = pathId(id);
  const notes = await writer.read<Record<string, unknown>>(sql`
    SELECT n.number, n.kind, n.status, n.issue_date, n.notes, n.legal_entity_id, n.customer_id,
           n.ship_to, n.customer_references,
           fl.name AS from_name, tl.name AS to_name
    FROM sales.delivery_note n
    JOIN inventory.location fl ON fl.id = n.from_location_id
    LEFT JOIN inventory.location tl ON tl.id = n.to_location_id
    WHERE n.id = CAST(${noteId} AS UUID)
  `);
  const note = notes[0];
  if (!note) throw domainError('WC_NOT_FOUND');
  const lines = await writer.read<Record<string, unknown>>(sql`
    SELECT l.line_no, l.description, l.quantity, l.unit, l.unit_price, l.discount_pct, l.tax_code, lot.code AS lot_code
    FROM sales.delivery_note_line l
    LEFT JOIN inventory.lot lot ON lot.id = l.lot_id
    WHERE l.delivery_note_id = CAST(${noteId} AS UUID)
    ORDER BY l.line_no
  `);
  const number = textOf(note.number);
  const kind = KINDS[String(note.kind)] ?? String(note.kind);
  const priced = lines.length > 0 && lines.every((line) => line.unit_price != null);
  const { seller, profile } = await loadSellerContext(writer, idText(note.legal_entity_id));
  const customer = await loadCustomerParty(writer, note.customer_id == null ? null : idText(note.customer_id));
  const rates = await loadTaxRates(writer);
  const rows: DocumentPdfLine[] = lines.map((line) => {
    const quantity = decOf(line.quantity);
    const price = line.unit_price == null ? null : decOf(line.unit_price);
    const discount = decOf(line.discount_pct ?? '0');
    const taxCode = textOf(line.tax_code);
    return {
      description: String(line.description),
      quantity: quantity.toFixed(3),
      unit_price: price == null ? null : price.toString(),
      line_base: price == null ? null : quantity.mul(price).mul(decOf(100).sub(discount)).div(100).toFixed(2),
      tax_code: taxCode,
      tax_rate: taxCode == null ? null : rates.get(taxCode) ?? null,
      discount_pct: discount.toString(),
      unit: textOf(line.unit),
      lot: textOf(line.lot_code) ?? 'Sin lote',
    };
  });
  const bytes = await renderDocumentPdf({
    title: 'Albarán',
    number,
    issueDate: note.issue_date == null ? null : dateOf(note.issue_date),
    dueLabel: null,
    dueDate: null,
    status: STATUSES[String(note.status)] ?? String(note.status),
    meta: [`Clase ${kind}`, `Origen ${textOf(note.from_name) ?? '—'}`, `Destino ${textOf(note.to_name) ?? '—'}`],
    partyLabel: 'Cliente',
    seller,
    profile,
    customer,
    customerName: customer?.legalName ?? '—',
    shipTo: shipToFrom(note.ship_to),
    customerReferences: textOf(note.customer_references),
    description: textOf(note.notes),
    lines: rows,
    priced,
    totals: priced ? valuedTotals(rows) : null,
    settlement: null,
    note: 'Albarán de entrega. No es una factura.',
  });
  const filename = `albaran-${safeName(number ?? 'borrador')}.pdf`;
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });
}

function safeName(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean === '' ? 'borrador' : clean.slice(0, 60);
}

function idText(value: unknown): string {
  return String(value).toLowerCase();
}

/** Albarán valorado: base, IVA por tipo (redondeado por tipo, como en la factura) y total. */
function valuedTotals(rows: readonly DocumentPdfLine[]): { subtotal: string; vat: string; withholding: null; total: string } {
  let subtotal = new Decimal(0);
  const byRate = new Map<string, Decimal>();
  for (const row of rows) {
    const base = new Decimal(row.line_base ?? '0');
    subtotal = subtotal.add(base);
    const rate = row.tax_rate ?? '0';
    byRate.set(rate, (byRate.get(rate) ?? new Decimal(0)).add(base));
  }
  let vat = new Decimal(0);
  for (const [rate, base] of byRate) vat = vat.add(base.mul(new Decimal(rate)).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  return { subtotal: subtotal.toFixed(2), vat: vat.toFixed(2), withholding: null, total: subtotal.add(vat).toFixed(2) };
}
