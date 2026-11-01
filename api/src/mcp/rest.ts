import type { ZodType } from "zod";

import { delegateSession } from "../auth/guard";
import { MAX_MCP_UPLOAD_BYTES } from "../core/attachments/mime";
import { DomainError, domainError } from "../core/errors";
import { sha256Hex } from "../core/hash";
import { newId } from "../core/ids";
import { canonicalJson } from "./confirm";
import { defineReadTool, defineWriteTool, type McpContext, type ReadTool, type WriteTool } from "./registry";
import { previewStale, webLink } from "./runtime";

/**
 * REST-backed tools. Each one replays, in process and as the represented person, the
 * route the web app calls: same guards, validations, approvals and audit as the UI.
 */

export type RestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** `METHOD /v1/path/:param`, exactly as the route is registered. */
export type RestRoute = `${RestMethod} /v1/${string}`;

type Fields = Record<string, unknown>;

export interface RestUpload {
  /** Form field the route reads the file from. */
  field: string;
  /** Other input fields sent as form fields. Everything else is ignored. */
  formFields?: readonly string[];
}

interface RestShape<T> {
  route: RestRoute;
  /** Path parameter → input field. By default each `:param` reads the input field of the same name. */
  params?: Record<string, string>;
  /**
   * Builds the query (GET) or the JSON body (writes). By default: every input field that is not
   * a path parameter. Writes get the `current` record, so a route that replaces the whole record
   * can be sent the record with the person's changes applied.
   */
  send?: (input: T, current: unknown) => Fields | unknown[] | undefined;
  /** Multipart upload: the input carries `file_base64`, `filename` and `content_type`. */
  upload?: RestUpload;
}

export interface RestReadDefinition<T> extends RestShape<T> {
  name: string;
  module: string;
  scope: string;
  title: string;
  description: string;
  input: ZodType<T>;
  extraScopes?: readonly string[];
  /** Other routes this tool also stands for (a CSV export of the same list, a sub-resource it includes…). */
  alsoCovers?: readonly RestRoute[];
  /** Web app path for the result, so the person can open it. */
  web?: (input: T, body: unknown) => string | null;
  /** Required when `route` is not a GET: why the route saves nothing (a calculator, a check, a preview). */
  computeOnly?: string;
}

export interface RestWriteDefinition<T> extends RestShape<T> {
  name: string;
  module: string;
  scope: string;
  title: string;
  description: string;
  input: ZodType<T>;
  extraScopes?: readonly string[];
  alsoCovers?: readonly RestRoute[];
  /**
   * GET route of the record the write changes. The preview shows it, and the commit
   * refuses with WC_MCP_PREVIEW_STALE if its status or `updated_at` moved meanwhile.
   */
  current?: { route: RestRoute; params?: Record<string, string> };
  /** `If-Match` for the write. By default the `updated_at` of `current`, as the web app sends it. */
  ifMatch?: (current: unknown) => string | null;
  /** One or two sentences for the person, in Spanish. Defaults to the title and the record's label. */
  summary?: (input: T, current: unknown) => string;
  web?: (input: T, body: unknown) => string | null;
}

interface RestRequest {
  method: RestMethod;
  path: string;
  query?: Fields;
  json?: unknown;
  headers?: Record<string, string>;
  upload?: { field: string; filename: string; contentType: string; base64: string; form: Record<string, string> };
}

interface RestPayload {
  input: unknown;
  request: RestRequest;
  current: { path: string; stamp: string | null } | null;
}

const MAX_TEXT_CHARS = 200_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const STAMP_KEYS = ["updated_at", "status", "version", "row_version", "closed_at", "archived_at"] as const;

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function routeParts(route: RestRoute): { method: RestMethod; path: string } {
  const space = route.indexOf(" ");
  return { method: route.slice(0, space) as RestMethod, path: route.slice(space + 1) };
}

function paramNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1] as string);
}

function fillPath(path: string, input: Fields, mapping: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_, name: string) => {
    const field = mapping[name] ?? name;
    const value = input[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw domainError("WC_VALIDATION", { [field]: "Obligatorio" });
    }
    return encodeURIComponent(String(value));
  });
}

