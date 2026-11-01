import { api, apiStream, ApiError } from "@/lib/api";
import { copy } from "@/i18n";

export type AssistantStep = {
  tool: string;
  title: string;
  ok: boolean;
  summary: string;
  code?: string;
};

export type AssistantLink = { label: string; path: string };

/** A prepared write waiting for the person's yes. The token only travels back to the API. */
export type AssistantPending = {
  tool: string;
  summary_es: string;
  confirmation_token: string;
  expires_at: string;
};

export type AssistantReply = {
  reply: string;
  steps: AssistantStep[];
  links: AssistantLink[];
  pending: AssistantPending | null;
};

export type StepEvent =
  | { status: "running"; tool: string; title: string }
  | ({ status: "done" } & AssistantStep);

export type ChatTurnMessage = {
  role: "user" | "assistant";
  content: string;
  pending?: AssistantPending;
};

export const ASSISTANT_UNAVAILABLE = "WC_ASSISTANT_UNAVAILABLE";

/** `tools` are the ones this person's turns may call: their permissions and the active modules. */
export type AssistantStatus = { available: boolean; tools: string[] };

export function assistantStatus(signal?: AbortSignal): Promise<AssistantStatus> {
  return api<AssistantStatus>("/v1/assistant/status", { signal });
}

type Frame = { event: string; data: string };

function parseFrame(chunk: string): Frame | null {
  let event = "message";
  const data: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { event, data: data.join("\n") } : null;
}

function errorFrom(data: string): ApiError {
  try {
    const body = JSON.parse(data) as { code?: unknown; message?: unknown };
    const code = typeof body.code === "string" ? body.code : "WC_ASSISTANT_FAILED";
    const message = typeof body.message === "string" ? body.message : copy.assistant.failure.other;
    return new ApiError(code === "WC_RATE_LIMITED" ? 429 : 502, code, message);
  } catch {
    return new ApiError(502, "WC_ASSISTANT_FAILED", copy.assistant.failure.other);
  }
}

/**
 * One turn of the chat over server-sent events: `step` while tools run, then `done` with
 * the reply. Errors before the stream starts arrive as a normal `ApiError`.
 */
export async function sendAssistantTurn(
  body: { messages: ChatTurnMessage[]; context: { path: string } },
  options: { signal: AbortSignal; onStep: (event: StepEvent) => void },
): Promise<AssistantReply> {
  const response = await apiStream("/v1/assistant/chat", {
    method: "POST",
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return (await response.json()) as AssistantReply;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(0, "WC_ASSISTANT_FAILED", copy.assistant.failure.cut);
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = parseFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      if (!frame) continue;
      if (frame.event === "step") options.onStep(JSON.parse(frame.data) as StepEvent);
      else if (frame.event === "done") return JSON.parse(frame.data) as AssistantReply;
      else if (frame.event === "error") throw errorFrom(frame.data);
    }
  }
  throw new ApiError(0, "WC_ASSISTANT_FAILED", copy.assistant.failure.cut);
}
