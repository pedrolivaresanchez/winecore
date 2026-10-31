import { renderPdf } from '../billing/export/pdf';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { pathId, textOf } from './db';

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

/** Albarán en español, con el lote de cada línea. */
export async function deliveryNotePdf(writer: Writer, id: string): Promise<Response> {
  const noteId = pathId(id);
  const notes = await writer.read<Record<string, unknown>>(sql`
    SELECT n.number, n.kind, n.status, n.issue_date, n.notes,
           e.legal_name AS entity_name, e.code AS entity_code,
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
    SELECT l.line_no, l.description, l.quantity, lot.code AS lot_code
    FROM sales.delivery_note_line l
    LEFT JOIN inventory.lot lot ON lot.id = l.lot_id
    WHERE l.delivery_note_id = CAST(${noteId} AS UUID)
    ORDER BY l.line_no
  `);
  const number = textOf(note.number) ?? 'Borrador';
  const kind = KINDS[String(note.kind)] ?? String(note.kind);
  const status = STATUSES[String(note.status)] ?? String(note.status);
  const issueDate = note.issue_date == null ? '—' : String(note.issue_date).slice(0, 10);
  const body = [
    'Albarán',
    `Número ${number}`,
    `Estado ${status}`,
    `Clase ${kind}`,
    `Fecha ${issueDate}`,
    `Entidad ${textOf(note.entity_name) ?? textOf(note.entity_code) ?? ''}`,
    `Cliente ${textOf(note.customer_name) ?? '—'}`,
    `Origen ${textOf(note.from_name) ?? '—'}`,
    `Destino ${textOf(note.to_name) ?? '—'}`,
    'Lineas',
    ...lines.map((line) => {
      const qty = Number(line.quantity);
      const quantity = Number.isFinite(qty) ? qty.toFixed(3) : String(line.quantity);
      const lot = textOf(line.lot_code) ?? 'Sin lote';
      return `${String(line.line_no)}. ${String(line.description)}  Lote ${lot}  Cantidad ${quantity}`;
    }),
  ];
  const notesText = textOf(note.notes);
  if (notesText) body.push(`Notas ${notesText}`);
  const bytes = await renderPdf(body.join('\n'));
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
