// Ciclo de vida del envío SILICIE. La persona descarga el fichero y lo presenta; WineCore no llama a la AEAT.
import { Decimal } from "decimal.js";
import { payloadSha256 } from "../approvals/canonical";
import { loadApprovalPolicies } from "../approvals/policy-store";
import { approvalServiceOn } from "../approvals/sql-store";
import type { ApprovalPolicy, Clock } from "../approvals/types";
import { readContent } from "../attachments/store";
import { sql } from "../db/sql";
import type { Actor, Tx, Writer } from "../db/writer";
import { domainError } from "../errors";
import { emitEvent } from "../events/emit";
import { newId } from "../ids";
import type { FiscalMove } from "../inventory/types";
import { businessDate } from "../time";
import { formatMilli } from "./silicie/csv";
import type { AnnulmentReason } from "./silicie/iesx4";
import { isAnnulmentReason } from "./silicie/iesx4";
import {
  buildPeriod,
  canonicalContent,
  contentHash,
  draftKey,
  sha256Bytes,
  type BuiltPeriod,
  type PeriodFile,
} from "./silicie/period";
import type { FiscalMoveInput, MoveHint, SilicieEntryDraft, SilicieLedger } from "./silicie/types";
import { assertStatusChange, assertMutableContent, isMutableStatus } from "./guard";
import type { Issue } from "./issue";
import { linkObligation } from "./obligations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9][A-Za-z0-9./_-]{3,39}$/;

export interface GenerateSilicieInput {
  legalEntityId: string;
  taxWarehouseId: string;
  periodStart: string;
  periodEnd: string;
  createdBy: string;
  recordedOn?: string;
  aggregation?: "monthly" | "none";
  kind?: "silicie.asientos";
  rectifiesSubmissionId?: string | null;
  hints?: Readonly<Record<string, MoveHint>>;
  annulments?: readonly { aeatEntryNumber: string; reason: AnnulmentReason; exerciseYear: number }[];
  /** Si se informa, el fichero sale de estos movimientos y no de todo el periodo. */
  onlyMoveIds?: readonly string[];
}

export interface SubmissionView {
  id: string;
  flow: string;
  legal_entity_id: string;
  tax_warehouse_id: string | null;
  kind: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  phase: string;
  content_sha256: string;
  external_ref: string | null;
  approval_request_id: string | null;
  rectifies_submission_id: string | null;
  ready_for_approval: boolean;
  blocks_approval: boolean;
  validation: { errors: Issue[]; warnings: Issue[] };
  files: { kind: string; exercise_year: number; filename: string; sha256: string }[];
  summary: { entry_count: number; litres: string };
  entries: {
    id: string;
    local_seq: number;
    entry_kind: string;
    movement_date: string;
    reference: string;
    status: string;
    aeat_entry_number: string | null;
  }[];
  created_by: string;
  /** Envío que rectifica a este. Nulo si todavía no hay corrección. */
  successor_id: string | null;
}

export function phaseOf(status: string, hasFile: boolean): string {
  switch (status) {
    case "draft":
      return hasFile ? "generated" : "draft";
    case "validated":
      return "generated";
    case "pending_approval":
      return "pending_approval";
    case "approved":
    case "submitting":
      return "approved";
    case "submitted":
      return "submitted";
    case "accepted":
    case "accepted_with_errors":
      return "accepted";
    case "rejected":
      return "rejected";
    case "rectified":
      return "corrected";
    default:
      return status;
  }
}

export interface SubmissionListQuery {
  legalEntityId?: string;
  flow?: string;
  /** null = todas las entidades. Lista vacía = ninguna. */
  entityIds?: readonly string[] | null;
  limit: number;
  cursor?: { at: string; id: string } | null;
}

export async function listSubmissionViews(
  writer: Writer,
  filter: SubmissionListQuery,
): Promise<{ items: SubmissionView[]; next_cursor: { at: string; id: string } | null }> {
  if (filter.entityIds && filter.entityIds.length === 0) return { items: [], next_cursor: null };
  const where = ["TRUE"];
  if (filter.legalEntityId) where.push(sql`s.legal_entity_id = CAST(${filter.legalEntityId} AS UUID)`);
  if (filter.entityIds) {
    const list = filter.entityIds.map((id) => sql`CAST(${id} AS UUID)`).join(", ");
    where.push(`s.legal_entity_id IN (${list})`);
  }
  if (filter.flow) where.push(sql`s.flow = ${filter.flow}`);
  if (filter.cursor) {
    where.push(sql`(
      s.created_at < CAST(${filter.cursor.at} AS TIMESTAMPTZ)
      OR (
        s.created_at = CAST(${filter.cursor.at} AS TIMESTAMPTZ)
        AND s.id < CAST(${filter.cursor.id} AS UUID)
      )
    )`);
  }
  const rows = await writer.read<Record<string, unknown>>(
    selectSubmission(where.join(" AND "), sql`ORDER BY s.created_at DESC, s.id DESC LIMIT ${filter.limit + 1}`),
  );
  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const items: SubmissionView[] = [];
  for (const row of page) items.push(await viewFrom(writer.read.bind(writer), asSubmission(row)));
  const last = page[page.length - 1];
  return {
    items,
    next_cursor: hasMore && last
      ? { at: String(last.created_at), id: String(last.id).toLowerCase() }
      : null,
  };
}

export async function getSubmission(writer: Writer, id: string): Promise<SubmissionView> {
  return viewFrom(writer.read.bind(writer), await requireRow(writer.read.bind(writer), id));
}

export async function generateSilicie(
  writer: Writer,
  actor: Actor,
  input: GenerateSilicieInput,
  clock: Clock,
): Promise<SubmissionView> {
  const id = await writer.withWrite(actor, (tx) => generateIn(tx, input, clock));
  return getSubmission(writer, id);
}

export async function validateSilicie(
  writer: Writer,
  actor: Actor,
  id: string,
  clock: Clock,
): Promise<SubmissionView> {
  await writer.withWrite(actor, (tx) => validateIn(tx, id, clock));
  return getSubmission(writer, id);
}

export async function requestApproval(
  writer: Writer,
  actor: Actor,
  id: string,
  clock: Clock,
): Promise<SubmissionView> {
  const policies = await loadApprovalPolicies(writer);
  const result = await writer.withWrite(actor, (tx) => requestIn(tx, id, policies, clock, actor.id));
  if (result.demoted) {
    throw domainError(
      "WC_VALIDATION",
      { period: "Los asientos del periodo han cambiado. Vuelve a generar el fichero." },
      "Los asientos del periodo han cambiado. Vuelve a generar el fichero.",
    );
  }
  return getSubmission(writer, id);
}

export async function markSubmitted(
  writer: Writer,
  actor: Actor,
  id: string,
  input: { externalRef: string; receiptAttachmentId?: string | null },
  clock: Clock,
): Promise<SubmissionView> {
  const policies = await loadApprovalPolicies(writer);
  await writer.withWrite(actor, (tx) => markSubmittedIn(tx, id, input, policies, clock));
  return getSubmission(writer, id);
}

export async function markResult(
  writer: Writer,
  actor: Actor,
  id: string,
  input: {
    result: "accepted" | "rejected" | "accepted_with_errors";
    items?: readonly { entryId: string; aeatEntryNumber?: string; result?: "accepted" | "rejected" }[];
  },
): Promise<SubmissionView> {
  await writer.withWrite(actor, (tx) => markResultIn(tx, id, input));
  return getSubmission(writer, id);
}

export async function correctSilicie(
  writer: Writer,
  actor: Actor,
  id: string,
  input: { reason: AnnulmentReason; entryIds?: readonly string[]; createdBy: string },
  clock: Clock,
): Promise<SubmissionView> {
  const correctionId = await writer.withWrite(actor, (tx) => correctIn(tx, id, input, clock));
  return getSubmission(writer, correctionId);
}

const CANCELLABLE = new Set(["draft", "validated", "pending_approval"]);

