/// <reference path="./ambient.d.ts" />

import { describe, expect, it } from "bun:test";
import type { FetchLike } from "./client";
import { SmokeError, healthUrl, smokeRemote } from "./smoke";

const EXPECTED = "c".repeat(40);
const OTHER = "d".repeat(40);

function health(sha: string, status = 200): Response {
  return new Response(
    JSON.stringify({ status: "ok", sha, schema_version: "1", db: "up", writer: "ok" }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("smokeRemote", () => {
  it("sha distinta → falla tras los reintentos", async () => {
    let calls = 0;
    let slept = 0;
    let sawAuth = false;
    const fetchImpl: FetchLike = async (input, init) => {
      calls += 1;
      if (String(input) !== "https://gateway.example/api/health") throw new Error("url inesperada");
      if (new Headers(init?.headers).has("authorization")) sawAuth = true;
      return health(OTHER);
    };
    await expect(
      smokeRemote({
        mainUrl: "https://gateway.example",
        expectedSha: EXPECTED,
        fetchImpl,
        attempts: 3,
        delayMs: 0,
        sleep: async () => {
          slept += 1;
        },
      }),
    ).rejects.toThrow(SmokeError);
    expect(calls).toBe(3);
    expect(slept).toBe(2);
    expect(sawAuth).toBe(false);
  });

  it("sha igual → pasa", async () => {
    const fetchImpl: FetchLike = async () => health(EXPECTED);
    const result = await smokeRemote({
      mainUrl: "https://gateway.example/",
      expectedSha: EXPECTED,
      fetchImpl,
      attempts: 1,
      delayMs: 0,
    });
    expect(result.sha).toBe(EXPECTED);
  });

  it("sha distinta y luego la correcta → pasa", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return health(calls === 1 ? OTHER : EXPECTED);
    };
    const result = await smokeRemote({
      mainUrl: "https://gateway.example",
      expectedSha: EXPECTED,
      fetchImpl,
      attempts: 3,
      delayMs: 0,
      sleep: async () => {},
    });
    expect(result.sha).toBe(EXPECTED);
    expect(calls).toBe(2);
  });

  it("TIMBAL_MAIN_URL con ruta o sin https → se rechaza", () => {
    expect(healthUrl("https://gateway.example")).toBe("https://gateway.example/api/health");
    expect(() => healthUrl("http://gateway.example")).toThrow(SmokeError);
    expect(() => healthUrl("https://gateway.example/api")).toThrow(SmokeError);
  });
});