function pathFields<T>(shape: RestShape<T>): Set<string> {
  const { path } = routeParts(shape.route);
  return new Set(paramNames(path).map((name) => shape.params?.[name] ?? name));
}

const UPLOAD_FIELDS = new Set(["file_base64", "filename", "content_type"]);

function defaultSend<T>(shape: RestShape<T>, input: T): Fields {
  const skip = pathFields(shape);
  const out: Fields = {};
  for (const [key, value] of Object.entries(isRecord(input) ? input : {})) {
    if (skip.has(key) || value === undefined) continue;
    if (shape.upload && UPLOAD_FIELDS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function buildRequest<T>(shape: RestShape<T>, input: T, current: unknown = null): RestRequest {
  const fields: Fields = isRecord(input) ? input : {};
  const { method, path } = routeParts(shape.route);
  const filled = fillPath(path, fields, shape.params);
  const sent = shape.send ? shape.send(input, current) : defaultSend(shape, input);
  if (shape.upload) {
    const base64 = fields.file_base64;
    const filename = fields.filename;
    const contentType = fields.content_type;
    if (typeof base64 !== "string" || base64.length === 0) throw domainError("WC_VALIDATION", { file_base64: "Obligatorio" });
    if (typeof filename !== "string" || filename.trim() === "") throw domainError("WC_VALIDATION", { filename: "Obligatorio" });
    if (typeof contentType !== "string" || contentType.trim() === "") throw domainError("WC_VALIDATION", { content_type: "Obligatorio" });
    const form: Record<string, string> = {};
    for (const key of shape.upload.formFields ?? []) {
      const value = fields[key];
      if (value === undefined || value === null) continue;
      form[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
    return { method, path: filled, upload: { field: shape.upload.field, filename, contentType, base64, form } };
  }
  if (method === "GET") return { method, path: filled, query: isRecord(sent) ? sent : undefined };
  return { method, path: filled, json: sent ?? {} };
}

function queryString(query: Fields | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
      continue;
    }
    params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

function decodeBase64(value: string, field: string): Uint8Array {
  const clean = value.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw domainError("WC_VALIDATION", { [field]: "No es base64" });
  const bytes = Buffer.from(clean, "base64");
  if (bytes.length === 0) throw domainError("WC_VALIDATION", { [field]: "El fichero está vacío" });
  if (bytes.length > MAX_MCP_UPLOAD_BYTES) throw domainError("WC_VALIDATION", { [field]: "El fichero es demasiado grande" });
  return new Uint8Array(bytes);
}

function requireRest(ctx: McpContext): NonNullable<McpContext["deps"]["rest"]> {
  if (!ctx.deps.rest) throw domainError("WC002", undefined, "Falta el enrutador de la API.");
  return ctx.deps.rest;
}

function requireSession(ctx: McpContext) {
  if (!ctx.session) {
    throw domainError("WC_FORBIDDEN", undefined, "Este cliente no actúa en nombre de ninguna persona: no puede usar las herramientas de la app.");
  }
  return ctx.session;
}

function toRequest(ctx: McpContext, call: RestRequest): Request {
  const rest = requireRest(ctx);
  const url = `http://winecore.internal${rest.basePath}${call.path}${queryString(call.query)}`;
  const headers = new Headers({ ...call.headers, accept: "application/json" });
  const requestId = `mcp.${ctx.requestId && /^[A-Za-z0-9._:-]{1,70}$/.test(ctx.requestId) ? ctx.requestId : newId()}`;
  headers.set("x-request-id", requestId);
  let body: FormData | string | undefined;
  if (call.upload) {
    const form = new FormData();
    const bytes = decodeBase64(call.upload.base64, "file_base64");
    form.set(call.upload.field, new File([bytes], call.upload.filename, { type: call.upload.contentType }));
    for (const [key, value] of Object.entries(call.upload.form)) form.set(key, value);
    body = form;
  } else if (call.method !== "GET" && call.method !== "DELETE") {
    headers.set("content-type", "application/json");
    body = JSON.stringify(call.json ?? {});
  }
  const request = new Request(url, { method: call.method, headers, body });
  delegateSession(request, requireSession(ctx));
  return request;
}

function filenameOf(response: Response): string | null {
  const disposition = response.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1] ?? null;
}

async function errorFrom(response: Response): Promise<DomainError> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = null;
  }
  if (isRecord(body) && typeof body.code === "string") {
    const message = typeof body.message === "string" ? body.message : "La operación no se ha podido hacer.";
    const fields = isRecord(body.fields)
      ? Object.fromEntries(Object.entries(body.fields).map(([key, value]) => [key, String(value)]))
      : undefined;
    return new DomainError(body.code, response.status, message, fields);
  }
  if (response.status === 404) return domainError("WC_NOT_FOUND");
  if (response.status === 401) return domainError("WC_UNAUTHENTICATED");
  if (response.status === 403) return domainError("WC_FORBIDDEN");
  return domainError("WC002", undefined, `La API respondió ${response.status}.`);
}

/** WHATWG decodes all of these as windows-1252. */
const LATIN_CHARSETS = new Set(["iso-8859-1", "iso8859-1", "latin1", "us-ascii", "ascii", "windows-1252", "cp1252"]);

async function decode(response: Response): Promise<unknown> {
  if (response.status === 204) return { ok: true };
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("json")) {
    const text = await response.text();
    if (text.trim() === "") return { ok: true };
    return JSON.parse(text) as unknown;
  }
  const filename = filenameOf(response);
  const contentType = type.split(";")[0]?.trim() || "application/octet-stream";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (type.startsWith("text/") || type.includes("csv")) {
    const charset = /charset=([^;]+)/.exec(type)?.[1]?.trim().replace(/"/g, "") ?? "utf-8";
    const utf8 = charset === "utf-8" || charset === "utf8";
    const decoder = LATIN_CHARSETS.has(charset) ? "windows-1252" : charset.startsWith("utf-16") ? "utf-16" : "utf-8";
    const text = new TextDecoder(decoder).decode(bytes);
    const clipped = text.length > MAX_TEXT_CHARS;
    return {
      filename,
      content_type: contentType,
      text: clipped ? text.slice(0, MAX_TEXT_CHARS) : text,
      truncated: clipped,
      // Files filed elsewhere (SILICIE CSV in ISO-8859-1) must keep their exact bytes.
      ...(utf8 || bytes.length > MAX_FILE_BYTES ? {} : {
        charset,
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        base64: Buffer.from(bytes).toString("base64"),
      }),
    };
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return { filename, content_type: contentType, size_bytes: bytes.length, base64: null, note_es: "El fichero pasa de 10 MB: descárgalo desde la app." };
  }
  return {
    filename,
    content_type: contentType,
    size_bytes: bytes.length,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    base64: Buffer.from(bytes).toString("base64"),
  };
}

export async function restCall(ctx: McpContext, call: RestRequest): Promise<unknown> {
  const response = await requireRest(ctx).handle(toRequest(ctx, call));
  if (!response.ok) throw await errorFrom(response);
  return decode(response);
}

function withLink(ctx: McpContext, body: unknown, path: string | null): unknown {
  if (!path) return body;
  const web = webLink(ctx, path);
  if (isRecord(body)) return { ...body, links: { ...(isRecord(body.links) ? body.links : {}), web } };
  return { data: body, links: { web } };
}

function recordOf(value: unknown): Fields | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.data)) return value.data;
  return value;
}

