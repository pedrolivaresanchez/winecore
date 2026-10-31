import { requestIdFor, sessionOf } from "../auth/guard";
import { can, entityScope, type Permission, type UserCtx } from "../core/auth/permissions";
import type { Actor, Writer } from "../core/db/writer";
import { domainError } from "../core/errors";
import { isAnnulmentReason } from "../core/regulatory/silicie/iesx4";
import {
  cancelSubmission,
  correctSilicie,
  generateSilicie,
  getSubmission,
  listSubmissionViews,
  markResult,
  markSubmitted,
  readSubmissionFile,
  requestApproval,
  validateSilicie,
  type SubmissionView,
} from "../core/regulatory/submissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RegulatoryDeps {
  writer: Writer;
  now: () => Date;
}

export async function listRegulatorySubmissions(deps: RegulatoryDeps, request: Request) {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const entity = optionalUuid(url.searchParams.get("entity") ?? url.searchParams.get("legal_entity_id"), "entity");
  const flow = url.searchParams.get("flow") ?? undefined;
  if (flow && !/^[a-z_]{3,20}$/.test(flow)) throw domainError("WC_VALIDATION", { flow: "Flujo no válido" });
  const page = pageOf(url);
  if (entity && !can(user, "regulatory.read", entity)) throw domainError("WC_FORBIDDEN");
  const scope = entityScope(user, "regulatory.read");
  const listed = await listSubmissionViews(deps.writer, {
    legalEntityId: entity,
    flow,
    entityIds: scope?.map((id) => id.toLowerCase()) ?? null,
    limit: page.limit,
    cursor: page.cursor,
  });
  return {
    items: listed.items.filter((item) => can(user, "regulatory.read", item.legal_entity_id)),
    next_cursor: listed.next_cursor ? encodeCursor(listed.next_cursor.at, listed.next_cursor.id) : null,
  };
}

export async function getRegulatorySubmission(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const view = await getSubmission(deps.writer, id);
  assertCan(user, "regulatory.read", view.legal_entity_id);
  return view;
}

export async function postRegulatorySubmission(deps: RegulatoryDeps, request: Request) {
  const user = sessionOf(request);
  const body = await jsonBody(request);
  const legalEntityId = requiredUuid(body.legal_entity_id, "legal_entity_id");
  assertCan(user, "regulatory.prepare", legalEntityId);
  if (body.flow !== undefined && body.flow !== "silicie") {
    throw domainError("WC_VALIDATION", { flow: "Este servicio solo prepara envíos SILICIE." });
  }
  const view = await generateSilicie(deps.writer, actor(user, request), {
    legalEntityId,
    taxWarehouseId: requiredUuid(body.tax_warehouse_id, "tax_warehouse_id"),
    periodStart: requiredDate(body.period_start, "period_start"),
    periodEnd: requiredDate(body.period_end, "period_end"),
    createdBy: user.id,
    recordedOn: optionalDate(body.recorded_on, "recorded_on"),
    aggregation: aggregationOf(body.aggregation),
  }, { now: deps.now });
  return view;
}

export async function postValidateSubmission(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  await assertSubmission(deps, user, id, "regulatory.prepare");
  return validateSilicie(deps.writer, actor(user, request), id, { now: deps.now });
}

export async function postRequestApproval(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  await assertSubmission(deps, user, id, "regulatory.prepare");
  return requestApproval(deps.writer, actor(user, request), id, { now: deps.now });
}

export async function getSubmissionFile(deps: RegulatoryDeps, request: Request, id: string): Promise<Response> {
  const user = sessionOf(request);
  await assertSubmission(deps, user, id, "regulatory.read");
  const url = new URL(request.url);
  const part = url.searchParams.get("part") === "anulaciones" ? "anulaciones" : "altas";
  const exercise = url.searchParams.get("exercise");
  const year = exercise === null || exercise === "" ? undefined : Number(exercise);
  if (year !== undefined && !Number.isInteger(year)) {
    throw domainError("WC_VALIDATION", { exercise: "Ejercicio no válido" });
  }
  const file = await readSubmissionFile(deps.writer, id, part, year);
  return new Response(file.bytes, {
    headers: {
      "content-type": "text/csv; charset=ISO-8859-1",
      "content-disposition": `attachment; filename="${file.filename}"`,
    },
  });
}

export async function postMarkSubmitted(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  await assertSubmission(deps, user, id, "regulatory.prepare");
  const body = await jsonBody(request);
  const externalRef = typeof body.external_ref === "string" ? body.external_ref : "";
  const receipt = body.receipt_attachment_id == null || body.receipt_attachment_id === ""
    ? null
    : requiredUuid(body.receipt_attachment_id, "receipt_attachment_id");
  return markSubmitted(deps.writer, actor(user, request), id, {
    externalRef,
    receiptAttachmentId: receipt,
  }, { now: deps.now });
}

