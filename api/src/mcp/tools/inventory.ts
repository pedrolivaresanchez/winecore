import { z } from "zod";

import { sql } from "../../core/db/sql";
import { domainError } from "../../core/errors";
import {
  listBalances,
  listFiscalBalances,
  listMoves,
  type BalanceQuery,
  type FiscalQuery,
  type MoveQuery,
} from "../../core/inventory/service/stock.service";
import type { ProductState } from "../../core/inventory/types";
import { defineReadTool } from "../registry";
import { iso, litersFromMl, requireWriter, text, webLink } from "../runtime";

const STATES = ["grape", "must", "wine", "packaged_unlabeled", "packaged_labeled", "goods"] as const;

const stockInput = z.object({
  at: z.string().min(10).max(40).optional(),
  location: z.string().trim().max(40).optional(),
  vessel: z.string().trim().max(40).optional(),
  lot_code: z.string().trim().max(40).optional(),
  sku: z.string().trim().max(40).optional(),
  state: z.enum(STATES).optional(),
  owner: z.enum(["PO", "CVPO"]).optional(),
});

export const inventoryStockAt = defineReadTool({
  name: "inventory_stock_at",
  module: "inventory",
  scope: "inventory.read",
  title: "Stock a una fecha",
  description: "Saldos físicos para inspección. No avisa a nadie.",
  input: stockInput,
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const at = input.at ?? ctx.now().toISOString();
    const locationId = await resolveCode(writer, "inventory.location", input.location ?? null, "location");
    const vesselId = await resolveCode(writer, "cellar.vessel", input.vessel ?? null, "vessel");
    const lotId = await resolveCode(writer, "inventory.lot", input.lot_code ?? null, "lot_code");
    const productId = input.sku ? await productIdOf(writer, input.sku) : null;
    const query: BalanceQuery = {
      at,
      locationId,
      vesselId,
      owner: input.owner ?? null,
      productId,
      lotId,
      state: (input.state ?? null) as ProductState | null,
      limit: 100,
      cursor: null,
    };
    const page = await listBalances(writer, query);
    const names = await namesFor(writer, page.items);
    const rows = page.items.map((row) => ({
      location: names.location.get(row.location_id ?? "") ?? "",
      vessel: names.vessel.get(row.vessel_id ?? "") ?? undefined,
      owner: names.owner.get(row.owner_entity_id ?? "") ?? "",
      lot_code: names.lot.get(row.lot_id ?? "") ?? undefined,
      sku: names.sku.get(row.product_id ?? "") ?? undefined,
      state: row.product_state,
      qty_units: row.qty_units,
      liters: litersFromMl(row.volume_ml),
    }));
    let bulkMl = 0;
    let packagedUnits = 0;
    let packagedMl = 0;
    for (const row of page.items) {
      const packaged = row.product_state === "packaged_labeled" || row.product_state === "packaged_unlabeled";
      if (packaged) {
        packagedUnits += row.qty_units;
        packagedMl += row.volume_ml;
      } else {
        bulkMl += row.volume_ml;
      }
    }
    const warnings: string[] = [];
    if (page.notice) warnings.push(page.notice);
    if (page.next_cursor) warnings.push("Hay más filas; acota la consulta.");
    return {
      at: page.at,
      rows,
      totals: {
        bulk_liters: litersFromMl(bulkMl),
        packaged_units: packagedUnits,
        packaged_liters: litersFromMl(packagedMl),
      },
      warnings,
      links: { web: webLink(ctx, "/existencias") },
    };
  },
});

