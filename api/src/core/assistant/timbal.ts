import type { Config } from '../../config';
import type { FetchLike } from '../db/timbal';
import { domainError } from '../errors';
import { parseProviderStep, unavailableAssistant, type AssistantProvider } from './provider';

/**
 * Llama al workflow `asistente` de la workforce: `{ conversation, catalog, screen }`
 * → `{ reply?, tool_calls? }`. El miembro no ejecuta herramientas; las ejecuta
 * la API con la sesión de la persona. Timbal reserva `messages` y `context`, por eso
 * la entrada no usa esos nombres.
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
          body: JSON.stringify({
            conversation: input.messages,
            catalog: input.tools,
            screen: input.context,
          }),
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

type AssistantConfig = Pick<Config, 'assistantUrl' | 'assistantToken'> &
  Partial<Pick<Config, 'timbalApiHost' | 'timbalToken'>>;

/** Sin `WINECORE_ASSISTANT_TOKEN`, un workflow del propio host de Timbal se llama con la credencial del proyecto. */
function tokenFor(config: AssistantConfig, url: string): string | undefined {
  if (config.assistantToken) return config.assistantToken;
  if (!config.timbalToken || !config.timbalApiHost) return undefined;
  try {
    return new URL(url).host === config.timbalApiHost ? config.timbalToken : undefined;
  } catch {
    return undefined;
  }
}

export function assistantFromConfig(config: AssistantConfig, fetchImpl?: FetchLike): AssistantProvider {
  if (!config.assistantUrl) return unavailableAssistant;
  return timbalAssistant({ url: config.assistantUrl, token: tokenFor(config, config.assistantUrl), fetchImpl });
}
