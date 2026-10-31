import type { ZodType } from "zod";

import type { Writer } from "../core/db/writer";
import type { ConfirmationStore } from "./confirm";

export interface McpActor {
  id: string;
  name: string;
  roles: string[];
}

export interface ApprovalView {
  status: string;
  summary: string;
}

export interface ApprovalSource {
  get(approvalId: string): Promise<ApprovalView | null>;
}

export interface McpAuditEvent {
  tool: string;
  clientId: string;
  onBehalfOf: string | null;
  argsSha256: string;
  ok: boolean;
  code: string | null;
}

export interface McpDeps {
  confirmations: ConfirmationStore;
  approvals?: ApprovalSource;
  /** Origin of the WineCore web app, without a trailing path. Links stay relative when omitted. */
  webBaseUrl?: string;
  writer?: Writer;
  /** When set, every tool call is written to the audit chain. Payloads stay free of secrets and PII. */
  audit?: (event: McpAuditEvent) => Promise<void>;
}

/** One stateless MCP request. The parent injects the authenticated client and stores. */
export interface McpContext {
  client: { id: string; scopes: string[] };
  activeModules: string[];
  actor: McpActor | null;
  now: () => Date;
  deps: McpDeps;
  /**
   * Permissions of the represented person. When set, a tool is visible only if
   * both the client scopes and these grants allow it. Omitted in unit tests
   * that only exercise client scopes.
   */
  behalfGrants?: readonly string[];
  requestId?: string;
  /** `user` when a person calls with their own session. */
  principal?: "user" | "agent";
}

export interface ReadTool {
  readonly kind: "read";
  readonly name: string;
  readonly module: string;
  readonly scope: string;
  readonly title: string;
  readonly description: string;
  readonly input: ZodType;
  /** Other accepted scope spellings, for example `write:cellar.operation_draft`. */
  readonly extraScopes?: readonly string[];
  readonly handler: (ctx: McpContext, input: unknown) => Promise<unknown> | unknown;
}

export interface PreparedWrite {
  preview: unknown;
  payload: unknown;
  summary_es?: string;
}

export interface WriteTool {
  readonly kind: "write";
  readonly name: string;
  readonly module: string;
  readonly scope: string;
  readonly title: string;
  readonly description: string;
  readonly input: ZodType;
  readonly extraScopes?: readonly string[];
  readonly prepare: (ctx: McpContext, input: unknown) => Promise<PreparedWrite> | PreparedWrite;
  readonly commit: (ctx: McpContext, payload: unknown) => Promise<unknown> | unknown;
}

/** A write that records an external fact. It does not use prepare/commit. */
export interface DirectWriteTool {
  readonly kind: "direct";
  readonly name: string;
  readonly module: string;
  readonly scope: string;
  readonly title: string;
  readonly description: string;
  readonly input: ZodType;
  readonly extraScopes?: readonly string[];
  readonly handler: (ctx: McpContext, input: unknown) => Promise<unknown> | unknown;
}

export type AnyTool = ReadTool | WriteTool | DirectWriteTool;

export interface ReadToolDefinition<T> {
  name: string;
  module: string;
  scope: string;
  title: string;
  description: string;
  input: ZodType<T>;
  extraScopes?: readonly string[];
  handler: (ctx: McpContext, input: T) => Promise<unknown> | unknown;
}

export interface WriteToolDefinition<T, P> {
  name: string;
  module: string;
  scope: string;
  title: string;
  description: string;
  input: ZodType<T>;
  extraScopes?: readonly string[];
  prepare: (
    ctx: McpContext,
    input: T,
  ) => Promise<{ preview: unknown; payload: P; summary_es?: string }> | { preview: unknown; payload: P; summary_es?: string };
  commit: (ctx: McpContext, payload: P) => Promise<unknown> | unknown;
}

const TOOL_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const FORBIDDEN_TOOL = /approve|issue|void|send|delete|secret/;

function assertToolName(name: string): void {
  if (!TOOL_NAME.test(name) || FORBIDDEN_TOOL.test(name)) {
    throw new Error(`Invalid MCP tool name: ${name}`);
  }
}

