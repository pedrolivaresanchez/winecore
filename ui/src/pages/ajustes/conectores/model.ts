import { copy } from "@/i18n";

/** Tool scopes declared by the MCP catalogue. `regulatory.approve` is never offered. */
const BLOCKED_SEGMENTS = new Set(["approve"]);

export const TOOL_SCOPES = [
  "*.read",
  "contacts.read",
  "contacts.write",
  "catalog.read",
  "inventory.read",
  "cellar.read",
  "cellar.operate",
  "write:cellar.operation_draft",
] as const;

export type ToolScope = (typeof TOOL_SCOPES)[number];

export const CODE_PATTERN = /^[a-z][a-z0-9-]{2,40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type McpClient = {
  id: string;
  code: string;
  description: string;
  scopes: string[];
  on_behalf_of_user_id: string | null;
  created_at: string;
  revoked_at: string | null;
  token_prefix: string | null;
  token_expires_at: string | null;
};

export type ClientStatus = "active" | "revoked" | "expired";

export type Person = { id: string; name: string };

export type AuditChange = { field: string; before: unknown; after: unknown };

export type AuditItem = {
  id: number | string;
  occurred_at: string;
  actor?: { type?: string; id?: string; display_name?: string; on_behalf_of?: string | null };
  row_id?: string | null;
  changes?: AuditChange[];
};

export type McpCall = {
  id: string;
  at: string;
  clientId: string | null;
  tool: string;
  ok: boolean;
  code: string | null;
};

export function isGrantableScope(scope: string): boolean {
  const segments = scope.trim().toLowerCase().split(/[:.]/);
  return segments.every((segment) => !BLOCKED_SEGMENTS.has(segment));
}

export function scopeLabel(scope: string): string {
  const labels = copy.connectors.scopeLabels as Record<string, string>;
  return labels[scope] ?? scope;
}

export function codeFromName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 41);
  return CODE_PATTERN.test(slug) ? slug : "";
}

export function mcpEndpoint(): string {
  if (typeof window === "undefined") return "/api/m2m/mcp";
  return `${window.location.origin}/api/m2m/mcp`;
}

export function asScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item.length > 0);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter((item) => item.length > 0);
    } catch {
      return [];
    }
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

export function asClient(value: unknown): McpClient | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = textOrNull(row.id);
  if (!id) return null;
  return {
    id,
    code: textOrNull(row.code) ?? "",
    description: textOrNull(row.description) ?? textOrNull(row.code) ?? "",
    scopes: asScopes(row.scopes),
    on_behalf_of_user_id: textOrNull(row.on_behalf_of_user_id),
    created_at: textOrNull(row.created_at) ?? "",
    revoked_at: textOrNull(row.revoked_at),
    token_prefix: textOrNull(row.token_prefix) ?? textOrNull(row.prefix),
    token_expires_at: textOrNull(row.token_expires_at) ?? textOrNull(row.expires_at),
  };
}

export function uniqueClients(items: McpClient[]): McpClient[] {
  const byId = new Map<string, McpClient>();
  for (const item of items) {
    const previous = byId.get(item.id);
    if (!previous || (!previous.token_prefix && item.token_prefix)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function clientStatus(client: McpClient, now = Date.now()): ClientStatus {
  if (client.revoked_at) return "revoked";
  if (!client.token_prefix) return "expired";
  if (client.token_expires_at) {
    const expires = Date.parse(client.token_expires_at);
    if (!Number.isNaN(expires) && expires <= now) return "expired";
  }
  return "active";
}

export function validateDraft(input: { name: string; code: string; scopes: readonly string[]; behalf: string }): Record<string, string> {
  const fields: Record<string, string> = {};
  const name = input.name.trim();
  if (name.length < 3 || name.length > 200) fields.description = copy.connectors.nameError;
  if (!CODE_PATTERN.test(input.code.trim())) fields.code = copy.connectors.codeError;
  const scopes = input.scopes.filter(isGrantableScope);
  if (scopes.length < 1 || scopes.length > 32) fields.scopes = copy.connectors.scopesError;
  if (input.behalf !== "" && !UUID_PATTERN.test(input.behalf)) fields.on_behalf_of_user_id = copy.connectors.personError;
  return fields;
}

function changeAfter(item: AuditItem, field: string): unknown {
  return item.changes?.find((change) => change.field === field)?.after;
}

export function peopleInAudit(items: AuditItem[] | undefined): Person[] {
  const names = new Map<string, string>();
  for (const item of items ?? []) {
    const actor = item?.actor;
    if (!actor || actor.type !== "user") continue;
    const id = actor.id?.trim() ?? "";
    const name = actor.display_name?.trim() ?? "";
    if (!UUID_PATTERN.test(id) || name.length === 0 || name === id) continue;
    if (!names.has(id.toLowerCase())) names.set(id.toLowerCase(), name);
  }
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "es"));
}

export function personName(people: Person[], id: string | null): string | null {
  if (!id) return null;
  return people.find((person) => person.id === id.toLowerCase())?.name ?? null;
}

export function mcpCalls(items: AuditItem[] | undefined): McpCall[] {
  const calls: McpCall[] = [];
  for (const item of items ?? []) {
    const tool = changeAfter(item, "tool");
    if (typeof tool !== "string" || tool.length === 0) continue;
    const ok = changeAfter(item, "ok");
    const code = changeAfter(item, "code");
    calls.push({
      id: String(item.id),
      at: item.occurred_at,
      clientId: item.row_id ?? null,
      tool,
      ok: ok === true,
      code: typeof code === "string" && code.length > 0 ? code : null,
    });
  }
  return calls;
}

export function lastUsedAt(calls: McpCall[]): Map<string, string> {
  const used = new Map<string, string>();
  for (const call of calls) {
    if (!call.clientId) continue;
    const key = call.clientId.toLowerCase();
    if (!used.has(key)) used.set(key, call.at);
  }
  return used;
}

export function clientName(clients: McpClient[], id: string | null): string | null {
  if (!id) return null;
  const key = id.toLowerCase();
  return clients.find((client) => client.id.toLowerCase() === key)?.description ?? null;
}
