/// <reference path="./ambient.d.ts" />

import {
  TIMBAL_API_BASE_URL,
  TargetRefusedError,
  assertAllowedApiPath,
  assertTimbalBaseUrl,
  redactSecrets,
  requireApiKey,
} from "./config";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type TimbalResponse = {
  status: number;
  body: unknown;
};

export type TimbalClientOptions = {
  token: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  /** Reintentos extra tras el primer intento. El SDK usa 3 (`retryAttempts`). */
  retryAttempts?: number;
  /** Base del backoff lineal: espera `retryDelayMs * n` en el reintento n. El SDK usa 1000. */
  retryDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

export class TimbalApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "TimbalApiError";
    this.status = status;
    this.code = code;
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseErrorBody(text: string, statusText: string): { message: string; code?: string } {
  try {
    const data = JSON.parse(text) as { message?: unknown; error?: unknown; code?: unknown };
    const message =
      typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : statusText || "error de Timbal";
    const code = typeof data.code === "string" ? data.code : undefined;
    return code === undefined ? { message } : { message, code };
  } catch {
    return { message: statusText || "error de Timbal" };
  }
}

/**
 * Cliente HTTP de la API de Timbal.
 * Base `https://api.timbal.ai` y cabecera `Authorization: Bearer` (SDK `ApiClient.prepareRequest`
 * y esquema `bearer_auth` de docs.timbal.ai). No escribe la clave ni la cabecera en el log.
 */
export class TimbalClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (message: string) => void;
  private readonly secrets: readonly string[];

  constructor(options: TimbalClientOptions) {
    this.token = requireApiKey(options.token);
    this.baseUrl = assertTimbalBaseUrl(options.baseUrl ?? TIMBAL_API_BASE_URL);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryAttempts = options.retryAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.secrets = [this.token];
    const emit = options.log ?? ((message: string) => console.error(message));
    this.log = (message: string) => emit(redactSecrets(message, this.secrets));
  }

  async request(method: string, path: string, body?: unknown): Promise<TimbalResponse> {
    assertAllowedApiPath(path);
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    for (let attempt = 0; attempt <= this.retryAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await response.text();
        if (!response.ok) {
          const parsed = parseErrorBody(text, response.statusText);
          const message = redactSecrets(parsed.message, this.secrets);
          const code = parsed.code === undefined ? undefined : redactSecrets(parsed.code, this.secrets);
          const failure = new TimbalApiError(message, response.status, code);
          if (!RETRYABLE_STATUS.has(response.status) || attempt === this.retryAttempts) {
            this.log(`Timbal ${method} ${path} -> ${response.status}: ${message}`);
            throw failure;
          }
          this.log(`Timbal ${method} ${path} -> ${response.status}; reintento ${attempt + 1}`);
          await this.sleep(this.retryDelayMs * (attempt + 1));
          continue;
        }
        if (text.trim() === "") return { status: response.status, body: null };
        try {
          return { status: response.status, body: JSON.parse(text) as unknown };
        } catch {
          const failure = new TimbalApiError(`Respuesta JSON ilegible (${response.status})`, response.status);
          this.log(failure.message);
          throw failure;
        }
      } catch (error) {
        if (error instanceof TimbalApiError || error instanceof TargetRefusedError) throw error;
        const message = redactSecrets(error instanceof Error ? error.message : "error de red", this.secrets);
        if (attempt === this.retryAttempts) {
          this.log(`Timbal ${method} ${path} error de red: ${message}`);
          throw new TimbalApiError(message, 0);
        }
        this.log(`Timbal ${method} ${path} error de red; reintento ${attempt + 1}`);
        await this.sleep(this.retryDelayMs * (attempt + 1));
      }
    }
    throw new TimbalApiError("reintentos agotados", 0);
  }
}
