import { z } from "zod";

import { APPROVAL_KINDS } from "../../core/approvals/types";
import { payloadSha256 } from "../../core/approvals/canonical";
import { sql } from "../../core/db/sql";
import { domainError } from "../../core/errors";
import { newId } from "../../core/ids";
import { defineReadTool, defineWriteTool } from "../registry";
import { actorOf, iso, requireWriter, webLink } from "../runtime";

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

const requestInput = z.object({
  kind: z.enum(APPROVAL_KINDS),
  subject_table: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  subject_id: z.uuid(),
  summary: z.string().trim().min(5).max(300),
  legal_entity: z.enum(["PO", "CVPO"]).optional(),
});

interface RequestPayload {
  kind: string;
  subject_table: string;
  subject_id: string;
  summary: string;
  legal_entity_id: string | null;
}

export const approvalsRequestCreate = defineWriteTool({
  name: "approvals_request_create",
  module: "system",
  scope: "*.read",
  title: "Crear solicitud",
  description: "Crea una solicitud de aprobación y devuelve el enlace a la bandeja. No decide la solicitud.",
  input: requestInput,
  prepare: async (ctx, input) => {
    const writer = requireWriter(ctx);
    if (!ctx.actor) {
      throw domainError("WC_VALIDATION", { on_behalf_of: "Hace falta una persona" }, "La solicitud debe quedar a nombre de una persona.");
    }
    const entityId = await entityByCode(writer, input.legal_entity ?? null);
    const payload: RequestPayload = {
      kind: input.kind,
      subject_table: input.subject_table,
      subject_id: input.subject_id,
      summary: input.summary,
      legal_entity_id: entityId,
    };
    return {
      preview: {
        kind: input.kind,
        summary: input.summary,
        subject_table: input.subject_table,
        subject_id: input.subject_id,
        legal_entity: input.legal_entity ?? null,
        effect: "Quedará pendiente. La decisión se toma en la web.",
      },
      payload,
      summary_es: `Se creará una solicitud «${input.summary}». No se aprueba ni se envía nada: solo el enlace a la bandeja.`,
    };
  },
  commit: async (ctx, payload) => {
    const writer = requireWriter(ctx);
    const body = payload as RequestPayload;
    if (!ctx.actor) {
      throw domainError("WC_VALIDATION", { on_behalf_of: "Hace falta una persona" });
    }
    const id = newId();
    const now = ctx.now();
    const expires = new Date(now.getTime() + 72 * 60 * 60 * 1000);
    const hash = payloadSha256({
      kind: body.kind,
      subject_table: body.subject_table,
      subject_id: body.subject_id,
      summary: body.summary,
    });
    const entityId = body.legal_entity_id;
    await writer.withWrite(actorOf(ctx, "solicitud de aprobación"), async (tx) => {
      tx.write(sql`
        INSERT INTO ops.approval_request (
          id, kind, legal_entity_id, subject_table, subject_id, payload_sha256,
          summary, details, status, requested_by, requested_at, expires_at
        ) VALUES (
          CAST(${id} AS UUID),
          ${body.kind},
          CASE
            WHEN ${entityId ?? ""} = '' THEN NULL
            ELSE CAST(${entityId ?? "00000000-0000-4000-8000-000000000000"} AS UUID)
          END,
          ${body.subject_table},
          CAST(${body.subject_id} AS UUID),
          ${hash},
          ${body.summary},
          ${sql.json({ source: "mcp" })},
          'pending',
          ${ctx.actor?.id ?? ""},
          ${now},
          ${expires}
        )
      `);
    });
    return {
      approval_id: id,
      link: webLink(ctx, `/aprobaciones/${id}`),
      status: "pending",
    };
  },
});

async function entityByCode(writer: ReturnType<typeof requireWriter>, code: string | null): Promise<string | null> {
  if (!code) return null;
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.legal_entity WHERE code = ${code}
  `);
  const id = rows[0]?.id;
  if (!id) throw domainError("WC_VALIDATION", { legal_entity: "No existe" });
  return id;
}

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