/** Anula un envío que todavía no está aprobado. No llama a la AEAT. */
export async function cancelSubmission(
  writer: Writer,
  actor: Actor,
  id: string,
  reason: string,
): Promise<SubmissionView> {
  await writer.withWrite(actor, async (tx) => {
    const row = await requireRow(tx.read.bind(tx), id);
    if (!CANCELLABLE.has(row.status)) {
      throw domainError(
        "WC_ILLEGAL_TRANSITION",
        { status: "Solo se puede anular un envío antes de aprobarlo." },
        "Solo se puede anular un envío antes de aprobarlo.",
      );
    }
    assertStatusChange(row.status, "cancelled");
    if (row.approval_request_id) {
      tx.write(sql`
        UPDATE ops.approval_request
        SET status = 'cancelled'
        WHERE id = CAST(${row.approval_request_id} AS UUID)
          AND status = 'pending'
      `);
    }
    const payload = parsePayload(row.payload);
    for (const entry of payload.entries) {
      if (!UUID.test(entry.id)) continue;
      tx.write(sql`
        UPDATE regulatory.silicie_entry
        SET status = 'annulled'
        WHERE id = CAST(${entry.id} AS UUID) AND status = 'pending'
      `);
    }
    tx.write(sql`
      UPDATE regulatory.submission
      SET status = 'cancelled', updated_at = now()
      WHERE id = CAST(${row.id} AS UUID)
    `);
    if (row.period_start && row.period_end) {
      tx.write(sql`
        UPDATE regulatory.obligation
        SET status = 'open'
        WHERE legal_entity_id = CAST(${row.legal_entity_id} AS UUID)
          AND flow = 'silicie'
          AND period_start = CAST(${row.period_start} AS DATE)
          AND period_end = CAST(${row.period_end} AS DATE)
          AND status = 'in_progress'
          AND submission_id IS NULL
      `);
    }
    tx.audit({
      table: "regulatory.submission",
      rowId: row.id,
      action: "UPDATE",
      before: { status: row.status },
      after: { status: "cancelled", reason },
    });
  });
  return getSubmission(writer, id);
}

export async function readSubmissionFile(
  writer: Writer,
  id: string,
  part: "altas" | "anulaciones",
  exerciseYear?: number,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const row = await requireRow(writer.read.bind(writer), id);
  const payload = parsePayload(row.payload);
  const bucket = part === "altas" ? payload.altas_sha256 : payload.anulaciones_sha256;
  const years = Object.keys(bucket).sort();
  const year = exerciseYear === undefined ? years[years.length - 1] : String(exerciseYear);
  const sha = year ? bucket[year] : undefined;
  if (!year || !sha) throw domainError("WC_NOT_FOUND");
  const bytes = await readContent(writer.read.bind(writer), sha);
  const prefix = part === "altas" ? "IESA1V2" : "IESX4";
  return { filename: `${prefix}-${payload.cae}-${year}.csv`, bytes };
}

/** El modo manual no encola un envío. Un intento `submit` en curso tampoco se duplica. */
export async function enqueueRun(tx: Tx, submissionId: string): Promise<void> {
  await assertNoSubmitInFlight(tx, submissionId);
  const row = await requireRow(tx.read.bind(tx), submissionId);
  if (row.flow === "silicie") {
    throw domainError(
      "WC_ILLEGAL_TRANSITION",
      { submit: "El envío de SILICIE es manual. No se encola nada hacia la AEAT." },
      "El envío de SILICIE es manual. No se encola nada hacia la AEAT.",
    );
  }
  throw domainError("WC_ILLEGAL_TRANSITION", { flow: "No hay conector automático para este envío." });
}

export async function syncSubmissionFromApproval(writer: Writer, actor: Actor, approvalRequestId: string): Promise<void> {
  if (!UUID.test(approvalRequestId)) return;
  await writer.withWrite(actor, async (tx) => {
    const rows = await tx.read<{ id: string; status: string; approval_status: string }>(sql`
      SELECT s.id::VARCHAR AS id, s.status, a.status AS approval_status
      FROM regulatory.submission s
      JOIN ops.approval_request a ON a.id = s.approval_request_id
      WHERE s.approval_request_id = CAST(${approvalRequestId} AS UUID)
    `);
    const row = rows[0];
    if (!row || row.status !== "pending_approval") return;
    if (row.approval_status === "approved") {
      assertStatusChange(row.status, "approved");
      tx.write(sql`
        UPDATE regulatory.submission SET status = 'approved', updated_at = now()
        WHERE id = CAST(${row.id} AS UUID) AND status = 'pending_approval'
      `);
      tx.audit({
        table: "regulatory.submission",
        rowId: row.id,
        action: "UPDATE",
        before: { status: "pending_approval" },
        after: { status: "approved" },
      });
      return;
    }
    if (row.approval_status === "rejected" || row.approval_status === "expired" || row.approval_status === "cancelled") {
      assertStatusChange(row.status, "validated");
      tx.write(sql`
        UPDATE regulatory.submission
        SET status = 'validated', approval_request_id = NULL, updated_at = now()
        WHERE id = CAST(${row.id} AS UUID) AND status = 'pending_approval'
      `);
      const linked = await tx.read<{ id: string }>(sql`
        SELECT id::VARCHAR AS id FROM regulatory.silicie_entry
        WHERE submission_id = CAST(${row.id} AS UUID) AND status = 'in_submission'
      `);
      const fromPayload = parsePayload(
        (await requireRow(tx.read.bind(tx), row.id)).payload,
      ).entries.map((entry) => entry.id);
      for (const entryId of [...linked.map((item) => item.id), ...fromPayload]) {
        if (!UUID.test(entryId)) continue;
        tx.write(sql`
          UPDATE regulatory.silicie_entry
          SET status = 'pending'
          WHERE id = CAST(${entryId} AS UUID) AND status = 'in_submission'
        `);
      }
      tx.audit({
        table: "regulatory.submission",
        rowId: row.id,
        action: "UPDATE",
        before: { status: "pending_approval" },
        after: { status: "validated" },
      });
    }
  });
}

async function generateIn(tx: Tx, input: GenerateSilicieInput, clock: Clock): Promise<string> {
  const kind = input.kind ?? "silicie.asientos";
  assertPeriod(input.periodStart, input.periodEnd);
  const warehouse = await requireWarehouse(tx, input.taxWarehouseId, input.legalEntityId);
  const existing = await findOpen(tx, input, kind);
  if (existing && !isMutableStatus(String(existing.status))) {
    if (["submitted", "accepted", "accepted_with_errors", "rejected"].includes(String(existing.status))) {
      throw domainError(
        "WC_ILLEGAL_TRANSITION",
        { period: "Este periodo ya tiene un envío presentado. Prepara una corrección." },
        "Este periodo ya tiene un envío presentado. Prepara una corrección.",
      );
    }
    throw domainError("WC120");
  }
  const prepared = await prepare(tx, input, warehouse, existing, clock);
  const id = existing ? String(existing.id) : newId();
  await persistPrepared(tx, id, input, existing, prepared, kind);
  return id;
}

async function validateIn(tx: Tx, id: string, clock: Clock): Promise<void> {
  const row = await requireRow(tx.read.bind(tx), id);
  if (row.flow !== "silicie") throw domainError("WC_NOT_FOUND");
  if (!isMutableStatus(row.status)) return;
  const payload = parsePayload(row.payload);
  const input = inputFromPayload(payload, row);
  const warehouse = await requireWarehouse(tx, input.taxWarehouseId, input.legalEntityId);
  const prepared = await prepare(tx, input, warehouse, row, clock);
  const hash = contentHash(prepared.canonical);
  const errors = prepared.issues.filter((issue) => issue.severity === "error");
  if (hash !== row.payload_sha256) {
    tx.write(sql`
      UPDATE regulatory.submission
      SET status = 'draft',
          validation_errors = ${sql.json(contenidoDistinto())},
          updated_at = now()
      WHERE id = CAST(${id} AS UUID)
    `);
    return;
  }
  const next = errors.length === 0 ? "validated" : "draft";
  assertStatusChange(row.status, next);
  tx.write(sql`
    UPDATE regulatory.submission
    SET status = ${next},
        validation_errors = ${sql.json(errors)},
        response_summary = ${sql.json({ warnings: prepared.issues.filter((issue) => issue.severity === "warning") })},
        updated_at = now()
    WHERE id = CAST(${id} AS UUID)
  `);
}

