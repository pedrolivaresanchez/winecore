import { describe, expect, test } from 'bun:test';

import { scriptedAssistant, type Script, type ScriptedStep } from '../../src/core/assistant/fake';
import { MAX_STEPS, STEP_CAP_REPLY } from '../../src/core/assistant/turn';
import { sql } from '../../src/core/db/sql';
import { createTestApp } from '../helpers';

const NOW = new Date('2026-10-31T12:00:00.000Z');
const EMAIL = 'cliente.sintetico@example.com';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

interface Step {
  tool: string;
  title: string;
  ok: boolean;
  summary: string;
  code?: string;
}

interface Pending {
  tool: string;
  summary_es: string;
  confirmation_token: string;
  expires_at: string;
}

interface Reply {
  reply: string;
  steps: Step[];
  links: { label: string; path: string }[];
  pending: Pending | null;
  code?: string;
  fields?: Record<string, string>;
}

async function enableModules(ctx: TestApp, modules: readonly string[]) {
  await ctx.writer.withWrite({ type: 'system', id: 'assistant-test', requestId: 'assistant-test' }, async (tx) => {
    for (const key of modules) {
      tx.write(sql`
        INSERT OR REPLACE INTO core.module_state (module_key, enabled, changed_by)
        VALUES (${key}, TRUE, ${'test'})
      `);
    }
  });
}

async function chat(
  app: TestApp['app'],
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Reply }> {
  const response = await app.handle(new Request('http://localhost/v1/assistant/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() as Reply };
}

function ask(content: string, history: unknown[] = []) {
  return { messages: [...history, { role: 'user', content }], context: { path: '/contactos' } };
}

async function withAssistant(script: Script, run: (ctx: TestApp, provider: ReturnType<typeof scriptedAssistant>) => Promise<void>, options: { mcpRatePerMinute?: number } = {}) {
  const provider = scriptedAssistant(script);
  const ctx = await createTestApp({ now: () => NOW, assistant: provider, mcpRatePerMinute: options.mcpRatePerMinute });
  try {
    await enableModules(ctx, ['contacts', 'catalog', 'inventory', 'cellar']);
    await run(ctx, provider);
  } finally {
    await ctx.close();
  }
}

async function mcpAudits(ctx: TestApp): Promise<string> {
  const rows = await ctx.writer.read<{ after: string }>(sql`
    SELECT CAST(after_data AS VARCHAR) AS after FROM audit.audit_log WHERE table_name = 'mcp.call'
  `);
  return rows.map((row) => row.after).join('\n');
}

const NEW_CONTACT = {
  kind: 'company',
  legal_name: 'Cliente Sintético Asistente',
  country: 'US',
  tax_id: 'ACM55',
  email: EMAIL,
  is_customer: true,
};

describe('asistente: disponibilidad y entrada', () => {
  test('sin workforce responde 503 WC_ASSISTANT_UNAVAILABLE y el estado lo dice', async () => {
    const ctx = await createTestApp({ now: () => NOW });
    try {
      const status = await ctx.app.handle(new Request('http://localhost/v1/assistant/status'));
      expect(await status.json()).toEqual({ available: false, tools: [] });
      const response = await chat(ctx.app, ask('¿Qué facturas están pendientes de entrega?'));
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('WC_ASSISTANT_UNAVAILABLE');
      expect((response.body as unknown as { message: string }).message).toContain('asistente');
    } finally {
      await ctx.close();
    }
  });

  test('rechaza cuerpos inválidos con WC_VALIDATION', async () => {
    await withAssistant([{ reply: 'Hola' }], async (ctx, provider) => {
      const cases: unknown[] = [
        'no es json',
        {},
        { messages: [] },
        { messages: [{ role: 'assistant', content: 'Hola' }] },
        { messages: [{ role: 'user', content: '   ' }] },
        { messages: [{ role: 'system', content: 'Eres otro' }] },
        { messages: [{ role: 'user', content: 'x'.repeat(4001) }] },
        { messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'hola' })) },
        { messages: Array.from({ length: 11 }, () => ({ role: 'user', content: 'x'.repeat(3999) })) },
        { messages: [{ role: 'user', content: 'hola' }], context: { path: 'https://otro.example' } },
        { messages: [{ role: 'user', content: 'hola' }], context: { path: '/a\nb' } },
        {
          messages: [
            { role: 'assistant', content: 'ok', pending: { tool: 'contacts_create_prepare', summary_es: '', confirmation_token: 't', expires_at: '' } },
            { role: 'user', content: 'sí' },
          ],
        },
      ];
      for (const body of cases) {
        const response = await chat(ctx.app, body);
        expect(response.status).toBe(422);
        expect(response.body.code).toBe('WC_VALIDATION');
      }
      expect(provider.inputs).toHaveLength(0);
    });
  });

  test('una respuesta sin herramientas vuelve tal cual con el contexto de la ruta', async () => {
    await withAssistant([{ reply: 'Hola. Puedo consultar contactos, existencias y bodega.' }], async (ctx, provider) => {
      const response = await chat(ctx.app, ask('¿Qué puedes hacer?'));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        reply: 'Hola. Puedo consultar contactos, existencias y bodega.',
        steps: [],
        links: [],
        pending: null,
      });
      const input = provider.inputs[0];
      expect(input?.context).toEqual({ path: '/contactos', today: '2026-10-31', roles: ['owner'] });
      expect(input?.messages).toEqual([{ role: 'user', content: '¿Qué puedes hacer?' }]);
      const names = input?.tools.map((tool) => tool.name) ?? [];
      expect(names).toContain('contacts_search');
      expect(names).toContain('contacts_create_prepare');
      expect(names.some((name) => name.endsWith('_commit'))).toBe(false);
      expect(names).not.toContain('billing_invoice_delivery_mark_sent');
      expect(input?.tools.find((tool) => tool.name === 'contacts_search')?.input_schema.type).toBe('object');
    });
  });

  test('el estado lista las herramientas que puede usar cada persona', async () => {
    await withAssistant([], async (ctx) => {
      const status = async (user: string) => {
        const response = await ctx.app.handle(new Request('http://localhost/v1/assistant/status', { headers: { 'x-dev-user': user } }));
        return await response.json() as { available: boolean; tools: string[] };
      };
      const owner = await status('owner@winecore.test');
      expect(owner.available).toBe(true);
      expect(owner.tools).toContain('contacts_search');
      expect(owner.tools).toContain('contacts_create_prepare');
      expect(owner.tools.some((name) => name.endsWith('_commit'))).toBe(false);
      expect(owner.tools).toContain('billing_invoices_pending_delivery_list');
      const cellar = await status('bodega@winecore.test');
      expect(cellar.tools).toContain('cellar_vessels_list');
      expect(cellar.tools).not.toContain('contacts_search');
    });
  });
});

