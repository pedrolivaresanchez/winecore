import { z } from 'zod';

import { domainError } from '../errors';

export const CHAT_LIMITS = {
  messages: 40,
  contentChars: 4000,
  totalChars: 40_000,
  pathChars: 200,
  bodyBytes: 256 * 1024,
} as const;

const pendingSchema = z.object({
  tool: z.string().regex(/^[a-z][a-z0-9_]{0,72}_commit$/),
  summary_es: z.string().max(2000),
  confirmation_token: z.string().min(1).max(200),
  expires_at: z.string().max(40),
});

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(CHAT_LIMITS.contentChars),
  pending: pendingSchema.optional(),
});

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(CHAT_LIMITS.messages),
  context: z.object({
    path: z.string().max(CHAT_LIMITS.pathChars).regex(/^\/[^\p{Cc}]*$/u).optional(),
  }).optional(),
});

export type PendingWrite = z.infer<typeof pendingSchema>;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  pending?: PendingWrite;
}

export interface ChatRequest {
  messages: ChatMessage[];
  path: string | null;
}

function issueText(code: string): string {
  if (code === 'too_big') return 'Demasiado largo';
  if (code === 'too_small') return 'Falta el valor';
  if (code === 'invalid_type') return 'Tipo no válido';
  return 'Valor no válido';
}

export function parseChatRequest(raw: unknown): ChatRequest {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.length > 0 ? issue.path.map(String).join('.') : 'body';
      fields[key] ??= issueText(issue.code);
    }
    throw domainError('WC_VALIDATION', fields);
  }
  const messages = parsed.data.messages.map((message): ChatMessage => (
    message.role === 'assistant' && message.pending
      ? { role: 'assistant', content: message.content, pending: message.pending }
      : { role: message.role, content: message.content }
  ));
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || last.content.trim() === '') {
    throw domainError('WC_VALIDATION', { messages: 'El último mensaje tiene que ser tuyo y no estar vacío' });
  }
  const total = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total > CHAT_LIMITS.totalChars) {
    throw domainError('WC_VALIDATION', { messages: 'La conversación es demasiado larga; empieza un chat nuevo' });
  }
  return { messages, path: parsed.data.context?.path ?? null };
}
