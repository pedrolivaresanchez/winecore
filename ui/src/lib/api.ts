import { isAuthEnabled } from "@/auth/config";
import { clearTokens, getAccessToken, refreshAccessToken } from "@/auth/tokens";
import { copy } from "@/i18n";
import { markNoAccess } from "@/lib/access";

const NO_ACCESS = new Set(["WC_NO_ACCESS", "WC_AUTH_NOT_ALLOWED"]);

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

export function fieldError(error: unknown, name: string): string | undefined {
  if (!(error instanceof ApiError) || !error.fields) return undefined;
  return error.fields[name];
}

function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  return (configured && configured.length > 0 ? configured : "/api").replace(/\/$/, "");
}

function buildUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase()}${suffix}`;
}

function normalizeFields(fields: unknown): Record<string, string> | undefined {
  if (!fields || typeof fields !== "object") return undefined;

  const out: Record<string, string> = {};
  if (Array.isArray(fields)) {
    for (const item of fields) {
      if (!item || typeof item !== "object") continue;
      const field = "field" in item ? item.field : undefined;
      const message = "message" in item ? item.message : undefined;
      if (typeof field === "string" && typeof message === "string") out[field] = message;
    }
  } else {
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "string") out[key] = value;
      else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0];
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeDetails(details: unknown): Record<string, unknown> | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  return details as Record<string, unknown>;
}

async function readError(response: Response): Promise<ApiError> {
  let payload: { code?: unknown; message?: unknown; fields?: unknown; details?: unknown } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }
  const code = typeof payload.code === "string" ? payload.code : "WC_ERROR";
  const message = typeof payload.message === "string" ? payload.message : copy.api.generic;
  return new ApiError(response.status, code, message, normalizeFields(payload.fields), normalizeDetails(payload.details));
}

function redirectToLogin() {
  if (window.location.pathname.startsWith("/login")) return;
  window.location.assign("/login");
}

async function send(path: string, init: RequestInit | undefined, retried: boolean): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init?.body != null && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (isAuthEnabled) {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path), { ...init, headers, cache: "no-store" });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, "WC_NETWORK", copy.api.offline);
  }

  if (response.status === 401) {
    // La verificación reforzada también responde 401. No es una sesión caducada.
    // clone: el cuerpo se vuelve a leer debajo si hay que renovar o rechazar la sesión.
    const denied = await readError(response.clone());
    if (denied.code === "WC_STEP_UP_REQUIRED" || denied.code === "WC_VERIFY_FAILED") throw denied;
    if (isAuthEnabled && !retried && (await refreshAccessToken())) return send(path, init, true);
    if (isAuthEnabled) {
      clearTokens();
      redirectToLogin();
      throw new ApiError(401, "WC_UNAUTHENTICATED", copy.api.expired);
    }
    throw new ApiError(401, denied.code === "WC_ERROR" ? "WC_UNAUTHENTICATED" : denied.code, denied.code === "WC_ERROR" ? copy.api.authOff : denied.message, denied.fields);
  }

  if (!response.ok) {
    const error = await readError(response);
    if (error.status === 403 && NO_ACCESS.has(error.code)) markNoAccess();
    throw error;
  }
  return response;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init, false);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, "WC_BAD_RESPONSE", copy.api.invalid);
  }
}

export async function apiBlob(path: string, init?: RequestInit): Promise<{ blob: Blob; filename: string | null }> {
  const response = await send(path, init, false);
  const header = response.headers.get("Content-Disposition") ?? "";
  const matched = /filename="([^"]+)"/.exec(header);
  return { blob: await response.blob(), filename: matched?.[1] ?? null };
}

export async function apiText(path: string, init?: RequestInit): Promise<string> {
  const response = await send(path, { ...init, headers: { Accept: "text/csv", ...headersOf(init) } }, false);
  return response.text();
}

function headersOf(init?: RequestInit): Record<string, string> {
  const headers = new Headers(init?.headers);
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
