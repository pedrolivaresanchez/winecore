import { requestIdFor, sessionOf } from "../auth/guard";
import { can } from "../core/auth/permissions";
import { domainError } from "../core/errors";
import { listObligations, loadHolidayCalendar, refreshRegulatoryCalendar, syncInfoviObligations, syncSilicieObligations } from "../core/regulatory/obligations";
import { warehousesByEntity } from "../core/regulatory/warehouses";
import { businessDate } from "../core/time";
import type { RegulatoryDeps } from "./regulatory-submissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listRegulatoryObligations(deps: RegulatoryDeps, request: Request) {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const entity = optionalUuid(url.searchParams.get("entity") ?? url.searchParams.get("legal_entity_id"));
  const flow = url.searchParams.get("flow") ?? undefined;
  const from = optionalDate(url.searchParams.get("from"));
  const to = optionalDate(url.searchParams.get("to"));
  if (entity && !can(user, "regulatory.read", entity)) throw domainError("WC_FORBIDDEN");
  const items = await listObligations(deps.writer.read.bind(deps.writer), {
    legalEntityId: entity,
    flow,
    from,
    to,
  });
  const byEntity = await warehousesByEntity(deps.writer);
  return {
    items: items
      .filter((item) => can(user, "regulatory.read", item.legal_entity_id))
      .map((item) => {
        const warehouses = byEntity.get(item.legal_entity_id.toLowerCase()) ?? [];
        const taxWarehouse = warehouses.length === 1 ? warehouses[0] ?? null : null;
        return {
          ...item,
          display: displayOf(item.status, item.due_date, deps.now()),
          tax_warehouse_id: taxWarehouse?.id ?? null,
          tax_warehouse: taxWarehouse,
          tax_warehouses: warehouses,
        };
      }),
  };
}

export async function postSyncObligations(deps: RegulatoryDeps, request: Request) {
  const user = sessionOf(request);
  if (!can(user, "regulatory.prepare")) throw domainError("WC_FORBIDDEN");
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const entityId = typeof body.legal_entity_id === "string" ? body.legal_entity_id : "";
  const year = typeof body.year === "number" ? body.year : null;
  if (entityId !== "" && year !== null) {
    if (!UUID.test(entityId)) throw domainError("WC_VALIDATION", { legal_entity_id: "Identificador no válido" });
    if (!can(user, "regulatory.prepare", entityId)) throw domainError("WC_FORBIDDEN");
    let inserted = 0;
    await deps.writer.withWrite({
      type: "user",
      id: user.id,
      requestId: requestIdFor(request),
    }, async (tx) => {
      const calendar = await loadHolidayCalendar(tx.read.bind(tx), year);
      inserted = await syncSilicieObligations(tx, entityId, year, calendar);
      inserted += await syncInfoviObligations(tx, entityId, year, calendar);
    });
    return { inserted };
  }
  return refreshRegulatoryCalendar(deps.writer, deps.now());
}

function displayOf(status: string, dueDate: string, now: Date): string {
  const today = businessDate(now);
  if (status === "done") return "presentado";
  if (dueDate < today) return "vencido";
  if (status === "in_progress") return "preparado";
  return "pendiente";
}

function optionalUuid(value: string | null): string | undefined {
  if (value === null || value === "") return undefined;
  if (!UUID.test(value)) throw domainError("WC_VALIDATION", { entity: "Identificador no válido" });
  return value.toLowerCase();
}

function optionalDate(value: string | null): string | undefined {
  if (value === null || value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw domainError("WC_VALIDATION", { date: "Fecha no válida" });
  return value;
}
