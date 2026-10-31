import { isAuthEnabled } from "@/auth/config";
import { clearTokens, getAccessToken, refreshAccessToken } from "@/auth/tokens";
import { copy } from "@/i18n";
import { markNoAccess } from "@/lib/access";

const NO_ACCESS = new Set(["WC_NO_ACCESS", "WC_AUTH_NOT_ALLOWED"]);

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
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

async function readError(response: Response): Promise<ApiError> {
  let payload: { code?: unknown; message?: unknown; fields?: unknown } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }
  const code = typeof payload.code === "string" ? payload.code : "WC_ERROR";
  const message = typeof payload.message === "string" ? payload.message : copy.api.generic;
  return new ApiError(response.status, code, message, normalizeFields(payload.fields));
}

function redirectToLogin() {
  if (window.location.pathname.startsWith("/login")) return;
  window.location.assign("/login");
}

export async function api<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body != null && !headers.has("Content-Type")) {
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
    if (isAuthEnabled && !retried && (await refreshAccessToken())) {
      return api<T>(path, init, true);
    }
    if (isAuthEnabled) {
      clearTokens();
      redirectToLogin();
      throw new ApiError(401, "WC_UNAUTHENTICATED", copy.api.expired);
    }
    throw new ApiError(401, "WC_UNAUTHENTICATED", copy.api.authOff);
  }

  if (!response.ok) {
    const error = await readError(response);
    if (error.status === 403 && NO_ACCESS.has(error.code)) markNoAccess();
    throw error;
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, "WC_BAD_RESPONSE", copy.api.invalid);
  }
}
