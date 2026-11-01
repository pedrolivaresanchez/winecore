/**
 * Prints the MCP tool catalogue in Spanish (markdown), grouped by area.
 * Usage: bun run scripts/mcp-catalog.ts > ../docs/13-mcp-catalogo.md
 */
import { baseTools } from "../src/mcp/server";

const AREAS: [prefix: string, title: string][] = [
  ["system_", "Sistema y búsqueda"],
  ["dashboard_", "Panel"],
  ["reports_", "Informes"],
  ["approvals_", "Aprobaciones"],
  ["contacts_", "Contactos"],
  ["catalog_", "Catálogo, formatos y tarifas"],
  ["sales_", "Ventas: presupuestos, pedidos y albaranes"],
  ["billing_", "Facturación, series y sociedades"],
  ["finance_", "Tesorería: cobros, pagos, remesas, bancos e intercompañía"],
  ["purchasing_", "Gastos"],
  ["inventory_", "Stock, aforos y ubicaciones"],
  ["cellar_", "Bodega: depósitos, operaciones, lotes y enología"],
  ["lot_", "Bodega: depósitos, operaciones, lotes y enología"],
  ["recipes_", "Bodega: depósitos, operaciones, lotes y enología"],
  ["hygiene_", "Higiene"],
  ["tasting_", "Catas"],
  ["vineyard_", "Viñedo"],
  ["regulatory_", "Regulatorio y SILICIE"],
];

const groups = new Map<string, string[]>();
for (const tool of [...baseTools].sort((a, b) => a.name.localeCompare(b.name))) {
  const area = AREAS.find(([prefix]) => tool.name.startsWith(prefix))?.[1] ?? "Otras";
  const name = tool.kind === "write" ? `\`${tool.name}_prepare\` / \`_commit\`` : `\`${tool.name}\``;
  const kind = tool.kind === "write" ? "escritura" : tool.kind === "read" ? "lectura" : "directa";
  groups.set(area, [...(groups.get(area) ?? []), `| ${name} | ${kind} | ${tool.title.replace(/\|/g, "/")} |`]);
}

const order = [...new Set([...AREAS.map(([, title]) => title), "Otras"])];
const total = baseTools.length;
const writes = baseTools.filter((tool) => tool.kind === "write").length;
console.log("# 13 · Catálogo de herramientas MCP");
console.log("");
console.log(`> Generado con \`bun run scripts/mcp-catalog.ts\` (en \`api/\`). ${total} herramientas, ${writes} de escritura en dos pasos (\`_prepare\` y \`_commit\`). Reglas y exclusiones: \`13-mcp.md\`.`);
for (const area of order) {
  const rows = groups.get(area);
  if (!rows) continue;
  console.log("");
  console.log(`## ${area} (${rows.length})`);
  console.log("");
  console.log("| Herramienta | Tipo | Qué hace |");
  console.log("|---|---|---|");
  for (const row of rows) console.log(row);
}
