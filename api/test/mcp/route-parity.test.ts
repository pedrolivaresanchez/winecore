import { describe, expect, test } from "bun:test";

import { NOT_IN_MCP } from "../../src/mcp/parity";
import { DECISION_VERB, mcpNames } from "../../src/mcp/registry";
import { baseTools } from "../../src/mcp/server";
import { createTestApp } from "../helpers";

async function appRoutes(): Promise<string[]> {
  const ctx = await createTestApp();
  try {
    const routes = (ctx.app as unknown as { routes: { method: string; path: string }[] }).routes;
    return [...new Set(routes.filter((route) => route.path.startsWith("/v1/")).map((route) => `${route.method} ${route.path}`))].sort();
  } finally {
    await ctx.close();
  }
}

function coverage(): Map<string, string[]> {
  const covered = new Map<string, string[]>();
  for (const tool of baseTools) {
    for (const route of tool.routes ?? []) covered.set(route, [...(covered.get(route) ?? []), tool.name]);
  }
  return covered;
}

describe("MCP parity with the web app", () => {
  test("every REST route the UI calls has an MCP tool, or a written reason not to", async () => {
    const routes = await appRoutes();
    const covered = coverage();
    const missing = routes.filter((route) => !covered.has(route) && !(route in NOT_IN_MCP));
    expect(missing).toEqual([]);
  });

  test("tools and exclusions only name routes that exist, and never the same route", async () => {
    const routes = new Set(await appRoutes());
    const covered = coverage();
    expect([...covered.keys()].filter((route) => !routes.has(route))).toEqual([]);
    expect(Object.keys(NOT_IN_MCP).filter((route) => !routes.has(route))).toEqual([]);
    expect(Object.keys(NOT_IN_MCP).filter((route) => covered.has(route))).toEqual([]);
  });

  test("every write is prepare/commit and every decision needs a confirmation", () => {
    for (const tool of baseTools) {
      const writes = (tool.routes ?? []).some((route) => !route.startsWith("GET "));
      if (writes && tool.kind === "read" && !tool.computeOnly?.trim()) {
        expect(`${tool.name}: ${tool.routes?.join(", ")}`).toBe(`${tool.name} is read-only or says why (computeOnly)`);
      }
      if (writes && tool.kind === "direct") {
        expect(`${tool.name}: ${tool.routes?.join(", ")}`).toBe(`${tool.name} must be prepare/commit`);
      }
      if (DECISION_VERB.test(tool.name)) expect(tool.kind).toBe("write");
      for (const name of mcpNames(tool)) expect(name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });
});
