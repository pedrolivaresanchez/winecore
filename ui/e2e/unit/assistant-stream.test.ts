import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyEvent,
  awaitsApproval,
  createEventTap,
  deserializeConversation,
  dismissApproval,
  emptyRuns,
  failureForStatus,
  internalPath,
  linksOf,
  localFailure,
  parseEventLine,
  projectEntries,
  resolveParent,
  serializeConversation,
  settleStale,
  startRun,
  tapBody,
  withTurnContext,
  type AssistantRuns,
  type StreamEvent,
  type ThreadMessage,
} from "../../src/lib/assistant-stream";

const ORIGIN = "https://app.winecore.test";

const root = (run: string, extra: StreamEvent = {}): StreamEvent => ({
  run_id: run,
  path: "asistente",
  call_id: `root-${run}`,
  parent_call_id: null,
  ...extra,
});

const tool = (run: string, name: string, callId: string, extra: StreamEvent = {}): StreamEvent => ({
  run_id: run,
  path: `asistente.app__${name}`,
  call_id: callId,
  parent_call_id: `root-${run}`,
  ...extra,
});

function fold(events: StreamEvent[], runId = "r1", from: AssistantRuns = startRun(emptyRuns, runId, { parent: null })) {
  return events.reduce<AssistantRuns>((state, event) => applyEvent(state, runId, event), from);
}

function assistantMessage(id: string, runId: string, body: string): ThreadMessage {
  return { id, role: "assistant", runId, content: [{ type: "text", text: body }] };
}

function userMessage(id: string, body: string, runId?: string): ThreadMessage {
  return { id, role: "user", ...(runId ? { runId } : {}), content: [{ type: "text", text: body }] };
}

describe("parseEventLine", () => {
  it("reads data lines and ignores everything else", () => {
    assert.deepEqual(parseEventLine('data: {"type":"START"}'), { type: "START" });
    assert.equal(parseEventLine("id: 4"), null);
    assert.equal(parseEventLine("data: [DONE]"), null);
    assert.equal(parseEventLine("data: not json"), null);
    assert.equal(parseEventLine("data: [1]"), null);
    assert.equal(parseEventLine(""), null);
  });
});

describe("linksOf", () => {
  it("finds links.web anywhere in a result and invents nothing", () => {
    const found = linksOf({ items: [{ id: 1, links: { web: "https://a/x" } }, { id: 2 }], links: { web: "https://a/list" } });
    assert.deepEqual(found.sort(), ["https://a/list", "https://a/x"]);
    assert.deepEqual(linksOf({ id: 3, name: "https://not-a-link" }), []);
    assert.deepEqual(linksOf("plain"), []);
  });
});

describe("internalPath", () => {
  it("keeps what belongs to the app and drops what leaves it", () => {
    assert.equal(internalPath("/contactos/1", ORIGIN), "/contactos/1");
    assert.equal(internalPath(`${ORIGIN}/lotes/9?x=1#a`, ORIGIN), "/lotes/9?x=1#a");
    assert.equal(internalPath("https://evil.test/contactos/1", ORIGIN), null);
    assert.equal(internalPath("//evil.test/x", ORIGIN), null);
    assert.equal(internalPath("javascript:alert(1)", ORIGIN), null);
    assert.equal(internalPath("mailto:a@b.c", ORIGIN), null);
  });
});