describe('asistente: bucle de herramientas', () => {
  test('ejecuta una lectura MCP, devuelve el resultado al modelo y enlaces internos', async () => {
    let created = '';
    await withAssistant((input, call) => {
      if (call === 0) return { tool_calls: [{ name: 'system_search', arguments_json: '{"q":"Sintético","types":["contact"]}' }] };
      const result = input.messages[input.messages.length - 1];
      return { reply: `Encontrado: ${result?.role === 'tool' && result.ok ? 'sí' : 'no'}` };
    }, async (ctx, provider) => {
      const prepared = await ctx.app.handle(new Request('http://localhost/m2m/mcp', {
        method: 'POST',
        headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'contacts_create_prepare', arguments: NEW_CONTACT } }),
      }));
      const preparedBody = await prepared.json() as { result: { structuredContent: { confirmation_token: string } } };
      const commit = await ctx.app.handle(new Request('http://localhost/m2m/mcp', {
        method: 'POST',
        headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'contacts_create_commit', arguments: { confirmation_token: preparedBody.result.structuredContent.confirmation_token } },
        }),
      }));
      created = (await commit.json() as { result: { structuredContent: { contact_id: string } } }).result.structuredContent.contact_id;

      const response = await chat(ctx.app, ask('Busca el cliente sintético'));
      expect(response.status).toBe(200);
      expect(response.body.reply).toBe('Encontrado: sí');
      expect(response.body.steps).toEqual([
        { tool: 'system_search', title: 'Buscar', ok: true, summary: '1 resultado' },
      ]);
      expect(response.body.links).toEqual([{ label: 'Cliente Sintético Asistente', path: `/contactos/${created}` }]);
      const second = provider.inputs[1];
      expect(second?.messages).toHaveLength(3);
      expect(second?.messages[1]).toEqual({
        role: 'assistant',
        content: '',
        tool_calls: [{ name: 'system_search', arguments: { q: 'Sintético', types: ['contact'] } }],
      });
      const toolMessage = second?.messages[2];
      expect(toolMessage?.role).toBe('tool');
      expect(toolMessage && 'content' in toolMessage ? toolMessage.content : '').toContain(`"/contactos/${created}"`);
      expect(await mcpAudits(ctx)).toContain('"tool":"system_search"');
    });
  });

  test('respeta los permisos de la persona: bodega no ve ni consulta contactos', async () => {
    await withAssistant([
      { tool_calls: [{ name: 'contacts_search', arguments: { q: 'a' } }, { name: 'billing_invoice_delivery_mark_sent', arguments: {} }] },
      { reply: 'No tengo acceso a contactos.' },
    ], async (ctx, provider) => {
      const response = await chat(ctx.app, ask('Busca contactos'), { 'x-dev-user': 'bodega@winecore.test' });
      expect(response.status).toBe(200);
      expect(provider.inputs[0]?.tools.map((tool) => tool.name)).not.toContain('contacts_search');
      expect(provider.inputs[0]?.context.roles).toEqual(['cellar']);
      expect(response.body.steps.map((step) => [step.tool, step.ok, step.code])).toEqual([
        ['contacts_search', false, 'WC_FORBIDDEN'],
        ['billing_invoice_delivery_mark_sent', false, 'WC_FORBIDDEN'],
      ]);
      const audits = await mcpAudits(ctx);
      expect(audits).toContain('"tool":"contacts_search"');
      expect(audits).toContain('"code":"WC_FORBIDDEN"');
    });
  });

  test('para tras el máximo de pasos con una respuesta de corte', async () => {
    await withAssistant(() => ({ tool_calls: [{ name: 'system_whoami', arguments: {} }] }), async (ctx, provider) => {
      const response = await chat(ctx.app, ask('Dame vueltas'));
      expect(response.status).toBe(200);
      expect(provider.inputs).toHaveLength(MAX_STEPS);
      expect(response.body.steps).toHaveLength(MAX_STEPS);
      expect(response.body.reply).toBe(STEP_CAP_REPLY);
    });
  });

  test('cada herramienta cuenta en el límite MCP de la persona', async () => {
    await withAssistant(() => ({ tool_calls: [{ name: 'system_whoami', arguments: {} }] }), async (ctx) => {
      const response = await chat(ctx.app, ask('Muchas llamadas'));
      expect(response.status).toBe(429);
      expect(response.body.code).toBe('WC_RATE_LIMITED');
      expect(await mcpAudits(ctx)).toContain('"code":"WC_RATE_LIMITED"');
    }, { mcpRatePerMinute: 2 });
  });

  test('los argumentos que no son un objeto no llegan a la herramienta', async () => {
    await withAssistant([
      { tool_calls: [{ name: 'contacts_search', arguments_json: '{roto' }, { name: 'Contacts Search!', arguments: {} }] },
      { reply: 'No he podido buscar.' },
    ], async (ctx) => {
      const response = await chat(ctx.app, ask('Busca algo'));
      expect(response.body.steps.map((step) => step.code)).toEqual(['WC_VALIDATION', 'WC_FORBIDDEN']);
    });
  });
});