async function requestIn(
  tx: Tx,
  id: string,
  policies: readonly ApprovalPolicy[],
  clock: Clock,
  requestedBy: string,
): Promise<{ demoted: true } | { demoted: false }> {
  const row = await requireRow(tx.read.bind(tx), id);
  if (row.flow !== "silicie") throw domainError("WC_NOT_FOUND");
  if (row.status !== "validated") {
    throw domainError(
      "WC_ILLEGAL_TRANSITION",
      { status: "Hay que validar el fichero, sin errores, antes de pedir la aprobación." },
      "Hay que validar el fichero, sin errores, antes de pedir la aprobación.",
    );
  }
  const payload = parsePayload(row.payload);
  const input = inputFromPayload(payload, row);
  const warehouse = await requireWarehouse(tx, input.taxWarehouseId, input.legalEntityId);
  const prepared = await prepare(tx, input, warehouse, row, clock);
  const errors = prepared.issues.filter((issue) => issue.severity === "error");
  const hash = contentHash(prepared.canonical);
  if (hash !== row.payload_sha256 || errors.length > 0) {
    tx.write(sql`
      UPDATE regulatory.submission
      SET status = 'draft',
          validation_errors = ${sql.json(errors.length > 0 ? errors : contenidoDistinto())},
          updated_at = now()
      WHERE id = CAST(${id} AS UUID) AND status = 'validated'
    `);
    return { demoted: true };
  }
  const litres = litresOf(prepared.built.drafts);
  const approval = await approvalServiceOn(tx, policies, clock).requestApproval({
    kind: "regulatory_submission",
    legalEntityId: input.legalEntityId,
    subjectTable: "regulatory.submission",
    subjectId: id,
    payload: prepared.canonical,
    summary: `SILICIE ${input.periodStart} a ${input.periodEnd} (${prepared.built.drafts.length} asientos)`,
    requestedBy,
    details: {
      period: `${input.periodStart}..${input.periodEnd}`,
      records: String(prepared.built.drafts.length),
      litres,
      destination: "AEAT-SILICIE",
      description: "Asientos SILICIE",
    },
  });
  if (approval.payloadSha256 !== hash) throw domainError("WC040");
  assertStatusChange("validated", "pending_approval");
  tx.write(sql`
    UPDATE regulatory.submission
    SET status = 'pending_approval',
        approval_request_id = CAST(${approval.id} AS UUID),
        validation_errors = ${sql.json([])},
        updated_at = now()
    WHERE id = CAST(${id} AS UUID) AND status = 'validated' AND payload_sha256 = ${hash}
  `);
  const payloadIds = parsePayload(row.payload).entries.map((entry) => entry.id).filter((entryId) => UUID.test(entryId));
  for (const entryId of payloadIds) {
    tx.write(sql`
      UPDATE regulatory.silicie_entry
      SET status = 'in_submission'
      WHERE id = CAST(${entryId} AS UUID) AND status = 'pending'
    `);
  }
  tx.audit({
    table: "regulatory.submission",
    rowId: id,
    action: "UPDATE",
    before: { status: "validated" },
    after: { status: "pending_approval", approval_request_id: approval.id, payload_sha256: hash },
  });
  emitEvent(tx, {
    type: "regulatory.submission.pending_approval",
    aggregate: "regulatory.submission",
    aggregateId: id,
    payload: {
      legal_entity_id: input.legalEntityId,
      submission_id: id,
      link: `/regulatorio/envios/${id}`,
    },
  });
  return { demoted: false };
}

async function markSubmittedIn(
  tx: Tx,
  id: string,
  input: { externalRef: string; receiptAttachmentId?: string | null },
  policies: readonly ApprovalPolicy[],
  clock: Clock,
): Promise<void> {
  const ref = input.externalRef.trim();
  if (!REF.test(ref)) {
    throw domainError("WC_VALIDATION", { external_ref: "La referencia de la AEAT tiene que tener entre 4 y 40 caracteres." });
  }
  const row = await requireRow(tx.read.bind(tx), id);
  if (row.status === "submitted" && row.external_ref === ref) return;
  if (row.status === "submitted") {
    throw domainError("WC_ILLEGAL_TRANSITION", { external_ref: "El envío ya está marcado como presentado." });
  }
  await assertNoSubmitInFlight(tx, id);
  if (!row.approval_request_id) throw domainError("WC_NOT_APPROVED");
  const approval = await tx.read<{ status: string; payload_sha256: string }>(sql`
    SELECT status, payload_sha256
    FROM ops.approval_request
    WHERE id = CAST(${row.approval_request_id} AS UUID)
  `);
  const current = approval[0];
  if (!current || current.status !== "approved" || current.payload_sha256 !== row.payload_sha256) {
    throw domainError("WC_NOT_APPROVED");
  }
  if (row.status !== "approved" && row.status !== "pending_approval") throw domainError("WC_ILLEGAL_TRANSITION");
  if (input.receiptAttachmentId) await assertAttachment(tx, input.receiptAttachmentId);
  assertStatusChange(row.status, "submitted");
  await approvalServiceOn(tx, policies, clock).consume({
    requestId: row.approval_request_id,
    payloadSha256: row.payload_sha256,
  });
  const summary = asRecord(row.response_summary);
  tx.write(sql`
    UPDATE regulatory.submission
    SET status = 'submitted',
        external_ref = ${ref},
        response_summary = ${sql.json({ ...summary, manual_submit: { mode: "manual", external_ref: ref } })},
        updated_at = now()
    WHERE id = CAST(${id} AS UUID)
  `);
  if (input.receiptAttachmentId) {
    linkReceipt(tx, input.receiptAttachmentId, id, row.created_by);
  }
  tx.audit({
    table: "regulatory.submission",
    rowId: id,
    action: "UPDATE",
    before: { status: row.status },
    after: { status: "submitted", external_ref: ref },
  });
}

async function markResultIn(
  tx: Tx,
  id: string,
  input: {
    result: "accepted" | "rejected" | "accepted_with_errors";
    items?: readonly { entryId: string; aeatEntryNumber?: string; result?: "accepted" | "rejected" }[];
  },
): Promise<void> {
  const row = await requireRow(tx.read.bind(tx), id);
  if (row.status === input.result) return;
  if (row.status !== "submitted") throw domainError("WC_ILLEGAL_TRANSITION");
  assertStatusChange(row.status, input.result);
  const payload = parsePayload(row.payload);
  tx.write(sql`
    UPDATE regulatory.submission
    SET status = ${input.result}, updated_at = now()
    WHERE id = CAST(${id} AS UUID) AND status = 'submitted'
  `);
  // No se inserta connector_run aquí: DuckDB no deja cambiar después un envío
  // que ya tiene hijos. El intento manual queda en response_summary y external_ref.
  // enqueueRun sigue rechazando un segundo submit en curso.
  if (input.items && input.items.length > 0) {
    for (const item of input.items) {
      if (!UUID.test(item.entryId)) throw domainError("WC_VALIDATION", { entry_id: "Identificador no válido" });
      const entryResult = item.result ?? (input.result === "rejected" ? "rejected" : "accepted");
      const number = item.aeatEntryNumber?.trim() ?? "";
      if (number.length > 35) throw domainError("WC_VALIDATION", { aeat_entry_number: "El número de asiento supera 35 caracteres" });
      tx.write(sql`
        UPDATE regulatory.silicie_entry
        SET status = ${entryResult === "rejected" ? "rejected" : "accepted"},
            aeat_entry_number = ${number === "" ? null : number}
        WHERE id = CAST(${item.entryId} AS UUID)
      `);
      tx.write(sql`
        UPDATE regulatory.submission_item
        SET result = ${entryResult === "rejected" ? "rejected" : "accepted"}
        WHERE submission_id = CAST(${id} AS UUID)
          AND item_id = CAST(${item.entryId} AS UUID)
      `);
    }
  } else {
    const entryStatus = input.result === "rejected" ? "rejected" : "accepted";
    for (const entry of payload.entries) {
      if (!UUID.test(entry.id)) continue;
      tx.write(sql`
        UPDATE regulatory.silicie_entry
        SET status = ${entryStatus}
        WHERE id = CAST(${entry.id} AS UUID)
          AND status IN ('pending', 'in_submission')
      `);
    }
  }
  if (input.result !== "rejected") {
    for (const entry of payload.entries) {
      for (const moveId of entry.fiscal_move_ids) {
        tx.write(sql`
          UPDATE inventory.fiscal_move
          SET silicie_entry_id = CAST(${entry.id} AS UUID)
          WHERE id = CAST(${moveId} AS UUID)
            AND silicie_entry_id IS NULL
        `);
      }
    }
  }
  // La corrección referencia el envío y el asiento previo. DuckDB no deja
  // actualizar esas filas después. El original sigue 'accepted'; la lectura
  // lo presenta como corrected cuando esta corrección queda aceptada.
  const obligationStatus = input.result === "accepted" ? "done" : "in_progress";
  if (row.period_start && row.period_end) {
    tx.write(sql`
      UPDATE regulatory.obligation
      SET status = ${obligationStatus}
      WHERE legal_entity_id = CAST(${row.legal_entity_id} AS UUID)
        AND flow = 'silicie'
        AND period_start = CAST(${row.period_start} AS DATE)
        AND period_end = CAST(${row.period_end} AS DATE)
    `);
  }
  if (input.result === "accepted" || input.result === "rejected") {
    emitEvent(tx, {
      type: input.result === "accepted" ? "regulatory.submission.accepted" : "regulatory.submission.rejected",
      aggregate: "regulatory.submission",
      aggregateId: id,
      payload: {
        legal_entity_id: row.legal_entity_id,
        submission_id: id,
        link: `/regulatorio/envios/${id}`,
      },
    });
  }
  tx.audit({
    table: "regulatory.submission",
    rowId: id,
    action: "UPDATE",
    before: { status: "submitted" },
    after: { status: input.result },
  });
}