describe("applyEvent", () => {
  it("follows a tool from running to done and keeps its links", () => {
    const state = fold([
      { type: "START", ...tool("r1", "contacts_search", "c1") },
      {
        type: "OUTPUT",
        ...tool("r1", "contacts_search", "c1"),
        status: { code: "success" },
        output: JSON.stringify({ items: [], links: { web: `${ORIGIN}/contactos` } }),
      },
    ]);
    assert.deepEqual(state.runs.r1?.steps, [{ callId: "c1", tool: "contacts_search", status: "done" }]);
    assert.deepEqual(state.runs.r1?.links, [`${ORIGIN}/contactos`]);
  });

  it("does not repeat a step it already has", () => {
    const start = { type: "START", ...tool("r1", "contacts_get", "c1") };
    const state = fold([start, start]);
    assert.equal(state.runs.r1?.steps.length, 1);
  });

  it("marks a failed tool with the Spanish reason the API gave", () => {
    const state = fold([
      { type: "START", ...tool("r1", "contacts_get", "c1") },
      {
        type: "OUTPUT",
        ...tool("r1", "contacts_get", "c1"),
        status: { code: "error" },
        error: { type: "McpError", message: JSON.stringify({ code: "WC_NOT_FOUND", message_es: "No existe ese contacto." }) },
      },
    ]);
    assert.equal(state.runs.r1?.steps[0]?.status, "failed");
    assert.equal(state.runs.r1?.steps[0]?.summary, "No existe ese contacto.");
  });

  it("remembers what a *_prepare tool offered, by confirmation token", () => {
    const state = fold([
      { type: "START", ...tool("r1", "contacts_create_prepare", "p1") },
      {
        type: "OUTPUT",
        ...tool("r1", "contacts_create_prepare", "p1"),
        status: { code: "success" },
        output: JSON.stringify({ confirmation_token: "tok", summary_es: "Se creará el contacto.", expires_at: "2026-11-01T11:00:00Z" }),
      },
    ]);
    assert.deepEqual(state.prepared.tok, {
      tool: "contacts_create_prepare",
      summary: "Se creará el contacto.",
      expiresAt: "2026-11-01T11:00:00Z",
    });
  });

  it("pauses the run on an approval and ties the card to the token", () => {
    const state = fold([
      { type: "START", ...tool("r1", "contacts_create_commit", "k1") },
      {
        type: "APPROVAL",
        ...tool("r1", "contacts_create_commit", "k1"),
        approval_id: "ap1",
        runnable_name: "app__contacts_create_commit",
        input: { confirmation_token: "tok" },
        ui: { title: "Crear contacto · confirmar" },
      },
      { type: "OUTPUT", ...tool("r1", "contacts_create_commit", "k1"), status: { code: "cancelled", reason: "approval_required" } },
      { type: "OUTPUT", ...root("r1"), status: { code: "cancelled", reason: "approval_required" } },
    ]);
    const run = state.runs.r1;
    assert.equal(run?.outcome, "paused");
    assert.equal(run?.steps[0]?.status, "waiting");
    assert.deepEqual(run?.approval, { id: "ap1", tool: "contacts_create_commit", token: "tok", title: "Crear contacto · confirmar" });
    assert.equal(awaitsApproval(state, "r1"), true);
  });

  it("ignores approvals for tools that are not the app's", () => {
    const state = fold([{ type: "APPROVAL", ...root("r1"), approval_id: "ap1", runnable_name: "other_tool" }]);
    assert.equal(state.runs.r1?.approval, undefined);
  });

  it("settles the run from the root output", () => {
    assert.equal(fold([{ type: "OUTPUT", ...root("r1"), status: { code: "success" } }]).runs.r1?.outcome, "ok");
    assert.equal(fold([{ type: "OUTPUT", ...root("r1"), status: { code: "cancelled", reason: "user" } }]).runs.r1?.outcome, "cancelled");
    const failed = fold([
      { type: "START", ...tool("r1", "contacts_get", "c1") },
      { type: "OUTPUT", ...root("r1"), status: { code: "error" } },
    ]).runs.r1;
    assert.equal(failed?.outcome, "failed");
    assert.equal(failed?.failure, "failed");
    assert.equal(failed?.steps[0]?.status, "failed");
  });

  it("returns the same object for events that say nothing it records", () => {
    const state = startRun(emptyRuns, "r1", { parent: null });
    const delta = { type: "DELTA", ...root("r1"), item: { type: "text_delta", text_delta: "hola" } };
    assert.equal(applyEvent(state, "r1", delta), state);
  });
});

describe("answering an approval", () => {
  const paused = (): AssistantRuns =>
    fold([
      { type: "START", ...tool("r1", "contacts_create_commit", "k1") },
      {
        type: "APPROVAL",
        ...tool("r1", "contacts_create_commit", "k1"),
        approval_id: "ap1",
        runnable_name: "app__contacts_create_commit",
        input: { confirmation_token: "tok" },
      },
      { type: "OUTPUT", ...tool("r1", "contacts_create_commit", "k1"), status: { code: "cancelled", reason: "approval_required" } },
      { type: "OUTPUT", ...root("r1"), status: { code: "cancelled", reason: "approval_required" } },
    ]);

  it("stops waiting once another run resumes it or the person walks away", () => {
    const state = paused();
    assert.equal(awaitsApproval(state, "r1"), true);
    assert.equal(awaitsApproval(dismissApproval(state, "r1"), "r1"), false);
    const resumed = startRun(state, "r2", { parent: "r1", resumeOf: "r1" });
    assert.equal(awaitsApproval(resumed, "r1"), false);
  });

  it("is not resumed by a request that never reached the agent", () => {
    const state = localFailure(paused(), "local-1", "unavailable", { parent: "r1", resumeOf: "r1" });
    assert.equal(awaitsApproval(state, "r1"), true);
  });

  it("never continues from a paused run whose approval was put aside", () => {
    const state = dismissApproval(paused(), "r1");
    assert.equal(resolveParent(state, "r1"), null);
  });

  it("continues from a paused run that still waits", () => {
    assert.equal(resolveParent(paused(), "r1"), "r1");
  });
});

