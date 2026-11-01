/**
 * What the Timbal chat runtime does not keep for us: the tools a turn consulted, the approvals it
 * is waiting on and how a turn ended. The runtime (`useTimbalStream`) turns the event stream into
 * text; this module watches the same stream, records the rest per run, and joins both into the
 * entries the conversation draws. No React in here, so it can be tested on its own.
 */

export const TOOL_PREFIX = "app__";
export const ASSISTANT_CONFIRMATION_SUFFIX = " · confirmar";

export type StepStatus = "running" | "done" | "failed" | "waiting";

export type ToolStep = {
  callId: string;
  /** Tool name without the MCP server prefix, e.g. `contacts_search`. */
  tool: string;
  status: StepStatus;
  /** Why it failed, in Spanish, when the API said so. */
  summary?: string;
};

export type RunOutcome = "running" | "ok" | "paused" | "cancelled" | "failed" | "stopped";

export type FailureKind = "busy" | "unavailable" | "forbidden" | "cut" | "failed";

export type Approval = {
  id: string;
  tool: string;
  /** The `confirmation_token` the write was prepared with; it ties the card to its summary. */
  token?: string;
  title?: string;
  /** The person walked away from it: nothing was executed and the next turn skips this run. */
  dismissed?: boolean;
};

export type RunInfo = {
  steps: ToolStep[];
  /** Links the tools returned (`links.web`), as they came. */
  links: string[];
  approval?: Approval;
  outcome: RunOutcome;
  failure?: FailureKind;
  /** Run this one continues: it answers that run's approval. */
  resumeOf?: string;
  /** The request never reached the agent, so there is no run behind this id. */
  local?: boolean;
  /** Run the next turn must hang from when this one cannot be one. */
  parent: string | null;
};

export type Prepared = { tool: string; summary: string; expiresAt?: string };

export type AssistantRuns = {
  runs: Record<string, RunInfo>;
  /** Prepared writes by confirmation token. */
  prepared: Record<string, Prepared>;
};

export const emptyRuns: AssistantRuns = { runs: {}, prepared: {} };

export type StreamEvent = Record<string, unknown>;

export function parseEventLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StreamEvent) : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const isRootPath = (path: string) => path !== "" && !path.includes(".");

function toolOfPath(path: string): string | null {
  const parts = path.split(".");
  const name = parts[1];
  return parts.length === 2 && name?.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : null;
}

function patchRun(state: AssistantRuns, runId: string, patch: (run: RunInfo) => RunInfo): AssistantRuns {
  const run = state.runs[runId];
  if (!run) return state;
  return { ...state, runs: { ...state.runs, [runId]: patch(run) } };
}

function setStep(run: RunInfo, callId: string, patch: Partial<ToolStep>): RunInfo {
  return { ...run, steps: run.steps.map((step) => (step.callId === callId ? { ...step, ...patch } : step)) };
}

function parseResult(output: unknown): unknown {
  if (typeof output !== "string") return output;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

const LINK_DEPTH = 4;
const LINKS_PER_RESULT = 20;

/** The `links.web` and `link` strings anywhere in a tool result, without inventing any. */
export function linksOf(result: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > LINK_DEPTH || found.length >= LINKS_PER_RESULT) return found;
  if (Array.isArray(result)) {
    for (const item of result) linksOf(item, found, depth + 1);
    return found;
  }
  const object = record(result);
  if (!object) return found;
  const web = text(record(object.links)?.web);
  if (web && !found.includes(web)) found.push(web);
  const single = text(object.link);
  if (single && !found.includes(single)) found.push(single);
  for (const [key, value] of Object.entries(object)) {
    if (key !== "links" && value && typeof value === "object") linksOf(value, found, depth + 1);
  }
  return found;
}

function preparedOf(tool: string, result: unknown): [string, Prepared] | null {
  const object = record(result);
  const token = text(object?.confirmation_token);
  const summary = text(object?.summary_es);
  if (!object || !token || !summary) return null;
  const expiresAt = text(object.expires_at);
  return [token, { tool, summary, ...(expiresAt ? { expiresAt } : {}) }];
}

