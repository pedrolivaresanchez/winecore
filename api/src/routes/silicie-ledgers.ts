import { requestIdFor, sessionOf } from "../auth/guard";
import { can } from "../core/auth/permissions";
import { sql } from "../core/db/sql";
import { domainError } from "../core/errors";
import { openSilicieExercise, warehouseEntityId } from "../core/regulatory/exercises";
import { createLedger, listLedgerRows, validateLedger } from "../core/regulatory/silicie/ledger-store";
import type { LedgerProductClass, LedgerSituation, WineColor } from "../core/regulatory/silicie/types";
import type { RegulatoryDeps } from "./regulatory-submissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLASSES = new Set(["raw_grape", "raw_must", "bulk", "bulk_wood", "packaged", "byproduct"]);
const COLORS = new Set(["tinto", "blanco", "rosado"]);

export async function listSilicieLedgers(deps: RegulatoryDeps, request: Request) {
  const user = sessionOf(request);
  if (!can(user, "regulatory.read")) throw domainError("WC_FORBIDDEN");
  const warehouse = new URL(request.url).searchParams.get("tax_warehouse_id") ?? "";
  if (!UUID.test(warehouse)) throw domainError("WC_VALIDATION", { tax_warehouse_id: "Identificador no válido" });
  const entity = await entityOfWarehouse(deps, warehouse);
  if (!can(user, "regulatory.read", entity)) throw domainError("WC_FORBIDDEN");
  const items = await listLedgerRows(deps.writer.read.bind(deps.writer), warehouse);
  return { items };
}

export async function postSilicieLedger(deps: RegulatoryDeps, request: Request) {
  const user = sessionOf(request);
  const body = asRecord(await request.json().catch(() => {
    throw domainError("WC_VALIDATION", { body: "El cuerpo no es JSON" });
  }));
  const taxWarehouseId = requiredUuid(body.tax_warehouse_id);
  const entity = await entityOfWarehouse(deps, taxWarehouseId);
  if (!can(user, "regulatory.prepare", entity)) throw domainError("WC_FORBIDDEN");
  const situation = situationOf(body);
  const ncCode = typeof body.nc_code === "string" && body.nc_code !== "" ? body.nc_code : undefined;
  const ledger = await deps.writer.withWrite({
    type: "user",
    id: user.id,
    requestId: requestIdFor(request),
  }, (tx) => createLedger(tx, {
    taxWarehouseId,
    situation,
    ncCode,
    createdAt: deps.now().toISOString(),
  }));
  return ledger;
}

export async function postOpenExercise(deps: RegulatoryDeps, request: Request) {
  const user = sessionOf(request);
  const body = asRecord(await request.json().catch(() => {
    throw domainError("WC_VALIDATION", { body: "El cuerpo no es JSON" });
  }));
  const taxWarehouseId = typeof body.tax_warehouse_id === "string" ? body.tax_warehouse_id.toLowerCase() : "";
  if (!UUID.test(taxWarehouseId)) throw domainError("WC_VALIDATION", { tax_warehouse_id: "Identificador no válido" });
  const year = yearOf(body.year);
  const entityId = await warehouseEntityId(deps.writer, taxWarehouseId);
  if (!entityId) throw domainError("WC_NOT_FOUND");
  if (!canOpenExercise(user, entityId)) throw domainError("WC_FORBIDDEN");
  return openSilicieExercise(deps.writer, {
    type: "user",
    id: user.id,
    requestId: requestIdFor(request),
    reason: "apertura de ejercicio SILICIE",
  }, { taxWarehouseId, year });
}

function canOpenExercise(user: { roles: { role: string; legalEntityId: string | null }[] }, entityId: string): boolean {
  return user.roles.some((role) =>
    (role.role === "owner" || role.role === "advisor")
    && (role.legalEntityId === null || role.legalEntityId.toLowerCase() === entityId),
  );
}

function yearOf(value: unknown): number {
  const year = typeof value === "number" ? value : typeof value === "string" && /^\d{4}$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(year)) throw domainError("WC_VALIDATION", { year: "El ejercicio es un año" });
  return year;
}

export async function postValidateLedger(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const advisor = user.roles.some((role) => role.role === "advisor" || role.role === "owner");
  if (!advisor && !can(user, "regulatory.prepare")) throw domainError("WC_FORBIDDEN");
  const body = asRecord(await request.json().catch(() => {
    throw domainError("WC_VALIDATION", { body: "El cuerpo no es JSON" });
  }));
  const advisorRef = typeof body.advisor_ref === "string" ? body.advisor_ref.trim() : "";
  await deps.writer.withWrite({
    type: "user",
    id: user.id,
    requestId: requestIdFor(request),
  }, (tx) => validateLedger(tx, id, advisorRef));
  return { id, validated_by: advisorRef };
}

async function entityOfWarehouse(deps: RegulatoryDeps, id: string): Promise<string> {
  const rows = await deps.writer.read<{ legal_entity_id: string }>(sql`
    SELECT legal_entity_id::VARCHAR AS legal_entity_id
    FROM inventory.tax_warehouse
    WHERE id = CAST(${id} AS UUID)
  `);
  const entity = rows[0]?.legal_entity_id;
  if (!entity) throw domainError("WC_NOT_FOUND");
  return entity;
}

function situationOf(body: Record<string, unknown>): LedgerSituation {
  const productClass = body.product_class;
  if (typeof productClass !== "string" || !CLASSES.has(productClass)) {
    throw domainError("WC_VALIDATION", { product_class: "Clase de mayor no válida" });
  }
  const situation: LedgerSituation = { productClass: productClass as LedgerProductClass };
  if (typeof body.color === "string") {
    if (!COLORS.has(body.color)) throw domainError("WC_VALIDATION", { color: "Color no válido" });
    situation.color = body.color as WineColor;
  }
  if (typeof body.wine_code === "string") situation.wineCode = body.wine_code;
  if (typeof body.brand === "string") situation.brand = body.brand;
  if (body.container_kind === "bottle" || body.container_kind === "bib") situation.containerKind = body.container_kind;
  if (typeof body.container_capacity_ml === "number") situation.containerCapacityMl = body.container_capacity_ml;
  return situation;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw domainError("WC_VALIDATION", { body: "El cuerpo no es un objeto" });
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw domainError("WC_VALIDATION", { tax_warehouse_id: "Identificador no válido" });
  }
  return value.toLowerCase();
}