export async function postMarkResult(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  await assertSubmission(deps, user, id, "regulatory.prepare");
  const body = await jsonBody(request);
  const result = body.result;
  if (result !== "accepted" && result !== "rejected" && result !== "accepted_with_errors") {
    throw domainError("WC_VALIDATION", { result: "El resultado tiene que ser accepted, rejected o accepted_with_errors." });
  }
  const items = Array.isArray(body.items)
    ? body.items.map((item) => {
        const row = asRecord(item);
        return {
          entryId: requiredUuid(row.entry_id, "entry_id"),
          aeatEntryNumber: typeof row.aeat_entry_number === "string" ? row.aeat_entry_number : undefined,
          result: entryResultOf(row.result),
        };
      })
    : undefined;
  return markResult(deps.writer, actor(user, request), id, { result, items });
}

export async function postCorrectSubmission(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const current = await assertSubmission(deps, user, id, "regulatory.prepare");
  const body = await jsonBody(request);
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!isAnnulmentReason(reason)) {
    throw domainError("WC_VALIDATION", { reason: "El motivo de anulación tiene que ser 1, 2 o 3." });
  }
  const entryIds = Array.isArray(body.entry_ids) ? body.entry_ids.map((item) => requiredUuid(item, "entry_id")) : undefined;
  const successor = await correctSilicie(deps.writer, actor(user, request), current.id, {
    reason,
    entryIds,
    createdBy: user.id,
  }, { now: deps.now });
  return { ...successor, successor_id: successor.id };
}

export async function postCancelSubmission(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  await assertSubmission(deps, user, id, "regulatory.prepare");
  const body = await jsonBody(request);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 500) {
    throw domainError("WC_VALIDATION", { reason: "El motivo tiene que tener entre 3 y 500 caracteres." });
  }
  return cancelSubmission(deps.writer, actor(user, request), id, reason);
}

async function assertSubmission(
  deps: RegulatoryDeps,
  user: UserCtx,
  id: string,
  permission: Permission,
): Promise<SubmissionView> {
  const view = await getSubmission(deps.writer, id);
  assertCan(user, permission, view.legal_entity_id);
  return view;
}

function assertCan(user: UserCtx, permission: Permission, entityId: string): void {
  if (!can(user, permission, entityId)) throw domainError("WC_FORBIDDEN");
}

function actor(user: UserCtx, request: Request): Actor {
  return { type: "user", id: user.id, requestId: requestIdFor(request) };
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => {
    throw domainError("WC_VALIDATION", { body: "El cuerpo no es JSON" });
  });
  return asRecord(body);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw domainError("WC_VALIDATION", { body: "El cuerpo no es un objeto" });
}

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw domainError("WC_VALIDATION", { [field]: "Identificador no válido" });
  }
  return value.toLowerCase();
}

function optionalUuid(value: string | null, field: string): string | undefined {
  if (value === null || value === "") return undefined;
  if (!UUID.test(value)) throw domainError("WC_VALIDATION", { [field]: "Identificador no válido" });
  return value.toLowerCase();
}

function requiredDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw domainError("WC_VALIDATION", { [field]: "Fecha no válida" });
  }
  return value;
}

function optionalDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredDate(value, field);
}

function entryResultOf(value: unknown): "accepted" | "rejected" | undefined {
  if (value === "accepted" || value === "rejected") return value;
  return undefined;
}

function pageOf(url: URL): { limit: number; cursor: { at: string; id: string } | null } {
  const limitRaw = url.searchParams.get("limit");
  let limit = 50;
  if (limitRaw !== null && limitRaw.trim() !== "") {
    if (!/^\d{1,3}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 100) {
      throw domainError("WC_VALIDATION", { limit: "El límite debe estar entre 1 y 100" });
    }
    limit = Number(limitRaw);
  }
  const cursorRaw = url.searchParams.get("cursor");
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) throw domainError("WC_VALIDATION", { cursor: "Cursor no válido" });
  return { limit, cursor };
}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, "utf8").toString("base64url");
}

function cursorInstant(value: string): boolean {
  const normalized = value.trim().replace(" ", "T").replace(/([+-])(\d{2})$/, "$1$2:00");
  return Number.isFinite(Date.parse(normalized));
}

function decodeCursor(cursor: string): { at: string; id: string } | null {
  try {
    const text = Buffer.from(cursor, "base64url").toString("utf8");
    const split = text.lastIndexOf("|");
    if (split <= 0) return null;
    const at = text.slice(0, split);
    const id = text.slice(split + 1);
    if (!cursorInstant(at) || !UUID.test(id)) return null;
    return { at, id: id.toLowerCase() };
  } catch {
    return null;
  }
}

function aggregationOf(value: unknown): "monthly" | "none" | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "monthly" || value === "none") return value;
  throw domainError("WC_VALIDATION", { aggregation: "La agregación tiene que ser monthly o none." });
}