async function correctIn(
  tx: Tx,
  id: string,
  input: { reason: AnnulmentReason; entryIds?: readonly string[]; createdBy: string },
  clock: Clock,
): Promise<string> {
  if (!isAnnulmentReason(input.reason)) {
    throw domainError("WC_VALIDATION", { reason: "El motivo de anulación tiene que ser 1, 2 o 3." });
  }
  const original = await requireRow(tx.read.bind(tx), id);
  if (!["accepted", "rejected", "accepted_with_errors"].includes(original.status)) {
    throw domainError(
      "WC_ILLEGAL_TRANSITION",
      { status: "Solo se corrige un envío ya presentado y con resultado." },
      "Solo se corrige un envío ya presentado y con resultado.",
    );
  }
  const originalPayload = parsePayload(original.payload);
  const entryIdList = originalPayload.entries.map((entry) => entry.id).filter((entryId) => UUID.test(entryId));
  const entries = entryIdList.length === 0
    ? []
    : await tx.read<Record<string, unknown>>(`
        SELECT id::VARCHAR AS id, aeat_entry_number, movement_date::VARCHAR AS movement_date, status
        FROM regulatory.silicie_entry
        WHERE id IN (${entryIdList.map((entryId) => `CAST(${sql`${entryId}`} AS UUID)`).join(", ")})
        ORDER BY local_seq
      `);
  const chosen = entries.filter((entry) => {
    if (input.entryIds && input.entryIds.length > 0) return input.entryIds.includes(String(entry.id));
    return entry.status === "accepted";
  });
  if (chosen.length === 0) {
    throw domainError("WC_VALIDATION", { entries: "No hay asientos aceptados que anular." });
  }
  const payload = parsePayload(original.payload);
  const moveIds: string[] = [];
  const hints: Record<string, MoveHint> = {};
  const annulments: { aeatEntryNumber: string; reason: AnnulmentReason; exerciseYear: number }[] = [];
  for (const entry of chosen) {
    const number = entry.aeat_entry_number == null ? "" : String(entry.aeat_entry_number).trim();
    if (number === "") {
      throw domainError(
        "WC_VALIDATION",
        { aeat_entry_number: "Falta el número de asiento de la AEAT para anular." },
        "Falta el número de asiento de la AEAT para anular.",
      );
    }
    const stored = payload.entries.find((item) => item.id === String(entry.id));
    const year = Number(String(entry.movement_date).slice(0, 4));
    annulments.push({ aeatEntryNumber: number, reason: input.reason, exerciseYear: year });
    for (const moveId of stored?.fiscal_move_ids ?? []) {
      moveIds.push(moveId);
      hints[moveId] = { previousAeatEntryNumber: number, annulsEntryId: String(entry.id) };
    }
  }
  return generateIn(tx, {
    legalEntityId: original.legal_entity_id,
    taxWarehouseId: payload.tax_warehouse_id,
    periodStart: original.period_start ?? payload.period_start,
    periodEnd: original.period_end ?? payload.period_end,
    createdBy: input.createdBy,
    recordedOn: payload.recorded_on,
    aggregation: payload.aggregation,
    rectifiesSubmissionId: original.id,
    hints,
    annulments,
    onlyMoveIds: moveIds,
  }, clock);
}

interface Prepared {
  built: BuiltPeriod;
  canonical: Record<string, unknown>;
  issues: Issue[];
  reuse: boolean;
  seqStartByYear: Record<string, number>;
  entryIds: Map<string, string>;
}

async function prepare(
  tx: Tx,
  input: GenerateSilicieInput,
  warehouse: Warehouse,
  existing: SubmissionRow | null,
  clock: Clock,
): Promise<Prepared> {
  const stored = existing ? parsePayload(existing.payload) : null;
  const recordedOn = input.recordedOn ?? stored?.recorded_on ?? businessDate(clock.now());
  const aggregation = input.aggregation ?? stored?.aggregation ?? "monthly";
  const moves = await loadPeriodMoves(tx, input);
  const history = await loadHistory(tx, input.taxWarehouseId, input.periodEnd);
  const ledgers = await loadLedgers(tx, input.taxWarehouseId);
  const openOperations = await loadOpenOperations(tx, input.legalEntityId, input.periodStart, input.periodEnd);
  const years = [...new Set(moves.map((move) => move.fiscalDate.slice(0, 4)))];
  const maxByYear = await maxSeqByYear(tx, input.taxWarehouseId);
  let seqStartByYear: Record<string, number> = {};
  for (const year of years) {
    const storedStart = stored?.seq_start_by_year[year];
    seqStartByYear[year] = storedStart ?? (maxByYear.get(year) ?? 0) + 1;
  }
  let built = buildPeriod({
    moves,
    history,
    ledgers,
    taxWarehouseId: input.taxWarehouseId,
    cae: warehouse.cae,
    establishmentName: warehouse.name,
    recordedOn,
    aggregation,
    seqStartByYear,
    hints: input.hints,
    annulments: input.annulments,
    openOperations,
  });
  const same = stored !== null && sameSignatures(built.drafts, stored.entries);
  let reuse = same;
  if (stored && !same) {
    seqStartByYear = {};
    for (const year of years) seqStartByYear[year] = (maxByYear.get(year) ?? 0) + 1;
    for (const row of input.annulments ?? []) {
      const key = String(row.exerciseYear);
      if (seqStartByYear[key] === undefined) seqStartByYear[key] = (maxByYear.get(key) ?? 0) + 1;
    }
    built = buildPeriod({
      moves,
      history,
      ledgers,
      taxWarehouseId: input.taxWarehouseId,
      cae: warehouse.cae,
      establishmentName: warehouse.name,
      recordedOn,
      aggregation,
      seqStartByYear,
      hints: input.hints,
      annulments: input.annulments,
      openOperations,
    });
    reuse = false;
  }
  const entryIds = new Map<string, string>();
  if (reuse && stored) {
    for (const entry of stored.entries) entryIds.set(`${entry.exercise_year}:${entry.local_seq}`, entry.id);
  } else {
    for (const draft of built.drafts) entryIds.set(draftKey(draft), newId());
  }
  const canonical = canonicalContent({
    legalEntityId: input.legalEntityId,
    taxWarehouseId: input.taxWarehouseId,
    cae: warehouse.cae,
    kind: input.kind ?? "silicie.asientos",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    aggregation,
    recordedOn,
    establishmentName: warehouse.name,
    seqStartByYear,
    files: built.files,
    drafts: built.drafts,
    entryIds,
    annulments: input.annulments ?? [],
  });
  canonical.only_move_ids = input.onlyMoveIds ? [...input.onlyMoveIds] : null;
  return { built, canonical, issues: built.issues, reuse, seqStartByYear, entryIds };
}

