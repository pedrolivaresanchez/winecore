import { domainError } from '../errors';

/** Herramienta que el modelo puede pedir. Los `_commit` se anuncian sin argumentos: el token lo pone la API. */
export interface ToolSpec {
  name: string;
  kind: 'read' | 'prepare' | 'commit';
  title: string;
  description: string;
  input_schema: { type: 'object'; properties?: Record<string, object>; required?: string[] };
}

export interface ToolCall {
  name: string;
  arguments: unknown;
}

/** Operación preparada que espera la confirmación de la persona. Sin token: el modelo no lo ve nunca. */
export interface PendingView {
  tool: string;
  summary_es: string;
  expires_at: string;
}

export type ProviderMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[]; pending?: PendingView }
  | { role: 'tool'; name: string; ok: boolean; content: string };

export interface AssistantContext {
  path: string | null;
  today: string;
  roles: string[];
}

export interface ProviderInput {
  messages: ProviderMessage[];
  tools: ToolSpec[];
  context: AssistantContext;
}

export interface ProviderStep {
  reply: string | null;
  tool_calls: ToolCall[];
  model: string | null;
}

export interface AssistantProvider {
  readonly available: boolean;
  next(input: ProviderInput, signal: AbortSignal): Promise<ProviderStep>;
}

export const unavailableAssistant: AssistantProvider = {
  available: false,
  next() {
    return Promise.reject(domainError('WC_ASSISTANT_UNAVAILABLE'));
  },
};

const MAX_REPLY_CHARS = 8000;
const MAX_TOOL_CALLS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function argumentsOf(call: Record<string, unknown>): unknown {
  if ('arguments' in call) {
    const value = call.arguments;
    if (typeof value !== 'string') return value ?? {};
    return parseArguments(value);
  }
  if (typeof call.arguments_json === 'string') return parseArguments(call.arguments_json);
  return {};
}

function parseArguments(raw: string): unknown {
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Acepta `{ reply, tool_calls }` o el mismo objeto dentro de `output`. Cada
 * llamada trae `arguments` (objeto o JSON en texto) o `arguments_json`.
 */
export function parseProviderStep(body: unknown, model: string | null = null): ProviderStep {
  const step = isRecord(body) && isRecord(body.output) && !('reply' in body) && !('tool_calls' in body)
    ? body.output
    : body;
  if (!isRecord(step)) throw domainError('WC_ASSISTANT_FAILED');
  const reply = typeof step.reply === 'string' && step.reply.trim() !== ''
    ? step.reply.trim().slice(0, MAX_REPLY_CHARS)
    : null;
  const rawCalls = step.tool_calls ?? [];
  if (!Array.isArray(rawCalls)) throw domainError('WC_ASSISTANT_FAILED');
  const toolCalls: ToolCall[] = [];
  for (const raw of rawCalls.slice(0, MAX_TOOL_CALLS)) {
    if (!isRecord(raw) || typeof raw.name !== 'string') continue;
    toolCalls.push({ name: raw.name.trim(), arguments: argumentsOf(raw) });
  }
  if (reply === null && toolCalls.length === 0) throw domainError('WC_ASSISTANT_FAILED');
  const ownModel = typeof step.model === 'string' && step.model.trim() !== '' ? step.model.trim() : null;
  return { reply, tool_calls: toolCalls, model: model ?? ownModel };
}
