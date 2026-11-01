import { Elysia } from 'elysia';

import { requestIdFor, requireUser, sessionOf, type GuardDeps } from '../auth/guard';
import { CHAT_LIMITS, parseChatRequest } from '../core/assistant/input';
import type { AssistantProvider } from '../core/assistant/provider';
import { runAssistantTurn, type ChatReply, type TurnDeps } from '../core/assistant/turn';
import type { Writer } from '../core/db/writer';
import { asDomainError, domainError, errorBody } from '../core/errors';
import { safeLogMessage } from '../core/redact';
import { contextForUser } from '../mcp/context';
import type { RestDispatch } from '../mcp/registry';
import { RateLimiter } from '../mcp/rate';
import { visibleToolCatalogue } from '../mcp/server';

/** Turnos de chat por minuto y persona. Cada herramienta cuenta además en el límite MCP. */
export const ASSISTANT_TURNS_PER_MINUTE = 20;
/** Por debajo del `idleTimeout` de Bun (120 s) para que la respuesta JSON llegue siempre. */
const TURN_TIMEOUT_MS = 110_000;
const HEARTBEAT_MS = 15_000;

export interface AssistantRouteDeps {
  guard: GuardDeps;
  writer: Writer;
  now: () => Date;
  provider: AssistantProvider;
  limiter: RateLimiter;
  log?: (line: string) => void;
  rest?: RestDispatch;
}

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > CHAT_LIMITS.bodyBytes) throw domainError('WC_VALIDATION', { body: 'La petición es demasiado grande' });
  const text = await request.text();
  if (text.length > CHAT_LIMITS.bodyBytes) throw domainError('WC_VALIDATION', { body: 'La petición es demasiado grande' });
  if (text.trim() === '') throw domainError('WC_VALIDATION', { body: 'El cuerpo está vacío' });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw domainError('WC_VALIDATION', { body: 'El JSON no es válido' });
  }
}

async function guarded(turn: TurnDeps, run: () => Promise<ChatReply>): Promise<ChatReply> {
  try {
    return await run();
  } catch (error) {
    if (asDomainError(error) || !turn.signal.aborted) throw error;
    throw domainError('WC_ASSISTANT_FAILED', undefined, 'El asistente ha tardado demasiado en responder. Inténtalo de nuevo');
  }
}

function stream(turn: TurnDeps, run: (turn: TurnDeps) => Promise<ChatReply>, log: (line: string) => void, requestId: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const ping = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      try {
        send('done', await run({ ...turn, onStep: (event) => send('step', event) }));
      } catch (error) {
        const domain = asDomainError(error);
        if (!domain) {
          log(JSON.stringify({
            request_id: requestId,
            code: 'WC_INTERNAL',
            level: 'error',
            message: safeLogMessage(error instanceof Error ? error.message : 'Error interno'),
          }));
        }
        send('error', errorBody(domain ?? domainError('WC_ASSISTANT_FAILED')));
      } finally {
        clearInterval(ping);
        open = false;
        try {
          controller.close();
        } catch {
          // El cliente ya cerró la conexión.
        }
      }
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

/**
 * Chat del asistente. El modelo vive en la workforce; las herramientas son las
 * MCP y se ejecutan aquí con la sesión de la persona (permisos, auditoría y
 * límite por minuto iguales que en `/m2m/mcp`). Con `Accept: text/event-stream`
 * responde por SSE: `step` por cada herramienta y `done` con el JSON final.
 */
export function assistantRoutes(deps: AssistantRouteDeps) {
  const turns = new RateLimiter(ASSISTANT_TURNS_PER_MINUTE);
  const log = deps.log ?? ((line: string) => console.log(line));
  const user = { beforeHandle: requireUser(deps.guard) };
  return new Elysia()
    .get('/v1/assistant/status', async ({ request }) => {
      if (!deps.provider.available) return { available: false, tools: [] };
      const ctx = await contextForUser(deps.writer, sessionOf(request), {
        now: deps.now,
        webBaseUrl: '',
        requestId: requestIdFor(request),
      });
      const tools = visibleToolCatalogue(ctx)
        .filter((tool) => tool.kind === 'read' || tool.kind === 'prepare')
        .map((tool) => tool.name);
      return { available: true, tools };
    }, user)
    .post('/v1/assistant/chat', async ({ request }) => {
      if (!deps.provider.available) throw domainError('WC_ASSISTANT_UNAVAILABLE');
      const input = parseChatRequest(await readBody(request));
      const session = sessionOf(request);
      if (!turns.allow(session.id, deps.now().getTime())) throw domainError('WC_RATE_LIMITED');
      const requestId = requestIdFor(request);
      const ctx = await contextForUser(deps.writer, session, { now: deps.now, webBaseUrl: '', requestId, rest: deps.rest });
      const turn: TurnDeps = {
        ctx,
        writer: deps.writer,
        provider: deps.provider,
        limiter: deps.limiter,
        now: deps.now,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]),
      };
      const run = (current: TurnDeps) => guarded(current, () => runAssistantTurn(current, input));
      if (request.headers.get('accept')?.includes('text/event-stream')) return stream(turn, run, log, requestId);
      return run(turn);
    }, user);
}
