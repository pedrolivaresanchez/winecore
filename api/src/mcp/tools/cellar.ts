import { z } from "zod";

import { payloadSha256 } from "../../core/approvals/canonical";
import { sql } from "../../core/db/sql";
import { domainError } from "../../core/errors";
import { newId } from "../../core/ids";
import { businessDate } from "../../core/time";
import { getLot } from "../../core/cellar/service/lots";
import { getOperation, listOperations } from "../../core/cellar/service/operations";
import { listVessels } from "../../core/cellar/service/vessels";
import { defineReadTool, defineWriteTool, untrustedText } from "../registry";
import {
  actorOf,
  iso,
  litersFromMl,
  mlFromLiters,
  previewStale,
  requireWriter,
  text,
  webLink,
} from "../runtime";

const OP_TYPES = ["racking", "blend", "filtration", "addition", "bottling", "loss", "sampling"] as const;
const CONSERVED = new Set(["racking", "filtration", "blend"]);

const endpoint = z.object({
  lot_code: z.string().trim().min(2).max(30),
  vessel_code: z.string().trim().min(2).max(20).optional(),
  liters: z.string().optional(),
  units: z.number().int().positive().optional(),
});

const draftInput = z.object({
  op_type: z.enum(OP_TYPES),
  occurred_at: z.string().min(10).max(40).optional(),
  inputs: z.array(endpoint).max(20).default([]),
  outputs: z.array(endpoint.extend({
    lot_code: z.string().trim().min(2).max(30).optional(),
    sku: z.string().trim().max(40).optional(),
  })).max(20).default([]),
  losses: z.array(endpoint.extend({
    kind: z.enum(["authorized", "incident"]),
  })).max(20).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

interface ResolvedEnd {
  role: "input" | "output" | "loss";
  lot_id: string | null;
  lot_code: string | null;
  vessel_id: string | null;
  vessel_code: string | null;
  location_id: string | null;
  product_state: string;
  volume_ml: number;
  qty_units: number;
  loss_kind: "authorized" | "incident" | null;
  capacity_ml: number | null;
  volume_now_ml: number;
}

interface DraftPayload {
  op_type: (typeof OP_TYPES)[number];
  occurred_at: string;
  legal_entity_id: string;
  lines: ResolvedEnd[];
  fingerprint: string;
  incident: boolean;
}

function localRequest(path: string): Request {
  return new Request(`http://winecore.local${path}`);
}

export const cellarVesselsList = defineReadTool({
  name: "cellar_vessels_list",
  module: "cellar",
  scope: "cellar.read",
  title: "Recipientes",
  description: "Recipientes de bodega y su contenido.",
  input: z.object({
    kind: z.string().trim().max(40).optional(),
    zone: z.string().trim().max(40).optional(),
    only_with_content: z.boolean().optional(),
  }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const params = new URLSearchParams();
    params.set("limit", "100");
    if (input.kind) params.set("kind", input.kind);
    if (input.zone) params.set("zone", input.zone);
    const listed = await listVessels(writer, localRequest(`/v1/vessels?${params.toString()}`));
    const readings = await latestReadings(writer, listed.items.map((item) => item.id));
    const items = listed.items
      .filter((item) => !input.only_with_content || item.volume_ml > 0)
      .map((item) => {
        const reading = readings.get(item.id);
        return {
          code: item.code,
          name: item.name,
          kind: item.kind,
          capacity_liters: litersFromMl(item.capacity_ml),
          content: item.volume_ml > 0 || item.lot_code
            ? {
              lot_code: item.lot_code,
              state: item.product_state,
              liters: litersFromMl(item.volume_ml),
              fill_pct: item.fill_pct,
            }
            : null,
          last_reading: reading,
          status: item.status,
        };
      });
    const warnings: string[] = [];
    if (listed.total > listed.items.length) warnings.push("La lista está limitada a 100 recipientes.");
    return { items, warnings };
  },
});

export const cellarLotGet = defineReadTool({
  name: "cellar_lot_get",
  module: "cellar",
  scope: "cellar.read",
  title: "Lote",
  description: "Lote con ubicación, análisis, lecturas, adiciones y catas.",
  input: z.object({ lot_code: z.string().trim().min(2).max(30) }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const lot = await getLot(writer, localRequest("/v1/lots/x"), input.lot_code);
    const [readings, analyses, additions, tastings] = await Promise.all([
      writer.read<Record<string, unknown>>(sql`
        SELECT measured_at, CAST(density AS VARCHAR) AS density, CAST(temperature_c AS VARCHAR) AS temperature_c
        FROM cellar.fermentation_reading
        WHERE lot_id = CAST(${lot.id} AS UUID)
        ORDER BY measured_at
        LIMIT 100
      `),
      writer.read<Record<string, unknown>>(sql`
        SELECT id::VARCHAR AS id, kind, sampled_at, lab, notes
        FROM cellar.analysis
        WHERE lot_id = CAST(${lot.id} AS UUID)
        ORDER BY sampled_at DESC
        LIMIT 20
      `),
      writer.read<Record<string, unknown>>(sql`
        SELECT id::VARCHAR AS id, CAST(quantity AS VARCHAR) AS quantity, quantity_unit, purpose
        FROM cellar.addition
        WHERE lot_id = CAST(${lot.id} AS UUID)
        ORDER BY id
        LIMIT 20
      `),
      writer.read<Record<string, unknown>>(sql`
        SELECT tasted_at, coalesce(notes, '') AS notes, decision
        FROM tasting.note
        WHERE lot_id = CAST(${lot.id} AS UUID)
        ORDER BY tasted_at DESC
        LIMIT 20
      `),
    ]);
    return {
      lot: {
        id: lot.id,
        code: lot.code,
        kind: lot.kind,
        vintage: lot.vintage,
        status: lot.status,
        positions: lot.positions,
      },
      readings: readings.map((row) => ({
        at: iso(row.measured_at),
        density: text(row.density),
        temperature_c: text(row.temperature_c),
      })),
      analyses: analyses.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        sampled_at: iso(row.sampled_at),
        lab: String(row.lab),
        notes: text(row.notes) ? untrustedText(String(row.notes)) : null,
      })),
      additions: additions.map((row) => ({
        id: String(row.id),
        quantity: String(row.quantity),
        quantity_unit: String(row.quantity_unit),
        purpose: String(row.purpose),
      })),
      tastings: tastings.map((row) => ({
        at: iso(row.tasted_at),
        notes: untrustedText(String(row.notes)),
        decision: text(row.decision) ? untrustedText(String(row.decision)) : null,
      })),
      links: { web: webLink(ctx, `/bodega/lotes/${lot.code}`) },
      warnings: [] as string[],
    };
  },
});