async function persistPrepared(
  tx: Tx,
  id: string,
  input: GenerateSilicieInput,
  existing: SubmissionRow | null,
  prepared: Prepared,
  kind: string,
): Promise<void> {
  const hash = contentHash(prepared.canonical);
  const errors = prepared.issues.filter((issue) => issue.severity === "error");
  const warnings = prepared.issues.filter((issue) => issue.severity === "warning");
  if (existing && hash === existing.payload_sha256 && sameJson(errors, asIssues(existing.validation_errors))) {
    return;
  }
  if (existing) assertMutableContent(existing.status);
  const exerciseIds = await ensureExercises(tx, input.taxWarehouseId, prepared.built.drafts, input.annulments ?? []);
  if (!existing) {
    tx.write(sql`
      INSERT INTO regulatory.submission (
        id, flow, legal_entity_id, kind, period_start, period_end, status, payload, payload_sha256,
        validation_errors, response_summary, rectifies_submission_id, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        'silicie',
        CAST(${input.legalEntityId} AS UUID),
        ${kind},
        CAST(${input.periodStart} AS DATE),
        CAST(${input.periodEnd} AS DATE),
        'draft',
        ${sql.json(prepared.canonical)},
        ${hash},
        ${sql.json(errors)},
        ${sql.json({ warnings })},
        CAST(${input.rectifiesSubmissionId ?? null} AS UUID),
        ${input.createdBy}
      )
    `);
  }
  if (existing && !prepared.reuse) {
    const previous = parsePayload(existing.payload);
    for (const entry of previous.entries) {
      if (!UUID.test(entry.id)) continue;
      tx.write(sql`
        UPDATE regulatory.silicie_entry
        SET status = 'annulled'
        WHERE id = CAST(${entry.id} AS UUID) AND status = 'pending'
      `);
    }
  }
  if (!prepared.reuse) {
    for (const draft of prepared.built.drafts) {
      const entryId = prepared.entryIds.get(draftKey(draft));
      const exerciseId = exerciseIds.get(Number(draft.movementDate.slice(0, 4)));
      if (!entryId || !exerciseId) throw domainError("WC_VALIDATION", { exercise: "No se ha podido numerar el asiento" });
      // submission_id queda vacío hasta el resultado: DuckDB no actualiza el envío si ya hay hijos.
      tx.write(sql`
        INSERT INTO regulatory.silicie_entry (
          id, exercise_id, tax_warehouse_id, local_seq, movement_date, entry_kind, fields,
          status, annuls_entry_id, submission_id
        ) VALUES (
          CAST(${entryId} AS UUID),
          CAST(${exerciseId} AS UUID),
          CAST(${input.taxWarehouseId} AS UUID),
          ${draft.localSeq},
          CAST(${draft.movementDate} AS DATE),
          ${draft.entryKind},
          ${sql.json(draft.fields)},
          'pending',
          CAST(${draft.annulsEntryId} AS UUID),
          NULL
        )
      `);
    }
  }
  let renderedId: string | null = null;
  for (const file of prepared.built.files) {
    const attachmentId = await storeFile(tx, file, id, input.createdBy, prepared.canonical.recorded_on);
    if (file.kind === "altas" && renderedId === null) renderedId = attachmentId;
  }
  if (existing) assertStatusChange(existing.status, "draft");
  tx.write(sql`
    UPDATE regulatory.submission
    SET status = 'draft',
        payload = ${sql.json(prepared.canonical)},
        payload_sha256 = ${hash},
        rendered_attachment_id = CAST(${renderedId} AS UUID),
        validation_errors = ${sql.json(errors)},
        response_summary = ${sql.json({ warnings })},
        approval_request_id = NULL,
        updated_at = now()
    WHERE id = CAST(${id} AS UUID)
  `);
  tx.audit({
    table: "regulatory.submission",
    rowId: id,
    action: existing ? "UPDATE" : "INSERT",
    before: existing ? { status: existing.status, payload_sha256: existing.payload_sha256 } : null,
    after: { status: "draft", payload_sha256: hash, kind },
  });
  await linkObligation(tx, input.legalEntityId, input.periodStart, input.periodEnd, "in_progress");
}

async function storeFile(
  tx: Tx,
  file: PeriodFile,
  submissionId: string,
  createdBy: string,
  recordedOn: unknown,
): Promise<string> {
  const sha = file.sha256 || sha256Bytes(file.bytes);
  const found = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.attachment
    WHERE storage_backend = 'knowledge_base' AND storage_key = ${sha}
    LIMIT 1
  `);
  let attachmentId = found[0]?.id?.toLowerCase() ?? "";
  if (attachmentId === "") {
    attachmentId = newId();
    const year = typeof recordedOn === "string" ? Number(recordedOn.slice(0, 4)) : 2027;
    const retention = `${Number.isInteger(year) ? year + 7 : 2034}-12-31`;
    tx.write(sql`
      INSERT INTO core.attachment_content (sha256, content)
      SELECT ${sha}, ${file.bytes}
      WHERE NOT EXISTS (SELECT 1 FROM core.attachment_content WHERE sha256 = ${sha})
    `);
    tx.write(sql`
      INSERT INTO core.attachment (
        id, sha256, storage_backend, storage_key, filename, mime_type, size_bytes,
        classification, retention_until, created_by
      ) VALUES (
        CAST(${attachmentId} AS UUID),
        ${sha},
        'knowledge_base',
        ${sha},
        ${file.filename},
        'text/csv',
        ${file.bytes.byteLength},
        'regulatory_evidence',
        CAST(${retention} AS DATE),
        ${createdBy}
      )
    `);
  }
  const linked = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.attachment_link
    WHERE attachment_id = CAST(${attachmentId} AS UUID)
      AND entity_table = 'regulatory.submission'
      AND entity_id = CAST(${submissionId} AS UUID)
      AND role = 'evidence_request'
    LIMIT 1
  `);
  if (!linked[0]) {
    tx.write(sql`
      INSERT INTO core.attachment_link (id, attachment_id, entity_table, entity_id, role, created_by)
      VALUES (
        CAST(${newId()} AS UUID),
        CAST(${attachmentId} AS UUID),
        'regulatory.submission',
        CAST(${submissionId} AS UUID),
        'evidence_request',
        ${createdBy}
      )
    `);
  }
  return attachmentId;
}

function linkReceipt(tx: Tx, attachmentId: string, submissionId: string, createdBy: string): void {
  tx.write(sql`
    INSERT INTO core.attachment_link (id, attachment_id, entity_table, entity_id, role, created_by)
    SELECT CAST(${newId()} AS UUID), CAST(${attachmentId} AS UUID), 'regulatory.submission',
           CAST(${submissionId} AS UUID), 'official_receipt', ${createdBy}
    WHERE NOT EXISTS (
      SELECT 1 FROM core.attachment_link
      WHERE attachment_id = CAST(${attachmentId} AS UUID)
        AND entity_table = 'regulatory.submission'
        AND entity_id = CAST(${submissionId} AS UUID)
        AND role = 'official_receipt'
    )
  `);
}

async function assertNoSubmitInFlight(tx: Tx, submissionId: string): Promise<void> {
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id
    FROM regulatory.connector_run
    WHERE submission_id = CAST(${submissionId} AS UUID)
      AND action = 'submit'
      AND status IN ('queued', 'claimed', 'running')
  `);
  if (rows[0]) {
    throw domainError(
      "WC_ILLEGAL_TRANSITION",
      { submit: "Ya hay un intento de envío en curso." },
      "Ya hay un intento de envío en curso.",
    );
  }
}

async function assertAttachment(tx: Tx, id: string): Promise<void> {
  if (!UUID.test(id)) throw domainError("WC_VALIDATION", { receipt_attachment_id: "Identificador no válido" });
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.attachment WHERE id = CAST(${id} AS UUID)
  `);
  if (!rows[0]) throw domainError("WC_VALIDATION", { receipt_attachment_id: "El justificante no existe" });
}

interface Warehouse {
  id: string;
  legalEntityId: string;
  cae: string;
  name: string;
}

