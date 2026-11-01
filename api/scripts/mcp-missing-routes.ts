/**
 * Lists the /v1 routes that no MCP tool covers yet, grouped by their first path segment.
 * Usage: bun run scripts/mcp-missing-routes.ts [segment…]
 */
import { NOT_IN_MCP } from "../src/mcp/parity";
import { baseTools } from "../src/mcp/server";
import { createTestApp } from "../test/helpers";

const only = new Set(process.argv.slice(2));
const ctx = await createTestApp();
try {
  const routes = (ctx.app as unknown as { routes: { method: string; path: string }[] }).routes;
  const all = [...new Set(routes.filter((route) => route.path.startsWith("/v1/")).map((route) => `${route.method} ${route.path}`))].sort();
  const covered = new Set(baseTools.flatMap((tool) => tool.routes ?? []));
  const groups = new Map<string, string[]>();
  for (const route of all) {
    if (covered.has(route) || route in NOT_IN_MCP) continue;
    const segment = route.split(" ")[1]?.split("/")[2] ?? "";
    if (only.size > 0 && !only.has(segment)) continue;
    groups.set(segment, [...(groups.get(segment) ?? []), route]);
  }
  let total = 0;
  for (const [segment, items] of [...groups.entries()].sort()) {
    total += items.length;
    console.log(`\n## ${segment} (${items.length})`);
    for (const item of items) console.log(item);
  }
  console.log(`\n${total} rutas sin herramienta (${covered.size} cubiertas, ${Object.keys(NOT_IN_MCP).length} excluidas)`);
} finally {
  await ctx.close();
}
