import { expect } from "bun:test";

import { InMemoryConfirmationStore } from "../../src/mcp/confirm";
import type { ToolCallResult } from "../../src/mcp/server";
import type { ApprovalSource, McpContext } from "../../src/mcp/registry";

export const CLIENT_A = "00000000-0000-4000-8000-0000000000a1";
export const CLIENT_B = "00000000-0000-4000-8000-0000000000a2";
export const ACTOR_ID = "00000000-0000-4000-8000-0000000000b1";
export const APPROVAL_ID = "00000000-0000-4000-8000-0000000000c1";

export function makeCtx(
  overrides: Partial<Omit<McpContext, "deps">> & { deps?: Partial<McpContext["deps"]> } = {},
): McpContext {
  const approvals: ApprovalSource = {
    async get(approvalId) {
      if (approvalId !== APPROVAL_ID) return null;
      return { status: "pendiente", summary: "Borrador de prueba" };
    },
  };
  const { deps: depOverrides, ...rest } = overrides;
  return {
    client: { id: CLIENT_A, scopes: ["read:*"] },
    activeModules: ["contacts", "catalog"],
    actor: { id: ACTOR_ID, name: "Persona de prueba", roles: ["owner"] },
    now: () => new Date("2026-10-31T12:00:00.000Z"),
    ...rest,
    deps: {
      confirmations: new InMemoryConfirmationStore(),
      approvals,
      webBaseUrl: "https://bodega.example",
      ...depOverrides,
    },
  };
}

export interface ToolErrorBody {
  code: string;
  message_es: string;
  fields?: Record<string, string>;
}

export function readToolResult(result: ToolCallResult): { ok?: unknown; error?: ToolErrorBody } {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("missing tool text");
  const body: unknown = JSON.parse(block.text);
  if (result.isError) return { error: body as ToolErrorBody };
  return { ok: body };
}

export function expectError(result: ToolCallResult, code: string, messagePart: string): ToolErrorBody {
  const parsed = readToolResult(result);
  expect(parsed.error).toBeDefined();
  const error = parsed.error as ToolErrorBody;
  expect(error.code).toBe(code);
  expect(error.message_es).toContain(messagePart);
  return error;
}
