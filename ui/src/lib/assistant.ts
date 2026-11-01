import { api, apiStream, ApiError, isAbortError } from "@/lib/api";
import {
  createEventTap,
  failureForStatus,
  localFailure,
  localFailureResponse,
  resolveParent,
  tapBody,
  withTurnContext,
  type PromptBody,
  type TapStore,
  type TurnContext,
} from "@/lib/assistant-stream";
import { civilDay, displayTimezone } from "@/lib/civil-date";

export type {
  ApprovalView,
  AssistantRuns,
  ChatEntry,
  FailureKind,
  StepStatus,
  ToolStep,
} from "@/lib/assistant-stream";

/**
 * The workforce member that answers. It is looked up by name, never as "the first one": the
 * project has more members (`ocr-gastos`) and the gateway lists them in no particular order.
 */
export const ASSISTANT_WORKFORCE = import.meta.env.VITE_ASSISTANT_WORKFORCE?.trim() || "asistente";

export type AssistantToolInfo = { name: string; title: string; kind: string };

/** The tools this person's turns may call: their permissions and the active modules, with the titles the chips use. */
export type AssistantStatus = { tools: AssistantToolInfo[] };

export function assistantStatus(signal?: AbortSignal): Promise<AssistantStatus> {
  return api<AssistantStatus>("/v1/assistant/status", { signal });
}

export type AssistantBridge = {
  runs: TapStore;
  screen: () => { path: string };
  /** The answer to an approval the next request carries, once. */
  takeResume: () => TurnContext["resume"] | null;
};

function readBody(body: BodyInit | null | undefined): PromptBody {
  if (typeof body !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PromptBody) : {};
  } catch {
    return {};
  }
}

/**
 * The `fetch` the Timbal chat runtime talks through. It carries the person's session like the rest
 * of the app (`apiStream`), adds the screen and the answer to an approval to the request, and lets
 * a tap read the response for what the runtime does not keep. A request that fails before the agent
 * hears of it comes back as an empty run, so the failure is worded here and not by the runtime.
 */
export function createAssistantFetch(bridge: AssistantBridge) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const body = readBody(init?.body);
    const requested = typeof body.context?.parent_id === "string" ? body.context.parent_id : null;
    const resume = bridge.takeResume() ?? undefined;
    const parent = resolveParent(bridge.runs.get(), requested);
    const start = { parent: resume?.runId ?? parent, resumeOf: resume?.runId };
    const screen = { ...bridge.screen(), date: civilDay(new Date(), displayTimezone()) };
    const payload = withTurnContext(body, { screen, parent, resume });

    try {
      const response = await apiStream(url, { ...init, body: JSON.stringify(payload) });
      if (!response.body) throw new ApiError(0, "WC_NETWORK", "");
      const tap = createEventTap(bridge.runs, start);
      return new Response(tapBody(response.body, tap), { status: response.status, headers: response.headers });
    } catch (error) {
      if (isAbortError(error)) throw error;
      const id = `local-${crypto.randomUUID()}`;
      const kind = error instanceof ApiError ? failureForStatus(error.status) : "failed";
      bridge.runs.set(localFailure(bridge.runs.get(), id, kind, start));
      return localFailureResponse(id);
    }
  };
}
