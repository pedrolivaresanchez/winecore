import { sql } from "../../db/sql";
import type { Tx } from "../../db/writer";
import { domainError } from "../../errors";
import { businessDate, isBusinessDate, isInstant } from "../../inventory/periods";
import type {
  BuildSheetInput,
  InfoviEdge,
  InfoviGauge,
  InfoviLot,
  InfoviMove,
  InfoviOperation,
  InfoviWine,
} from "./sheet";

const STOCK_STATES = new Set(["must", "wine", "packaged_unlabeled", "packaged_labeled"]);

export async function loadSheetInput(
  tx: Tx,
  input: {
    legalEntityId: string;
    taxWarehouseId: string;
    installationName: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
  },
): Promise<BuildSheetInput> {
  const locations = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id
    FROM inventory.location
    WHERE tax_warehouse_id = CAST(${input.taxWarehouseId} AS UUID)
  `);
  const inside = new Set(locations.map((row) => String(row.id).toLowerCase()));
  const moveRows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, occurred_at::VARCHAR AS occurred_at, location_id::VARCHAR AS location_id,
           lot_id::VARCHAR AS lot_id, product_state, volume_ml, mass_g, qty_units, move_type,
           source_table, source_id::VARCHAR AS source_id
    FROM inventory.stock_move
    WHERE owner_entity_id = CAST(${input.legalEntityId} AS UUID)
  `);
  const lotRows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, wine_id::VARCHAR AS wine_id, code
    FROM inventory.lot
    WHERE producer_entity_id = CAST(${input.legalEntityId} AS UUID)
  `);
  const wineRows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name, color, category FROM catalog.wine
  `);
  const operationRows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, op_type, status, occurred_at::VARCHAR AS occurred_at, details::VARCHAR AS details
    FROM cellar.operation
    WHERE legal_entity_id = CAST(${input.legalEntityId} AS UUID)
      AND status IN ('draft', 'confirmed')
      AND op_type <> 'cleaning'
  `);
  const lineRows = await tx.read<Record<string, unknown>>(sql`
    SELECT l.operation_id::VARCHAR AS operation_id, l.role, l.lot_id::VARCHAR AS lot_id,
           l.product_state, l.volume_ml, l.mass_g
    FROM cellar.operation_line l
    JOIN cellar.operation o ON o.id = l.operation_id
    WHERE o.legal_entity_id = CAST(${input.legalEntityId} AS UUID)
  `);
  const intakeRows = await tx.read<{ id: string }>(sql`
    SELECT g.operation_id::VARCHAR AS id
    FROM cellar.grape_intake g
    JOIN cellar.operation o ON o.id = g.operation_id
    WHERE o.legal_entity_id = CAST(${input.legalEntityId} AS UUID)
  `);
  const edgeRows = await tx.read<Record<string, unknown>>(sql`
    SELECT e.child_lot_id::VARCHAR AS child_lot_id, e.parent_lot_id::VARCHAR AS parent_lot_id
    FROM inventory.lot_edge e
    JOIN inventory.lot c ON c.id = e.child_lot_id
    WHERE c.producer_entity_id = CAST(${input.legalEntityId} AS UUID)
  `);
  const gaugeRows = await tx.read<Record<string, unknown>>(sql`
    SELECT c.id::VARCHAR AS id, c.counted_at::VARCHAR AS counted_at,
           l.location_id::VARCHAR AS location_id, l.product_state,
           l.counted_volume_ml, l.expected_volume_ml
    FROM inventory.inventory_count c
    JOIN inventory.inventory_count_line l ON l.count_id = c.id
    WHERE c.legal_entity_id = CAST(${input.legalEntityId} AS UUID)
      AND c.status IN ('approved', 'posted')
  `);

  const intakes = new Set(intakeRows.map((row) => String(row.id).toLowerCase()));
  const lines = new Map<string, { lotIds: Set<string>; inputMl: number; outputMl: number }>();
  for (const row of lineRows) {
    const operationId = String(row.operation_id).toLowerCase();
    const current = lines.get(operationId) ?? { lotIds: new Set<string>(), inputMl: 0, outputMl: 0 };
    const lotId = textOrNull(row.lot_id);
    if (lotId) current.lotIds.add(lotId.toLowerCase());
    const volume = intOf(row.volume_ml);
    if (row.role === "input") current.inputMl += volume;
    if (row.role === "output") current.outputMl += volume;
    lines.set(operationId, current);
  }

  const operations: InfoviOperation[] = operationRows.map((row) => {
    const id = String(row.id).toLowerCase();
    const details = asRecord(row.details);
    const ticket = ticketOf(details);
    const aggregated = lines.get(id) ?? { lotIds: new Set<string>(), inputMl: 0, outputMl: 0 };
    const lotIds = new Set(aggregated.lotIds);
    if (ticket?.lotId) lotIds.add(ticket.lotId.toLowerCase());
    return {
      id,
      opType: String(row.op_type),
      status: String(row.status),
      day: civilDay(String(row.occurred_at)),
      varietyCode: ticket?.variety ?? null,
      netG: ticket?.netG ?? null,
      parcelCodes: ticket?.parcels ?? [],
      sourceKind: ticket?.sourceKind ?? null,
      hasIntake: intakes.has(id),
      lotIds: [...lotIds],
      inputMl: aggregated.inputMl,
      outputMl: aggregated.outputMl,
    };
  });

  const moves: InfoviMove[] = moveRows.map((row) => {
    const locationId = String(row.location_id).toLowerCase();
    return {
      id: String(row.id).toLowerCase(),
      day: civilDay(String(row.occurred_at)),
      inInstallation: inside.has(locationId),
      lotId: textOrNull(row.lot_id)?.toLowerCase() ?? null,
      productState: String(row.product_state),
      volumeMl: intOf(row.volume_ml),
      massG: intOf(row.mass_g),
      qtyUnits: intOf(row.qty_units),
      moveType: String(row.move_type),
      sourceTable: String(row.source_table),
      sourceId: String(row.source_id).toLowerCase(),
    };
  });

  const lots: InfoviLot[] = lotRows.map((row) => ({
    id: String(row.id).toLowerCase(),
    wineId: textOrNull(row.wine_id)?.toLowerCase() ?? null,
    code: String(row.code),
  }));
  const wines: InfoviWine[] = wineRows.map((row) => ({
    id: String(row.id).toLowerCase(),
    code: String(row.code),
    name: String(row.name),
    color: String(row.color),
    category: String(row.category),
  }));
  const edges: InfoviEdge[] = edgeRows.map((row) => ({
    childLotId: String(row.child_lot_id).toLowerCase(),
    parentLotId: String(row.parent_lot_id).toLowerCase(),
  }));

  return {
    installationId: input.taxWarehouseId.toLowerCase(),
    installationName: input.installationName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dueDate: input.dueDate,
    moves,
    lots,
    wines,
    operations,
    edges,
    gauges: gaugesOf(gaugeRows, inside),
  };
}

function gaugesOf(rows: readonly Record<string, unknown>[], inside: ReadonlySet<string>): InfoviGauge[] {
  const totals = new Map<string, { day: string; volumeMl: number }>();
  for (const row of rows) {
    const locationId = String(row.location_id).toLowerCase();
    if (!inside.has(locationId)) continue;
    if (!STOCK_STATES.has(String(row.product_state))) continue;
    const counted = row.counted_volume_ml == null ? null : intOf(row.counted_volume_ml);
    const volume = counted ?? intOf(row.expected_volume_ml);
    const id = String(row.id).toLowerCase();
    const current = totals.get(id) ?? { day: civilDay(String(row.counted_at)), volumeMl: 0 };
    current.volumeMl += volume;
    totals.set(id, current);
  }
  return [...totals.values()];
}

function ticketOf(details: Record<string, unknown>): {
  variety: string | null;
  netG: number | null;
  parcels: string[];
  sourceKind: "parcels" | "grower" | null;
  lotId: string | null;
} | null {
  const raw = details.grape_reception;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const ticket = raw as Record<string, unknown>;
  const source = asRecord(ticket.source);
  const parcels: string[] = [];
  if (Array.isArray(source.lines)) {
    for (const line of source.lines) {
      const row = asRecord(line);
      if (typeof row.parcel_code === "string" && row.parcel_code.trim() !== "") parcels.push(row.parcel_code.trim());
    }
  }
  const kind = source.kind === "parcels" || source.kind === "grower" ? source.kind : null;
  return {
    variety: typeof ticket.variety_code === "string" && ticket.variety_code !== "" ? ticket.variety_code : null,
    netG: ticket.net_g == null || ticket.net_g === "" ? null : intOf(ticket.net_g),
    parcels,
    sourceKind: kind,
    lotId: typeof ticket.lot_id === "string" ? ticket.lot_id : null,
  };
}

export function civilDay(value: string): string {
  const text = value.trim();
  if (isBusinessDate(text)) return text;
  let normalized = text.includes("T") ? text : text.replace(" ", "T");
  if (/[+-]\d{4}$/.test(normalized)) normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (/[+-]\d{2}$/.test(normalized)) normalized = `${normalized}:00`;
  if (isInstant(normalized)) return businessDate(normalized);
  if (isBusinessDate(text.slice(0, 10))) return text.slice(0, 10);
  throw domainError("WC_VALIDATION", { occurred_at: "La fecha del movimiento no es válida." });
}

function intOf(value: unknown): number {
  if (typeof value === "bigint") {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw domainError("WC_VALIDATION", { quantity: "Cantidad fuera de rango" });
    return number;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw domainError("WC_VALIDATION", { quantity: "Cantidad no entera" });
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw domainError("WC_VALIDATION", { quantity: "Cantidad fuera de rango" });
    return number;
  }
  throw domainError("WC_VALIDATION", { quantity: "Cantidad no entera" });
}

function textOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
