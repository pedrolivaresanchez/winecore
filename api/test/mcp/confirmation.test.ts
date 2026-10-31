import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { InMemoryConfirmationStore, sha256Hex, type ConfirmationStore } from "../../src/mcp/confirm";
import { defineWriteTool } from "../../src/mcp/registry";
import { callTool } from "../../src/mcp/server";
import { CLIENT_A, CLIENT_B, expectError, makeCtx, readToolResult } from "./fixture";

function readingTool(runs: { n: number }) {
  return defineWriteTool({
    name: "cellar_reading_add",
    module: "cellar",
    scope: "write:cellar.reading",
    title: "Añadir lectura",
    description: "Prepara una lectura de densidad.",
    input: z.object({
      vessel_code: z.string().min(1),
      density: z.string().min(1),
    }),
    prepare: (_ctx, input) => ({
      preview: { deposito: input.vessel_code, densidad: input.density },
      payload: { vessel_code: input.vessel_code, density: input.density },
    }),
    commit: (_ctx, payload) => {
      runs.n += 1;
      const body = payload as { vessel_code: string };
      return { reading_id: "00000000-0000-4000-8000-0000000000e1", vessel_code: body.vessel_code };
    },
  });
}

function cellarCtx(store: ConfirmationStore, now: () => Date, clientId = CLIENT_A) {
  return makeCtx({
    client: { id: clientId, scopes: ["write:cellar.reading"] },
    activeModules: ["cellar"],
    now,
    deps: { confirmations: store },
  });
}

describe("two-step confirmation", () => {
  test("prepare then commit", async () => {
    const runs = { n: 0 };
    const tool = readingTool(runs);
    const store = new InMemoryConfirmationStore();
    const now = new Date("2026-10-31T12:00:00.000Z");
    const ctx = cellarCtx(store, () => now);
    const prepared = readToolResult(await callTool(ctx, "cellar_reading_add_prepare", { vessel_code: "D-12", density: "1.090" }, [tool]));
    expect(runs.n).toBe(0);
    const body = prepared.ok as {
      preview: { deposito: string };
      summary_es: string;
      confirmation_token: string;
      expires_at: string;
    };
    expect(body.preview.deposito).toBe("D-12");
    expect(body.summary_es.length).toBeGreaterThan(10);
    expect(body.confirmation_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.expires_at).toBe("2026-10-31T12:15:00.000Z");
    const stored = await store.get(await sha256Hex(body.confirmation_token));
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(body.confirmation_token);

    const committed = readToolResult(
      await callTool(ctx, "cellar_reading_add_commit", { confirmation_token: body.confirmation_token }, [tool]),
    );
    expect(committed.ok).toEqual({ reading_id: "00000000-0000-4000-8000-0000000000e1", vessel_code: "D-12" });
    expect(runs.n).toBe(1);
  });

  test("expired token", async () => {
    const runs = { n: 0 };
    const tool = readingTool(runs);
    const store = new InMemoryConfirmationStore();
    let now = new Date("2026-10-31T12:00:00.000Z");
    const ctx = cellarCtx(store, () => now);
    const prepared = readToolResult(await callTool(ctx, "cellar_reading_add_prepare", { vessel_code: "D-12", density: "1.090" }, [tool]));
    const token = (prepared.ok as { confirmation_token: string }).confirmation_token;
    now = new Date(now.getTime() + 15 * 60 * 1000 + 1);
    expectError(
      await callTool(ctx, "cellar_reading_add_commit", { confirmation_token: token }, [tool]),
      "WC_MCP_CONFIRMATION_INVALID",
      "caducado",
    );
    expect(runs.n).toBe(0);
  });

  test("token of another client", async () => {
    const runs = { n: 0 };
    const tool = readingTool(runs);
    const store = new InMemoryConfirmationStore();
    const now = () => new Date("2026-10-31T12:00:00.000Z");
    const owner = cellarCtx(store, now, CLIENT_A);
    const other = cellarCtx(store, now, CLIENT_B);
    const prepared = readToolResult(await callTool(owner, "cellar_reading_add_prepare", { vessel_code: "D-12", density: "1.090" }, [tool]));
    const token = (prepared.ok as { confirmation_token: string }).confirmation_token;
    expectError(
      await callTool(other, "cellar_reading_add_commit", { confirmation_token: token }, [tool]),
      "WC_MCP_CONFIRMATION_INVALID",
      "otro cliente",
    );
    expect(runs.n).toBe(0);
  });

  test("tampered payload", async () => {
    const runs = { n: 0 };
    const tool = readingTool(runs);
    const inner = new InMemoryConfirmationStore();
    const store: ConfirmationStore = {
      create: (record) => inner.create(record),
      markConsumed: (hash, result) => inner.markConsumed(hash, result),
      async get(hash) {
        const record = await inner.get(hash);
        if (!record) return null;
        return { ...record, payload: { vessel_code: "OTRO", density: "9.999" } };
      },
    };
    const ctx = cellarCtx(store, () => new Date("2026-10-31T12:00:00.000Z"));
    const prepared = readToolResult(await callTool(ctx, "cellar_reading_add_prepare", { vessel_code: "D-12", density: "1.090" }, [tool]));
    const token = (prepared.ok as { confirmation_token: string }).confirmation_token;
    expectError(
      await callTool(ctx, "cellar_reading_add_commit", { confirmation_token: token }, [tool]),
      "WC_MCP_CONFIRMATION_INVALID",
      "no coincide",
    );
    expect(runs.n).toBe(0);
  });

  test("replayed commit returns the same result and runs once", async () => {
    const runs = { n: 0 };
    const tool = readingTool(runs);
    const store = new InMemoryConfirmationStore();
    const ctx = cellarCtx(store, () => new Date("2026-10-31T12:00:00.000Z"));
    const prepared = readToolResult(await callTool(ctx, "cellar_reading_add_prepare", { vessel_code: "D-12", density: "1.090" }, [tool]));
    const token = (prepared.ok as { confirmation_token: string }).confirmation_token;
    const first = readToolResult(await callTool(ctx, "cellar_reading_add_commit", { confirmation_token: token, idempotency_key: "k-1" }, [tool]));
    const second = readToolResult(await callTool(ctx, "cellar_reading_add_commit", { confirmation_token: token, idempotency_key: "k-1" }, [tool]));
    expect(first.ok).toEqual(second.ok);
    expect(runs.n).toBe(1);
  });
});
