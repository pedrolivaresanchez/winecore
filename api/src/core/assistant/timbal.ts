import type { Config } from '../../config';
import type { FetchLike } from '../db/timbal';
import { domainError } from '../errors';
import { parseProviderStep, unavailableAssistant, type AssistantProvider } from './provider';

/**
 * Llama al workflow `asistente` de la workforce: `{ messages, tools, context }`
 * → `{ reply?, tool_calls? }`. El miembro no ejecuta herramientas; las ejecuta
 * la API con la sesión de la persona.
 */
export function timbalAssistant(options: {
  url: string;
  token?: string;
  fetchImpl?: FetchLike;
}): AssistantProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    available: true,
    async next(input, signal) {
      const headers = new Headers({ 'content-type': 'application/json' });
      if (options.token) headers.set('authorization', `Bearer ${options.token}`);
      let response: Response;
      try {
        response = await fetchImpl(options.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(input),
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        throw domainError('WC_ASSISTANT_FAILED');
      }
      if (!response.ok) throw domainError('WC_ASSISTANT_FAILED');
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw domainError('WC_ASSISTANT_FAILED');
      }
      const routed = response.headers.get('x-timbal-routed-model');
      return parseProviderStep(body, routed && routed.trim() !== '' ? routed.trim() : null);
    },
  };
}

export function assistantFromConfig(config: Pick<Config, 'assistantUrl' | 'assistantToken'>, fetchImpl?: FetchLike): AssistantProvider {
  if (!config.assistantUrl) return unavailableAssistant;
  return timbalAssistant({ url: config.assistantUrl, token: config.assistantToken ?? undefined, fetchImpl });
}