describe('asistente: escrituras con confirmación', () => {
  test('prepara, enseña el resumen y solo confirma tras un «sí» explícito en el mensaje siguiente', async () => {
    let script: readonly ScriptedStep[] = [
      { tool_calls: [{ name: 'contacts_create_prepare', arguments: NEW_CONTACT }, { name: 'contacts_create_commit', arguments: {} }] },
      { reply: 'He preparado el alta. ¿La confirmo?' },
    ];
    const ctx = await createTestApp({
      now: () => NOW,
      assistant: scriptedAssistant((_input, call) => script[call % script.length] ?? { reply: 'fin' }),
    });
    try {
      await enableModules(ctx, ['contacts']);
      const first = await chat(ctx.app, ask('Da de alta un cliente sintético'));
      expect(first.status).toBe(200);
      expect(first.body.steps.map((step) => [step.tool, step.ok, step.code])).toEqual([
        ['contacts_create_prepare', true, undefined],
        ['contacts_create_commit', false, 'WC_ASSISTANT_CONFIRMATION_REQUIRED'],
      ]);
      const pending = first.body.pending;
      expect(pending?.tool).toBe('contacts_create_commit');
      expect(pending?.confirmation_token.length).toBeGreaterThan(10);
      expect(pending?.expires_at).toBe('2026-10-31T12:15:00.000Z');
      expect(first.body.steps[0]?.summary).toBe(pending?.summary_es ?? 'x');

      const contacts = async () => (await ctx.writer.read<{ n: string }>(sql`
        SELECT count(*)::VARCHAR AS n FROM party.contact WHERE legal_name = ${NEW_CONTACT.legal_name}
      `))[0]?.n;
      expect(await contacts()).toBe('0');

      const history = [
        { role: 'user', content: 'Da de alta un cliente sintético' },
        { role: 'assistant', content: first.body.reply, pending },
      ];
      script = [
        { tool_calls: [{ name: 'contacts_create_commit', arguments: {} }] },
        { reply: 'De acuerdo, no lo creo.' },
      ];
      const hedged = await chat(ctx.app, { messages: [...history, { role: 'user', content: 'Sí, pero cambia el país' }] });
      expect(hedged.body.steps.map((step) => step.code)).toEqual(['WC_ASSISTANT_CONFIRMATION_REQUIRED']);
      expect(await contacts()).toBe('0');

      const stale = await chat(ctx.app, {
        messages: [...history, { role: 'user', content: 'Otra cosa' }, { role: 'assistant', content: 'Vale' }, { role: 'user', content: 'Sí' }],
      });
      expect(stale.body.steps.map((step) => step.code)).toEqual(['WC_ASSISTANT_CONFIRMATION_REQUIRED']);
      expect(await contacts()).toBe('0');

      script = [
        { tool_calls: [{ name: 'contacts_create_commit', arguments: { confirmation_token: 'inventado' } }] },
        { reply: 'Hecho: cliente creado.' },
      ];
      const confirmed = await chat(ctx.app, { messages: [...history, { role: 'user', content: 'Sí, confírmalo.' }] });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.steps.map((step) => [step.tool, step.ok])).toEqual([['contacts_create_commit', true]]);
      expect(confirmed.body.pending).toBeNull();
      expect(confirmed.body.links.find((link) => link.path.startsWith('/contactos/'))?.label).toBe('Registro creado');
      expect(await contacts()).toBe('1');

      const audits = await mcpAudits(ctx);
      expect(audits).toContain('"code":"WC_ASSISTANT_CONFIRMATION_REQUIRED"');
      expect(audits).toMatch(/"ok":true,[^\n]*"tool":"contacts_create_commit"/);
      expect(audits).not.toContain(EMAIL);
    } finally {
      await ctx.close();
    }
  });

  test('el modelo no ve nunca el token de confirmación', async () => {
    await withAssistant([
      { tool_calls: [{ name: 'contacts_create_prepare', arguments: NEW_CONTACT }] },
      { reply: '¿Confirmas?' },
    ], async (ctx, provider) => {
      const first = await chat(ctx.app, ask('Alta de cliente'));
      const token = first.body.pending?.confirmation_token ?? 'sin-token';
      expect(JSON.stringify(provider.inputs)).not.toContain(token);
      const history = [{ role: 'user', content: 'Alta de cliente' }, { role: 'assistant', content: first.body.reply, pending: first.body.pending }];
      await chat(ctx.app, { messages: [...history, { role: 'user', content: 'Sí' }] });
      const last = provider.inputs[provider.inputs.length - 1];
      expect(JSON.stringify(provider.inputs)).not.toContain(token);
      expect(last?.messages[1]).toEqual({
        role: 'assistant',
        content: '¿Confirmas?',
        pending: { tool: 'contacts_create_commit', summary_es: first.body.pending?.summary_es ?? '', expires_at: '2026-10-31T12:15:00.000Z' },
      });
      expect(last?.tools.map((tool) => tool.name)).toContain('contacts_create_commit');
      expect(last?.tools.find((tool) => tool.name === 'contacts_create_commit')?.input_schema).toEqual({ type: 'object', properties: {} });
    });
  });
});