/** The Spanish reason a tool gave when it failed: `{"code":…,"message_es":…}` inside the error. */
function failureSummary(event: StreamEvent): string | undefined {
  const error = record(event.error);
  const message = text(error?.message);
  if (!message) return undefined;
  try {
    const parsed = record(JSON.parse(message));
    return text(parsed?.message_es) ?? undefined;
  } catch {
    return undefined;
  }
}

function settle(run: RunInfo, steps: StepStatus): RunInfo {
  return { ...run, steps: run.steps.map((step) => (step.status === "running" ? { ...step, status: steps } : step)) };
}

export type RunStart = { parent: string | null; resumeOf?: string };

export function startRun(state: AssistantRuns, runId: string, start: RunStart): AssistantRuns {
  const run: RunInfo = {
    steps: [],
    links: [],
    outcome: "running",
    parent: start.parent,
    ...(start.resumeOf ? { resumeOf: start.resumeOf } : {}),
  };
  return { ...state, runs: { ...state.runs, [runId]: run } };
}

export function localFailure(state: AssistantRuns, runId: string, failure: FailureKind, start: RunStart): AssistantRuns {
  const run: RunInfo = {
    steps: [],
    links: [],
    outcome: "failed",
    failure,
    local: true,
    parent: start.parent,
    ...(start.resumeOf ? { resumeOf: start.resumeOf } : {}),
  };
  return { ...state, runs: { ...state.runs, [runId]: run } };
}

/**
 * Folds one event of the run `runId` into the record. Returns the same object when the event
 * says nothing the conversation shows, so streaming a long answer costs nothing here.
 */
export function applyEvent(state: AssistantRuns, runId: string, event: StreamEvent): AssistantRuns {
  const path = text(event.path) ?? "";
  const callId = text(event.call_id) ?? "";
  const tool = toolOfPath(path);

  if (event.type === "START" && tool && callId) {
    return patchRun(state, runId, (run) =>
      run.steps.some((step) => step.callId === callId)
        ? run
        : { ...run, steps: [...run.steps, { callId, tool, status: "running" }] },
    );
  }

  if (event.type === "APPROVAL") {
    const id = text(event.approval_id);
    const name = text(event.runnable_name);
    if (!id || !name?.startsWith(TOOL_PREFIX)) return state;
    const token = text(record(event.input)?.confirmation_token) ?? undefined;
    const title = text(record(event.ui)?.title) ?? undefined;
    const approval: Approval = {
      id,
      tool: name.slice(TOOL_PREFIX.length),
      ...(token ? { token } : {}),
      ...(title ? { title } : {}),
    };
    return patchRun(state, runId, (run) => ({ ...run, approval }));
  }

  if (event.type !== "OUTPUT") return state;
  const status = record(event.status);
  const code = text(status?.code);
  const reason = text(status?.reason);

  if (tool && callId) {
    if (code === "success") {
      const result = parseResult(event.output);
      const links = linksOf(result);
      const prepared = preparedOf(tool, result);
      const next = patchRun(state, runId, (run) => ({
        ...setStep(run, callId, { status: "done" }),
        links: [...run.links, ...links.filter((link) => !run.links.includes(link))],
      }));
      return prepared ? { ...next, prepared: { ...next.prepared, [prepared[0]]: prepared[1] } } : next;
    }
    if (code === "cancelled" && (reason === "approval_required" || reason === "input_required")) {
      return patchRun(state, runId, (run) => setStep(run, callId, { status: "waiting" }));
    }
    const summary = failureSummary(event);
    return patchRun(state, runId, (run) => setStep(run, callId, { status: "failed", ...(summary ? { summary } : {}) }));
  }

  if (isRootPath(path)) {
    if (code === "success") return patchRun(state, runId, (run) => ({ ...settle(run, "done"), outcome: "ok" }));
    if (code === "cancelled" && (reason === "approval_required" || reason === "input_required")) {
      return patchRun(state, runId, (run) => ({ ...run, outcome: "paused" }));
    }
    if (code === "cancelled") {
      return patchRun(state, runId, (run) => ({ ...settle(run, "failed"), outcome: "cancelled" }));
    }
    return patchRun(state, runId, (run) => ({ ...settle(run, "failed"), outcome: "failed", failure: "failed" }));
  }
  return state;
}