export const cellarOperationsList = defineReadTool({
  name: "cellar_operations_list",
  module: "cellar",
  scope: "cellar.read",
  title: "Operaciones",
  description: "Operaciones de bodega, incluidas las que siguen en borrador.",
  input: z.object({
    op_type: z.enum(OP_TYPES).optional(),
    status: z.enum(["draft", "confirmed", "rectified", "discarded"]).optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const params = new URLSearchParams();
    params.set("limit", String(input.limit ?? 25));
    if (input.cursor) params.set("cursor", input.cursor);
    if (input.op_type) params.set("op_type", input.op_type);
    if (input.status) params.set("status", input.status);
    const listed = await listOperations(writer, localRequest(`/v1/cellar/operations?${params.toString()}`));
    return {
      items: listed.items.map((item) => ({
        id: item.id,
        number: item.number,
        op_type: item.op_type,
        status: item.status,
        occurred_at: item.occurred_at,
        link: webLink(ctx, `/bodega/operaciones/${item.id}`),
      })),
      next_cursor: listed.next_cursor,
      warnings: [] as string[],
    };
  },
});

export const cellarOperationGet = defineReadTool({
  name: "cellar_operation_get",
  module: "cellar",
  scope: "cellar.read",
  title: "Operación",
  description: "Detalle de una operación de bodega. El motivo se marca como texto no confiable.",
  input: z.object({ operation_id: z.uuid() }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const operation = await getOperation(writer, localRequest("/v1/cellar/operations/x"), input.operation_id);
    return {
      id: operation.id,
      number: operation.number,
      op_type: operation.op_type,
      status: operation.status,
      occurred_at: operation.occurred_at,
      reason: operation.reason ? untrustedText(operation.reason) : null,
      lines: operation.lines.map((line) => ({
        role: line.role,
        lot_id: line.lot_id,
        vessel_id: line.vessel_id,
        liters: litersFromMl(line.volume_ml),
        qty_units: line.qty_units,
        loss_kind: line.loss_kind,
        notes: line.notes ? untrustedText(line.notes) : null,
      })),
      links: { web: webLink(ctx, `/bodega/operaciones/${operation.id}`) },
      warnings: operation.status === "draft" ? ["Sigue en borrador: se confirma con cellar_operation_confirm o en la web."] : [],
    };
  },
});

export const cellarOperationDraft = defineWriteTool({
  name: "cellar_operation_draft",
  module: "cellar",
  scope: "cellar.operate",
  extraScopes: ["write:cellar.operation_draft"],
  title: "Borrador de operación",
  description: "Prepara un borrador de operación de bodega por códigos de lote y recipiente y litros. No mueve vino: se confirma después con cellar_operation_confirm o en la web.",
  input: draftInput,
  prepare: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const resolved = await resolveDraft(writer, input, ctx.now());
    checkDraft(resolved);
    const payload: DraftPayload = {
      op_type: input.op_type,
      occurred_at: resolved.occurredAt,
      legal_entity_id: resolved.legalEntityId,
      lines: resolved.lines,
      fingerprint: fingerprint(resolved.lines),
      incident: resolved.lines.some((line) => line.loss_kind === "incident"),
    };
    return {
      preview: {
        op_type: input.op_type,
        occurred_at: resolved.occurredAt,
        lines: resolved.lines.map((line) => ({
          role: line.role,
          lot_code: line.lot_code,
          vessel_code: line.vessel_code,
          liters: litersFromMl(line.volume_ml),
          qty_units: line.qty_units,
          loss_kind: line.loss_kind,
        })),
        confirms_on_web: true,
        approval_required: payload.incident,
      },
      payload,
      summary_es: payload.incident
        ? `Borrador de ${input.op_type}. Hay una merma por incidencia: se pedirá aprobación y no se confirma el movimiento.`
        : `Borrador de ${input.op_type}. El movimiento no se confirma: queda en borrador hasta confirmarlo.`,
    };
  },
  commit: async (ctx, raw) => {
    const writer = requireWriter(ctx);
    const payload = raw as DraftPayload;
    const fresh = await refreshFingerprint(writer, payload.lines);
    if (fresh !== payload.fingerprint) throw previewStale();
    checkDraft({ lines: payload.lines, opType: payload.op_type });
    const id = newId();
    const now = ctx.now();
    const fiscalDate = businessDate(new Date(payload.occurred_at));
    const storedLines = payload.lines
      .filter((line) => line.lot_id && (line.volume_ml > 0 || line.qty_units > 0))
      .map((line) => ({
        role: line.role,
        lot_id: line.lot_id,
        vessel_id: line.vessel_id,
        location_id: line.location_id,
        product_id: null,
        product_state: line.product_state,
        volume_ml: line.volume_ml,
        qty_units: line.qty_units,
        loss_kind: line.loss_kind,
        nominal_volume_ml: null,
        excise_product_key: null,
        nc_code: null,
      }));
    const details = {
      fiscal_date: fiscalDate,
      lines: storedLines,
      new_lot: null,
      addition: null,
      cleaning: null,
    };
    let approvalId: string | null = null;
    await writer.withWrite(actorOf(ctx, "borrador de operación"), async (tx) => {
      tx.write(sql`
        INSERT INTO cellar.operation (
          id, legal_entity_id, op_type, occurred_at, status, reason, details, performed_by, created_by, created_at
        ) VALUES (
          CAST(${id} AS UUID),
          CAST(${payload.legal_entity_id} AS UUID),
          ${payload.op_type},
          CAST(${payload.occurred_at} AS TIMESTAMPTZ),
          'draft',
          ${payload.incident ? "Merma por incidencia" : null},
          ${sql.json(details)},
          ${ctx.actor?.name?.slice(0, 80) || "mcp"},
          ${ctx.actor?.id ?? ctx.client.id},
          ${now}
        )
      `);
      tx.audit({
        table: "cellar.operation",
        rowId: id,
        action: "INSERT",
        before: null,
        after: { id, status: "draft", op_type: payload.op_type },
      });
      for (const line of storedLines) {
        if (!line.lot_id || !line.vessel_id || !line.location_id) continue;
        const lineId = newId();
        tx.write(sql`
          INSERT INTO cellar.operation_line (
            id, operation_id, role, lot_id, vessel_id, location_id, product_state,
            volume_ml, qty_units, mass_g, loss_kind
          ) VALUES (
            CAST(${lineId} AS UUID),
            CAST(${id} AS UUID),
            ${line.role},
            CAST(${line.lot_id} AS UUID),
            CAST(${line.vessel_id} AS UUID),
            CAST(${line.location_id} AS UUID),
            ${line.product_state},
            ${line.volume_ml},
            ${line.qty_units},
            0,
            ${line.loss_kind}
          )
        `);
      }
      if (payload.incident && ctx.actor) {
        approvalId = newId();
        const expires = new Date(now.getTime() + 72 * 60 * 60 * 1000);
        tx.write(sql`
          INSERT INTO ops.approval_request (
            id, kind, legal_entity_id, subject_table, subject_id, payload_sha256,
            summary, details, status, requested_by, requested_at, expires_at
          ) VALUES (
            CAST(${approvalId} AS UUID),
            'cellar_loss',
            CAST(${payload.legal_entity_id} AS UUID),
            'cellar.operation',
            CAST(${id} AS UUID),
            ${payloadSha256({ operation_id: id, op_type: payload.op_type })},
            ${"Merma por incidencia en borrador de bodega"},
            ${sql.json({ source: "mcp", operation_id: id })},
            'pending',
            ${ctx.actor.id},
            ${now},
            ${expires}
          )
        `);
        tx.write(sql`
          UPDATE cellar.operation
          SET approval_request_id = CAST(${approvalId} AS UUID)
          WHERE id = CAST(${id} AS UUID)
        `);
      }
    });
    return {
      operation_id: id,
      link: webLink(ctx, `/bodega/operaciones/${id}`),
      approval_id: approvalId,
      approval_link: approvalId ? webLink(ctx, `/aprobaciones/${approvalId}`) : null,
      status: "draft",
    };
  },
});

