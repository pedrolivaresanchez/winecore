import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { machineOf, requestIdFor, sessionOf } from "../auth/guard";
import type { Config } from "../config";
import type { Writer } from "../core/db/writer";
import { domainError } from "../core/errors";
import { auditDeniedCall, contextForMachine, contextForUser } from "./context";
import type { RateLimiter } from "./rate";
import type { McpContext } from "./registry";
import { createMcpServer } from "./server";

/**
 * Stateless Streamable HTTP. One server and one transport per request, so no
 * session is kept between calls. JSON responses (the SDK also speaks SSE).
 */
export async function handleMcpRequest(request: Request, ctx: McpContext): Promise<Response> {
  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export interface McpHttpDeps {
  config: Config;
  writer: Writer;
  now: () => Date;
  limiter: RateLimiter;
}

function toolCallOf(raw: string): { name: string; args: unknown } | null {
  try {
    const body = JSON.parse(raw) as { method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    if (body.method !== "tools/call") return null;
    const name = body.params?.name;
    if (typeof name !== "string" || name.length === 0 || name.length > 80) return null;
    return { name, args: body.params?.arguments ?? {} };
  } catch {
    return null;
  }
}

/**
 * Authenticated Streamable HTTP. The caller has already passed
 * `requireUserOrMachine`. Machine tokens (`wc_…`) and Timbal (or dev) sessions
 * both reach this handler.
 */
export async function handleAuthenticatedMcp(deps: McpHttpDeps, request: Request): Promise<Response> {
  const raw = await request.text();
  const replay = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: raw.length > 0 ? raw : undefined,
  });
  const machine = machineOf(request);
  const input = {
    now: deps.now,
    webBaseUrl: deps.config.appPublicUrl,
    requestId: requestIdFor(request),
  };
  const ctx = machine
    ? await contextForMachine(deps.writer, machine.id, input)
    : await contextForUser(deps.writer, sessionOf(request), input);
  if (!deps.limiter.allow(ctx.client.id, deps.now().getTime())) {
    const call = toolCallOf(raw);
    if (call) await auditDeniedCall(deps.writer, ctx, call.name, call.args, "WC_RATE_LIMITED");
    throw domainError("WC_RATE_LIMITED");
  }
  return handleMcpRequest(replay, ctx);
}
