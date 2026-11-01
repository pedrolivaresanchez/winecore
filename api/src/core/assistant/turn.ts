import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { auditDeniedCall } from '../../mcp/context';
import type { RateLimiter } from '../../mcp/rate';
import type { AnyTool, McpContext } from '../../mcp/registry';
import { baseTools, callTool, toolKindOf, visibleToolCatalogue, type ToolDescriptor } from '../../mcp/server';
import type { Writer } from '../db/writer';
import { domainError, type ErrorCode } from '../errors';
import { businessDate } from '../time';
import { isExplicitConfirmation } from './confirm';
import type { ChatMessage, ChatRequest, PendingWrite } from './input';
import type { AssistantProvider, ProviderMessage, ToolCall, ToolSpec } from './provider';

export const MAX_STEPS = 6;
export const MAX_CALLS_PER_STEP = 4;
const MAX_RESULT_CHARS = 12_000;
const MAX_LINKS = 8;
const TOOL_NAME = /^[a-z][a-z0-9_]{1,79}$/;

export const STEP_CAP_REPLY =
  'He llegado al límite de pasos para esta pregunta sin una respuesta completa. Acótala un poco o pídeme que siga.';

export interface ChatStep {
  tool: string;
  title: string;
  ok: boolean;
  summary: string;
  code?: string;
}

export interface ChatLink {
  label: string;
  path: string;
}

export interface ChatReply {
  reply: string;
  steps: ChatStep[];
  links: ChatLink[];
  pending: PendingWrite | null;
}

export type StepEvent =
  | { status: 'running'; tool: string; title: string }
  | ({ status: 'done' } & ChatStep);

export interface TurnDeps {
  ctx: McpContext;
  writer: Writer;
  provider: AssistantProvider;
  /** El mismo limitador que `/m2m/mcp`: cada herramienta consume una llamada. */
  limiter: RateLimiter;
  now: () => Date;
  signal: AbortSignal;
  tools?: readonly AnyTool[];
  onStep?: (event: StepEvent) => void;
}