/** The stream is over: whatever has no ending was cut. */
export function endRun(state: AssistantRuns, runId: string, how: "complete" | "aborted" | "error"): AssistantRuns {
  return patchRun(state, runId, (run) => {
    if (run.outcome !== "running") return run;
    if (how === "aborted") return { ...settle(run, "failed"), outcome: "stopped" };
    return { ...settle(run, "failed"), outcome: "failed", failure: "cut" };
  });
}

/**
 * Runs left "running" by a page that went away mid-turn. Nothing is coming for them.
 */
export function settleStale(state: AssistantRuns): AssistantRuns {
  let changed = false;
  const runs: Record<string, RunInfo> = {};
  for (const [id, run] of Object.entries(state.runs)) {
    if (run.outcome === "running") {
      changed = true;
      runs[id] = { ...settle(run, "failed"), outcome: "failed", failure: "cut" };
    } else {
      runs[id] = run;
    }
  }
  return changed ? { ...state, runs } : state;
}

export function dismissApproval(state: AssistantRuns, runId: string): AssistantRuns {
  return patchRun(state, runId, (run) => (run.approval ? { ...run, approval: { ...run.approval, dismissed: true } } : run));
}

/** Nothing resumed this run yet, so its approval still waits for an answer. */
export function awaitsApproval(state: AssistantRuns, runId: string): boolean {
  const run = state.runs[runId];
  if (!run || run.outcome !== "paused" || !run.approval || run.approval.dismissed) return false;
  return !Object.values(state.runs).some((other) => other.resumeOf === runId && !other.local);
}

/**
 * The run the next turn continues. A turn that failed, was stopped or whose approval was
 * dismissed is not a place to continue from: the agent would find tool calls without answers.
 */
export function resolveParent(state: AssistantRuns, runId: string | null): string | null {
  let current = runId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const run = state.runs[current];
    if (!run) return current;
    const unusable =
      run.local === true ||
      run.outcome === "failed" ||
      run.outcome === "stopped" ||
      run.outcome === "running" ||
      (run.outcome === "paused" && run.approval?.dismissed === true);
    if (!unusable) return current;
    current = run.parent;
  }
  return null;
}

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  runId?: string;
  content: readonly { type: string; text?: string }[];
};

export type ApprovalView = {
  runId: string;
  id: string;
  tool: string;
  title: string | null;
  summary: string | null;
  expiresAt: string | null;
};

export type EntryNotice = "stopped" | "cancelled";

export type ChatEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: ToolStep[];
  /** Internal paths of the records the tools returned. */
  links: string[];
  approval: ApprovalView | null;
  failure?: FailureKind;
  /** The turn can be asked again as it was. A turn that answered an approval cannot. */
  retryable?: boolean;
  notice?: EntryNotice;
  /** The run this entry ends on. */
  runId?: string;
};

/** Internal path for a link that belongs to WineCore; `null` for anything that leaves it. */
export function internalPath(href: string, origin: string): string | null {
  if (href.startsWith("/")) return href.startsWith("//") ? null : href;
  try {
    const url = new URL(href);
    if (url.origin !== origin) return null;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith("//") ? null : path;
  } catch {
    return null;
  }
}

export function messageText(message: ThreadMessage): string {
  return message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => (part.text ?? "").trim())
    .filter((part) => part !== "")
    .join("\n\n");
}

function approvalView(state: AssistantRuns, runId: string): ApprovalView | null {
  if (!awaitsApproval(state, runId)) return null;
  const approval = state.runs[runId]?.approval;
  if (!approval) return null;
  const prepared = approval.token ? state.prepared[approval.token] : undefined;
  const title = approval.title?.endsWith(ASSISTANT_CONFIRMATION_SUFFIX)
    ? approval.title.slice(0, -ASSISTANT_CONFIRMATION_SUFFIX.length)
    : (approval.title ?? null);
  return {
    runId,
    id: approval.id,
    tool: approval.tool,
    title,
    summary: prepared?.summary ?? null,
    expiresAt: prepared?.expiresAt ?? null,
  };
}

function appendUnique(into: string[], values: string[], origin: string) {
  for (const value of values) {
    const path = internalPath(value, origin);
    if (path && !into.includes(path)) into.push(path);
  }
}

/**
 * The conversation as the person sees it. Turns that answer an approval are folded into the
 * message that asked, so confirming a write does not open a second bubble, and their prompts
 * (the runtime's stand-in for the click) are not drawn. `resuming` covers the moments before
 * the run of such a turn has an id.
 */
