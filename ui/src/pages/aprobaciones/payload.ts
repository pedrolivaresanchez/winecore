import { copy, fill } from "@/i18n";
import type { PayloadRow } from "@/pages/aprobaciones/model";

export type DiffRow = {
  label: string;
  before: string;
  after: string;
};

export type PresentedPayload = {
  lines: PayloadRow[];
  diffs: DiffRow[];
};

const BEFORE = ["before", "from", "previous", "antes"];
const AFTER = ["after", "to", "next", "despues", "después"];
const SKIP = new Set(["price_list_id", "version_id", "product_id", "id"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LABELS: Record<string, string> = {
  aforo: "Aforo",
  litros: "Litros",
  items: "Precios",
  "valid from": "Desde",
  "valid to": "Hasta",
  version: "Versión",
  accion: "Acción",
  entidad: "Entidad",
  modulo: "Módulo",
  destino: "Destino",
  periodo: "Periodo",
  asientos: "Asientos",
  salidas: "Salidas",
  cuadre: "Cuadre",
  deposito: "Depósito",
  motivo: "Motivo",
  cambios: "Cambios",
};

function labelize(label: string): string {
  const known = LABELS[label.toLocaleLowerCase("es")];
  if (known) return known;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function tidy(value: string): string {
  return value.replace(/(\d+)\.(\d+)/g, (_match, whole: string, frac: string) => {
    const trimmed = frac.replace(/0+$/, "");
    return trimmed ? `${whole},${trimmed}` : whole;
  });
}

function salvagePrices(text: string): string[] {
  const prices = [...text.matchAll(/"unit_price":"([^"]+)"/g)].map((match) => match[1] ?? "");
  const qtys = [...text.matchAll(/"min_qty":"([^"]+)"/g)].map((match) => match[1] ?? "");
  return prices.filter(Boolean).map((price, index) => {
    const qty = qtys[index];
    return qty ? `${qty} · ${price} €` : `${price} €`;
  });
}

function tryJson(value: string): unknown {
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textOf(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value === "" ? "—" : value;
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (typeof value === "number") return String(value);
  return "";
}

function pairOf(value: unknown): { before: string; after: string } | null {
  if (!isRecord(value)) return null;
  const beforeKey = BEFORE.find((key) => key in value);
  const afterKey = AFTER.find((key) => key in value);
  if (!beforeKey || !afterKey) return null;
  const before = textOf(value[beforeKey]);
  const after = textOf(value[afterKey]);
  if (!before || !after) return null;
  return { before, after };
}

function labelOf(value: Record<string, unknown>, fallback: string): string {
  for (const key of ["label", "field", "name", "deposito"]) {
    const found = value[key];
    if (typeof found === "string" && found.trim()) return found.trim();
  }
  return fallback;
}

function diffsOf(label: string, value: unknown): DiffRow[] {
  const pair = pairOf(value);
  if (pair) return [{ label, ...pair }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (!isRecord(item)) return [];
      const nested = pairOf(item);
      if (!nested) return [];
      return [{ label: labelOf(item, `${label} ${index + 1}`), ...nested }];
    });
  }
  return [];
}

function priceLine(item: Record<string, unknown>): string | null {
  const qty = item.min_qty ?? item.qty;
  const price = item.unit_price ?? item.price ?? item.importe;
  if (qty == null && price == null) return null;
  const parts = [];
  if (qty != null) parts.push(String(qty));
  if (price != null) parts.push(`${price} €`);
  return parts.join(" · ");
}

function linesOf(label: string, value: unknown, depth: number): PayloadRow[] {
  if (depth > 2) return [{ label, value: textOf(value) || "…" }];
  if (value == null || typeof value !== "object") return [{ label, value: textOf(value) }];
  if (Array.isArray(value)) {
    const prices = value.flatMap((item) => (isRecord(item) ? [priceLine(item)] : [])).filter((item): item is string => Boolean(item));
    if (prices.length > 0) {
      const head = prices.slice(0, 6).map((line, index) => ({ label: `${label} ${index + 1}`, value: line }));
      if (prices.length > 6) {
        head.push({ label, value: fill(copy.approvals.moreLines, { n: String(prices.length - 6) }) });
      }
      return [{ label, value: fill(copy.approvals.lines, { n: String(prices.length) }) }, ...head];
    }
    return [{ label, value: fill(copy.approvals.lines, { n: String(value.length) }) }];
  }
  const record = value as Record<string, unknown>;
  const rows: PayloadRow[] = [];
  for (const key of Object.keys(record).sort()) {
    if (SKIP.has(key)) continue;
    const child = record[key];
    const childLabel = key.replaceAll("_", " ");
    if (child != null && typeof child === "object") rows.push(...linesOf(childLabel, child, depth + 1));
    else rows.push({ label: childLabel, value: textOf(child) });
  }
  return rows.length > 0 ? rows : [{ label, value: "—" }];
}

/** Summary rows plus a before/after list when the payload carries one. */
export function presentPayload(rows: PayloadRow[]): PresentedPayload {
  const lines: PayloadRow[] = [];
  const diffs: DiffRow[] = [];
  for (const row of rows) {
    if (!row.value.trim() || UUID.test(row.value.trim()) || row.label.endsWith(" id")) continue;
    const parsed = tryJson(row.value);
    if (parsed == null) {
      const prices = row.value.includes("unit_price") ? salvagePrices(row.value) : [];
      if (prices.length > 0) {
        const truncated = !row.value.trim().endsWith("]");
        prices.slice(0, 4).map(tidy).forEach((line, index) => {
          lines.push({ label: `Precio ${index + 1}`, value: line });
        });
        if (!truncated && prices.length > 4) {
          lines.push({ label: "Precios", value: fill(copy.approvals.moreLines, { n: String(prices.length - 4) }) });
        }
        continue;
      }
      lines.push(row);
      continue;
    }
    const found = diffsOf(row.label, parsed);
    if (found.length > 0) {
      diffs.push(...found);
      continue;
    }
    if (isRecord(parsed)) {
      const nested: DiffRow[] = [];
      const rest: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const inner = diffsOf(key.replaceAll("_", " "), value);
        if (inner.length > 0) nested.push(...inner);
        else rest[key] = value;
      }
      if (nested.length > 0) {
        diffs.push(...nested);
        lines.push(...linesOf(row.label, rest, 0).filter((line) => line.label !== row.label || Object.keys(rest).length === 0));
        continue;
      }
    }
    lines.push(...linesOf(row.label, parsed, 0));
  }
  return {
    lines: lines.slice(0, 24).map((line) => ({ label: labelize(line.label), value: line.value })),
    diffs: diffs.slice(0, 24),
  };
}