describe("resolveParent", () => {
  it("skips runs the agent cannot continue from", () => {
    let state = startRun(emptyRuns, "ok", { parent: null });
    state = applyEvent(state, "ok", { type: "OUTPUT", ...root("ok"), status: { code: "success" } });
    state = startRun(state, "bad", { parent: "ok" });
    state = applyEvent(state, "bad", { type: "OUTPUT", ...root("bad"), status: { code: "error" } });
    state = localFailure(state, "local-1", "busy", { parent: "bad" });
    assert.equal(resolveParent(state, "local-1"), "ok");
    assert.equal(resolveParent(state, null), null);
    assert.equal(resolveParent(state, "unknown-run"), "unknown-run");
  });

  it("does not loop on a cycle", () => {
    const state: AssistantRuns = {
      prepared: {},
      runs: {
        a: { steps: [], links: [], outcome: "failed", parent: "b" },
        b: { steps: [], links: [], outcome: "failed", parent: "a" },
      },
    };
    assert.equal(resolveParent(state, "a"), null);
  });
});

describe("projectEntries", () => {
  const asked = (): AssistantRuns => {
    let state = fold([
      { type: "START", ...tool("r1", "contacts_create_prepare", "p1") },
      {
        type: "OUTPUT",
        ...tool("r1", "contacts_create_prepare", "p1"),
        status: { code: "success" },
        output: JSON.stringify({ confirmation_token: "tok", summary_es: "Se creará el contacto.", links: { web: `${ORIGIN}/contactos` } }),
      },
      { type: "OUTPUT", ...root("r1"), status: { code: "success" } },
    ]);
    state = startRun(state, "r2", { parent: "r1" });
    state = fold(
      [
        { type: "START", ...tool("r2", "contacts_create_commit", "k1") },
        {
          type: "APPROVAL",
          ...tool("r2", "contacts_create_commit", "k1"),
          approval_id: "ap1",
          runnable_name: "app__contacts_create_commit",
          input: { confirmation_token: "tok" },
          ui: { title: "Crear contacto · confirmar" },
        },
        { type: "OUTPUT", ...tool("r2", "contacts_create_commit", "k1"), status: { code: "cancelled", reason: "approval_required" } },
        { type: "OUTPUT", ...root("r2"), status: { code: "cancelled", reason: "approval_required" } },
      ],
      "r2",
      state,
    );
    return state;
  };

  const thread: ThreadMessage[] = [
    userMessage("u1", "crea el contacto"),
    assistantMessage("a1", "r1", "Voy a crear un contacto. ¿Lo confirmas?"),
    userMessage("u2", "sí, confirmo"),
    assistantMessage("a2", "r2", ""),
  ];

  it("draws the card with the Spanish summary while the approval waits", () => {
    const entries = projectEntries(thread, asked(), ORIGIN);
    assert.equal(entries.length, 4);
    const last = entries[3];
    assert.deepEqual(last?.approval, {
      runId: "r2",
      id: "ap1",
      tool: "contacts_create_commit",
      title: "Crear contacto",
      summary: "Se creará el contacto.",
      expiresAt: null,
    });
    assert.deepEqual(last?.steps.map((step) => step.status), ["waiting"]);
    assert.equal(entries[1]?.approval, null);
    assert.deepEqual(entries[1]?.links, ["/contactos"]);
  });

  it("folds the turn that answers an approval into the bubble that asked", () => {
    let state = asked();
    state = startRun(state, "r3", { parent: "r2", resumeOf: "r2" });
    state = fold(
      [
        { type: "START", ...tool("r3", "contacts_create_commit", "k2") },
        { type: "OUTPUT", ...tool("r3", "contacts_create_commit", "k2"), status: { code: "success" }, output: "{}" },
        { type: "OUTPUT", ...root("r3"), status: { code: "success" } },
      ],
      "r3",
      state,
    );
    const messages: ThreadMessage[] = [...thread, userMessage("u3", "Sí, confirmo.", "r3"), assistantMessage("a3", "r3", "Hecho: el contacto está creado.")];
    const entries = projectEntries(messages, state, ORIGIN);
    assert.equal(entries.length, 4, "no extra user bubble and no extra assistant bubble");
    const answer = entries[3];
    assert.equal(answer?.content, "Hecho: el contacto está creado.");
    assert.equal(answer?.approval, null);
    assert.deepEqual(answer?.steps.map((step) => [step.tool, step.status]), [["contacts_create_commit", "done"]]);
    assert.equal(answer?.retryable, undefined);
  });

  it("hides the stand-in prompt while the resumed run has no id yet", () => {
    const messages: ThreadMessage[] = [...thread, userMessage("u3", "Sí, confirmo."), { id: "a3", role: "assistant", content: [] }];
    const entries = projectEntries(messages, asked(), ORIGIN, { resuming: true });
    assert.equal(entries.filter((entry) => entry.role === "user").length, 2);
    assert.equal(entries.length, 4);
  });

  it("shows the notice and drops the waiting chip when the approval was put aside", () => {
    const entries = projectEntries(thread, dismissApproval(asked(), "r2"), ORIGIN);
    const last = entries[3];
    assert.equal(last?.approval, null);
    assert.equal(last?.notice, "cancelled");
    assert.deepEqual(last?.steps, []);
  });

  it("offers retry for a turn that failed and not for one that answered an approval", () => {
    let state = startRun(emptyRuns, "r1", { parent: null });
    state = applyEvent(state, "r1", { type: "OUTPUT", ...root("r1"), status: { code: "error" } });
    const entries = projectEntries([userMessage("u1", "hola"), assistantMessage("a1", "r1", "")], state, ORIGIN);
    assert.equal(entries[1]?.failure, "failed");
    assert.equal(entries[1]?.retryable, true);
  });

  it("leaves foreign links out of the entry", () => {
    const state = fold([
      { type: "START", ...tool("r1", "contacts_get", "c1") },
      {
        type: "OUTPUT",
        ...tool("r1", "contacts_get", "c1"),
        status: { code: "success" },
        output: JSON.stringify({ links: { web: "https://evil.test/contactos/1" } }),
      },
      { type: "OUTPUT", ...root("r1"), status: { code: "success" } },
    ]);
    const entries = projectEntries([userMessage("u1", "hola"), assistantMessage("a1", "r1", "ok")], state, ORIGIN);
    assert.deepEqual(entries[1]?.links, []);
  });
});

