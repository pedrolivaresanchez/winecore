import { sql } from '../db/sql';
import type { Actor, Tx } from '../db/writer';
import { DomainError } from '../errors';
import { loadStockMoves } from '../inventory/service/rows';
import type { StockMove } from '../inventory/types';
import { businessDate, toMadridOffsetString } from '../time';
import {
  asRecord,
  fail,
  idOf,
  idOrNull,
  loadProduct,
  newRowId,
  optionalText,
  throwIf,
  UUID_RE,
} from './db';
import { outbox } from './db';
import { assertPhysical, writeStockMove } from './moves';

const KINDS = new Set(['breakage', 'loss', 'delay', 'refused', 'other']);

export async function createIncident(tx: Tx, actor: Actor, noteId: string, raw: unknown): Promise<Record<string, unknown>> {
  const note = await requireIssued(tx, noteId);
  const body = asRecord(raw);
  const fields: Record<string, string> = {};
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!KINDS.has(kind)) fields.kind = 'Tipo de incidencia no válido';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length < 3) fields.description = 'Describe la incidencia';
  const claim = optionalText(body.carrier_claim_ref ?? body.carrierClaimRef, 'carrier_claim_ref', fields, 80);
  let units: number | null = null;
  if (body.units_affected != null && body.units_affected !== '') {
    const parsed = Number(body.units_affected);
    if (!Number.isInteger(parsed) || parsed < 0) fields.units_affected = 'Las unidades deben ser un entero';
    else units = parsed;
  }
  const lineId = body.line_id == null || body.line_id === '' ? null : (typeof body.line_id === 'string' ? body.line_id.trim().toLowerCase() : '');
  if (lineId === '') fields.line_id = 'Identificador no válido';
  const photos = Array.isArray(body.photos) ? body.photos : [];
  throwIf(fields);
  if (!KINDS.has(kind) || description.length < 3) fail('Incidencia no válida');
  const lines = await tx.read<Record<string, unknown>>(sql`
    SELECT id, product_id, lot_id, quantity, line_no FROM sales.delivery_note_line
    WHERE delivery_note_id = CAST(${noteId} AS UUID) ORDER BY line_no
  `);
  const chosen = lineId
    ? lines.find((line) => idOf(line.id) === lineId)
    : lines.length === 1 ? lines[0] : undefined;
  if (lineId && !chosen) fail('La línea no pertenece al albarán', { line_id: lineId });
  const storedDescription = chosen ? `${description}\n[[line:${idOf(chosen.id)}]]` : description;
  const now = new Date();
  const reported = businessDate(now);
  const deadline = shiftDate(reported, 7);
  const noticeOn = shiftDate(deadline, -3);
  const id = newRowId();
  tx.write(sql`
    INSERT INTO sales.shipping_incident (
      id, delivery_note_id, kind, reported_at, description, units_affected, carrier_claim_ref,
      claim_deadline, status, created_by, created_at
    ) VALUES (
      CAST(${id} AS UUID), CAST(${noteId} AS UUID), ${kind}, ${now}, ${storedDescription},
      ${units}, ${claim}, CAST(${deadline} AS DATE), 'open', ${actor.id}, ${now}
    )
  `);
  for (const photo of photos) {
    if (typeof photo !== 'string' || !UUID_RE.test(photo)) fail('La foto no es válida', { photos: 'Identificador no válido' });
    const found = await tx.read(sql`SELECT id FROM core.attachment WHERE id = CAST(${photo.toLowerCase()} AS UUID)`);
    if (!found[0]) fail('La foto no existe', { photos: photo });
    const linkId = newRowId();
    tx.write(sql`
      INSERT INTO core.attachment_link (id, attachment_id, entity_table, entity_id, role, created_by, created_at)
      VALUES (
        CAST(${linkId} AS UUID), CAST(${photo.toLowerCase()} AS UUID), 'sales.shipping_incident',
        CAST(${id} AS UUID), 'photo', ${actor.id}, ${now}
      )
    `);
  }
  tx.write(sql`
    INSERT INTO core.notification (id, user_id, kind, title, body)
    VALUES (
      CAST(${newRowId()} AS UUID), CAST(${actor.id} AS UUID), 'shipping_incident',
      'Incidencia de transporte',
      ${`Plazo de reclamación ${deadline}. Aviso 3 días antes: ${noticeOn}.`}
    )
  `);
  const noticeAt = new Date(`${noticeOn}T08:00:00Z`);
  outbox(tx, 'sales.incident.opened', 'sales.shipping_incident', id, idOf(note.legal_entity_id), {
    incident_id: id,
    delivery_note_id: noteId,
    kind,
    claim_deadline: deadline,
    notice_on: noticeOn,
  }, noticeAt);
  tx.audit({
    table: 'sales.shipping_incident',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { kind, claim_deadline: deadline, units_affected: units },
  });
  const proposal = await proposeLoss(tx, note, chosen, units);
  return {
    id,
    delivery_note_id: noteId,
    kind,
    description,
    units_affected: units,
    carrier_claim_ref: claim,
    claim_deadline: deadline,
    notice_on: noticeOn,
    status: 'open',
    line_id: chosen ? idOf(chosen.id) : null,
    proposed_shrinkage: proposal,
  };
}

