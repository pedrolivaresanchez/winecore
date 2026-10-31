import { requestIdFor, sessionOf } from "../auth/guard";
import { can, type Permission, type UserCtx } from "../core/auth/permissions";
import type { Actor } from "../core/db/writer";
import { domainError } from "../core/errors";
import { loadHolidayCalendar } from "../core/regulatory/obligations";
import { infoviDueDate, monthBounds, shiftMonth } from "../core/regulatory/infovi/deadlines";
import {
  cancelInfovi,
  correctInfovi,
  findInfoviFiling,
  generateInfovi,
  getInfoviFiling,
  markInfoviSubmitted,
  readInfoviFile,
  requestInfoviApproval,
  validateInfovi,
  type InfoviFilingView,
} from "../core/regulatory/infovi/workflow";
import { businessDate } from "../core/time";
import type { RegulatoryDeps } from "./regulatory-submissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-\d{2}$/;

export async function getInfoviMonth(deps: RegulatoryDeps, request: Request) {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const legalEntityId = requiredUuid(url.searchParams.get("entity") ?? url.searchParams.get("legal_entity_id"), "entity");
  const taxWarehouseId = requiredUuid(url.searchParams.get("tax_warehouse_id"), "tax_warehouse_id");
  assertCan(user, "regulatory.read", legalEntityId);
  const month = monthOf(url.searchParams.get("month"), deps.now());
  const bounds = boundsOf(month);
  const calendar = await loadHolidayCalendar(deps.writer.read.bind(deps.writer), Number(bounds.end.slice(0, 4)));
  const filing = await findInfoviFiling(deps.writer, { legalEntityId, taxWarehouseId, month });
  return {
    month,
    period_start: bounds.start,
    period_end: bounds.end,
    due_date: infoviDueDate(bounds.end, calendar),
    filing,
  };
}

export async function postInfovi(deps: RegulatoryDeps, request: Request) {
  const user = sessionOf(request);
  const body = await jsonBody(request);
  const legalEntityId = requiredUuid(body.legal_entity_id, "legal_entity_id");
  assertCan(user, "regulatory.prepare", legalEntityId);
  const month = typeof body.month === "string" ? body.month : "";
  if (!MONTH.test(month)) throw domainError("WC_VALIDATION", { month: "El mes no es válido." });
  return generateInfovi(deps.writer, actor(user, request), {
    legalEntityId,
    taxWarehouseId: requiredUuid(body.tax_warehouse_id, "tax_warehouse_id"),
    month,
    createdBy: user.id,
  }, { now: deps.now });
}

export async function getInfovi(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const view = await getInfoviFiling(deps.writer, id);
  assertCan(user, "regulatory.read", view.legal_entity_id);
  return view;
}

export async function getInfoviFile(deps: RegulatoryDeps, request: Request, id: string): Promise<Response> {
  const user = sessionOf(request);
  await assertFiling(deps, user, id, "regulatory.read");
  const file = await readInfoviFile(deps.writer, id);
  return new Response(file.bytes, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${file.filename}"`,
    },
  });
}

export async function postValidateInfovi(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  await assertFiling(deps, user, id, "regulatory.prepare");
  return validateInfovi(deps.writer, actor(user, request), id, { now: deps.now });
}

export async function postRequestInfoviApproval(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  await assertFiling(deps, user, id, "regulatory.prepare");
  return requestInfoviApproval(deps.writer, actor(user, request), id, { now: deps.now });
}

export async function postMarkInfoviSubmitted(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  await assertFiling(deps, user, id, "regulatory.prepare");
  const body = await jsonBody(request);
  const externalRef = typeof body.external_ref === "string" ? body.external_ref : "";
  const receipt = body.receipt_attachment_id == null || body.receipt_attachment_id === ""
    ? null
    : requiredUuid(body.receipt_attachment_id, "receipt_attachment_id");
  return markInfoviSubmitted(deps.writer, actor(user, request), id, {
    externalRef,
    receiptAttachmentId: receipt,
  }, { now: deps.now });
}

export async function postCorrectInfovi(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const current = await assertFiling(deps, user, id, "regulatory.prepare");
  const body = await jsonBody(request);
  const reason = typeof body.reason === "string" ? body.reason : "";
  const successor = await correctInfovi(deps.writer, actor(user, request), current.id, {
    reason,
    createdBy: user.id,
  }, { now: deps.now });
  return { ...successor, successor_id: successor.id };
}

export async function postCancelInfovi(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  await assertFiling(deps, user, id, "regulatory.prepare");
  const body = await jsonBody(request);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 500) {
    throw domainError("WC_VALIDATION", { reason: "El motivo tiene que tener entre 3 y 500 caracteres." });
  }
  return cancelInfovi(deps.writer, actor(user, request), id, reason);
}

async function assertFiling(
  deps: RegulatoryDeps,
  user: UserCtx,
  id: string,
  permission: Permission,
): Promise<InfoviFilingView> {
  const view = await getInfoviFiling(deps.writer, id);
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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw domainError("WC_VALIDATION", { body: "El cuerpo no es un objeto" });
  }
  return body as Record<string, unknown>;
}

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw domainError("WC_VALIDATION", { [field]: "Identificador no válido" });
  }
  return value.toLowerCase();
}

function monthOf(value: string | null, now: Date): string {
  if (value === null || value === "") return shiftMonth(businessDate(now).slice(0, 7), -1);
  if (!MONTH.test(value)) throw domainError("WC_VALIDATION", { month: "El mes no es válido." });
  return value;
}

function boundsOf(month: string): { start: string; end: string } {
  try {
    return monthBounds(month);
  } catch {
    throw domainError("WC_VALIDATION", { month: "El mes no es válido." });
  }
}