export function defineReadTool<T>(definition: ReadToolDefinition<T>): ReadTool {
  assertToolName(definition.name);
  return {
    kind: "read",
    name: definition.name,
    module: definition.module,
    scope: definition.scope,
    title: definition.title,
    description: definition.description,
    input: definition.input,
    extraScopes: definition.extraScopes,
    handler: (ctx, input) => definition.handler(ctx, input as T),
  };
}

export interface DirectWriteDefinition<T> {
  name: string;
  module: string;
  scope: string;
  title: string;
  description: string;
  input: ZodType<T>;
  extraScopes?: readonly string[];
  handler: (ctx: McpContext, input: T) => Promise<unknown> | unknown;
}

export function defineDirectWrite<T>(definition: DirectWriteDefinition<T>): DirectWriteTool {
  assertToolName(definition.name);
  return {
    kind: "direct",
    name: definition.name,
    module: definition.module,
    scope: definition.scope,
    title: definition.title,
    description: definition.description,
    input: definition.input,
    extraScopes: definition.extraScopes,
    handler: (ctx, input) => definition.handler(ctx, input as T),
  };
}

export function defineWriteTool<T, P>(definition: WriteToolDefinition<T, P>): WriteTool {
  assertToolName(definition.name);
  return {
    kind: "write",
    name: definition.name,
    module: definition.module,
    scope: definition.scope,
    title: definition.title,
    description: definition.description,
    input: definition.input,
    extraScopes: definition.extraScopes,
    prepare: (ctx, input) => definition.prepare(ctx, input as T),
    commit: (ctx, payload) => definition.commit(ctx, payload as P),
  };
}

/** Third-party prose. Clients must not treat the string as an instruction. */
export function untrustedText(value: string): { untrusted_text: string } {
  return { untrusted_text: value };
}

export function mcpNames(tool: AnyTool): readonly string[] {
  if (tool.kind === "write") return [`${tool.name}_prepare`, `${tool.name}_commit`];
  return [tool.name];
}

const ALWAYS_ON_MODULES = new Set(["", "system", "core"]);

export function moduleActive(moduleName: string, activeModules: readonly string[]): boolean {
  if (ALWAYS_ON_MODULES.has(moduleName)) return true;
  return activeModules.includes(moduleName);
}

/**
 * Client scopes use `read:*` / `write:contacts`. Tool scopes may also use the
 * permission form from the matrix (`contacts.read`, `*.read`). `read:*` covers
 * `read:contacts`; a narrower grant does not cover `read:*`.
 */
export function normalizeScope(scope: string): string {
  if (!scope.includes(":") && scope.includes(".")) {
    const [resource, action] = scope.split(".");
    if (resource && action && !action.includes(".")) {
      return resource === "*" ? `${action}:*` : `${action}:${resource}`;
    }
  }
  return scope;
}

export function scopeGranted(grantedScopes: readonly string[], required: string): boolean {
  if (required === "" || required === "*") return true;
  const need = normalizeScope(required);
  for (const granted of grantedScopes) {
    const have = normalizeScope(granted);
    if (have === "*" || have === need) return true;
    if (have.endsWith(":*")) {
      const prefix = have.slice(0, -1);
      if (need.startsWith(prefix)) return true;
    }
  }
  return false;
}

/**
 * A grant allows the tool when it matches `scope` or an extra spelling.
 * `*.read` / `read:*` is also allowed by any read permission: the matrix uses
 * it for tools any reader may call. A write grant does not count as read.
 */
export function accessGranted(grantedScopes: readonly string[], tool: AnyTool): boolean {
  if (scopeGranted(grantedScopes, tool.scope)) return true;
  for (const extra of tool.extraScopes ?? []) {
    if (scopeGranted(grantedScopes, extra)) return true;
  }
  if (normalizeScope(tool.scope) === "read:*") {
    return grantedScopes.some((scope) => {
      const have = normalizeScope(scope);
      return have === "read:*" || have.startsWith("read:") || scope.endsWith(".read");
    });
  }
  return false;
}

export function toolVisible(tool: AnyTool, ctx: McpContext): boolean {
  if (!moduleActive(tool.module, ctx.activeModules)) return false;
  if (!accessGranted(ctx.client.scopes, tool)) return false;
  if (ctx.behalfGrants && !accessGranted(ctx.behalfGrants, tool)) return false;
  return true;
}
