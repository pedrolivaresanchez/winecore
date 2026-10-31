// Ciclo INFOVI: generar, validar, pedir aprobación y anotar la presentación manual.
// WineCore no llama al Ministerio ni a la Junta.
import { payloadSha256 } from "../../approvals/canonical";
import { loadApprovalPolicies } from "../../approvals/policy-store";
import { approvalServiceOn } from "../../approvals/sql-store";
import type { ApprovalPolicy, Clock } from "../../approvals/types";
import { readContent } from "../../attachments/store";
import { sql } from "../../db/sql";
import type { Actor, Tx, Writer } from "../../db/writer";
import { domainError } from "../../errors";
import { emitEvent } from "../../events/emit";
import { newId } from "../../ids";
import { businessDate } from "../../time";
import { loadHolidayCalendar } from "../obligations";
import { assertMutableContent, assertStatusChange, isMutableStatus } from "../guard";
import { errorsOf, warningsOf, type Issue } from "../issue";
import { phaseOf } from "../submissions";
import { INFOVI_BASIS, infoviDueDate, monthBounds } from "./deadlines";
import { infoviFilename, renderInfoviCsv, sha256Bytes } from "./csv";
import { loadSheetInput } from "./load";
import { buildInfoviSheet, sheetToPayload, type InfoviSheet } from "./sheet";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9][A-Za-z0-9./_-]{3,39}$/;
const MONTH = /^\d{4}-\d{2}$/;

export interface GenerateInfoviInput {
  legalEntityId: string;
  taxWarehouseId: string;
  month: string;
  createdBy: string;
  rectifiesFilingId?: string | null;
  reason?: string | null;
}

export interface InfoviLineView {
  family: string;
  color: string;
  category: string;
  opening_l: string;
  entries_l: string;
  exits_l: string;
  closing_l: string;
  reconciles: boolean;
}

export interface InfoviFilingView {
  id: string;
  legal_entity_id: string;
  tax_warehouse_id: string;
  kind: string;
  period_start: string;
  period_end: string;
  due_date: string;
  status: string;
  phase: string;
  content_sha256: string;
  external_ref: string | null;
  approval_request_id: string | null;
  rectifies_filing_id: string | null;
  successor_id: string | null;
  ready_for_approval: boolean;
  blocks_approval: boolean;
  validation: { errors: Issue[]; warnings: Issue[] };
  lines: InfoviLineView[];
  grape: { operation_id: string; day: string; variety: string | null; parcel_codes: string[]; kg: string | null }[];
  production: {
    campaign: string;
    must_l: string;
    wine_l: string;
    average_hl: string | null;
    campaigns_with_data: number;
  };
  bottling_l: string;
  sales_l: string;
  reconciliation: { ok: boolean; unbalanced: number };
  blocked_note: string;
  files: { filename: string; sha256: string }[];
  installation_name: string;
  created_by: string;
}

export async function generateInfovi(
  writer: Writer,
  actor: Actor,
  input: GenerateInfoviInput,
  clock: Clock,
): Promise<InfoviFilingView> {
  const id = await writer.withWrite(actor, (tx) => generateIn(tx, input, clock));
  return getInfoviFiling(writer, id);
}

export async function validateInfovi(writer: Writer, actor: Actor, id: string, clock: Clock): Promise<InfoviFilingView> {
  await writer.withWrite(actor, (tx) => validateIn(tx, id, clock));
  return getInfoviFiling(writer, id);
}

export async function requestInfoviApproval(writer: Writer, actor: Actor, id: string, clock: Clock): Promise<InfoviFilingView> {
  const policies = await loadApprovalPolicies(writer);
  const result = await writer.withWrite(actor, (tx) => requestIn(tx, id, policies, clock, actor.id));
  if (result.demoted) {
    throw domainError(
      "WC_VALIDATION",
      { period: "Los datos del periodo han cambiado. Vuelve a preparar la ficha." },
      "Los datos del periodo han cambiado. Vuelve a preparar la ficha.",
    );
  }
  return getInfoviFiling(writer, id);
}

export async function markInfoviSubmitted(
  writer: Writer,
  actor: Actor,
  id: string,
  input: { externalRef: string; receiptAttachmentId?: string | null },
  clock: Clock,
): Promise<InfoviFilingView> {
  const policies = await loadApprovalPolicies(writer);
  await writer.withWrite(actor, (tx) => markSubmittedIn(tx, id, input, policies, clock));
  return getInfoviFiling(writer, id);
}

