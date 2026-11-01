import { isRoleCode, permissionsFor, type UserCtx } from "../core/auth/permissions";
import { sql } from "../core/db/sql";
import type { Actor, Writer } from "../core/db/writer";
import { domainError } from "../core/errors";
import { sha256Hex } from "../core/hash";
import { canonicalJson } from "./confirm";
import type { McpAuditEvent, McpContext, RestDispatch } from "./registry";
import { asStringList } from "./runtime";
import { sqlConfirmationStore } from "./sql-confirm";

export async function loadActiveModules(writer: Writer): Promise<string[]> {
  const rows = await writer.read<{ module_key: string }>(`
    SELECT module_key FROM core.module_state WHERE enabled = TRUE ORDER BY module_key
  `);
  return rows.map((row) => String(row.module_key));
}

async function loadUser(writer: Writer, userId: string): Promise<UserCtx | null> {
  const users = await writer.read<{
    id: string;
    email: string;
    display_name: string;
    status: string;
  }>(sql`
    SELECT id::VARCHAR AS id, email, display_name, status
    FROM core.app_user
    WHERE id = CAST(${userId} AS UUID)
  `);
  const user = users[0];
  if (!user || user.status !== "active") return null;
  const roles = await writer.read<{ role_code: string; legal_entity_id: string | null; code: string | null }>(sql`
    SELECT r.role_code, r.legal_entity_id::VARCHAR AS legal_entity_id, e.code
    FROM core.user_role r
    LEFT JOIN core.legal_entity e ON e.id = r.legal_entity_id
    WHERE r.user_id = CAST(${user.id} AS UUID) AND r.revoked_at IS NULL
  `);
  return {
    id: user.id,
    email: String(user.email ?? ""),
    displayName: String(user.display_name),
    roles: roles.flatMap((row) => {
      const role = String(row.role_code);
      if (!isRoleCode(role)) return [];
      return [{
        role,
        legalEntityId: row.legal_entity_id,
        legalEntityCode: row.code,
      }];
    }),
  };
}

function auditActor(ctx: McpContext): Actor {
  return {
    type: ctx.principal === "user" ? "user" : "agent",
    id: ctx.principal === "user" && ctx.actor ? ctx.actor.id : ctx.client.id,
    onBehalfOf: ctx.principal === "user" ? undefined : ctx.actor?.id,
    requestId: ctx.requestId && ctx.requestId.trim() !== "" ? ctx.requestId : "mcp",
    reason: "llamada MCP",
  };
}

export function auditToolCall(writer: Writer, ctx: McpContext): (event: McpAuditEvent) => Promise<void> {
  return async (event) => {
    const after = {
      event: "mcp.call",
      tool: event.tool,
      client_id: event.clientId,
      on_behalf_of: event.onBehalfOf,
      args_sha256: event.argsSha256,
      ok: event.ok,
      code: event.code,
    };
    await writer.withWrite(auditActor(ctx), async (tx) => {
      tx.audit({
        table: "mcp.call",
        rowId: event.clientId,
        action: "EVENT",
        before: null,
        after,
      });
    });
  };
}

export async function contextForMachine(
  writer: Writer,
  clientId: string,
  input: { now: () => Date; webBaseUrl: string; requestId: string; rest?: RestDispatch },
): Promise<McpContext> {
  const rows = await writer.read<{
    id: string;
    code: string;
    scopes: unknown;
    on_behalf_of_user_id: string | null;
  }>(sql`
    SELECT id::VARCHAR AS id, code, scopes, on_behalf_of_user_id::VARCHAR AS on_behalf_of_user_id
    FROM core.api_client
    WHERE id = CAST(${clientId} AS UUID) AND revoked_at IS NULL
  `);
  const row = rows[0];
  if (!row) throw domainError("WC_UNAUTHENTICATED");
  const behalf = row.on_behalf_of_user_id ? await loadUser(writer, row.on_behalf_of_user_id) : null;
  if (row.on_behalf_of_user_id && !behalf) throw domainError("WC_UNAUTHENTICATED");
  const modules = await loadActiveModules(writer);
  const ctx: McpContext = {
    client: { id: row.id, scopes: asStringList(row.scopes) },
    activeModules: modules,
    actor: behalf
      ? { id: behalf.id, name: behalf.displayName, roles: behalf.roles.map((role) => role.role) }
      : null,
    behalfGrants: behalf ? permissionsFor(behalf) : undefined,
    session: behalf ?? undefined,
    now: input.now,
    requestId: input.requestId,
    principal: "agent",
    deps: {
      confirmations: sqlConfirmationStore(writer, behalf?.id ?? null),
      webBaseUrl: input.webBaseUrl,
      writer,
      approvals: sqlApprovals(writer),
      rest: input.rest,
    },
  };
  ctx.deps.audit = auditToolCall(writer, ctx);
  return ctx;
}

export async function contextForUser(
  writer: Writer,
  user: UserCtx,
  input: { now: () => Date; webBaseUrl: string; requestId: string; rest?: RestDispatch },
): Promise<McpContext> {
  const modules = await loadActiveModules(writer);
  const ctx: McpContext = {
    client: { id: user.id, scopes: permissionsFor(user) },
    activeModules: modules,
    actor: { id: user.id, name: user.displayName, roles: user.roles.map((role) => role.role) },
    session: user,
    now: input.now,
    requestId: input.requestId,
    principal: "user",
    deps: {
      confirmations: sqlConfirmationStore(writer, user.id),
      webBaseUrl: input.webBaseUrl,
      writer,
      approvals: sqlApprovals(writer),
      rest: input.rest,
    },
  };
  ctx.deps.audit = auditToolCall(writer, ctx);
  return ctx;
}

function sqlApprovals(writer: Writer): McpContext["deps"]["approvals"] {
  return {
    async get(approvalId: string) {
      const rows = await writer.read<{ status: string; summary: string }>(sql`
        SELECT status, summary
        FROM ops.approval_request
        WHERE id = CAST(${approvalId} AS UUID)
      `);
      const row = rows[0];
      if (!row) return null;
      return { status: String(row.status), summary: String(row.summary) };
    },
  };
}

export async function auditDeniedCall(
  writer: Writer,
  ctx: McpContext,
  tool: string,
  args: unknown,
  code: string,
): Promise<void> {
  let argsSha256 = "0".repeat(64);
  try {
    argsSha256 = sha256Hex(canonicalJson(args ?? {}));
  } catch {
    argsSha256 = sha256Hex("unserializable");
  }
  await auditToolCall(writer, ctx)({
    tool,
    clientId: ctx.client.id,
    onBehalfOf: ctx.actor?.id ?? null,
    argsSha256,
    ok: false,
    code,
  });
}