export const inventoryMovementsList = defineReadTool({
  name: "inventory_movements_list",
  module: "inventory",
  scope: "inventory.read",
  title: "Movimientos",
  description: "Movimientos del libro físico o fiscal.",
  input: z.object({
    ledger: z.enum(["physical", "fiscal"]),
    from: z.string().optional(),
    to: z.string().optional(),
    lot_code: z.string().trim().max(40).optional(),
    sku: z.string().trim().max(40).optional(),
    location: z.string().trim().max(40).optional(),
    cursor: z.string().min(1).max(300).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const lotId = await resolveCode(writer, "inventory.lot", input.lot_code ?? null, "lot_code");
    const productId = input.sku ? await productIdOf(writer, input.sku) : null;
    const locationId = input.ledger === "physical"
      ? await resolveCode(writer, "inventory.location", input.location ?? null, "location")
      : null;
    const query: MoveQuery = {
      book: input.ledger,
      from: input.from ?? null,
      to: input.to ?? null,
      moveType: null,
      lotId,
      productId,
      locationId,
      vesselId: null,
      owner: null,
      sourceId: null,
      sourceTable: null,
      silicieEntryId: null,
      limit: input.limit ?? 25,
      cursor: input.cursor ?? null,
    };
    const page = await listMoves(writer, query);
    return {
      items: page.items.map((row) => ({
        id: String(row.id),
        ledger: input.ledger,
        at: input.ledger === "physical" ? iso(row.occurred_at) : String(row.fiscal_date).slice(0, 10),
        move_type: String(row.move_type),
        liters: litersFromMl(Number(row.volume_ml ?? 0)),
        qty_units: Number(row.qty_units ?? row.units ?? 0),
        document: {
          type: String(row.source_table ?? ""),
          id: text(row.source_id),
        },
        link: webLink(ctx, `/existencias/movimientos/${String(row.id)}`),
      })),
      next_cursor: page.next_cursor,
      warnings: [] as string[],
    };
  },
});

export const inventoryReconcile = defineReadTool({
  name: "inventory_reconcile_physical_fiscal",
  module: "inventory",
  scope: "inventory.read",
  title: "Cuadre físico y fiscal",
  description: "Compara el saldo físico con el fiscal a una fecha. No guarda el informe.",
  input: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    persist: z.literal(false).optional(),
  }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const at = `${input.to}T23:59:59.000Z`;
    const physical = await listBalances(writer, {
      at,
      locationId: null,
      vesselId: null,
      owner: null,
      productId: null,
      lotId: null,
      state: null,
      limit: 100,
      cursor: null,
    });
    const fiscal: FiscalQuery = {
      at,
      taxWarehouseId: null,
      productId: null,
      lotId: null,
      limit: 100,
      cursor: null,
    };
    const fiscalPage = await listFiscalBalances(writer, fiscal);
    const physicalMl = physical.items.reduce((sum, row) => sum + row.volume_ml, 0);
    const fiscalMl = fiscalPage.items.reduce((sum, row) => sum + row.volume_ml, 0);
    const difference = physicalMl - fiscalMl;
    const balanced = difference === 0 && !physical.next_cursor && !fiscalPage.next_cursor;
    const warnings: string[] = [];
    if (physical.notice) warnings.push(physical.notice);
    if (physical.next_cursor || fiscalPage.next_cursor) warnings.push("El cuadre está truncado a 100 filas.");
    const moves = await listMoves(writer, {
      book: "physical",
      from: input.from,
      to: input.to,
      moveType: null,
      lotId: null,
      productId: null,
      locationId: null,
      vesselId: null,
      owner: null,
      sourceId: null,
      sourceTable: null,
      silicieEntryId: null,
      limit: 20,
      cursor: null,
    });
    return {
      balanced,
      differences: balanced ? [] : [{
        physical_liters: litersFromMl(physicalMl),
        fiscal_liters: litersFromMl(fiscalMl),
        difference_liters: litersFromMl(difference),
        explanation: `A ${input.to} el físico y el fiscal no coinciden en volumen (desde ${input.from}).`,
        documents: moves.items.slice(0, 10).map((row) => ({
          type: String(row.source_table ?? row.move_type),
          number: text(row.id) ?? "",
          date: iso(row.occurred_at).slice(0, 10),
          link: webLink(ctx, `/existencias/movimientos/${String(row.id)}`),
        })),
      }],
      warnings,
    };
  },
});

async function resolveCode(
  writer: ReturnType<typeof requireWriter>,
  table: "inventory.location" | "cellar.vessel" | "inventory.lot",
  code: string | null,
  field: string,
): Promise<string | null> {
  if (!code) return null;
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM ${sql.raw(table)} WHERE code = ${code} LIMIT 2
  `);
  if (rows.length === 0) throw domainError("WC_VALIDATION", { [field]: "No existe" });
  if (rows.length > 1) throw domainError("WC_VALIDATION", { [field]: "Hay varios con este código" });
  return rows[0]?.id ?? null;
}

async function productIdOf(writer: ReturnType<typeof requireWriter>, sku: string): Promise<string> {
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM catalog.product WHERE sku = ${sku}
  `);
  const id = rows[0]?.id;
  if (!id) throw domainError("WC_VALIDATION", { sku: "No existe" });
  return id;
}

async function namesFor(writer: ReturnType<typeof requireWriter>, rows: readonly { location_id: string | null; vessel_id: string | null; owner_entity_id: string | null; lot_id: string | null; product_id: string | null }[]) {
  return {
    location: await codeMap(writer, "inventory.location", rows.map((row) => row.location_id)),
    vessel: await codeMap(writer, "cellar.vessel", rows.map((row) => row.vessel_id)),
    owner: await codeMap(writer, "core.legal_entity", rows.map((row) => row.owner_entity_id)),
    lot: await codeMap(writer, "inventory.lot", rows.map((row) => row.lot_id)),
    sku: await skuMap(writer, rows.map((row) => row.product_id)),
  };
}

async function codeMap(
  writer: ReturnType<typeof requireWriter>,
  table: "inventory.location" | "cellar.vessel" | "inventory.lot" | "core.legal_entity",
  ids: readonly (string | null)[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const id of [...new Set(ids.filter((id): id is string => Boolean(id)))]) {
    const rows = await writer.read<{ code: string }>(sql`
      SELECT code FROM ${sql.raw(table)} WHERE id = CAST(${id} AS UUID)
    `);
    const code = rows[0]?.code;
    if (code) map.set(id, code);
  }
  return map;
}

async function skuMap(writer: ReturnType<typeof requireWriter>, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const id of [...new Set(ids.filter((id): id is string => Boolean(id)))]) {
    const rows = await writer.read<{ sku: string }>(sql`
      SELECT sku FROM catalog.product WHERE id = CAST(${id} AS UUID)
    `);
    const sku = rows[0]?.sku;
    if (sku) map.set(id, sku);
  }
  return map;
}
