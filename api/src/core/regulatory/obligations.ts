// Calendario persistido y avisos de plazo. El aviso sale por el outbox; no llama a la AEAT.
import { sql } from "../db/sql";
import type { Tx, Writer } from "../db/writer";
import { emitEvent } from "../events/emit";
import { newId } from "../ids";
import { businessDate } from "../time";
import {
  buildObligations,
  calendarFor,
  deadlineBand,
  type HolidayCalendar,
  type ObligationDraft,
} from "./calendar";

const DUE_SOON = "regulatory.obligation.due_soon";
const OVERDUE = "regulatory.obligation.overdue";

export interface StoredObligation {
  id: string;
  legal_entity_id: string;
  flow: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string;
  legal_basis: string;
  status: string;
  submission_id: string | null;
}

export async function loadHolidayCalendar(read: Tx["read"], aroundYear: number): Promise<HolidayCalendar> {
  const rows = await read<{ value: unknown }>(sql`
    SELECT value::VARCHAR AS value
    FROM core.setting
    WHERE key = 'regulatory.non_working_days'
  `);
  const extra = parseDates(rows[0]?.value);
  return calendarFor([aroundYear - 1, aroundYear, aroundYear + 1], extra);
}

/** Inserta las obligaciones SILICIE del año que aún no existen. No pisa una ya cumplida. */
export async function syncSilicieObligations(
  tx: Tx,
  legalEntityId: string,
  year: number,
  calendar: HolidayCalendar,
): Promise<number> {
  const desired = buildObligations(year, legalEntityId, calendar);
  const existing = await tx.read<{ title: string; due_date: string }>(sql`
    SELECT title, due_date::VARCHAR AS due_date
    FROM regulatory.obligation
    WHERE legal_entity_id = CAST(${legalEntityId} AS UUID)
      AND flow = 'silicie'
  `);
  const known = new Set(existing.map((row) => `${row.title}|${String(row.due_date).slice(0, 10)}`));
  let inserted = 0;
  for (const item of desired) {
    if (known.has(`${item.title}|${item.dueDate}`)) continue;
    insertObligation(tx, legalEntityId, item);
    inserted += 1;
  }
  return inserted;
}

/**
 * No escribe `submission_id` mientras el envío siga cambiando: DuckDB no deja
 * actualizar una fila que ya está referenciada por una clave foránea.
 */
export async function linkObligation(
  tx: Tx,
  legalEntityId: string,
  periodStart: string,
  periodEnd: string,
  status: "in_progress" | "done" | "open",
  submissionId?: string | null,
): Promise<void> {
  if (submissionId) {
    tx.write(sql`
      UPDATE regulatory.obligation
      SET status = ${status},
          submission_id = CAST(${submissionId} AS UUID)
      WHERE legal_entity_id = CAST(${legalEntityId} AS UUID)
        AND flow = 'silicie'
        AND period_start = CAST(${periodStart} AS DATE)
        AND period_end = CAST(${periodEnd} AS DATE)
    `);
    return;
  }
  tx.write(sql`
    UPDATE regulatory.obligation
    SET status = ${status}
    WHERE legal_entity_id = CAST(${legalEntityId} AS UUID)
      AND flow = 'silicie'
      AND period_start = CAST(${periodStart} AS DATE)
      AND period_end = CAST(${periodEnd} AS DATE)
      AND status <> 'done'
      AND submission_id IS NULL
  `);
}

export async function listObligations(
  read: Tx["read"],
  filter: { legalEntityId?: string; flow?: string; from?: string; to?: string },
): Promise<StoredObligation[]> {
  const where = ["TRUE"];
  if (filter.legalEntityId) where.push(sql`legal_entity_id = CAST(${filter.legalEntityId} AS UUID)`);
  if (filter.flow) where.push(sql`flow = ${filter.flow}`);
  if (filter.from) where.push(sql`due_date >= CAST(${filter.from} AS DATE)`);
  if (filter.to) where.push(sql`due_date <= CAST(${filter.to} AS DATE)`);
  const rows = await read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id, flow, title,
           period_start::VARCHAR AS period_start, period_end::VARCHAR AS period_end,
           due_date::VARCHAR AS due_date, legal_basis, status,
           submission_id::VARCHAR AS submission_id
    FROM regulatory.obligation
    WHERE ${where.join(" AND ")}
    ORDER BY due_date, title
  `);
  return rows.map(mapObligation);
}

/**
 * Encola como máximo un aviso por obligación y banda (30, 7, 1 o vencida).
 * Devuelve cuántos eventos ha encolado. La notificación la crea el despachador del outbox.
 */
export async function scanDeadlineAlerts(tx: Tx, today: string): Promise<number> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id,
           due_date::VARCHAR AS due_date, status
    FROM regulatory.obligation
    WHERE flow = 'silicie'
      AND status IN ('open', 'in_progress')
  `);
  const sent = await alreadySent(tx);
  let emitted = 0;
  for (const row of rows) {
    const id = String(row.id);
    const due = String(row.due_date).slice(0, 10);
    const band = deadlineBand(today, due);
    if (!band) continue;
    const type = band === "overdue" ? OVERDUE : DUE_SOON;
    const key = `${type}|${id}|${band}`;
    if (sent.has(key)) continue;
    emitEvent(tx, {
      type,
      aggregate: "regulatory.obligation",
      aggregateId: id,
      payload: {
        legal_entity_id: String(row.legal_entity_id),
        obligation_id: id,
        link: "/regulatorio",
        alert: band,
        days_left: daysLeft(today, due),
      },
    });
    emitted += 1;
  }
  return emitted;
}