describe("withTurnContext", () => {
  const screen = { path: "/lotes", date: "2026-11-01" };

  it("sets where the person is and which run the turn hangs from", () => {
    const body = withTurnContext({ prompt: "hola", context: { parent_id: "stale", keep: 1 } }, { screen, parent: "r9" });
    assert.deepEqual(body, { prompt: "hola", context: { parent_id: "r9", keep: 1 }, screen });
  });

  it("answers an approval on the paused run, not on its parent", () => {
    const body = withTurnContext({ prompt: "Sí, confirmo." }, { screen, parent: "r1", resume: { runId: "r2", approvalId: "ap1" } });
    assert.deepEqual(body.context, { parent_id: "r2" });
    assert.deepEqual(body.resume, { ap1: true });
  });
});

describe("conversation storage", () => {
  it("round-trips and settles runs a closed page left running", () => {
    let state = startRun(emptyRuns, "r1", { parent: null });
    state = applyEvent(state, "r1", { type: "START", ...tool("r1", "contacts_get", "c1") });
    const messages = [userMessage("u1", "hola"), assistantMessage("a1", "r1", "parcial")];
    const restored = deserializeConversation(serializeConversation(messages, state));
    assert.ok(restored);
    assert.equal(restored.messages.length, 2);
    assert.equal(restored.store.runs.r1?.outcome, "failed");
    assert.equal(restored.store.runs.r1?.failure, "cut");
    assert.equal(restored.store.runs.r1?.steps[0]?.status, "failed");
  });

  it("refuses what it did not write", () => {
    assert.equal(deserializeConversation(null), null);
    assert.equal(deserializeConversation("{"), null);
    assert.equal(deserializeConversation(JSON.stringify({ v: 1, messages: [] })), null);
  });

  it("settleStale leaves finished runs alone", () => {
    const state = applyEvent(startRun(emptyRuns, "r1", { parent: null }), "r1", { type: "OUTPUT", ...root("r1"), status: { code: "success" } });
    assert.equal(settleStale(state), state);
  });
});

