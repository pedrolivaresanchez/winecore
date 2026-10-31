import type { InspectionTotals } from "../inspection";

export interface ReportItem {
  location_id: string;
  location_code: string | null;
  vessel_id: string | null;
  vessel_code: string | null;
  owner_entity_id: string;
  owner_code: string | null;
  lot_id: string | null;
  lot_code: string | null;
  vintage: number | null;
  product_id: string | null;
  product_sku: string | null;
  product_state: string;
  qty_units: number;
  volume_ml: number;
  mass_g: number;
  litres: string;
}

function cell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(header: readonly string[], rows: readonly object[]): string {
  const lines = [header.join(",")];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    lines.push(header.map((key) => cell(record[key])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function label(code: string | null, id: string | null): string {
  if (code) return code;
  return id ?? "—";
}

/** Printable inspection sheet. The hash is the SHA-256 of the canonical JSON. */
export function inspectionHtml(input: {
  at: string;
  business_date: string;
  hash: string;
  notice: string | null;
  items: readonly ReportItem[];
  totals: InspectionTotals;
}): string {
  const groups = new Map<string, ReportItem[]>();
  for (const item of input.items) {
    const key = item.location_id;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const sections: string[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    const rows = list
      .map(
        (item) => `<tr>
          <td>${esc(label(item.vessel_code, item.vessel_id))}</td>
          <td>${esc(label(item.lot_code, item.lot_id))}</td>
          <td>${esc(item.vintage ?? "—")}</td>
          <td>${esc(label(item.product_sku, item.product_id))}</td>
          <td>${esc(item.product_state)}</td>
          <td>${esc(label(item.owner_code, item.owner_entity_id))}</td>
          <td class="num">${esc(item.litres)}</td>
          <td class="num">${esc(item.qty_units)}</td>
        </tr>`,
      )
      .join("");
    sections.push(`<section><h2>${esc(label(first?.location_code ?? null, first?.location_id ?? null))}</h2>
      <table>
        <thead><tr>
          <th>Recipiente</th><th>Lote</th><th>Añada</th><th>Producto</th><th>Estado</th>
          <th>Propietario</th><th>Litros</th><th>Unidades</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></section>`);
  }
  const notice = input.notice ? `<p class="notice">${esc(input.notice)}</p>` : "";
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Existencias a ${esc(input.business_date)}</title>
  <style>
    body { font-family: "Source Sans 3", sans-serif; color: #1c1917; margin: 24px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 16px; margin: 18px 0 6px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #d6d3d1; text-align: left; padding: 4px 8px; font-size: 13px; }
    td.num, th:nth-last-child(-n+2) { text-align: right; }
    .meta, .notice { color: #57534e; font-size: 13px; }
    .hash { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
    @media print { body { margin: 12px; } }
  </style>
</head>
<body>
  <h1>Existencias a ${esc(input.at)}</h1>
  <p class="meta">Día de negocio ${esc(input.business_date)} · Granel ${esc(input.totals.bulk_litres)} L · Envasado ${esc(input.totals.packaged_units)} ud</p>
  ${notice}
  ${sections.join("\n") || "<p>Sin existencias.</p>"}
  <p class="hash">SHA-256 ${esc(input.hash)}</p>
</body>
</html>
`;
}

export const INSPECTION_CSV_HEADER = [
  "location_id",
  "location_code",
  "vessel_id",
  "vessel_code",
  "owner_entity_id",
  "owner_code",
  "lot_id",
  "lot_code",
  "vintage",
  "product_id",
  "product_sku",
  "product_state",
  "qty_units",
  "volume_ml",
  "mass_g",
  "litres",
] as const;