export async function confirmShrinkage(tx: Tx, actor: Actor, noteId: string, incidentId: string): Promise<Record<string, unknown>> {
  const note = await requireIssued(tx, noteId);
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT * FROM sales.shipping_incident
    WHERE id = CAST(${incidentId} AS UUID) AND delivery_note_id = CAST(${noteId} AS UUID)
  `);
  const incident = rows[0];
  if (!incident) fail('La incidencia no existe');
  const units = incident.units_affected == null ? 0 : Number(incident.units_affected);
  if (!Number.isInteger(units) || units <= 0) fail('La incidencia no indica mercancía perdida', { units_affected: 'Obligatorio' });
  const existing = await loadStockMoves(tx, `source_table = 'sales.shipping_incident' AND source_id = CAST(${sql`${incidentId}`} AS UUID)`);
  if (existing.length > 0) fail('La merma ya está registrada');
  const parsed = splitDescription(String(incident.description));
  const lines = await tx.read<Record<string, unknown>>(sql`
    SELECT id, product_id, lot_id FROM sales.delivery_note_line WHERE delivery_note_id = CAST(${noteId} AS UUID)
  `);
  const line = parsed.lineId
    ? lines.find((item) => idOf(item.id) === parsed.lineId)
    : lines[0];
  if (!line) fail('No hay línea para la merma');
  const product = await loadProduct(tx, idOf(line.product_id));
  const state = product.kind === 'wine' ? 'packaged_labeled' : 'goods';
  const nominal = product.nominal_volume_ml ?? 0;
  const volume = state === 'goods' ? 0 : units * nominal;
  const noteMoves = await loadStockMoves(tx, `source_table = 'sales.delivery_note' AND source_id = CAST(${sql`${noteId}`} AS UUID) AND move_type = 'delivery_out'`);
  const owner = noteMoves.find((move) => move.source_line_id === idOf(line.id))?.owner_entity_id ?? idOf(note.legal_entity_id);
  const now = new Date();
  const move: StockMove = {
    id: newRowId(),
    occurred_at: toMadridOffsetString(now),
    move_type: 'loss',
    location_id: idOf(note.from_location_id),
    vessel_id: null,
    owner_entity_id: owner,
    lot_id: idOrNull(line.lot_id),
    product_id: idOf(line.product_id),
    product_state: state,
    qty_units: -units,
    volume_ml: -volume,
    mass_g: 0,
    loss_kind: 'incident',
    source_table: 'sales.shipping_incident',
    source_id: incidentId,
    source_line_id: idOf(line.id),
    reverses_move_id: null,
    created_by: actor.id,
  };
  await assertPhysical(tx, [move]);
  writeStockMove(tx, move, now);
  return {
    incident_id: incidentId,
    created: true,
    move_type: 'loss',
    qty_units: -units,
    volume_ml: -volume,
    location_id: move.location_id,
    lot_id: move.lot_id,
    product_id: move.product_id,
  };
}

async function proposeLoss(
  tx: Tx,
  note: Record<string, unknown>,
  line: Record<string, unknown> | undefined,
  units: number | null,
): Promise<Record<string, unknown> | null> {
  if (!line || units == null || units <= 0) return null;
  const product = await loadProduct(tx, idOf(line.product_id));
  const nominal = product.nominal_volume_ml ?? 0;
  const volume = product.kind === 'wine' ? units * nominal : 0;
  return {
    created: false,
    move_type: 'loss',
    loss_kind: 'incident',
    product_id: idOf(line.product_id),
    lot_id: idOrNull(line.lot_id),
    location_id: idOf(note.from_location_id),
    qty_units: -units,
    volume_ml: -volume,
  };
}

async function requireIssued(tx: Tx, noteId: string): Promise<Record<string, unknown>> {
  const rows = await tx.read<Record<string, unknown>>(sql`SELECT * FROM sales.delivery_note WHERE id = CAST(${noteId} AS UUID)`);
  const note = rows[0];
  if (!note) throw new DomainError('WC_NOT_FOUND', 404, 'No encontrado');
  if (!['issued', 'shipped', 'delivered'].includes(String(note.status))) {
    fail('La incidencia se registra sobre un albarán emitido', { status: String(note.status) });
  }
  return note;
}

function splitDescription(stored: string): { description: string; lineId: string | null } {
  const match = /^(.*)\n\[\[line:([0-9a-f-]{36})\]\]$/s.exec(stored);
  if (!match) return { description: stored, lineId: null };
  return { description: match[1] ?? stored, lineId: match[2] ?? null };
}

function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}