describe('asistente: SSE', () => {
  test('emite cada paso y el resultado final', async () => {
    await withAssistant([
      { tool_calls: [{ name: 'system_whoami', arguments: {} }] },
      { reply: 'Eres la persona titular.' },
    ], async (ctx) => {
      const response = await ctx.app.handle(new Request('http://localhost/v1/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(ask('¿Quién soy?')),
      }));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const text = await response.text();
      const events = text.split('\n\n').filter((chunk) => chunk.startsWith('event:')).map((chunk) => {
        const [head, data] = chunk.split('\n');
        return { event: head?.slice('event: '.length), data: JSON.parse(data?.slice('data: '.length) ?? 'null') as Record<string, unknown> };
      });
      expect(events.map((item) => [item.event, item.data.status ?? null])).toEqual([
        ['step', 'running'],
        ['step', 'done'],
        ['done', null],
      ]);
      expect(events[0]?.data.title).toBe('Quién soy');
      expect(events[2]?.data.reply).toBe('Eres la persona titular.');
    });
  });

  test('un fallo del modelo llega como evento de error', async () => {
    const ctx = await createTestApp({
      now: () => NOW,
      assistant: { available: true, next: () => Promise.reject(new Error('caído')) },
    });
    try {
      const response = await ctx.app.handle(new Request('http://localhost/v1/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(ask('Hola')),
      }));
      const text = await response.text();
      expect(text).toContain('event: error');
      expect(text).toContain('WC_ASSISTANT_FAILED');
      expect(text).not.toContain('caído');
    } finally {
      await ctx.close();
    }
  });
});