async function requireWarehouse(tx: Tx, id: string, legalEntityId: string): Promise<Warehouse> {
  if (!UUID.test(id) || !UUID.test(legalEntityId)) throw domainError("WC_VALIDATION", { id: "Identificador no válido" });
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id, cae, name
    FROM inventory.tax_warehouse
    WHERE id = CAST(${id} AS UUID) AND is_active
  `);
  const row = rows[0];
  if (!row) throw domainError("WC_NOT_FOUND");
  if (String(row.legal_entity_id) !== legalEntityId) {
    throw domainError("WC_VALIDATION", { tax_warehouse_id: "El establecimiento no es de esta entidad." });
  }
  const cae = String(row.cae);
  if (!/^ES[0-9A-Z]{11}$/.test(cae)) throw domainError("WC_VALIDATION", { cae: "El CAE no tiene la forma esperada." });
  return { id, legalEntityId, cae, name: String(row.name) };
}

async function findOpen(tx: Tx, input: GenerateSilicieInput, kind: string): Promise<SubmissionRow | null> {
  const statusFilter = input.rectifiesSubmissionId
    ? "s.status IN ('draft', 'validated', 'pending_approval', 'approved')"
    : "s.status NOT IN ('cancelled', 'rectified')";
  const where = [
    sql`s.flow = 'silicie'`,
    sql`s.legal_entity_id = CAST(${input.legalEntityId} AS UUID)`,
    sql`s.kind = ${kind}`,
    sql`s.period_start = CAST(${input.periodStart} AS DATE)`,
    sql`s.period_end = CAST(${input.periodEnd} AS DATE)`,
    statusFilter,
    sql`(
      (${input.rectifiesSubmissionId ?? null} IS NULL AND s.rectifies_submission_id IS NULL)
      OR s.rectifies_submission_id = CAST(${input.rectifiesSubmissionId ?? null} AS UUID)
    )`,
  ].join(" AND ");
  const rows = await tx.read<Record<string, unknown>>(selectSubmission(where, "ORDER BY s.created_at DESC"));
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (payload.tax_warehouse_id === input.taxWarehouseId) return asSubmission(row);
  }
  return null;
}

async function loadPeriodMoves(tx: Tx, input: GenerateSilicieInput): Promise<FiscalMoveInput[]> {
  if (input.onlyMoveIds && input.onlyMoveIds.length === 0) return [];
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT m.id::VARCHAR AS id, m.tax_warehouse_id::VARCHAR AS tax_warehouse_id,
           m.fiscal_date::VARCHAR AS fiscal_date, m.physical_date::VARCHAR AS physical_date,
           m.move_type, m.product_class, m.lot_id::VARCHAR AS lot_id, m.product_id::VARCHAR AS product_id,
           m.volume_ml, m.units, m.abv_pct::VARCHAR AS abv_pct, m.excise_product_key, m.nc_code,
           m.justification_type, m.justification_ref, m.counterparty_contact_id::VARCHAR AS counterparty_contact_id,
           m.counterparty_excise_number, m.fiscal_trigger, m.source_table, m.source_id::VARCHAR AS source_id,
           m.source_line_id::VARCHAR AS source_line_id, m.silicie_entry_id::VARCHAR AS silicie_entry_id,
           m.reverses_move_id::VARCHAR AS reverses_move_id, m.reason, m.created_by,
           m.created_at::VARCHAR AS created_at,
           e.status AS entry_status, e.submission_id::VARCHAR AS entry_submission_id
    FROM inventory.fiscal_move m
    LEFT JOIN regulatory.silicie_entry e ON e.id = m.silicie_entry_id
    WHERE m.tax_warehouse_id = CAST(${input.taxWarehouseId} AS UUID)
      AND m.fiscal_date >= CAST(${input.periodStart} AS DATE)
      AND m.fiscal_date <= CAST(${input.periodEnd} AS DATE)
    ORDER BY m.fiscal_date, m.id
  `);
  const only = input.onlyMoveIds ? new Set(input.onlyMoveIds) : null;
  const moves: FiscalMoveInput[] = [];
  for (const row of rows) {
    if (only && !only.has(String(row.id))) continue;
    if (!only && row.entry_status && ["accepted", "in_submission", "annulled"].includes(String(row.entry_status))) {
      continue;
    }
    moves.push(toMoveInput(row));
  }
  return moves;
}

async function loadHistory(tx: Tx, taxWarehouseId: string, periodEnd: string): Promise<FiscalMove[]> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, tax_warehouse_id::VARCHAR AS tax_warehouse_id,
           fiscal_date::VARCHAR AS fiscal_date, physical_date::VARCHAR AS physical_date,
           move_type, product_class, lot_id::VARCHAR AS lot_id, product_id::VARCHAR AS product_id,
           volume_ml, units, abv_pct::VARCHAR AS abv_pct, excise_product_key, nc_code,
           justification_type, justification_ref, counterparty_contact_id::VARCHAR AS counterparty_contact_id,
           counterparty_excise_number, fiscal_trigger, source_table, source_id::VARCHAR AS source_id,
           source_line_id::VARCHAR AS source_line_id, silicie_entry_id::VARCHAR AS silicie_entry_id,
           reverses_move_id::VARCHAR AS reverses_move_id, reason, created_by, created_at::VARCHAR AS created_at
    FROM inventory.fiscal_move
    WHERE tax_warehouse_id = CAST(${taxWarehouseId} AS UUID)
      AND fiscal_date <= CAST(${periodEnd} AS DATE)
    ORDER BY fiscal_date, id
  `);
  return rows.map(toFiscal);
}

async function loadLedgers(tx: Tx, taxWarehouseId: string): Promise<SilicieLedger[]> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, tax_warehouse_id::VARCHAR AS tax_warehouse_id, reference, description,
           product_class, epigrafe, epigrafe_code, nc_code, product_key, container_type,
           container_capacity_l::VARCHAR AS container_capacity_l, is_active, validated_by,
           created_at::VARCHAR AS created_at
    FROM regulatory.silicie_ledger
    WHERE tax_warehouse_id = CAST(${taxWarehouseId} AS UUID) AND is_active
  `);
  return rows.map(toLedger);
}

