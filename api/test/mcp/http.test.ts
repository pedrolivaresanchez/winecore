import { describe, expect, test } from "bun:test";

import { handleMcpRequest } from "../../src/mcp/http";
import { CLIENT_A, makeCtx } from "./fixture";

const ctx = makeCtx();

async function rpc(id: number, method: string, params: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handleMcpRequest(
    new Request("https://bodega.example/api/m2m/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
    ctx,
  );
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

describe("streamable http", () => {
  test("initialize, tools/list and tools/call", async () => {
    const init = await rpc(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "prueba", version: "0.0.1" },
    });
    expect(init.status).toBe(200);
    const initResult = init.body.result as { protocolVersion: string; serverInfo: { name: string } };
    expect(initResult.protocolVersion).toBe("2025-06-18");
    expect(initResult.serverInfo.name).toBe("winecore");

    const list = await rpc(2, "tools/list", {});
    expect(list.status).toBe(200);
    const tools = (list.body.result as { tools: { name: string }[] }).tools;
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("system_whoami");
    expect(names).not.toContain("system_modules");
    expect(names).toContain("approvals_get_link");
    expect(names.some((name) => /approve|issue|void|send|delete|secret|decide|reject/i.test(name))).toBe(false);

    const call = await rpc(3, "tools/call", { name: "system_whoami", arguments: {} });
    expect(call.status).toBe(200);
    const callResult = call.body.result as { isError?: boolean; content: { type: string; text: string }[] };
    expect(callResult.isError).toBeUndefined();
    const block = callResult.content[0];
    const text = block?.type === "text" ? block.text : "";
    const who = JSON.parse(text) as { client: string; scopes: string[] };
    expect(who.client).toBe(CLIENT_A);
    expect(who.scopes).toEqual(["read:*"]);
  });
});