export async function correctInfovi(
  writer: Writer,
  actor: Actor,
  id: string,
  input: { reason: string; createdBy: string },
  clock: Clock,
): Promise<InfoviFilingView> {
  const successor = await writer.withWrite(actor, (tx) => correctIn(tx, id, input, clock));
  return getInfoviFiling(writer, successor);
}

export async function cancelInfovi(writer: Writer, actor: Actor, id: string, reason: string): Promise<InfoviFilingView> {
  await writer.withWrite(actor, (tx) => cancelIn(tx, id, reason));
  return getInfoviFiling(writer, id);
}

export async function getInfoviFiling(writer: Writer, id: string): Promise<InfoviFilingView> {
  return viewFrom(writer.read.bind(writer), await requireRow(writer.read.bind(writer), id));
}

export async function readInfoviFile(writer: Writer, id: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const row = await requireRow(writer.read.bind(writer), id);
  const payload = parsePayload(row.payload);
  if (!payload.csv_sha256) throw domainError("WC_NOT_FOUND");
  const bytes = await readContent(writer.read.bind(writer), payload.csv_sha256);
  return { filename: infoviFilename(row.period_start), bytes };
}

export async function findInfoviFiling(
  writer: Writer,
  input: { legalEntityId: string; taxWarehouseId: string; month: string },
): Promise<InfoviFilingView | null> {
  const bounds = boundsOf(input.month);
  const rows = await writer.read<Record<string, unknown>>(selectFiling(sql`
    f.legal_entity_id = CAST(${input.legalEntityId} AS UUID)
    AND f.period_start = CAST(${bounds.start} AS DATE)
    AND f.period_end = CAST(${bounds.end} AS DATE)
    AND f.status <> 'cancelled'
  `, "ORDER BY f.created_at DESC"));
  for (const row of rows) {
    const filing = asFiling(row);
    const payload = parsePayload(filing.payload);
    if (payload.tax_warehouse_id === input.taxWarehouseId.toLowerCase()) {
      return viewFrom(writer.read.bind(writer), filing);
    }
  }
  return null;
}