async function loadOpenOperations(
  tx: Tx,
  legalEntityId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ id: string; opType: string; occurredOn: string }[]> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, op_type, occurred_at::VARCHAR AS occurred_at
    FROM cellar.operation
    WHERE legal_entity_id = CAST(${legalEntityId} AS UUID)
      AND status = 'draft'
      AND op_type <> 'cleaning'
  `);
  const found: { id: string; opType: string; occurredOn: string }[] = [];
  for (const row of rows) {
    const occurredOn = civilOf(row.occurred_at);
    if (occurredOn < periodStart || occurredOn > periodEnd) continue;
    found.push({ id: String(row.id), opType: String(row.op_type), occurredOn });
  }
  return found;
}

async function maxSeqByYear(tx: Tx, taxWarehouseId: string): Promise<Map<string, number>> {
  const rows = await tx.read<{ year: number | string; max_seq: number | string }>(sql`
    SELECT x.year::VARCHAR AS year, COALESCE(MAX(e.local_seq), 0)::INTEGER AS max_seq
    FROM regulatory.silicie_exercise x
    LEFT JOIN regulatory.silicie_entry e ON e.exercise_id = x.id
    WHERE x.tax_warehouse_id = CAST(${taxWarehouseId} AS UUID)
    GROUP BY x.year
  `);
  const map = new Map<string, number>();
  for (const row of rows) map.set(String(row.year), Number(row.max_seq));
  return map;
}

async function ensureExercises(
  tx: Tx,
  taxWarehouseId: string,
  drafts: readonly SilicieEntryDraft[],
  annulments: readonly { exerciseYear: number }[],
): Promise<Map<number, string>> {
  const rows = await tx.read<{ id: string; year: number | string }>(sql`
    SELECT id::VARCHAR AS id, year::VARCHAR AS year
    FROM regulatory.silicie_exercise
    WHERE tax_warehouse_id = CAST(${taxWarehouseId} AS UUID)
  `);
  const map = new Map<number, string>();
  for (const row of rows) map.set(Number(row.year), row.id);
  const years = new Set<number>();
  for (const draft of drafts) years.add(Number(draft.movementDate.slice(0, 4)));
  for (const row of annulments) years.add(row.exerciseYear);
  for (const year of years) {
    if (map.has(year)) continue;
    const id = newId();
    tx.write(sql`
      INSERT INTO regulatory.silicie_exercise (id, tax_warehouse_id, year)
      VALUES (CAST(${id} AS UUID), CAST(${taxWarehouseId} AS UUID), ${year})
    `);
    map.set(year, id);
  }
  return map;
}

function selectSubmission(where: string, order = ""): string {
  return `
    SELECT s.id::VARCHAR AS id, s.flow, s.legal_entity_id::VARCHAR AS legal_entity_id, s.kind,
           s.period_start::VARCHAR AS period_start, s.period_end::VARCHAR AS period_end, s.status,
           s.payload::VARCHAR AS payload, s.payload_sha256,
           s.rendered_attachment_id::VARCHAR AS rendered_attachment_id,
           s.validation_errors::VARCHAR AS validation_errors,
           s.response_summary::VARCHAR AS response_summary,
           s.approval_request_id::VARCHAR AS approval_request_id, s.external_ref,
           s.rectifies_submission_id::VARCHAR AS rectifies_submission_id, s.created_by,
           s.created_at::VARCHAR AS created_at
    FROM regulatory.submission s
    WHERE ${where}
    ${order}
  `;
}

interface SubmissionRow {
  id: string;
  flow: string;
  legal_entity_id: string;
  kind: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  payload: unknown;
  payload_sha256: string;
  rendered_attachment_id: string | null;
  validation_errors: unknown;
  response_summary: unknown;
  approval_request_id: string | null;
  external_ref: string | null;
  rectifies_submission_id: string | null;
  created_by: string;
}

async function requireRow(read: Tx["read"], id: string): Promise<SubmissionRow> {
  if (!UUID.test(id)) throw domainError("WC_NOT_FOUND");
  const rows = await read<Record<string, unknown>>(selectSubmission(sql`s.id = CAST(${id} AS UUID)`));
  const row = rows[0];
  if (!row) throw domainError("WC_NOT_FOUND");
  return asSubmission(row);
}

function asSubmission(row: Record<string, unknown>): SubmissionRow {
  return {
    id: String(row.id),
    flow: String(row.flow),
    legal_entity_id: String(row.legal_entity_id),
    kind: String(row.kind),
    period_start: row.period_start == null ? null : String(row.period_start).slice(0, 10),
    period_end: row.period_end == null ? null : String(row.period_end).slice(0, 10),
    status: String(row.status),
    payload: row.payload,
    payload_sha256: String(row.payload_sha256),
    rendered_attachment_id: row.rendered_attachment_id == null ? null : String(row.rendered_attachment_id),
    validation_errors: row.validation_errors,
    response_summary: row.response_summary,
    approval_request_id: row.approval_request_id == null ? null : String(row.approval_request_id),
    external_ref: row.external_ref == null ? null : String(row.external_ref),
    rectifies_submission_id: row.rectifies_submission_id == null ? null : String(row.rectifies_submission_id),
    created_by: String(row.created_by),
  };
}

interface StoredEntry {
  id: string;
  exercise_year: number;
  local_seq: number;
  entry_kind: string;
  movement_date: string;
  reference: string;
  cantidad: number;
  unidad: string;
  fiscal_move_ids: string[];
  annuls_entry_id: string | null;
  numero_asiento_previo: string;
}

interface StoredPayload {
  tax_warehouse_id: string;
  cae: string;
  aggregation: "monthly" | "none";
  recorded_on: string;
  establishment_name: string;
  seq_start_by_year: Record<string, number>;
  altas_sha256: Record<string, string>;
  anulaciones_sha256: Record<string, string>;
  entries: StoredEntry[];
  annulments: { aeat_entry_number: string; reason: string; exercise_year: number }[];
  only_move_ids: string[] | null;
  period_start: string;
  period_end: string;
  legal_entity_id: string;
}

function parsePayload(value: unknown): StoredPayload {
  const record = asRecord(value);
  const aggregation = record.aggregation === "none" ? "none" : "monthly";
  return {
    tax_warehouse_id: String(record.tax_warehouse_id ?? ""),
    cae: String(record.cae ?? ""),
    aggregation,
    recorded_on: String(record.recorded_on ?? ""),
    establishment_name: String(record.establishment_name ?? ""),
    seq_start_by_year: numberMap(record.seq_start_by_year),
    altas_sha256: stringMap(record.altas_sha256),
    anulaciones_sha256: stringMap(record.anulaciones_sha256),
    entries: Array.isArray(record.entries) ? record.entries.map(storedEntry) : [],
    annulments: Array.isArray(record.annulments)
      ? record.annulments.map((item) => {
          const row = asRecord(item);
          return {
            aeat_entry_number: String(row.aeat_entry_number ?? ""),
            reason: String(row.reason ?? ""),
            exercise_year: Number(row.exercise_year ?? String(record.recorded_on ?? "").slice(0, 4)),
          };
        })
      : [],
    only_move_ids: Array.isArray(record.only_move_ids) ? record.only_move_ids.map(String) : null,
    period_start: String(record.period_start ?? ""),
    period_end: String(record.period_end ?? ""),
    legal_entity_id: String(record.legal_entity_id ?? ""),
  };
}

function inputFromPayload(payload: StoredPayload, row: SubmissionRow): GenerateSilicieInput {
  return {
    legalEntityId: row.legal_entity_id,
    taxWarehouseId: payload.tax_warehouse_id,
    periodStart: row.period_start ?? payload.period_start,
    periodEnd: row.period_end ?? payload.period_end,
    createdBy: row.created_by,
    recordedOn: payload.recorded_on,
    aggregation: payload.aggregation,
    rectifiesSubmissionId: row.rectifies_submission_id,
    onlyMoveIds: payload.only_move_ids ?? undefined,
    hints: hintsFrom(payload),
    annulments: payload.annulments.flatMap((item) => {
      if (!isAnnulmentReason(item.reason)) return [];
      return [{
        aeatEntryNumber: item.aeat_entry_number,
        reason: item.reason,
        exerciseYear: item.exercise_year,
      }];
    }),
  };
}

function hintsFrom(payload: StoredPayload): Record<string, MoveHint> | undefined {
  const hints: Record<string, MoveHint> = {};
  for (const entry of payload.entries) {
    if (entry.numero_asiento_previo === "") continue;
    for (const moveId of entry.fiscal_move_ids) {
      const hint: MoveHint = { previousAeatEntryNumber: entry.numero_asiento_previo };
      if (entry.annuls_entry_id) hint.annulsEntryId = entry.annuls_entry_id;
      hints[moveId] = hint;
    }
  }
  return Object.keys(hints).length > 0 ? hints : undefined;
}

async function viewFrom(read: Tx["read"], current: SubmissionRow): Promise<SubmissionView> {
  const payload = parsePayload(current.payload);
  const errors = asIssues(current.validation_errors);
  const warnings = asIssues(asRecord(current.response_summary).warnings);
  const hasFile = Object.keys(payload.altas_sha256).length > 0 || Object.keys(payload.anulaciones_sha256).length > 0;
  const followers = await read<{ id: string; status: string }>(sql`
    SELECT id::VARCHAR AS id, status
    FROM regulatory.submission
    WHERE rectifies_submission_id = CAST(${current.id} AS UUID)
      AND status <> 'cancelled'
    ORDER BY created_at DESC, id DESC
  `);
  const successorId = followers[0] ? String(followers[0].id).toLowerCase() : null;
  const acceptedSuccessor = followers.some((row) => row.status === "accepted");
  const entryIds = payload.entries.map((entry) => entry.id).filter((entryId) => UUID.test(entryId));
  const entryFilter = entryIds.length > 0
    ? `(submission_id = CAST(${sql`${current.id}`} AS UUID) OR id IN (${entryIds.map((entryId) => `CAST(${sql`${entryId}`} AS UUID)`).join(", ")}))`
    : `submission_id = CAST(${sql`${current.id}`} AS UUID)`;
  const entryRows = await read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, local_seq, entry_kind, movement_date::VARCHAR AS movement_date,
           status, aeat_entry_number, fields::VARCHAR AS fields
    FROM regulatory.silicie_entry
    WHERE ${entryFilter}
      AND status <> 'annulled'
    ORDER BY local_seq
  `);
  const files = [
    ...Object.entries(payload.altas_sha256).map(([year, sha]) => ({
      kind: "altas",
      exercise_year: Number(year),
      filename: `IESA1V2-${payload.cae}-${year}.csv`,
      sha256: sha,
    })),
    ...Object.entries(payload.anulaciones_sha256).map(([year, sha]) => ({
      kind: "anulaciones",
      exercise_year: Number(year),
      filename: `IESX4-${payload.cae}-${year}.csv`,
      sha256: sha,
    })),
  ];
  return {
    id: current.id,
    flow: current.flow,
    legal_entity_id: current.legal_entity_id,
    tax_warehouse_id: payload.tax_warehouse_id || null,
    kind: current.kind,
    period_start: current.period_start,
    period_end: current.period_end,
    status: current.status,
    phase: acceptedSuccessor ? "corrected" : phaseOf(current.status, hasFile),
    content_sha256: current.payload_sha256,
    external_ref: current.external_ref,
    approval_request_id: current.approval_request_id,
    rectifies_submission_id: current.rectifies_submission_id,
    ready_for_approval: current.status === "validated" && errors.length === 0,
    blocks_approval: errors.length > 0 || current.status === "draft",
    validation: { errors, warnings },
    files,
    summary: {
      entry_count: entryRows.length || payload.entries.length,
      litres: litresOfStored(payload.entries),
    },
    entries: entryRows.map((entry) => ({
      id: String(entry.id),
      local_seq: Number(entry.local_seq),
      entry_kind: String(entry.entry_kind),
      movement_date: String(entry.movement_date).slice(0, 10),
      reference: referenceOf(entry.fields),
      status: String(entry.status),
      aeat_entry_number: entry.aeat_entry_number == null ? null : String(entry.aeat_entry_number),
    })),
    created_by: current.created_by,
    successor_id: successorId,
  };
}