export function projectEntries(
  messages: readonly ThreadMessage[],
  state: AssistantRuns,
  origin: string,
  options: { resuming?: boolean } = {},
): ChatEntry[] {
  const entries: ChatEntry[] = [];
  messages.forEach((message, index) => {
    const run = message.runId ? state.runs[message.runId] : undefined;
    const answersApproval = run?.resumeOf !== undefined || (options.resuming === true && index >= messages.length - 2);

    if (message.role === "user") {
      if (!answersApproval) {
        entries.push({ id: message.id, role: "user", content: messageText(message), steps: [], links: [], approval: null });
      }
      return;
    }

    const folded = answersApproval ? entries.findLast((entry) => entry.role === "assistant") : undefined;
    if (folded && run?.local) {
      folded.failure = run.failure;
      folded.retryable = false;
      return;
    }

    const target: ChatEntry = folded ?? {
      id: message.id,
      role: "assistant",
      content: "",
      steps: [],
      links: [],
      approval: null,
    };
    if (!folded) entries.push(target);

    target.content = [target.content, messageText(message)].filter((part) => part !== "").join("\n\n");
    if (!run || !message.runId) return;
    // Once the approval was answered (or put aside) the step that waited for it says nothing:
    // the resumed run shows the same tool with its result.
    const answered = run.outcome === "paused" && !awaitsApproval(state, message.runId);
    target.steps = [...target.steps, ...(answered ? run.steps.filter((step) => step.status !== "waiting") : run.steps)];
    appendUnique(target.links, run.links, origin);
    target.runId = message.runId;
    target.failure = run.outcome === "failed" ? run.failure : undefined;
    target.retryable = run.outcome === "failed" || run.outcome === "stopped" ? run.resumeOf === undefined : undefined;
    target.notice = run.outcome === "stopped" ? "stopped" : undefined;
    target.approval = approvalView(state, message.runId);
    if (run.outcome === "paused" && run.approval?.dismissed) target.notice = "cancelled";
  });
  return entries;
}

export type PromptBody = {
  prompt?: unknown;
  context?: { parent_id?: unknown; [key: string]: unknown };
  [key: string]: unknown;
};

export type TurnContext = {
  screen: { path: string; date: string };
  parent: string | null;
  /** Answer to an approval: the paused run it continues and the approval's id. */
  resume?: { runId: string; approvalId: string };
};

/** The request the runtime built, with what only this app knows: where the person is and the approval being answered. */
export function withTurnContext(body: PromptBody, turn: TurnContext): PromptBody {
  const context = { ...(body.context ?? {}), parent_id: turn.resume ? turn.resume.runId : turn.parent };
  return {
    ...body,
    context,
    screen: turn.screen,
    ...(turn.resume ? { resume: { [turn.resume.approvalId]: true } } : {}),
  };
}

export type StoredMessage = { id: string; role: "user" | "assistant"; runId?: string; text: string };

export type StoredConversation = { v: 2; messages: StoredMessage[]; store: AssistantRuns };

export const KEPT_MESSAGES = 120;

export function serializeConversation(messages: readonly ThreadMessage[], store: AssistantRuns): string {
  const kept = messages.slice(-KEPT_MESSAGES).map(
    (message): StoredMessage => ({
      id: message.id,
      role: message.role,
      ...(message.runId ? { runId: message.runId } : {}),
      text: messageText(message),
    }),
  );
  const used = new Set(kept.flatMap((message) => (message.runId ? [message.runId] : [])));
  const runs: Record<string, RunInfo> = {};
  for (const id of used) {
    const run = store.runs[id];
    if (run) runs[id] = run;
  }
  const tokens = new Set(
    Object.values(runs).flatMap((run) => (run.approval?.token ? [run.approval.token] : [])),
  );
  const prepared: Record<string, Prepared> = {};
  for (const token of tokens) {
    const entry = store.prepared[token];
    if (entry) prepared[token] = entry;
  }
  const stored: StoredConversation = { v: 2, messages: kept, store: { runs, prepared } };
  return JSON.stringify(stored);
}

function isStoredMessage(value: unknown): value is StoredMessage {
  const message = record(value);
  return (
    !!message &&
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.text === "string" &&
    (message.runId === undefined || typeof message.runId === "string")
  );
}

