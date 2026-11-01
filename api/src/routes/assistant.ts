import { Elysia } from 'elysia';

import { requestIdFor, requireUser, sessionOf, type GuardDeps } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { contextForUser } from '../mcp/context';
import { visibleToolCatalogue, type ExposedKind } from '../mcp/server';

export interface AssistantRouteDeps {
  guard: GuardDeps;
  writer: Writer;
  now: () => Date;
}

export interface AssistantToolInfo {
  name: string;
  title: string;
  kind: ExposedKind;
}

/**
 * El asistente es un agente de Timbal que llama a `/mcp` con la sesión de la persona.
 * Aquí solo queda lo que la interfaz necesita para hablar en español: el título de cada
 * herramienta que esa persona puede usar (el catálogo ya viene filtrado por permisos y módulos).
 */
export function assistantRoutes(deps: AssistantRouteDeps) {
  return new Elysia().get('/v1/assistant/status', async ({ request }): Promise<{ tools: AssistantToolInfo[] }> => {
    const ctx = await contextForUser(deps.writer, sessionOf(request), {
      now: deps.now,
      webBaseUrl: '',
      requestId: requestIdFor(request),
    });
    const tools = visibleToolCatalogue(ctx).map(({ name, title, kind }) => ({ name, title, kind }));
    return { tools };
  }, { beforeHandle: requireUser(deps.guard) });
}
