import { describe, expect, test } from 'bun:test';

import { isExplicitConfirmation } from '../../src/core/assistant/confirm';
import { parseProviderStep, type ProviderInput } from '../../src/core/assistant/provider';
import { assistantFromConfig, timbalAssistant } from '../../src/core/assistant/timbal';
import { DomainError } from '../../src/core/errors';

const INPUT: ProviderInput = {
  messages: [{ role: 'user', content: '¿Qué lotes hay en el depósito 3?' }],
  tools: [],
  context: { path: '/bodega', today: '2026-10-31', roles: ['cellar'] },
};

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'otro';
  }
}

describe('parseProviderStep', () => {
  test('acepta el paso directo o dentro de output, y arguments_json', () => {
    expect(parseProviderStep({ reply: ' Hola ' })).toEqual({ reply: 'Hola', tool_calls: [], model: null });
    expect(parseProviderStep({
      output: { reply: null, tool_calls: [{ name: 'cellar_lot_get', arguments_json: '{"lot_code":"L-1"}' }] },
    })).toEqual({ reply: null, tool_calls: [{ name: 'cellar_lot_get', arguments: { lot_code: 'L-1' } }], model: null });
    expect(parseProviderStep({ tool_calls: [{ name: 'system_whoami', arguments: '' }] }).tool_calls).toEqual([
      { name: 'system_whoami', arguments: {} },
    ]);
    expect(parseProviderStep({ tool_calls: [{ name: 'x', arguments_json: '{roto' }] }).tool_calls[0]?.arguments).toBeNull();
  });

  test('un paso vacío o con otra forma es un fallo del asistente', () => {
    for (const body of [null, 'texto', [], {}, { reply: '' }, { tool_calls: 'no' }]) {
      expect(() => parseProviderStep(body)).toThrow(DomainError);
    }
  });
});

describe('timbalAssistant', () => {
  test('envía conversation, catalog y screen con el token y lee el modelo enrutado', async () => {
    const seen: { url?: string; auth?: string | null; body?: unknown } = {};
    const provider = timbalAssistant({
      url: 'https://workforce.example/run',
      token: 'token-sintetico',
      fetchImpl: async (url, init) => {
        seen.url = String(url);
        seen.auth = new Headers(init?.headers).get('authorization');
        seen.body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ reply: 'Hay un lote.' }), {
          headers: { 'content-type': 'application/json', 'x-timbal-routed-model': 'proveedor/modelo' },
        });
      },
    });
    const step = await provider.next(INPUT, new AbortController().signal);
    expect(step).toEqual({ reply: 'Hay un lote.', tool_calls: [], model: 'proveedor/modelo' });
    expect(seen).toEqual({
      url: 'https://workforce.example/run',
      auth: 'Bearer token-sintetico',
      body: { conversation: INPUT.messages, catalog: INPUT.tools, screen: INPUT.context },
    });
  });

  test('errores de red, HTTP o JSON se convierten en WC_ASSISTANT_FAILED', async () => {
    const signal = new AbortController().signal;
    const failing = [
      () => Promise.reject(new Error('red caída')),
      () => Promise.resolve(new Response('no', { status: 500 })),
      () => Promise.resolve(new Response('no es json', { status: 200 })),
      () => Promise.resolve(Response.json({ otra: 'forma' })),
    ];
    for (const fetchImpl of failing) {
      const provider = timbalAssistant({ url: 'https://workforce.example/run', fetchImpl });
      expect(await codeOf(provider.next(INPUT, signal))).toBe('WC_ASSISTANT_FAILED');
    }
  });

  test('sin URL configurada no está disponible', async () => {
    const provider = assistantFromConfig({ assistantUrl: null, assistantToken: null });
    expect(provider.available).toBe(false);
    expect(await codeOf(provider.next(INPUT, new AbortController().signal))).toBe('WC_ASSISTANT_UNAVAILABLE');
    expect(assistantFromConfig({ assistantUrl: 'https://workforce.example/run', assistantToken: null }).available).toBe(true);
  });

  test('sin token propio, un workflow del host de Timbal usa la credencial del proyecto y otro host no', async () => {
    const auth: Array<string | null> = [];
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      auth.push(new Headers(init?.headers).get('authorization'));
      return Response.json({ reply: 'Hecho.' });
    };
    const signal = new AbortController().signal;
    const base = { assistantToken: null, timbalApiHost: 'api.timbal.ai', timbalToken: 'credencial-sintetica' };
    const own = assistantFromConfig(
      { ...base, assistantUrl: 'https://api.timbal.ai/orgs/1/projects/2/workforce/asistente/run?rev=main' },
      fetchImpl,
    );
    const other = assistantFromConfig({ ...base, assistantUrl: 'https://workforce.example/run' }, fetchImpl);
    const explicit = assistantFromConfig(
      { ...base, assistantToken: 'token-propio', assistantUrl: 'https://api.timbal.ai/run' },
      fetchImpl,
    );
    for (const provider of [own, other, explicit]) await provider.next(INPUT, signal);
    expect(auth).toEqual(['Bearer credencial-sintetica', null, 'Bearer token-propio']);
  });
});

describe('isExplicitConfirmation', () => {
  test('solo un «sí» claro confirma', () => {
    for (const yes of ['Sí', 'si', 'Sí, confírmalo.', 'Confirmo', 'Adelante', 'Vale, hazlo', 'De acuerdo', 'OK', '¡Sí!']) {
      expect(isExplicitConfirmation(yes)).toBe(true);
    }
    for (const no of [
      'No',
      'Sí, pero cambia el país',
      '¿Seguro?',
      'Espera',
      'Cancela',
      'Crea otro contacto distinto',
      'sí no',
      '',
      `Sí ${'muy '.repeat(30)}bien`,
    ]) {
      expect(isExplicitConfirmation(no)).toBe(false);
    }
  });
});
