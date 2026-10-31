/// <reference path="./ambient.d.ts" />

import { describe, expect, it } from "bun:test";
import { TimbalClient, type FetchLike } from "./client";
import { TargetRefusedError } from "./config";

const SECRET = "timbal-test-key-should-not-appear";

function assertAbsent(haystack: string, label: string): void {
  if (haystack.includes(SECRET)) throw new Error(`${label} contiene el secreto`);
}

describe("TimbalClient", () => {
  it("org, proyecto o entorno distintos → no llama a fetch", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return new Response("{}", { status: 200 });
    };
    const client = new TimbalClient({ token: SECRET, fetchImpl, retryAttempts: 0, log: () => {} });
    const paths = [
      "/orgs/999/projects/3942/envs/4165/deploy",
      "/orgs/122/projects/8888/envs/4165/deploy",
      "/orgs/122/projects/3942/envs/7777/deploy",
    ];
    for (const path of paths) {
      await expect(client.request("POST", path, { rev: "a".repeat(40) })).rejects.toThrow(TargetRefusedError);
    }
    expect(called).toBe(false);
  });

  it("envía Bearer a api.timbal.ai y no lo escribe en el log", async () => {
    const logs: string[] = [];
    let sentBearer = false;
    const fetchImpl: FetchLike = async (input, init) => {
      if (String(input) !== "https://api.timbal.ai/orgs/122/projects/3942/envs/4165/deployments?trigger=latest") {
        throw new Error("url inesperada");
      }
      sentBearer = new Headers(init?.headers).get("authorization") === `Bearer ${SECRET}`;
      return new Response(JSON.stringify({ deployments: [] }), { status: 200 });
    };
    const client = new TimbalClient({ token: SECRET, fetchImpl, log: (message) => logs.push(message) });
    const response = await client.request("GET", "/orgs/122/projects/3942/envs/4165/deployments?trigger=latest");
    expect(response.status).toBe(200);
    if (!sentBearer) throw new Error("no envió el bearer");
    assertAbsent(logs.join("\n"), "log");
  });

  it("502 → reintenta con backoff y luego acepta 200", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls < 3) return new Response("no", { status: 502, statusText: "Bad Gateway" });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = new TimbalClient({
      token: SECRET,
      fetchImpl,
      retryAttempts: 2,
      retryDelayMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      log: () => {},
    });
    const response = await client.request("GET", "/orgs/122/projects/3942/envs/4165/deployments");
    expect(response.status).toBe(200);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it("400 → no reintenta", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: "rev inválida" }), { status: 400 });
    };
    const client = new TimbalClient({
      token: SECRET,
      fetchImpl,
      retryAttempts: 3,
      sleep: async () => {
        throw new Error("no debía esperar");
      },
      log: () => {},
    });
    await expect(client.request("POST", "/orgs/122/projects/3942/envs/4165/deploy", { rev: "abc" })).rejects.toThrow(
      "rev inválida",
    );
    expect(calls).toBe(1);
  });

  it("el secreto que devuelve la API no se imprime", async () => {
    const logs: string[] = [];
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ message: `token ${SECRET}`, code: SECRET }), { status: 401 });
    const client = new TimbalClient({
      token: SECRET,
      fetchImpl,
      retryAttempts: 0,
      log: (message) => logs.push(message),
    });
    let message = "";
    try {
      await client.request("GET", "/orgs/122/projects/3942/envs/4165/deployments");
      throw new Error("debía fallar");
    } catch (error) {
      message = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ""}` : "";
    }
    assertAbsent(message, "error");
    assertAbsent(logs.join("\n"), "log");
    expect(message).toContain("[redacted]");
    expect(logs.join("\n")).toContain("[redacted]");
  });
});