async function latestReadings(writer: ReturnType<typeof requireWriter>, vesselIds: readonly string[]) {
  const map = new Map<string, { at: string; density?: string; temperature_c?: string }>();
  for (const id of vesselIds) {
    const rows = await writer.read<Record<string, unknown>>(sql`
      SELECT measured_at, CAST(density AS VARCHAR) AS density, CAST(temperature_c AS VARCHAR) AS temperature_c
      FROM cellar.fermentation_reading
      WHERE vessel_id = CAST(${id} AS UUID)
      ORDER BY measured_at DESC
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) continue;
    const density = text(row.density);
    const temperature = text(row.temperature_c);
    map.set(id, {
      at: iso(row.measured_at),
      ...(density ? { density } : {}),
      ...(temperature ? { temperature_c: temperature } : {}),
    });
  }
  return map;
}

async function resolveDraft(
  writer: ReturnType<typeof requireWriter>,
  input: z.infer<typeof draftInput>,
  now: Date,
): Promise<{ occurredAt: string; legalEntityId: string; lines: ResolvedEnd[] }> {
  const lines: ResolvedEnd[] = [];
  const groups = [
    ...input.inputs.map((line) => ({ ...line, role: "input" as const, kind: null })),
    ...input.outputs.map((line) => ({ ...line, role: "output" as const, kind: null })),
    ...(input.losses ?? []).map((line) => ({ ...line, role: "loss" as const, kind: line.kind })),
  ];
  let legalEntityId: string | null = null;
  for (const line of groups) {
    const lot = line.lot_code ? await lotByCode(writer, line.lot_code) : null;
    const vessel = line.vessel_code ? await vesselByCode(writer, line.vessel_code) : null;
    if (lot && !legalEntityId) legalEntityId = lot.producer_entity_id;
    const volume = line.liters ? mlFromLiters(line.liters, "liters") : 0;
    const units = line.units ?? 0;
    if (volume === 0 && units === 0) {
      throw domainError("WC_VALIDATION", { liters: "Indica litros o unidades" });
    }
    lines.push({
      role: line.role,
      lot_id: lot?.id ?? null,
      lot_code: lot?.code ?? line.lot_code ?? null,
      vessel_id: vessel?.id ?? null,
      vessel_code: vessel?.code ?? line.vessel_code ?? null,
      location_id: vessel?.location_id ?? null,
      product_state: stateOf(lot?.kind ?? "wine"),
      volume_ml: volume,
      qty_units: units,
      loss_kind: line.role === "loss" ? line.kind : null,
      capacity_ml: vessel?.capacity_ml ?? null,
      volume_now_ml: vessel?.volume_ml ?? 0,
    });
  }
  if (!legalEntityId) {
    const rows = await writer.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = 'CVPO'
    `);
    legalEntityId = rows[0]?.id ?? null;
  }
  if (!legalEntityId) throw domainError("WC_VALIDATION", { legal_entity: "No hay entidad" });
  return { occurredAt: input.occurred_at ?? now.toISOString(), legalEntityId, lines };
}