/**
 * Dos escrituras: primero las obligaciones, después los avisos.
 * La lectura de una escritura no ve lo que esa misma escritura aún no ha confirmado.
 */
export async function refreshRegulatoryCalendar(
  writer: Writer,
  now: Date,
): Promise<{ inserted: number; emitted: number }> {
  const actor = { type: "system" as const, id: "regulatory-deadlines", requestId: newId() };
  const entities = await writer.read<{ id: string }>(sql`
    SELECT DISTINCT legal_entity_id::VARCHAR AS id
    FROM inventory.tax_warehouse
    WHERE is_active
  `);
  const today = businessDate(now);
  const year = Number(today.slice(0, 4));
  let inserted = 0;
  await writer.withWrite(actor, async (tx) => {
    const calendar = await loadHolidayCalendar(tx.read.bind(tx), year);
    for (const entity of entities) {
      inserted += await syncSilicieObligations(tx, entity.id, year, calendar);
      inserted += await syncSilicieObligations(tx, entity.id, year + 1, calendar);
    }
  });
  let emitted = 0;
  await writer.withWrite(actor, async (tx) => {
    emitted = await scanDeadlineAlerts(tx, today);
  });
  return { inserted, emitted };
}

function insertObligation(tx: Tx, legalEntityId: string, item: ObligationDraft): void {
  const id = newId();
  tx.write(sql`
    INSERT INTO regulatory.obligation (
      id, legal_entity_id, flow, title, period_start, period_end, due_date, legal_basis, status
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${legalEntityId} AS UUID),
      ${item.flow},
      ${item.title},
      CAST(${item.periodStart} AS DATE),
      CAST(${item.periodEnd} AS DATE),
      CAST(${item.dueDate} AS DATE),
      ${item.legalBasis},
      'open'
    )
  `);
  tx.audit({
    table: "regulatory.obligation",
    rowId: id,
    action: "INSERT",
    before: null,
    after: { flow: item.flow, due_date: item.dueDate, status: "open" },
  });
}

async function alreadySent(tx: Tx): Promise<Set<string>> {
  const rows = await tx.read<{ event_type: string; payload: unknown }>(sql`
    SELECT event_type, payload::VARCHAR AS payload
    FROM ops.outbox_event
    WHERE event_type IN (${DUE_SOON}, ${OVERDUE})
  `);
  const sent = new Set<string>();
  for (const row of rows) {
    const payload = asRecord(row.payload);
    const obligationId = typeof payload.obligation_id === "string" ? payload.obligation_id : "";
    const alert = typeof payload.alert === "string" ? payload.alert : "";
    if (obligationId !== "" && alert !== "") sent.add(`${row.event_type}|${obligationId}|${alert}`);
  }
  return sent;
}

function daysLeft(today: string, due: string): number {
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = Date.parse(`${due}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function parseDates(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function asRecord(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  return {};
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapObligation(row: Record<string, unknown>): StoredObligation {
  return {
    id: String(row.id),
    legal_entity_id: String(row.legal_entity_id),
    flow: String(row.flow),
    title: String(row.title),
    period_start: row.period_start == null ? null : String(row.period_start).slice(0, 10),
    period_end: row.period_end == null ? null : String(row.period_end).slice(0, 10),
    due_date: String(row.due_date).slice(0, 10),
    legal_basis: String(row.legal_basis),
    status: String(row.status),
    submission_id: row.submission_id == null ? null : String(row.submission_id),
  };
}