interface Outcome {
  step: ChatStep;
  content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clip(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}… [recortado: acota la consulta]`;
}

function toSpec(tool: ToolDescriptor): ToolSpec {
  if (tool.kind === 'commit') {
    return {
      name: tool.name,
      kind: 'commit',
      title: tool.title,
      description: 'Ejecuta la operación preparada en el turno anterior. Solo si la persona la acaba de confirmar; la API añade el token.',
      input_schema: { type: 'object', properties: {} },
    };
  }
  return {
    name: tool.name,
    kind: tool.kind === 'prepare' ? 'prepare' : 'read',
    title: tool.title,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

/** La operación pendiente solo vale para el mensaje que sigue justo a la propuesta. */
function offeredPending(messages: readonly ChatMessage[], now: Date): PendingWrite | null {
  const previous = messages[messages.length - 2];
  const pending = previous?.role === 'assistant' ? previous.pending : undefined;
  if (!pending) return null;
  const expires = Date.parse(pending.expires_at);
  if (!Number.isFinite(expires) || expires <= now.getTime()) return null;
  return pending;
}

function providerHistory(messages: readonly ChatMessage[], offered: PendingWrite | null): ProviderMessage[] {
  return messages.map((message, index): ProviderMessage => {
    if (message.role === 'user') return { role: 'user', content: message.content };
    if (offered && index === messages.length - 2) {
      return {
        role: 'assistant',
        content: message.content,
        pending: { tool: offered.tool, summary_es: offered.summary_es, expires_at: offered.expires_at },
      };
    }
    return { role: 'assistant', content: message.content };
  });
}

const INTERNAL_TOOL_ERROR = { code: 'WC002', message: 'Error interno al ejecutar la herramienta.' };

function errorOf(result: CallToolResult): { code: string; message: string } {
  const block = result.content[0];
  if (block?.type !== 'text') return INTERNAL_TOOL_ERROR;
  let body: { code?: unknown; message_es?: unknown };
  try {
    body = JSON.parse(block.text) as typeof body;
  } catch {
    return INTERNAL_TOOL_ERROR;
  }
  if (typeof body.code !== 'string' || typeof body.message_es !== 'string') return INTERNAL_TOOL_ERROR;
  return { code: body.code, message: body.message_es };
}

function countSummary(data: Record<string, unknown>): string {
  for (const key of ['items', 'rows', 'results', 'samples', 'operations']) {
    const value = data[key];
    if (!Array.isArray(value)) continue;
    if (value.length === 0) return 'Sin resultados';
    const more = typeof data.next_cursor === 'string' && data.next_cursor !== '' ? ' o más' : '';
    return value.length === 1 && more === '' ? '1 resultado' : `${value.length}${more} resultados`;
  }
  return 'Consultado';
}

const LABEL_KEYS = ['title', 'legal_name', 'name', 'display_name', 'number', 'code', 'sku'] as const;

function internalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.length > 200) return null;
  if (/[\s\p{Cc}\\]/u.test(value)) return null;
  return value;
}

function labelOf(record: Record<string, unknown>, fallback: string): string {
  for (const key of LABEL_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim().slice(0, 80);
  }
  return fallback;
}

function collectLinks(value: unknown, fallback: string, into: Map<string, ChatLink>, depth = 0): void {
  if (depth > 4 || into.size >= MAX_LINKS) return;
  if (Array.isArray(value)) {
    for (const item of value) collectLinks(item, fallback, into, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  const links = isRecord(value.links) ? value.links : null;
  const path = internalPath(value.link) ?? internalPath(links?.web);
  if (path && !into.has(path)) into.set(path, { label: labelOf(value, fallback), path });
  for (const [key, child] of Object.entries(value)) {
    if (key === 'links' || key === 'link') continue;
    if (typeof child === 'object' && child !== null) collectLinks(child, fallback, into, depth + 1);
  }
}

export async function runAssistantTurn(deps: TurnDeps, request: ChatRequest): Promise<ChatReply> {
  const tools = deps.tools ?? baseTools;
  const ctx = deps.ctx;
  const offered = offeredPending(request.messages, deps.now());
  const lastUser = request.messages[request.messages.length - 1];
  const confirmed = offered !== null && lastUser?.role === 'user' && isExplicitConfirmation(lastUser.content);
  const catalogue = visibleToolCatalogue(ctx, tools).filter((tool) => (
    tool.kind === 'read' || tool.kind === 'prepare' || (tool.kind === 'commit' && tool.name === offered?.tool)
  ));
  const specs = catalogue.map(toSpec);
  const titles = new Map(catalogue.map((tool) => [tool.name, tool.title]));
  const messages = providerHistory(request.messages, offered);
  const context = {
    path: request.path,
    today: businessDate(deps.now()),
    roles: ctx.actor?.roles ?? [],
  };
  const steps: ChatStep[] = [];
  const links = new Map<string, ChatLink>();
  let pending: PendingWrite | null = null;
  let committed = false;

  async function deny(call: ToolCall, title: string, code: ErrorCode): Promise<Outcome> {
    const error = domainError(code);
    await auditDeniedCall(deps.writer, ctx, call.name, call.arguments, code);
    return {
      step: { tool: call.name, title, ok: false, summary: error.message, code },
      content: JSON.stringify({ code, message_es: error.message }),
    };
  }

  async function run(call: ToolCall): Promise<Outcome> {
    const title = titles.get(call.name) ?? call.name;
    if (!TOOL_NAME.test(call.name)) {
      const error = domainError('WC_FORBIDDEN');
      return {
        step: { tool: call.name.slice(0, 80), title: title.slice(0, 80), ok: false, summary: error.message, code: error.code },
        content: JSON.stringify({ code: error.code, message_es: error.message }),
      };
    }
    if (!deps.limiter.allow(ctx.client.id, deps.now().getTime())) {
      await auditDeniedCall(deps.writer, ctx, call.name, call.arguments, 'WC_RATE_LIMITED');
      throw domainError('WC_RATE_LIMITED');
    }
    const kind = toolKindOf(call.name, tools);
    if (kind === 'direct') return deny(call, title, 'WC_FORBIDDEN');
    let args = call.arguments;
    if (kind === 'commit') {
      if (!offered || offered.tool !== call.name || !confirmed || committed) {
        return deny(call, title, 'WC_ASSISTANT_CONFIRMATION_REQUIRED');
      }
      committed = true;
      args = { confirmation_token: offered.confirmation_token };
    } else if (!isRecord(args)) {
      return deny(call, title, 'WC_VALIDATION');
    }
    const result = await callTool(ctx, call.name, args, tools);
    if (result.isError === true) {
      const error = errorOf(result);
      return {
        step: { tool: call.name, title, ok: false, summary: error.message, code: error.code },
        content: JSON.stringify({ code: error.code, message_es: error.message }),
      };
    }
    const data = isRecord(result.structuredContent) ? result.structuredContent : {};
    collectLinks(data, title, links);
    if (kind === 'prepare') {
      const summary = typeof data.summary_es === 'string' ? data.summary_es : title;
      const token = typeof data.confirmation_token === 'string' ? data.confirmation_token : '';
      const expiresAt = typeof data.expires_at === 'string' ? data.expires_at : '';
      pending = { tool: `${call.name.slice(0, -'_prepare'.length)}_commit`, summary_es: summary, confirmation_token: token, expires_at: expiresAt };
      const forModel = { preview: data.preview, summary_es: summary, expires_at: expiresAt, estado: 'pendiente_de_confirmacion' };
      return {
        step: { tool: call.name, title, ok: true, summary },
        content: clip(JSON.stringify(forModel)),
      };
    }
    if (kind === 'commit') {
      pending = null;
      return { step: { tool: call.name, title, ok: true, summary: 'Hecho' }, content: clip(JSON.stringify(data)) };
    }
    return { step: { tool: call.name, title, ok: true, summary: countSummary(data) }, content: clip(JSON.stringify(data)) };
  }

  for (let round = 0; round < MAX_STEPS; round += 1) {
    deps.signal.throwIfAborted();
    const next = await deps.provider.next({ messages, tools: specs, context }, deps.signal);
    if (next.tool_calls.length === 0) {
      return { reply: next.reply ?? '', steps, links: [...links.values()], pending };
    }
    const calls = next.tool_calls.slice(0, MAX_CALLS_PER_STEP);
    messages.push({ role: 'assistant', content: next.reply ?? '', tool_calls: calls });
    for (const call of calls) {
      deps.signal.throwIfAborted();
      deps.onStep?.({ status: 'running', tool: call.name.slice(0, 80), title: (titles.get(call.name) ?? call.name).slice(0, 80) });
      const outcome = await run(call);
      steps.push(outcome.step);
      deps.onStep?.({ status: 'done', ...outcome.step });
      messages.push({ role: 'tool', name: call.name, ok: outcome.step.ok, content: outcome.content });
    }
  }
  return { reply: STEP_CAP_REPLY, steps, links: [...links.values()], pending };
}