function checkDraft(resolved: { lines: readonly ResolvedEnd[]; opType?: string }): void {
  for (const line of resolved.lines) {
    if (line.role === "output" && line.vessel_id && line.capacity_ml !== null) {
      const next = line.volume_now_ml + line.volume_ml;
      if (next > line.capacity_ml) throw domainError("WC025");
    }
    if (line.role === "input" && line.vessel_id && line.volume_ml > line.volume_now_ml) {
      throw domainError("WC024");
    }
  }
  if (resolved.opType && CONSERVED.has(resolved.opType)) {
    const inputMl = sum(resolved.lines.filter((line) => line.role === "input"));
    const outputMl = sum(resolved.lines.filter((line) => line.role === "output"));
    const lossMl = sum(resolved.lines.filter((line) => line.role === "loss"));
    if (inputMl !== outputMl + lossMl) throw domainError("WC020");
  }
}

function sum(lines: readonly ResolvedEnd[]): number {
  return lines.reduce((total, line) => total + line.volume_ml, 0);
}

function fingerprint(lines: readonly ResolvedEnd[]): string {
  return lines
    .map((line) => `${line.vessel_id ?? ""}:${line.volume_now_ml}:${line.capacity_ml ?? ""}`)
    .join("|");
}

async function refreshFingerprint(writer: ReturnType<typeof requireWriter>, lines: readonly ResolvedEnd[]): Promise<string> {
  const fresh: ResolvedEnd[] = [];
  for (const line of lines) {
    const vessel = line.vessel_code ? await vesselByCode(writer, line.vessel_code) : null;
    fresh.push({
      ...line,
      volume_now_ml: vessel?.volume_ml ?? line.volume_now_ml,
      capacity_ml: vessel?.capacity_ml ?? line.capacity_ml,
    });
  }
  return fingerprint(fresh);
}