function stampOf(value: unknown): string | null {
  const record = recordOf(value);
  if (!record) return null;
  const parts: Fields = {};
  for (const key of STAMP_KEYS) if (key in record) parts[key] = record[key];
  return Object.keys(parts).length === 0 ? null : sha256Hex(canonicalJson(parts));
}

/**
 * For routes that replace the whole record: `keys` from the current record (or from the
 * element of `current[list]` whose `id` is `id`), with the person's changes on top.
 */
export function patchOnto(
  current: unknown,
  keys: readonly string[],
  changes: Fields | undefined,
  nested?: { list: string; id: string },
): Fields {
  let record = recordOf(current) ?? {};
  if (nested) {
    const items = record[nested.list];
    const found = Array.isArray(items) ? items.find((item) => isRecord(item) && item.id === nested.id) : undefined;
    if (!isRecord(found)) throw domainError("WC_NOT_FOUND");
    record = found;
  }
  const out: Fields = {};
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function updatedAtOf(value: unknown): string | null {
  const found = recordOf(value)?.updated_at;
  return typeof found === "string" && found !== "" ? found : null;
}

const LABEL_KEYS = ["number", "code", "legal_name", "name", "display_name", "title", "sku", "label"] as const;

function labelOf(value: unknown): string | null {
  const record = recordOf(value);
  if (!record) return null;
  for (const key of LABEL_KEYS) {
    const found = record[key];
    if (typeof found === "string" && found.trim() !== "") return found.trim().slice(0, 80);
  }
  return null;
}

/** Large base64 blobs do not belong in a preview. */
function compact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (typeof value === "string") return value.length > 600 ? `${value.slice(0, 600)}…` : value;
  if (Array.isArray(value)) {
    const head = value.slice(0, 50).map((item) => compact(item, depth + 1));
    return value.length > 50 ? [...head, `… y ${value.length - 50} más`] : head;
  }
  if (!isRecord(value)) return value;
  const out: Fields = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = key === "file_base64" || key === "base64" ? "[fichero]" : compact(item, depth + 1);
  }
  return out;
}

