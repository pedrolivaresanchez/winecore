import { seesPersonalContactData, isRoleCode, type UserCtx } from "../core/auth/permissions";
import type { Actor, Writer } from "../core/db/writer";
import { domainError, type DomainError } from "../core/errors";
import type { McpContext } from "./registry";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireWriter(ctx: McpContext): Writer {
  if (!ctx.deps.writer) {
    throw domainError("WC002", undefined, "Falta el almacén de datos.");
  }
  return ctx.deps.writer;
}

export function actorOf(ctx: McpContext, reason: string): Actor {
  const requestId = ctx.requestId && ctx.requestId.trim() !== "" ? ctx.requestId : "mcp";
  if (ctx.principal === "user" && ctx.actor) {
    return { type: "user", id: ctx.actor.id, requestId, reason };
  }
  return {
    type: "agent",
    id: ctx.client.id,
    onBehalfOf: ctx.actor?.id,
    requestId,
    reason,
  };
}

export function viewerOf(ctx: McpContext): UserCtx {
  const roles = (ctx.actor?.roles ?? []).flatMap((role) =>
    isRoleCode(role) ? [{ role, legalEntityId: null, legalEntityCode: null }] : [],
  );
  return {
    id: ctx.actor?.id ?? ctx.client.id,
    email: "",
    displayName: ctx.actor?.name ?? "",
    roles,
  };
}

export function seesPersonal(ctx: McpContext): boolean {
  return seesPersonalContactData(viewerOf(ctx));
}

export function webLink(ctx: McpContext, path: string): string {
  const origin = (ctx.deps.webBaseUrl ?? "").replace(/\/$/, "");
  return `${origin}${path}`;
}

export function previewStale(message = "Los datos han cambiado. Prepara de nuevo la operación."): DomainError {
  return domainError("WC_MCP_PREVIEW_STALE", undefined, message);
}

export function maskTaxId(value: string | null | undefined): string {
  if (!value) return "";
  return `****${value.slice(-5)}`;
}

export function litersFromMl(ml: number): string {
  const sign = ml < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(ml));
  const whole = Math.trunc(abs / 1000);
  const frac = String(abs % 1000).padStart(3, "0");
  return `${sign}${whole}.${frac}`;
}

/** Liters with at most 3 decimal places, as a positive millilitre integer. */
export function mlFromLiters(value: string, field: string): number {
  if (!/^\d+(\.\d{1,3})?$/.test(value)) {
    throw domainError("WC_VALIDATION", { [field]: "Usa litros con hasta 3 decimales" });
  }
  const [whole, frac = ""] = value.split(".");
  const ml = Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
  if (!Number.isSafeInteger(ml) || ml <= 0) {
    throw domainError("WC_VALIDATION", { [field]: "El volumen debe ser mayor que cero" });
  }
  return ml;
}

export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value ?? "");
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return text;
  return new Date(parsed).toISOString();
}

export function text(value: unknown): string | null {
  if (value == null) return null;
  const rendered = String(value);
  return rendered === "" ? null : rendered;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function asCount(value: unknown): number {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function jsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed.map((item) => String(item));
      } catch {
        /* DuckDB sometimes returns a list as a bracketed string. */
      }
    }
    return trimmed.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  }
  return [];
}
