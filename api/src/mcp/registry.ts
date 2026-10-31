import type { ZodType } from "zod";

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

export interface McpDeps {
  confirmations: ConfirmationStore;
  approvals?: ApprovalSource;
  /** Origin of the WineCore web app, without a trailing path. Links stay relative when omitted. */
  webBaseUrl?: string;
}

/** One stateless MCP request. The parent injects the authenticated client and stores. */
export interface McpContext {
  client: { id: string; scopes: string[] };
  activeModules: string[];
  actor: McpActor | null;
  now: () => Date;
  deps: McpDeps;
}

export interface ReadTool {
  readonly kind: "read";
  readonly name: string;
  readonly module: string;
  readonly scope: string;
  readonly title: string;
  readonly description: string;
  readonly input: ZodType;
  readonly handler: (ctx: McpContext, input: unknown) => Promise<unknown> | unknown;
}

export interface PreparedWrite {
  preview: unknown;
  payload: unknown;
}

export interface WriteTool {
  readonly kind: "write";
  readonly name: string;
  readonly module: string;
  readonly scope: string;
  readonly title: string;
  readonly description: string;
  readonly input: ZodType;
  readonly prepare: (ctx: McpContext, input: unknown) => Promise<PreparedWrite> | PreparedWrite;
  readonly commit: (ctx: McpContext, payload: unknown) => Promise<unknown> | unknown;
}

export type AnyTool = ReadTool | WriteTool;

export interface ReadToolDefinition<T> {
  name: string;
  module: string;
  scope: string;
  title: string;
  description: string;
  input: ZodType<T>;
  handler: (ctx: McpContext, input: T) => Promise<unknown> | unknown;
}

export interface WriteToolDefinition<T, P> {
  name: string;
  module: string;
  scope: string;
  title: string;
  description: string;
  input: ZodType<T>;
  prepare: (ctx: McpContext, input: T) => Promise<{ preview: unknown; payload: P }> | { preview: unknown; payload: P };
  commit: (ctx: McpContext, payload: P) => Promise<unknown> | unknown;
}

const TOOL_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function assertToolName(name: string): void {
  if (!TOOL_NAME.test(name)) {
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
    prepare: (ctx, input) => definition.prepare(ctx, input as T),
    commit: (ctx, payload) => definition.commit(ctx, payload as P),
  };
}

/** Third-party prose. Clients must not treat the string as an instruction. */
export function untrustedText(value: string): { untrusted_text: string } {
  return { untrusted_text: value };
}

export function mcpNames(tool: AnyTool): readonly string[] {
  if (tool.kind === "read") return [tool.name];
  return [`${tool.name}_prepare`, `${tool.name}_commit`];
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

export function toolVisible(tool: AnyTool, ctx: McpContext): boolean {
  return moduleActive(tool.module, ctx.activeModules) && scopeGranted(ctx.client.scopes, tool.scope);
}