export async function syncInfoviFromApproval(writer: Writer, actor: Actor, approvalRequestId: string): Promise<void> {
  if (!UUID.test(approvalRequestId)) return;
  await writer.withWrite(actor, async (tx) => {
    const rows = await tx.read<{ id: string; status: string; approval_status: string }>(sql`
      SELECT f.id::VARCHAR AS id, f.status, a.status AS approval_status
      FROM regulatory.infovi_filing f
      JOIN ops.approval_request a ON a.id = f.approval_request_id
      WHERE f.approval_request_id = CAST(${approvalRequestId} AS UUID)
    `);
    const row = rows[0];
    if (!row || row.status !== "pending_approval") return;
    if (row.approval_status === "approved") {
      assertStatusChange(row.status, "approved");
      tx.write(sql`
        UPDATE regulatory.infovi_filing
        SET status = 'approved', updated_at = now()
        WHERE id = CAST(${row.id} AS UUID) AND status = 'pending_approval'
      `);
      tx.audit({
        table: "regulatory.infovi_filing",
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
        UPDATE regulatory.infovi_filing
        SET status = 'validated', approval_request_id = NULL, updated_at = now()
        WHERE id = CAST(${row.id} AS UUID) AND status = 'pending_approval'
      `);
      tx.audit({
        table: "regulatory.infovi_filing",
        rowId: row.id,
        action: "UPDATE",
        before: { status: "pending_approval" },
        after: { status: "validated" },
      });
    }
  });
}

async function generateIn(tx: Tx, input: GenerateInfoviInput, clock: Clock): Promise<string> {
  const prepared = await prepare(tx, input, clock);
  const existing = await findOpen(tx, input, prepared.bounds);
  if (existing && !isMutableStatus(existing.status)) {
    if (existing.status === "submitted" || existing.status === "accepted" || existing.status === "rejected") {
      throw domainError(
        "WC_ILLEGAL_TRANSITION",
        { period: "Este periodo ya está presentado. Prepara una corrección." },
        "Este periodo ya está presentado. Prepara una corrección.",
      );
    }
    throw domainError("WC120");
  }
  const id = existing ? existing.id : newId();
  await persist(tx, id, input, existing, prepared);
  return id;
}

async function validateIn(tx: Tx, id: string, clock: Clock): Promise<void> {
  const row = await requireRow(tx.read.bind(tx), id);
  if (!isMutableStatus(row.status)) return;
  const payload = parsePayload(row.payload);
  const prepared = await prepare(tx, inputFrom(row, payload), clock);
  const hash = payloadSha256(prepared.canonical);
  const errors = errorsOf(prepared.sheet.issues);
  if (hash !== row.payload_sha256) {
    tx.write(sql`
      UPDATE regulatory.infovi_filing
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
    UPDATE regulatory.infovi_filing
    SET status = ${next},
        validation_errors = ${sql.json(errors)},
        response_summary = ${sql.json({ warnings: warningsOf(prepared.sheet.issues) })},
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
): Promise<{ demoted: boolean }> {
  const row = await requireRow(tx.read.bind(tx), id);
  if (row.status !== "validated") {
    throw domainError(
      "WC_ILLEGAL_TRANSITION",
      { status: "Hay que validar la ficha, sin errores, antes de pedir la aprobación." },
      "Hay que validar la ficha, sin errores, antes de pedir la aprobación.",
    );
  }
  const payload = parsePayload(row.payload);
  const prepared = await prepare(tx, inputFrom(row, payload), clock);
  const errors = errorsOf(prepared.sheet.issues);
  const hash = payloadSha256(prepared.canonical);
  if (hash !== row.payload_sha256 || errors.length > 0) {
    tx.write(sql`
      UPDATE regulatory.infovi_filing
      SET status = 'draft',
          validation_errors = ${sql.json(errors.length > 0 ? errors : contenidoDistinto())},
          updated_at = now()
      WHERE id = CAST(${id} AS UUID) AND status = 'validated'
    `);
    return { demoted: true };
  }
  const approval = await approvalServiceOn(tx, policies, clock).requestApproval({
    kind: "regulatory_submission",
    legalEntityId: row.legal_entity_id,
    subjectTable: "regulatory.infovi_filing",
    subjectId: id,
    payload: prepared.canonical,
    summary: `INFOVI ${row.period_start.slice(0, 7)} (${prepared.sheet.lines.length} grupos)`,
    requestedBy,
    details: {
      period: `${row.period_start}..${row.period_end}`,
      records: String(prepared.sheet.lines.length),
      destination: "INFOVI",
      description: "Declaración de existencias",
    },
  });
  if (approval.payloadSha256 !== hash) throw domainError("WC040");
  assertStatusChange("validated", "pending_approval");
  tx.write(sql`
    UPDATE regulatory.infovi_filing
    SET status = 'pending_approval',
        approval_request_id = CAST(${approval.id} AS UUID),
        validation_errors = ${sql.json([])},
        updated_at = now()
    WHERE id = CAST(${id} AS UUID) AND status = 'validated' AND payload_sha256 = ${hash}
  `);
  tx.audit({
    table: "regulatory.infovi_filing",
    rowId: id,
    action: "UPDATE",
    before: { status: "validated" },
    after: { status: "pending_approval", approval_request_id: approval.id },
  });
  emitEvent(tx, {
    type: "regulatory.submission.pending_approval",
    aggregate: "regulatory.infovi_filing",
    aggregateId: id,
    payload: { legal_entity_id: row.legal_entity_id, submission_id: id, link: "/regulatorio/infovi" },
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
    throw domainError("WC_VALIDATION", { external_ref: "La referencia del justificante tiene que tener entre 4 y 40 caracteres." });
  }
  const row = await requireRow(tx.read.bind(tx), id);
  if (row.status === "submitted" && row.external_ref === ref) return;
  if (row.status === "submitted") {
    throw domainError("WC_ILLEGAL_TRANSITION", { external_ref: "La declaración ya está marcada como presentada." });
  }
  if (!row.approval_request_id) throw domainError("WC_NOT_APPROVED");
  const approval = await tx.read<{ status: string; payload_sha256: string }>(sql`
    SELECT status, payload_sha256 FROM ops.approval_request WHERE id = CAST(${row.approval_request_id} AS UUID)
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
    UPDATE regulatory.infovi_filing
    SET status = 'submitted',
        external_ref = ${ref},
        response_summary = ${sql.json({ ...summary, manual_submit: { mode: "manual", external_ref: ref } })},
        updated_at = now()
    WHERE id = CAST(${id} AS UUID)
  `);
  if (input.receiptAttachmentId) linkReceipt(tx, input.receiptAttachmentId, id, row.created_by);
  setObligation(tx, row.legal_entity_id, row.period_start, row.period_end, row.due_date, "done");
  tx.audit({
    table: "regulatory.infovi_filing",
    rowId: id,
    action: "UPDATE",
    before: { status: row.status },
    after: { status: "submitted", external_ref: ref },
  });
}

async function correctIn(
  tx: Tx,
  id: string,
  input: { reason: string; createdBy: string },
  clock: Clock,
): Promise<string> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw domainError("WC_VALIDATION", { reason: "El motivo tiene que tener entre 3 y 500 caracteres." });
  }
  const original = await requireRow(tx.read.bind(tx), id);
  if (original.status !== "submitted" && original.status !== "accepted" && original.status !== "rejected") {
    throw domainError(
      "WC_ILLEGAL_TRANSITION",
      { status: "Solo se corrige una declaración ya presentada." },
      "Solo se corrige una declaración ya presentada.",
    );
  }
  const followers = await tx.read<{ id: string; status: string }>(sql`
    SELECT id::VARCHAR AS id, status
    FROM regulatory.infovi_filing
    WHERE rectifies_filing_id = CAST(${original.id} AS UUID)
      AND status <> 'cancelled'
    ORDER BY created_at DESC
  `);
  const open = followers.find((row) => isMutableStatus(row.status));
  if (open) return String(open.id).toLowerCase();
  if (followers.length > 0) throw domainError("WC120");
  const payload = parsePayload(original.payload);
  return generateIn(tx, {
    legalEntityId: original.legal_entity_id,
    taxWarehouseId: payload.tax_warehouse_id,
    month: original.period_start.slice(0, 7),
    createdBy: input.createdBy,
    rectifiesFilingId: original.id,
    reason,
  }, clock);
}

async function cancelIn(tx: Tx, id: string, reason: string): Promise<void> {
  const row = await requireRow(tx.read.bind(tx), id);
  if (!["draft", "validated", "pending_approval"].includes(row.status)) {
    throw domainError(
      "WC_ILLEGAL_TRANSITION",
      { status: "Solo se puede anular una ficha antes de aprobarla." },
      "Solo se puede anular una ficha antes de aprobarla.",
    );
  }
  assertStatusChange(row.status, "cancelled");
  if (row.approval_request_id) {
    tx.write(sql`
      UPDATE ops.approval_request SET status = 'cancelled'
      WHERE id = CAST(${row.approval_request_id} AS UUID) AND status = 'pending'
    `);
  }
  tx.write(sql`
    UPDATE regulatory.infovi_filing SET status = 'cancelled', updated_at = now()
    WHERE id = CAST(${row.id} AS UUID)
  `);
  if (!row.rectifies_filing_id) {
    setObligation(tx, row.legal_entity_id, row.period_start, row.period_end, row.due_date, "open");
  }
  tx.audit({
    table: "regulatory.infovi_filing",
    rowId: row.id,
    action: "UPDATE",
    before: { status: row.status },
    after: { status: "cancelled", reason },
  });
}

interface Prepared {
  sheet: InfoviSheet;
  canonical: Record<string, unknown>;
  bounds: { start: string; end: string };
  dueDate: string;
  bytes: Uint8Array;
  csvSha: string;
}

async function prepare(tx: Tx, input: GenerateInfoviInput, clock: Clock): Promise<Prepared> {
  if (!MONTH.test(input.month)) throw domainError("WC_VALIDATION", { month: "El mes no es válido." });
  let bounds: { start: string; end: string };
  try {
    bounds = monthBounds(input.month);
  } catch {
    throw domainError("WC_VALIDATION", { month: "El mes no es válido." });
  }
  const warehouse = await requireWarehouse(tx, input.taxWarehouseId, input.legalEntityId);
  const year = Number(bounds.end.slice(0, 4));
  const calendar = await loadHolidayCalendar(tx.read.bind(tx), year);
  const dueDate = infoviDueDate(bounds.end, calendar);
  const loaded = await loadSheetInput(tx, {
    legalEntityId: input.legalEntityId,
    taxWarehouseId: warehouse.id,
    installationName: warehouse.name,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    dueDate,
  });
  const sheet = buildInfoviSheet(loaded);
  const bytes = renderInfoviCsv(sheet);
  const csvSha = sha256Bytes(bytes);
  const canonical = sheetToPayload(sheet, {
    legalEntityId: input.legalEntityId.toLowerCase(),
    recordedOn: businessDate(clock.now()),
    rectifiesFilingId: input.rectifiesFilingId?.toLowerCase() ?? null,
    reason: input.reason?.trim() || null,
    csvSha256: csvSha,
  });
  return { sheet, canonical, bounds, dueDate, bytes, csvSha };
}

async function persist(
  tx: Tx,
  id: string,
  input: GenerateInfoviInput,
  existing: FilingRow | null,
  prepared: Prepared,
): Promise<void> {
  const hash = payloadSha256(prepared.canonical);
  const errors = errorsOf(prepared.sheet.issues);
  const warnings = warningsOf(prepared.sheet.issues);
  if (existing && hash === existing.payload_sha256 && sameJson(errors, asIssues(existing.validation_errors))) return;
  if (existing) assertMutableContent(existing.status);
  const attachmentId = await storeFile(tx, prepared.bytes, prepared.csvSha, infoviFilename(prepared.bounds.start), id, input.createdBy, prepared.canonical.recorded_on);
  if (!existing) {
    tx.write(sql`
      INSERT INTO regulatory.infovi_filing (
        id, legal_entity_id, tax_warehouse_id, kind, period_start, period_end, due_date,
        status, payload, payload_sha256, rendered_attachment_id, validation_errors, response_summary,
        rectifies_filing_id, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${input.legalEntityId} AS UUID),
        CAST(${input.taxWarehouseId} AS UUID),
        'infovi.mensual',
        CAST(${prepared.bounds.start} AS DATE),
        CAST(${prepared.bounds.end} AS DATE),
        CAST(${prepared.dueDate} AS DATE),
        'draft',
        ${sql.json(prepared.canonical)},
        ${hash},
        CAST(${attachmentId} AS UUID),
        ${sql.json(errors)},
        ${sql.json({ warnings })},
        CAST(${input.rectifiesFilingId ?? null} AS UUID),
        ${input.createdBy}
      )
    `);
  } else {
    assertStatusChange(existing.status, "draft");
    tx.write(sql`
      UPDATE regulatory.infovi_filing
      SET status = 'draft',
          due_date = CAST(${prepared.dueDate} AS DATE),
          payload = ${sql.json(prepared.canonical)},
          payload_sha256 = ${hash},
          rendered_attachment_id = CAST(${attachmentId} AS UUID),
          validation_errors = ${sql.json(errors)},
          response_summary = ${sql.json({ warnings })},
          approval_request_id = NULL,
          updated_at = now()
      WHERE id = CAST(${id} AS UUID)
    `);
  }
  setObligation(
    tx,
    input.legalEntityId,
    prepared.bounds.start,
    prepared.bounds.end,
    prepared.dueDate,
    "in_progress",
    input.rectifiesFilingId != null,
  );
  tx.audit({
    table: "regulatory.infovi_filing",
    rowId: id,
    action: existing ? "UPDATE" : "INSERT",
    before: existing ? { status: existing.status, payload_sha256: existing.payload_sha256 } : null,
    after: { status: "draft", payload_sha256: hash },
  });
}

async function storeFile(
  tx: Tx,
  bytes: Uint8Array,
  sha: string,
  filename: string,
  filingId: string,
  createdBy: string,
  recordedOn: unknown,
): Promise<string> {
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
      SELECT ${sha}, ${bytes}
      WHERE NOT EXISTS (SELECT 1 FROM core.attachment_content WHERE sha256 = ${sha})
    `);
    tx.write(sql`
      INSERT INTO core.attachment (
        id, sha256, storage_backend, storage_key, filename, mime_type, size_bytes,
        classification, retention_until, created_by
      ) VALUES (
        CAST(${attachmentId} AS UUID), ${sha}, 'knowledge_base', ${sha}, ${filename},
        'text/csv', ${bytes.byteLength}, 'regulatory_evidence', CAST(${retention} AS DATE), ${createdBy}
      )
    `);
  }
  const linked = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.attachment_link
    WHERE attachment_id = CAST(${attachmentId} AS UUID)
      AND entity_table = 'regulatory.infovi_filing'
      AND entity_id = CAST(${filingId} AS UUID)
      AND role = 'evidence_request'
    LIMIT 1
  `);
  if (!linked[0]) {
    tx.write(sql`
      INSERT INTO core.attachment_link (id, attachment_id, entity_table, entity_id, role, created_by)
      VALUES (
        CAST(${newId()} AS UUID), CAST(${attachmentId} AS UUID), 'regulatory.infovi_filing',
        CAST(${filingId} AS UUID), 'evidence_request', ${createdBy}
      )
    `);
  }
  return attachmentId;
}

function linkReceipt(tx: Tx, attachmentId: string, filingId: string, createdBy: string): void {
  tx.write(sql`
    INSERT INTO core.attachment_link (id, attachment_id, entity_table, entity_id, role, created_by)
    SELECT CAST(${newId()} AS UUID), CAST(${attachmentId} AS UUID), 'regulatory.infovi_filing',
           CAST(${filingId} AS UUID), 'official_receipt', ${createdBy}
    WHERE NOT EXISTS (
      SELECT 1 FROM core.attachment_link
      WHERE attachment_id = CAST(${attachmentId} AS UUID)
        AND entity_table = 'regulatory.infovi_filing'
        AND entity_id = CAST(${filingId} AS UUID)
        AND role = 'official_receipt'
    )
  `);
}

function setObligation(
  tx: Tx,
  legalEntityId: string,
  periodStart: string,
  periodEnd: string,
  dueDate: string,
  status: "in_progress" | "done" | "open",
  force = false,
): void {
  const title = `INFOVI · ${periodStart.slice(0, 7)}`;
  if (status === "in_progress") {
    const id = newId();
    tx.write(sql`
      INSERT INTO regulatory.obligation (
        id, legal_entity_id, flow, title, period_start, period_end, due_date, legal_basis, status
      )
      SELECT CAST(${id} AS UUID), CAST(${legalEntityId} AS UUID), 'infovi', ${title},
             CAST(${periodStart} AS DATE), CAST(${periodEnd} AS DATE), CAST(${dueDate} AS DATE),
             ${INFOVI_BASIS}, 'open'
      WHERE NOT EXISTS (
        SELECT 1 FROM regulatory.obligation
        WHERE legal_entity_id = CAST(${legalEntityId} AS UUID)
          AND flow = 'infovi'
          AND title = ${title}
          AND due_date = CAST(${dueDate} AS DATE)
      )
    `);
  }
  const guard = status === "in_progress" && !force ? "AND status <> 'done'" : "";
  tx.write(`
    UPDATE regulatory.obligation
    SET status = ${sql`${status}`}
    WHERE legal_entity_id = CAST(${sql`${legalEntityId}`} AS UUID)
      AND flow = 'infovi'
      AND period_start = CAST(${sql`${periodStart}`} AS DATE)
      AND period_end = CAST(${sql`${periodEnd}`} AS DATE)
      ${guard}
  `);
}

async function assertAttachment(tx: Tx, id: string): Promise<void> {
  if (!UUID.test(id)) throw domainError("WC_VALIDATION", { receipt_attachment_id: "Identificador no válido" });
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.attachment WHERE id = CAST(${id} AS UUID)
  `);
  if (!rows[0]) throw domainError("WC_VALIDATION", { receipt_attachment_id: "El justificante no existe" });
}

async function requireWarehouse(tx: Tx, id: string, legalEntityId: string): Promise<{ id: string; name: string }> {
  if (!UUID.test(id) || !UUID.test(legalEntityId)) throw domainError("WC_VALIDATION", { id: "Identificador no válido" });
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, legal_entity_id::VARCHAR AS legal_entity_id, name
    FROM inventory.tax_warehouse
    WHERE id = CAST(${id} AS UUID) AND is_active
  `);
  const row = rows[0];
  if (!row) throw domainError("WC_NOT_FOUND");
  if (String(row.legal_entity_id).toLowerCase() !== legalEntityId.toLowerCase()) {
    throw domainError("WC_VALIDATION", { tax_warehouse_id: "El establecimiento no es de esta entidad." });
  }
  return { id: String(row.id).toLowerCase(), name: String(row.name) };
}

async function findOpen(
  tx: Tx,
  input: GenerateInfoviInput,
  bounds: { start: string; end: string },
): Promise<FilingRow | null> {
  const rectifies = input.rectifiesFilingId ?? null;
  const rows = await tx.read<Record<string, unknown>>(selectFiling(sql`
    f.legal_entity_id = CAST(${input.legalEntityId} AS UUID)
    AND f.period_start = CAST(${bounds.start} AS DATE)
    AND f.period_end = CAST(${bounds.end} AS DATE)
    AND f.status <> 'cancelled'
    AND (
      (${rectifies} IS NULL AND f.rectifies_filing_id IS NULL)
      OR f.rectifies_filing_id = CAST(${rectifies} AS UUID)
    )
  `, "ORDER BY f.created_at DESC"));
  for (const row of rows) {
    const filing = asFiling(row);
    const payload = parsePayload(filing.payload);
    if (payload.tax_warehouse_id === input.taxWarehouseId.toLowerCase()) return filing;
  }
  return null;
}

interface FilingRow {
  id: string;
  legal_entity_id: string;
  tax_warehouse_id: string;
  kind: string;
  period_start: string;
  period_end: string;
  due_date: string;
  status: string;
  payload: unknown;
  payload_sha256: string;
  validation_errors: unknown;
  response_summary: unknown;
  approval_request_id: string | null;
  external_ref: string | null;
  rectifies_filing_id: string | null;
  created_by: string;
}

function selectFiling(where: string, order = ""): string {
  return `
    SELECT f.id::VARCHAR AS id, f.legal_entity_id::VARCHAR AS legal_entity_id,
           f.tax_warehouse_id::VARCHAR AS tax_warehouse_id, f.kind,
           f.period_start::VARCHAR AS period_start, f.period_end::VARCHAR AS period_end,
           f.due_date::VARCHAR AS due_date, f.status, f.payload::VARCHAR AS payload, f.payload_sha256,
           f.validation_errors::VARCHAR AS validation_errors, f.response_summary::VARCHAR AS response_summary,
           f.approval_request_id::VARCHAR AS approval_request_id, f.external_ref,
           f.rectifies_filing_id::VARCHAR AS rectifies_filing_id, f.created_by
    FROM regulatory.infovi_filing f
    WHERE ${where}
    ${order}
  `;
}

async function requireRow(read: Tx["read"], id: string): Promise<FilingRow> {
  if (!UUID.test(id)) throw domainError("WC_NOT_FOUND");
  const rows = await read<Record<string, unknown>>(selectFiling(sql`f.id = CAST(${id} AS UUID)`));
  const row = rows[0];
  if (!row) throw domainError("WC_NOT_FOUND");
  return asFiling(row);
}

function asFiling(row: Record<string, unknown>): FilingRow {
  return {
    id: String(row.id).toLowerCase(),
    legal_entity_id: String(row.legal_entity_id).toLowerCase(),
    tax_warehouse_id: String(row.tax_warehouse_id).toLowerCase(),
    kind: String(row.kind),
    period_start: String(row.period_start).slice(0, 10),
    period_end: String(row.period_end).slice(0, 10),
    due_date: String(row.due_date).slice(0, 10),
    status: String(row.status),
    payload: row.payload,
    payload_sha256: String(row.payload_sha256),
    validation_errors: row.validation_errors,
    response_summary: row.response_summary,
    approval_request_id: row.approval_request_id == null ? null : String(row.approval_request_id).toLowerCase(),
    external_ref: row.external_ref == null ? null : String(row.external_ref),
    rectifies_filing_id: row.rectifies_filing_id == null ? null : String(row.rectifies_filing_id).toLowerCase(),
    created_by: String(row.created_by),
  };
}

interface StoredPayload {
  tax_warehouse_id: string;
  installation_name: string;
  csv_sha256: string;
  rectifies_filing_id: string | null;
  reason: string | null;
  blocked_note: string;
  lines: InfoviLineView[];
  grape: InfoviFilingView["grape"];
  production: InfoviFilingView["production"];
  bottling_l: string;
  sales_l: string;
  reconciliation: { ok: boolean; unbalanced: number };
  recorded_on: string;
}

function parsePayload(value: unknown): StoredPayload {
  const record = asRecord(value);
  const production = asRecord(record.production);
  const reconciliation = asRecord(record.reconciliation);
  return {
    tax_warehouse_id: String(record.tax_warehouse_id ?? "").toLowerCase(),
    installation_name: String(record.installation_name ?? ""),
    csv_sha256: String(record.csv_sha256 ?? ""),
    rectifies_filing_id: record.rectifies_filing_id == null || record.rectifies_filing_id === ""
      ? null
      : String(record.rectifies_filing_id).toLowerCase(),
    reason: record.reason == null || record.reason === "" ? null : String(record.reason),
    blocked_note: String(record.blocked_note ?? ""),
    lines: Array.isArray(record.lines) ? record.lines.map(lineOf) : [],
    grape: Array.isArray(record.grape) ? record.grape.map(grapeOf) : [],
    production: {
      campaign: String(production.campaign ?? ""),
      must_l: String(production.must_l ?? "0.000"),
      wine_l: String(production.wine_l ?? "0.000"),
      average_hl: production.average_hl == null || production.average_hl === "" ? null : String(production.average_hl),
      campaigns_with_data: Number(production.campaigns_with_data ?? 0),
    },
    bottling_l: String(record.bottling_l ?? "0.000"),
    sales_l: String(record.sales_l ?? "0.000"),
    reconciliation: {
      ok: reconciliation.ok === true,
      unbalanced: Number(reconciliation.unbalanced ?? 0),
    },
    recorded_on: String(record.recorded_on ?? ""),
  };
}

function inputFrom(row: FilingRow, payload: StoredPayload): GenerateInfoviInput {
  return {
    legalEntityId: row.legal_entity_id,
    taxWarehouseId: payload.tax_warehouse_id,
    month: row.period_start.slice(0, 7),
    createdBy: row.created_by,
    rectifiesFilingId: row.rectifies_filing_id,
    reason: payload.reason,
  };
}

async function viewFrom(read: Tx["read"], row: FilingRow): Promise<InfoviFilingView> {
  const payload = parsePayload(row.payload);
  const errors = asIssues(row.validation_errors);
  const warnings = asIssues(asRecord(row.response_summary).warnings);
  const followers = await read<{ id: string; status: string }>(sql`
    SELECT id::VARCHAR AS id, status
    FROM regulatory.infovi_filing
    WHERE rectifies_filing_id = CAST(${row.id} AS UUID)
      AND status <> 'cancelled'
    ORDER BY created_at DESC
  `);
  const successor = followers[0];
  const successorId = successor ? String(successor.id).toLowerCase() : null;
  const corrected = followers.some((item) => item.status === "submitted" || item.status === "accepted");
  const hasFile = payload.csv_sha256 !== "";
  return {
    id: row.id,
    legal_entity_id: row.legal_entity_id,
    tax_warehouse_id: row.tax_warehouse_id,
    kind: row.kind,
    period_start: row.period_start,
    period_end: row.period_end,
    due_date: row.due_date,
    status: row.status,
    phase: corrected ? "corrected" : phaseOf(row.status, hasFile),
    content_sha256: row.payload_sha256,
    external_ref: row.external_ref,
    approval_request_id: row.approval_request_id,
    rectifies_filing_id: row.rectifies_filing_id,
    successor_id: successorId,
    ready_for_approval: row.status === "validated" && errors.length === 0,
    blocks_approval: errors.length > 0 || row.status === "draft",
    validation: { errors, warnings },
    lines: payload.lines,
    grape: payload.grape,
    production: payload.production,
    bottling_l: payload.bottling_l,
    sales_l: payload.sales_l,
    reconciliation: payload.reconciliation,
    blocked_note: payload.blocked_note,
    files: hasFile ? [{ filename: infoviFilename(row.period_start), sha256: payload.csv_sha256 }] : [],
    installation_name: payload.installation_name,
    created_by: row.created_by,
  };
}

function lineOf(value: unknown): InfoviLineView {
  const row = asRecord(value);
  return {
    family: String(row.family ?? ""),
    color: String(row.color ?? ""),
    category: String(row.category ?? ""),
    opening_l: String(row.opening_l ?? "0.000"),
    entries_l: String(row.entries_l ?? "0.000"),
    exits_l: String(row.exits_l ?? "0.000"),
    closing_l: String(row.closing_l ?? "0.000"),
    reconciles: row.reconciles === true,
  };
}

function grapeOf(value: unknown): InfoviFilingView["grape"][number] {
  const row = asRecord(value);
  return {
    operation_id: String(row.operation_id ?? ""),
    day: String(row.day ?? "").slice(0, 10),
    variety: row.variety == null || row.variety === "" ? null : String(row.variety),
    parcel_codes: Array.isArray(row.parcel_codes) ? row.parcel_codes.map(String) : [],
    kg: row.kg == null || row.kg === "" ? null : String(row.kg),
  };
}

function contenidoDistinto(): Issue[] {
  return [{
    severity: "error",
    code: "contenido_distinto",
    message: "Los datos del periodo han cambiado. Vuelve a preparar la ficha.",
  }];
}

function boundsOf(month: string): { start: string; end: string } {
  if (!MONTH.test(month)) throw domainError("WC_VALIDATION", { month: "El mes no es válido." });
  try {
    return monthBounds(month);
  } catch {
    throw domainError("WC_VALIDATION", { month: "El mes no es válido." });
  }
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