export function defineRestRead<T>(definition: RestReadDefinition<T>): ReadTool {
  return defineReadTool<T>({
    name: definition.name,
    module: definition.module,
    scope: definition.scope,
    title: definition.title,
    description: definition.description,
    input: definition.input,
    extraScopes: definition.extraScopes,
    routes: [definition.route, ...(definition.alsoCovers ?? [])],
    computeOnly: definition.computeOnly,
    handler: async (ctx, input) => {
      const body = await restCall(ctx, buildRequest(definition, input));
      return withLink(ctx, body, definition.web?.(input, body) ?? null);
    },
  });
}

export function defineRestWrite<T>(definition: RestWriteDefinition<T>): WriteTool {
  return defineWriteTool<T, RestPayload>({
    name: definition.name,
    module: definition.module,
    scope: definition.scope,
    title: definition.title,
    description: definition.description,
    input: definition.input,
    extraScopes: definition.extraScopes,
    routes: [definition.route, ...(definition.alsoCovers ?? [])],
    prepare: async (ctx, input) => {
      requireSession(ctx);
      let current: unknown = null;
      let currentPath: string | null = null;
      if (definition.current) {
        const { path } = routeParts(definition.current.route);
        currentPath = fillPath(path, isRecord(input) ? input : {}, definition.current.params ?? definition.params);
        current = await restCall(ctx, { method: "GET", path: currentPath });
      }
      const built = buildRequest(definition, input, current);
      const version = definition.ifMatch ? definition.ifMatch(current) : updatedAtOf(current);
      const request: RestRequest = {
        ...built,
        // Fixed at prepare time: a commit retried after a timeout replays instead of writing twice.
        headers: { "idempotency-key": `mcp-${newId()}`, ...(version ? { "if-match": version } : {}) },
      };
      const label = labelOf(current);
      const summary = definition.summary?.(input, current)
        ?? `${definition.title}${label ? `: ${label}` : ""}. ¿Confirmas?`;
      return {
        preview: {
          operation: definition.title,
          route: `${request.method} ${request.path}`,
          record: current === null ? null : compact(current),
          changes: compact(request.upload ? { ...request.upload.form, filename: request.upload.filename } : request.json ?? request.query ?? null),
        },
        payload: { input, request, current: currentPath ? { path: currentPath, stamp: stampOf(current) } : null },
        summary_es: summary,
      };
    },
    commit: async (ctx, payload) => {
      if (payload.current?.stamp) {
        const now = await restCall(ctx, { method: "GET", path: payload.current.path });
        if (stampOf(now) !== payload.current.stamp) throw previewStale();
      }
      const body = await restCall(ctx, payload.request);
      return withLink(ctx, body, definition.web?.(payload.input as T, body) ?? null);
    },
  });
}
