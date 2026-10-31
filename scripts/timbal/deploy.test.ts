/// <reference path="./ambient.d.ts" />

import { describe, expect, it } from "bun:test";
import type { FetchLike } from "./client";
import { TargetRefusedError } from "./config";
import { DeployFailedError, DeployTimeoutError, deployAndWait } from "./deploy";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const SECRET = "timbal-test-key-should-not-appear";

function assertAbsent(haystack: string, label: string): void {
  if (haystack.includes(SECRET)) throw new Error(`${label} contiene el secreto`);
}

type Call = { url: string; method: string; body: string | undefined };

function deployment(status: string, commit: string): unknown {
  return { id: 1, status, target: { id: 1, type: "git", commit } };
}

describe("deployAndWait", () => {
  it("éxito tras un estado pendiente → termina", async () => {
    const calls: Call[] = [];
    let polls = 0;
    const fetchImpl: FetchLike = async (input, init) => {
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url: String(input), method: init?.method ?? "", body });
      assertAbsent(String(input), "url");
      if (body !== undefined) assertAbsent(body, "body");
      if (init?.method === "POST") return new Response("", { status: 202 });
      polls += 1;
      const status = polls === 1 ? "building" : "succeeded";
      return new Response(
        JSON.stringify({
          deployments: [deployment(status, SHA), deployment(status, SHA)],
        }),
        { status: 200 },
      );
    };
    const sleeps: number[] = [];
    await deployAndWait({
      sha: SHA,
      token: SECRET,
      fetchImpl,
      timeoutMs: 10_000,
      pollMs: 25,
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      client: undefined,
    });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.timbal.ai/orgs/122/projects/3942/envs/4165/deploy");
    expect(calls[0]?.body).toBe(JSON.stringify({ rev: SHA }));
    expect(calls[1]?.url).toContain("/orgs/122/projects/3942/envs/4165/deployments?trigger=latest");
    expect(polls).toBe(2);
    expect(sleeps).toEqual([25]);
  });

  it("un componente en fallo → falla sin seguir sondeando", async () => {
    let gets = 0;
    const fetchImpl: FetchLike = async (_input, init) => {
      if (init?.method === "POST") return new Response("", { status: 202 });
      gets += 1;
      return new Response(
        JSON.stringify({
          deployments: [deployment("succeeded", SHA), deployment("failed", SHA)],
        }),
        { status: 200 },
      );
    };
    let slept = false;
    await expect(
      deployAndWait({
        sha: SHA,
        token: SECRET,
        fetchImpl,
        timeoutMs: 10_000,
        sleep: async () => {
          slept = true;
        },
      }),
    ).rejects.toThrow(DeployFailedError);
    expect(gets).toBe(1);
    expect(slept).toBe(false);
  });

  it("estado no terminal → tiempo agotado", async () => {
    const fetchImpl: FetchLike = async (_input, init) => {
      if (init?.method === "POST") return new Response("", { status: 202 });
      return new Response(JSON.stringify({ deployments: [deployment("building", SHA)] }), { status: 200 });
    };
    await expect(
      deployAndWait({
        sha: SHA,
        token: SECRET,
        fetchImpl,
        timeoutMs: 0,
        sleep: async () => {
          throw new Error("no debía esperar");
        },
      }),
    ).rejects.toThrow(DeployTimeoutError);
  });

  it("fallo de otra SHA → no es nuestro despliegue y agota el tiempo", async () => {
    const fetchImpl: FetchLike = async (_input, init) => {
      if (init?.method === "POST") return new Response("", { status: 202 });
      return new Response(JSON.stringify({ deployments: [deployment("failed", OTHER)] }), { status: 200 });
    };
    await expect(
      deployAndWait({
        sha: SHA,
        token: SECRET,
        fetchImpl,
        timeoutMs: 0,
        sleep: async () => {
          throw new Error("no debía esperar");
        },
      }),
    ).rejects.toThrow(DeployTimeoutError);
  });

  it("éxito de otra SHA → tiempo agotado", async () => {
    const fetchImpl: FetchLike = async (_input, init) => {
      if (init?.method === "POST") return new Response("", { status: 202 });
      return new Response(JSON.stringify({ deployments: [deployment("succeeded", OTHER)] }), { status: 200 });
    };
    await expect(
      deployAndWait({
        sha: SHA,
        token: SECRET,
        fetchImpl,
        timeoutMs: 0,
        sleep: async () => {
          throw new Error("no debía esperar");
        },
      }),
    ).rejects.toThrow(DeployTimeoutError);
  });

  it("otro proyecto → no llama a fetch", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return new Response("", { status: 202 });
    };
    await expect(
      deployAndWait({
        sha: SHA,
        token: SECRET,
        projectId: "8888",
        fetchImpl,
      }),
    ).rejects.toThrow(TargetRefusedError);
    expect(called).toBe(false);
  });
});
