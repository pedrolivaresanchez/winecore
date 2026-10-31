import { z } from "zod";

import { APPROVAL_KINDS } from "../../core/approvals/types";
import { sql } from "../../core/db/sql";
import { domainError } from "../../core/errors";
import { defineReadTool } from "../registry";
import { iso, requireWriter, webLink } from "../runtime";

const INBOX_ROLES = new Set(["owner", "approver"]);

export const approvalsGetLink = defineReadTool({
  name: "approvals_get_link",
  module: "system",
  scope: "*.read",
  title: "Enlace a la bandeja",
  description: "Enlace a una solicitud en la bandeja de aprobaciones. No aprueba ni rechaza.",
  input: z.object({
    approval_id: z.uuid(),
  }),
  handler: async (ctx, input) => {
    if (ctx.deps.writer) {
      const row = await findRequest(ctx.deps.writer, input.approval_id);
      if (!row || !canSee(ctx.actor?.id ?? null, ctx.actor?.roles ?? [], row.requested_by)) {
        throw domainError("WC_VALIDATION", { approval_id: "No encontrada" }, "No existe esa solicitud de aprobación.");
      }
      return {
        link: webLink(ctx, `/aprobaciones/${row.id}`),
        status: row.status,
        summary: row.summary,
      };
    }
    if (!ctx.deps.approvals) {
      throw domainError("WC002", undefined, "Falta el origen de aprobaciones.");
    }
    const view = await ctx.deps.approvals.get(input.approval_id);
    if (!view) {
      throw domainError("WC_VALIDATION", { approval_id: "No encontrada" }, "No existe esa solicitud de aprobación.");
    }
    return {
      link: webLink(ctx, `/aprobaciones/${input.approval_id}`),
      status: view.status,
      summary: view.summary,
    };
  },
});

export const approvalsListPending = defineReadTool({
  name: "approvals_list_pending",
  module: "system",
  scope: "*.read",
  title: "Solicitudes pendientes",
  description: "Lista solicitudes de aprobación pendientes y su enlace. No aprueba ni rechaza.",
  input: z.object({
    entity: z.enum(["PO", "CVPO"]).optional(),
    kind: z.enum(APPROVAL_KINDS).optional(),
  }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const filters = [
      sql`r.status = 'pending'`,
      sql`r.expires_at > ${ctx.now()}`,
    ];
    if (input.entity) filters.push(sql`e.code = ${input.entity}`);
    if (input.kind) filters.push(sql`r.kind = ${input.kind}`);
    const mine = ctx.actor && !ctx.actor.roles.some((role) => INBOX_ROLES.has(role));
    if (mine) filters.push(sql`r.requested_by = ${ctx.actor?.id ?? ""}`);
    if (!ctx.actor) filters.push(sql`FALSE`);
    const rows = await writer.read<Record<string, unknown>>(`
      SELECT r.id::VARCHAR AS id, r.kind, e.code AS entity, r.summary,
             r.requested_at, r.expires_at, r.requested_by
      FROM ops.approval_request r
      LEFT JOIN core.legal_entity e ON e.id = r.legal_entity_id
      WHERE ${filters.join(" AND ")}
      ORDER BY r.requested_at, r.id
      LIMIT 100
    `);
    return {
      items: rows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        entity: row.entity === "PO" || row.entity === "CVPO" ? row.entity : null,
        summary: String(row.summary),
        requested_at: iso(row.requested_at),
        expires_at: iso(row.expires_at),
        link: webLink(ctx, `/aprobaciones/${String(row.id)}`),
      })),
      warnings: ctx.actor ? [] : ["El cliente no representa a una persona, así que no hay solicitudes propias."],
    };
  },
});

interface RequestRow {
  id: string;
  status: string;
  summary: string;
  requested_by: string;
}

async function findRequest(writer: ReturnType<typeof requireWriter>, id: string): Promise<RequestRow | null> {
  const rows = await writer.read<RequestRow>(sql`
    SELECT id::VARCHAR AS id, status, summary, requested_by
    FROM ops.approval_request
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    status: String(row.status),
    summary: String(row.summary),
    requested_by: String(row.requested_by),
  };
}

function canSee(actorId: string | null, roles: readonly string[], requestedBy: string): boolean {
  if (roles.some((role) => INBOX_ROLES.has(role))) return true;
  return actorId !== null && actorId === requestedBy;
}