function stateOf(kind: string): string {
  if (kind === "grape" || kind === "must" || kind === "wine") return kind;
  if (kind === "bottled") return "packaged_labeled";
  return "wine";
}

async function lotByCode(writer: ReturnType<typeof requireWriter>, code: string) {
  const rows = await writer.read<{ id: string; code: string; kind: string; producer_entity_id: string }>(sql`
    SELECT id::VARCHAR AS id, code, kind, producer_entity_id::VARCHAR AS producer_entity_id
    FROM inventory.lot
    WHERE code = ${code} AND status = 'active'
    LIMIT 2
  `);
  if (rows.length === 0) throw domainError("WC_VALIDATION", { lot_code: "No existe" });
  if (rows.length > 1) throw domainError("WC_VALIDATION", { lot_code: "Hay varios lotes con este código" });
  return rows[0] ?? null;
}

async function vesselByCode(writer: ReturnType<typeof requireWriter>, code: string) {
  const rows = await writer.read<{ id: string; code: string; capacity_ml: number; location_id: string; status: string }>(sql`
    SELECT id::VARCHAR AS id, code, capacity_ml, location_id::VARCHAR AS location_id, status
    FROM cellar.vessel
    WHERE code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError("WC_VALIDATION", { vessel_code: "No existe" });
  if (row.status !== "in_service") throw domainError("WC_VESSEL_NOT_IN_SERVICE");
  const volume = await writer.read<{ volume_ml: string }>(sql`
    SELECT COALESCE(SUM(volume_ml), 0)::VARCHAR AS volume_ml
    FROM inventory.stock_move
    WHERE vessel_id = CAST(${row.id} AS UUID)
  `);
  return {
    id: row.id,
    code: row.code,
    capacity_ml: Number(row.capacity_ml),
    location_id: row.location_id,
    volume_ml: Number(volume[0]?.volume_ml ?? 0),
  };
}
