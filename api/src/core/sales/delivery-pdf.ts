import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { renderDocumentPdf } from '../pdf/document';
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
    SELECT n.number, n.kind, n.status, n.issue_date, n.notes,
           e.legal_name AS entity_name, e.code AS entity_code, e.tax_id AS entity_tax_id,
           e.address_line, e.postal_code, e.city, e.province,
           c.legal_name AS customer_name,
           fl.name AS from_name, tl.name AS to_name
    FROM sales.delivery_note n
    JOIN core.legal_entity e ON e.id = n.legal_entity_id
    LEFT JOIN party.contact c ON c.id = n.customer_id
    JOIN inventory.location fl ON fl.id = n.from_location_id
    LEFT JOIN inventory.location tl ON tl.id = n.to_location_id
    WHERE n.id = CAST(${noteId} AS UUID)
  `);
  const note = notes[0];
  if (!note) throw domainError('WC_NOT_FOUND');
  const lines = await writer.read<Record<string, unknown>>(sql`
    SELECT l.line_no, l.description, l.quantity, l.unit_price, l.discount_pct, l.tax_code, lot.code AS lot_code
    FROM sales.delivery_note_line l
    LEFT JOIN inventory.lot lot ON lot.id = l.lot_id
    WHERE l.delivery_note_id = CAST(${noteId} AS UUID)
    ORDER BY l.line_no
  `);
  const number = textOf(note.number) ?? 'Borrador';
  const kind = KINDS[String(note.kind)] ?? String(note.kind);
  const priced = lines.length > 0 && lines.every((line) => line.unit_price != null);
  const bytes = await renderDocumentPdf({
    title: 'Albarán',
    number,
    issueDate: note.issue_date == null ? null : dateOf(note.issue_date),
    dueLabel: null,
    dueDate: null,
    status: STATUSES[String(note.status)] ?? String(note.status),
    meta: [`Clase ${kind}`, `Origen ${textOf(note.from_name) ?? '—'}`, `Destino ${textOf(note.to_name) ?? '—'}`],
    partyLabel: 'Cliente',
    seller: {
      legalName: textOf(note.entity_name) ?? textOf(note.entity_code) ?? '',
      taxId: textOf(note.entity_tax_id) ?? '',
      addressLine: textOf(note.address_line) ?? '',
      postalCode: textOf(note.postal_code) ?? '',
      city: textOf(note.city) ?? '',
      province: textOf(note.province) ?? '',
    },
    customerName: textOf(note.customer_name) ?? '—',
    description: textOf(note.notes),
    lines: lines.map((line) => {
      const lot = textOf(line.lot_code) ?? 'Sin lote';
      const quantity = decOf(line.quantity);
      const price = line.unit_price == null ? null : decOf(line.unit_price);
      const discount = decOf(line.discount_pct ?? '0');
      return {
        description: `${String(line.description)} · Lote ${lot}`,
        quantity: quantity.toFixed(3),
        unit_price: price == null ? null : price.toString(),
        line_base: price == null ? null : quantity.mul(price).mul(decOf(100).sub(discount)).div(100).toFixed(2),
        tax_code: textOf(line.tax_code),
      };
    }),
    priced,
    totals: null,
    settlement: null,
    note: 'Albarán de entrega. No es una factura.',
  });
  const filename = `albaran-${safeName(number)}.pdf`;
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