describe("failureForStatus", () => {
  it("words the status the person can act on", () => {
    assert.equal(failureForStatus(429), "busy");
    assert.equal(failureForStatus(403), "forbidden");
    assert.equal(failureForStatus(0), "cut");
    for (const status of [404, 502, 503, 504]) assert.equal(failureForStatus(status), "unavailable");
    assert.equal(failureForStatus(500), "failed");
  });
});

const sse = (event: StreamEvent) => `data: ${JSON.stringify(event)}\n\n`;

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let out = "";
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) out += decoder.decode(chunk, { stream: true });
  return out;
}

function liveStore(initial: AssistantRuns = emptyRuns) {
  let current = initial;
  return { get: () => current, set: (next: AssistantRuns) => (current = next) };
}

describe("tapBody", () => {
  const llmDelta = { type: "DELTA", run_id: "r1", path: "asistente.llm", call_id: "l1", parent_call_id: "root-r1", item: { type: "text_delta", text_delta: "Hola" } };

  it("records the run and withholds what the runtime would print raw", async () => {
    const store = liveStore();
    const events = [
      sse({ type: "START", ...root("r1", { parent_run_id: null }) }),
      sse({ type: "START", ...tool("r1", "contacts_create_commit", "k1") }),
      sse(llmDelta),
      sse({ type: "OUTPUT", ...tool("r1", "contacts_create_commit", "k1"), status: { code: "cancelled", reason: "approval_required" }, output: { approval_id: "ap1", status: "approval_required" } }),
      sse({ type: "OUTPUT", ...root("r1"), status: { code: "cancelled", reason: "approval_required" }, output: { approval_id: "ap1" } }),
    ];
    const passed = await readAll(tapBody(streamOf(events), createEventTap(store, { parent: "r0" })));
    assert.ok(passed.includes('"text_delta":"Hola"'));
    assert.ok(!passed.includes("approval_id"), "no raw approval payload reaches the runtime");
    assert.equal(store.get().runs.r1?.outcome, "paused");
    assert.equal(store.get().runs.r1?.parent, "r0");
    assert.equal(store.get().runs.r1?.steps[0]?.status, "waiting");
  });

  it("lets a successful root output through", async () => {
    const store = liveStore();
    const final = sse({ type: "OUTPUT", ...root("r1"), status: { code: "success" }, output: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
    const passed = await readAll(tapBody(streamOf([sse({ type: "START", ...root("r1") }), final]), createEventTap(store, { parent: null })));
    assert.ok(passed.includes('"text":"ok"'));
    assert.equal(store.get().runs.r1?.outcome, "ok");
  });

  it("passes lines through when they arrive split across chunks", async () => {
    const store = liveStore();
    const line = sse(llmDelta);
    const half = Math.floor(line.length / 2);
    const passed = await readAll(
      tapBody(streamOf([sse({ type: "START", ...root("r1") }), line.slice(0, half), line.slice(half)]), createEventTap(store, { parent: null })),
    );
    assert.equal(passed.split("\n").filter((entry) => entry.startsWith("data:")).length, 2);
  });

  it("marks a run that ended without a root output as cut", async () => {
    const store = liveStore();
    await readAll(tapBody(streamOf([sse({ type: "START", ...root("r1") })]), createEventTap(store, { parent: null })));
    assert.equal(store.get().runs.r1?.outcome, "failed");
    assert.equal(store.get().runs.r1?.failure, "cut");
  });

  it("marks a run the person stopped as stopped", async () => {
    const store = liveStore();
    const body = tapBody(streamOf([sse({ type: "START", ...root("r1") })]), createEventTap(store, { parent: null }));
    const reader = body.getReader();
    await reader.read();
    await reader.cancel();
    assert.equal(store.get().runs.r1?.outcome, "stopped");
  });
});