function toMoveInput(row: Record<string, unknown>): FiscalMoveInput {
  return {
    id: String(row.id),
    taxWarehouseId: String(row.tax_warehouse_id),
    fiscalDate: String(row.fiscal_date).slice(0, 10),
    physicalDate: row.physical_date == null ? null : String(row.physical_date).slice(0, 10),
    moveType: String(row.move_type) as FiscalMoveInput["moveType"],
    productClass: String(row.product_class) as FiscalMoveInput["productClass"],
    lotId: textOrNull(row.lot_id),
    productId: textOrNull(row.product_id),
    volumeMl: intOf(row.volume_ml),
    units: intOf(row.units),
    abvCenti: abvCenti(row.abv_pct),
    exciseProductKey: textOrNull(row.excise_product_key),
    ncCode: textOrNull(row.nc_code),
    justificationType: String(row.justification_type) as FiscalMoveInput["justificationType"],
    justificationRef: String(row.justification_ref),
    counterpartyContactId: textOrNull(row.counterparty_contact_id),
    counterpartyExciseNumber: textOrNull(row.counterparty_excise_number),
    fiscalTrigger: String(row.fiscal_trigger) as FiscalMoveInput["fiscalTrigger"],
    sourceTable: String(row.source_table),
    sourceId: String(row.source_id),
    sourceLineId: textOrNull(row.source_line_id),
    silicieEntryId: null,
    reversesMoveId: textOrNull(row.reverses_move_id),
    reason: textOrNull(row.reason),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

function toFiscal(row: Record<string, unknown>): FiscalMove {
  return {
    id: String(row.id),
    tax_warehouse_id: String(row.tax_warehouse_id),
    fiscal_date: String(row.fiscal_date).slice(0, 10),
    physical_date: row.physical_date == null ? null : String(row.physical_date).slice(0, 10),
    move_type: String(row.move_type) as FiscalMove["move_type"],
    product_class: String(row.product_class) as FiscalMove["product_class"],
    lot_id: textOrNull(row.lot_id),
    product_id: textOrNull(row.product_id),
    volume_ml: intOf(row.volume_ml),
    units: intOf(row.units),
    abv_pct: row.abv_pct == null ? null : String(row.abv_pct),
    excise_product_key: textOrNull(row.excise_product_key),
    nc_code: textOrNull(row.nc_code),
    justification_type: String(row.justification_type) as FiscalMove["justification_type"],
    justification_ref: String(row.justification_ref),
    counterparty_contact_id: textOrNull(row.counterparty_contact_id),
    counterparty_excise_number: textOrNull(row.counterparty_excise_number),
    fiscal_trigger: String(row.fiscal_trigger) as FiscalMove["fiscal_trigger"],
    source_table: String(row.source_table),
    source_id: String(row.source_id),
    source_line_id: textOrNull(row.source_line_id),
    silicie_entry_id: textOrNull(row.silicie_entry_id),
    reverses_move_id: textOrNull(row.reverses_move_id),
    reason: textOrNull(row.reason),
    created_by: String(row.created_by),
  };
}

function toLedger(row: Record<string, unknown>): SilicieLedger {
  return {
    id: String(row.id),
    taxWarehouseId: String(row.tax_warehouse_id),
    reference: String(row.reference),
    description: String(row.description),
    productClass: String(row.product_class) as SilicieLedger["productClass"],
    epigrafe: textOrNull(row.epigrafe),
    epigrafeCode: textOrNull(row.epigrafe_code),
    ncCode: String(row.nc_code),
    productKey: textOrNull(row.product_key),
    containerType: textOrNull(row.container_type),
    containerCapacityMl: row.container_capacity_l == null ? null : litresToMl(row.container_capacity_l),
    isActive: row.is_active !== false,
    validatedBy: textOrNull(row.validated_by),
    createdAt: String(row.created_at ?? ""),
  };
}

function litresToMl(value: unknown): number {
  const ml = new Decimal(String(value)).mul(1000);
  if (!ml.isInteger()) throw domainError("WC_VALIDATION", { container_capacity_l: "La capacidad no es un número entero de mililitros" });
  return ml.toNumber();
}

function sameSignatures(drafts: readonly SilicieEntryDraft[], stored: readonly StoredEntry[]): boolean {
  if (drafts.length !== stored.length) return false;
  return drafts.every((draft, index) => signatureOfDraft(draft) === signatureOfStored(stored[index]));
}

function signatureOfDraft(draft: SilicieEntryDraft): string {
  return [
    draft.entryKind,
    draft.movementDate,
    draft.fields.referenciaProducto,
    String(draft.fields.cantidad),
    draft.fields.unidadMedida,
    draft.fields.numeroAsientoPrevio,
    draft.fiscalMoveIds.join(","),
  ].join("|");
}

function signatureOfStored(entry: StoredEntry | undefined): string {
  if (!entry) return "";
  return [
    entry.entry_kind,
    entry.movement_date,
    entry.reference,
    String(entry.cantidad),
    entry.unidad,
    entry.numero_asiento_previo,
    entry.fiscal_move_ids.join(","),
  ].join("|");
}

function litresOf(drafts: readonly SilicieEntryDraft[]): string {
  let ml = 0;
  for (const draft of drafts) {
    if (draft.fields.unidadMedida !== "LTR") continue;
    ml += draft.fields.cantidad;
  }
  return formatMilli(ml, 13);
}

function litresOfStored(entries: readonly StoredEntry[]): string {
  let ml = 0;
  for (const entry of entries) {
    if (entry.unidad !== "LTR") continue;
    ml += entry.cantidad;
  }
  try {
    return formatMilli(ml, 13);
  } catch {
    return "0.000";
  }
}

function contenidoDistinto(): Issue[] {
  return [{
    severity: "error",
    code: "contenido_distinto",
    message: "Los asientos del periodo han cambiado. Vuelve a generar el fichero.",
  }];
}

function assertPeriod(start: string, end: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    throw domainError("WC_VALIDATION", { period: "El periodo no es válido." });
  }
}

function storedEntry(value: unknown): StoredEntry {
  const row = asRecord(value);
  return {
    id: String(row.id ?? ""),
    exercise_year: Number(row.exercise_year),
    local_seq: Number(row.local_seq),
    entry_kind: String(row.entry_kind ?? ""),
    movement_date: String(row.movement_date ?? ""),
    reference: String(row.reference ?? ""),
    cantidad: Number(row.cantidad),
    unidad: String(row.unidad ?? ""),
    fiscal_move_ids: Array.isArray(row.fiscal_move_ids) ? row.fiscal_move_ids.map(String) : [],
    annuls_entry_id: row.annuls_entry_id == null || row.annuls_entry_id === "" ? null : String(row.annuls_entry_id),
    numero_asiento_previo: String(row.numero_asiento_previo ?? ""),
  };
}

function referenceOf(fields: unknown): string {
  const record = asRecord(fields);
  return String(record.referenciaProducto ?? "");
}

function asIssues(value: unknown): Issue[] {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    const row = asRecord(item);
    if (row.severity !== "error" && row.severity !== "warning") return [];
    if (typeof row.message !== "string" || typeof row.code !== "string") return [];
    const issue: Issue = { severity: row.severity, code: row.code, message: row.message };
    if (typeof row.item_id === "string") issue.item_id = row.item_id;
    return [issue];
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  return {};
}

function stringMap(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) out[key] = String(item);
  return out;
}

function numberMap(value: unknown): Record<string, number> {
  const record = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(record)) out[key] = Number(item);
  return out;
}

function sameJson(left: unknown, right: unknown): boolean {
  return payloadSha256(left) === payloadSha256(right);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function textOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function intOf(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number)) throw domainError("WC_VALIDATION", { quantity: "Cantidad no entera" });
  return number;
}

function abvCenti(value: unknown): number | null {
  if (value == null || value === "") return null;
  const centi = new Decimal(String(value)).mul(100);
  if (!centi.isInteger()) throw domainError("WC_VALIDATION", { abv_pct: "El grado tiene más de 2 decimales" });
  return centi.toNumber();
}

function civilOf(value: unknown): string {
  const text = String(value).trim();
  const date = new Date(text.includes("T") ? text : text.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  return businessDate(date);
}
