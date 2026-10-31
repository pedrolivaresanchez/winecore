/// <reference path="./ambient.d.ts" />

import type { FetchLike } from "./client";
import {
  assertCommitSha,
  assertGithubRef,
  positiveInt,
  redactSecrets,
} from "./config";

export class SmokeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokeError";
  }
}

export const SMOKE_ATTEMPTS = 12;
export const SMOKE_DELAY_MS = 5_000;

/** `TIMBAL_MAIN_URL` es solo el origen https. El humo pide `{origen}/api/health`. */
export function healthUrl(mainUrl: string): string {
  let url: URL;
  try {
    url = new URL(mainUrl);
  } catch {
    throw new SmokeError("TIMBAL_MAIN_URL no es una URL");
  }
  if (url.protocol !== "https:") throw new SmokeError("TIMBAL_MAIN_URL tiene que ser https");
  if (url.username !== "" || url.password !== "") throw new SmokeError("TIMBAL_MAIN_URL no admite credenciales");
  if (url.search !== "" || url.hash !== "") throw new SmokeError("TIMBAL_MAIN_URL no admite query ni fragmento");
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new SmokeError("TIMBAL_MAIN_URL es solo el origen, sin ruta");
  }
  return `https://${url.host}/api/health`;
}

function showSha(value: unknown): string {
  if (typeof value !== "string") return "(ausente)";
  if (/^[0-9a-f]{7,64}$/i.test(value.trim())) return value.trim().toLowerCase();
  return "(no es una sha)";
}

export type SmokeOptions = {
  mainUrl: string;
  expectedSha: string;
  fetchImpl?: FetchLike;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  githubRef?: string;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * GET `{TIMBAL_MAIN_URL}/api/health` sin credencial de Timbal.
 * Tiene que responder `sha` igual a la del commit. Reintenta en red, HTTP no OK y sha distinta.
 */
export async function smokeRemote(options: SmokeOptions): Promise<{ sha: string }> {
  assertGithubRef(options.githubRef);
  const expected = assertCommitSha(options.expectedSha);
  const url = healthUrl(options.mainUrl);
  const attempts = options.attempts ?? SMOKE_ATTEMPTS;
  const delayMs = options.delayMs ?? SMOKE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (attempts < 1) throw new SmokeError("Hace falta al menos un intento de humo");

  let last = "sin respuesta";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const text = await response.text();
      if (!response.ok) {
        last = `HTTP ${response.status}`;
      } else {
        let body: unknown;
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          last = "JSON ilegible";
          body = null;
        }
        if (typeof body === "object" && body !== null) {
          const sha = (body as { sha?: unknown }).sha;
          if (typeof sha === "string" && sha.trim().toLowerCase() === expected) {
            return { sha: expected };
          }
          last = `sha ${showSha(sha)} != ${expected}`;
        } else if (body !== null) {
          last = "cuerpo de health ilegible";
        }
      }
    } catch (error) {
      last = error instanceof Error ? error.message : "error de red";
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new SmokeError(`Humo fallido tras ${attempts} intentos: ${redactSecrets(last, [])}`);
}

async function main(): Promise<void> {
  const mainUrl = process.env.TIMBAL_MAIN_URL ?? "";
  if (mainUrl.trim() === "") throw new SmokeError("Falta TIMBAL_MAIN_URL");
  const sha = assertCommitSha(process.env.GITHUB_SHA ?? "");
  assertGithubRef(process.env.GITHUB_REF);
  await smokeRemote({
    mainUrl,
    expectedSha: sha,
    githubRef: process.env.GITHUB_REF,
    attempts: positiveInt(process.env.TIMBAL_SMOKE_ATTEMPTS, SMOKE_ATTEMPTS),
    delayMs: positiveInt(process.env.TIMBAL_SMOKE_DELAY_MS, SMOKE_DELAY_MS),
  });
  console.log(`Humo ok: ${sha}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "humo fallido";
    console.error(redactSecrets(message, [process.env.TIMBAL_API_KEY ?? ""]));
    process.exit(1);
  });
}
