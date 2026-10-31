/// <reference lib="dom" />

import { McpToolError } from "./errors";

/** Upper bound enforced by ops.mcp_confirmation (created_at + 15 minutes). */
export const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

/**
 * One prepared write. The raw token is never stored: `tokenHash` is the hex
 * SHA-256 of the base64url token. `payloadSha256` binds the canonical payload.
 */
export interface ConfirmationRecord {
  tokenHash: string;
  toolName: string;
  clientId: string;
  payloadSha256: string;
  preview: unknown;
  payload: unknown;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  result: unknown | null;
}

export interface ConfirmationStore {
  create(record: ConfirmationRecord): Promise<void>;
  get(tokenHash: string): Promise<ConfirmationRecord | null>;
  markConsumed(tokenHash: string, result: unknown): Promise<void>;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/** In-memory stand-in for ops.mcp_confirmation. Returns copies from `get`. */
export class InMemoryConfirmationStore implements ConfirmationStore {
  private readonly rows = new Map<string, ConfirmationRecord>();

  async create(record: ConfirmationRecord): Promise<void> {
    if (this.rows.has(record.tokenHash)) {
      throw new Error("confirmation already exists");
    }
    this.rows.set(record.tokenHash, cloneJson(record));
  }

  async get(tokenHash: string): Promise<ConfirmationRecord | null> {
    const record = this.rows.get(tokenHash);
    return record ? cloneJson(record) : null;
  }

  async markConsumed(tokenHash: string, result: unknown): Promise<void> {
    const record = this.rows.get(tokenHash);
    if (!record) {
      throw new Error("confirmation not found");
    }
    if (record.consumedAt !== null) return;
    record.consumedAt = new Date().toISOString();
    record.result = cloneJson(result);
  }
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  let index = 0;
  while (index + 2 < bytes.length) {
    const b0 = bytes[index] ?? 0;
    const b1 = bytes[index + 1] ?? 0;
    const b2 = bytes[index + 2] ?? 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64URL[(triple >> 18) & 63];
    out += BASE64URL[(triple >> 12) & 63];
    out += BASE64URL[(triple >> 6) & 63];
    out += BASE64URL[triple & 63];
    index += 3;
  }
  if (index < bytes.length) {
    const b0 = bytes[index] ?? 0;
    const b1 = index + 1 < bytes.length ? (bytes[index + 1] ?? 0) : 0;
    const triple = (b0 << 16) | (b1 << 8);
    out += BASE64URL[(triple >> 18) & 63];
    out += BASE64URL[(triple >> 12) & 63];
    if (index + 1 < bytes.length) out += BASE64URL[(triple >> 6) & 63];
  }
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new McpToolError("WC_VALIDATION", "Los datos preparados no son válidos.", {
        payload: "Número no finito",
      });
    }
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) sorted[key] = canonicalize(child);
    }
    return sorted;
  }
  throw new McpToolError("WC_VALIDATION", "Los datos preparados no son válidos.", {
    payload: "Tipo no serializable",
  });
}

/** Stable JSON used to bind a confirmation to the payload that will be committed. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export interface IssuedConfirmation {
  token: string;
  expiresAt: string;
}

export async function issueConfirmation(input: {
  store: ConfirmationStore;
  now: Date;
  toolName: string;
  clientId: string;
  preview: unknown;
  payload: unknown;
}): Promise<IssuedConfirmation> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const payloadSha256 = await sha256Hex(canonicalJson(input.payload));
  const createdAt = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + CONFIRMATION_TTL_MS).toISOString();
  await input.store.create({
    tokenHash,
    toolName: input.toolName,
    clientId: input.clientId,
    payloadSha256,
    preview: input.preview,
    payload: input.payload,
    createdAt,
    expiresAt,
    consumedAt: null,
    result: null,
  });
  return { token, expiresAt };
}

const inFlight = new Map<string, Promise<unknown>>();

function invalid(messageEs: string): McpToolError {
  return new McpToolError("WC_MCP_CONFIRMATION_INVALID", messageEs);
}

async function consumeOnce(
  input: {
    store: ConfirmationStore;
    now: Date;
    toolName: string;
    clientId: string;
    execute: (payload: unknown) => Promise<unknown>;
  },
  tokenHash: string,
): Promise<unknown> {
  const record = await input.store.get(tokenHash);
  if (!record) throw invalid("La confirmación no es válida.");
  if (record.toolName !== input.toolName) {
    throw invalid("La confirmación no corresponde a esta herramienta.");
  }
  if (record.clientId !== input.clientId) {
    throw invalid("La confirmación pertenece a otro cliente.");
  }
  if (record.consumedAt !== null) return record.result;

  const actualHash = await sha256Hex(canonicalJson(record.payload));
  if (actualHash !== record.payloadSha256) {
    throw invalid("La confirmación no coincide con los datos preparados.");
  }
  const expiresAt = Date.parse(record.expiresAt);
  if (Number.isNaN(expiresAt) || input.now.getTime() > expiresAt) {
    throw invalid("La confirmación ha caducado. Prepara de nuevo la operación.");
  }

  const result = await input.execute(record.payload);
  await input.store.markConsumed(tokenHash, result);
  return result;
}

/**
 * Runs the prepared payload once. A second call with the same token returns the
 * stored result and does not call `execute` again.
 */
export async function consumeConfirmation(input: {
  store: ConfirmationStore;
  now: Date;
  token: string;
  toolName: string;
  clientId: string;
  execute: (payload: unknown) => Promise<unknown>;
}): Promise<unknown> {
  const pending = inFlight.get(input.token);
  if (pending) return pending;
  const run = (async () => {
    const tokenHash = await sha256Hex(input.token);
    return consumeOnce(input, tokenHash);
  })().finally(() => {
    inFlight.delete(input.token);
  });
  inFlight.set(input.token, run);
  return run;
}