function isRunInfo(value: unknown): value is RunInfo {
  const run = record(value);
  return !!run && Array.isArray(run.steps) && Array.isArray(run.links) && typeof run.outcome === "string";
}

export function deserializeConversation(raw: string | null): { messages: ThreadMessage[]; store: AssistantRuns } | null {
  if (!raw) return null;
  try {
    const parsed = record(JSON.parse(raw));
    if (!parsed || parsed.v !== 2 || !Array.isArray(parsed.messages)) return null;
    const messages = parsed.messages.filter(isStoredMessage).map(
      (message): ThreadMessage => ({
        id: message.id,
        role: message.role,
        ...(message.runId ? { runId: message.runId } : {}),
        content: message.text ? [{ type: "text", text: message.text }] : [],
      }),
    );
    const store = record(parsed.store);
    const runs: Record<string, RunInfo> = {};
    for (const [id, run] of Object.entries(record(store?.runs) ?? {})) {
      if (isRunInfo(run)) runs[id] = run;
    }
    const prepared = (record(store?.prepared) ?? {}) as Record<string, Prepared>;
    return { messages, store: settleStale({ runs, prepared }) };
  } catch {
    return null;
  }
}

/** Where a failed request puts the person, as the kind of failure the conversation words. */
export function failureForStatus(status: number): FailureKind {
  if (status === 429) return "busy";
  if (status === 403) return "forbidden";
  if (status === 0) return "cut";
  if (status === 404 || status === 502 || status === 503 || status === 504) return "unavailable";
  return "failed";
}

export type EventTap = {
  /** `false` when the runtime must not see the event. */
  accept: (event: StreamEvent) => boolean;
  end: (how: "complete" | "aborted" | "error") => void;
};

export type TapStore = { get: () => AssistantRuns; set: (next: AssistantRuns) => void };

/**
 * Follows one response. The events that end a turn without an answer (an error, a pause for
 * approval, a cancel) are recorded here and withheld from the runtime, which would otherwise
 * print their raw payload into the message.
 */
export function createEventTap(store: TapStore, start: { parent: string | null; resumeOf?: string }): EventTap {
  let runId: string | null = null;
  return {
    accept(event) {
      const path = text(event.path) ?? "";
      if (event.type === "START" && isRootPath(path)) {
        const id = text(event.run_id);
        if (!id || runId) return true;
        runId = id;
        store.set(startRun(store.get(), id, { parent: text(event.parent_run_id) ?? start.parent, resumeOf: start.resumeOf }));
        return true;
      }
      if (!runId) return true;
      const next = applyEvent(store.get(), runId, event);
      if (next !== store.get()) store.set(next);
      if (event.type === "OUTPUT" && isRootPath(path)) return text(record(event.status)?.code) === "success";
      // A tool's own result is shown as a chip. The runtime prints an object it does not know
      // (the pause for approval, for one) as JSON when nothing was said before it.
      if (event.type === "OUTPUT" && toolOfPath(path)) return false;
      return true;
    },
    end(how) {
      if (!runId) return;
      const next = endRun(store.get(), runId, how);
      if (next !== store.get()) store.set(next);
    },
  };
}

/**
 * The response body with the tap watching it. Lines the runtime must not see are dropped; the
 * rest pass through byte for byte.
 */
export function tapBody(body: ReadableStream<Uint8Array>, tap: EventTap): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  function filter(lines: string[]): string {
    let out = "";
    for (const line of lines) {
      const event = parseEventLine(line);
      if (event && !tap.accept(event)) continue;
      out += `${line}\n`;
    }
    return out;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            const rest = filter(buffer ? [buffer] : []);
            buffer = "";
            tap.end("complete");
            if (rest) controller.enqueue(encoder.encode(rest));
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          const out = filter(lines);
          if (out) {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      } catch (error) {
        tap.end(error instanceof Error && error.name === "AbortError" ? "aborted" : "error");
        controller.error(error);
      }
    },
    cancel(reason) {
      tap.end("aborted");
      return reader.cancel(reason);
    },
  });
}

/** A response that holds only the start of a run which failed before the agent heard of it. */
export function localFailureResponse(runId: string): Response {
  const event = JSON.stringify({ type: "START", run_id: runId, parent_run_id: null, path: "asistente" });
  return new Response(`data: ${event}\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
