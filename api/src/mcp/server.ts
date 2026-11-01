import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodType } from "zod";

import { sha256Hex } from "../core/hash";
import { DomainError, domainError } from "../core/errors";
import { canonicalJson, consumeConfirmation, issueConfirmation } from "./confirm";
import {
  defineDirectWrite,
  defineReadTool,
  mcpNames,
  moduleActive,
  toolVisible,
  type AnyTool,
  type DirectWriteTool,
  type McpContext,
  type ReadTool,
  type WriteTool,
} from "./registry";
import { coreTools, mcpTools } from "./tools";

const INSTRUCTIONS =
  "Servidor MCP de WineCore: todo lo que se hace en la app se puede hacer aquí, con los permisos de la persona representada. Las lecturas son inmediatas. Toda escritura va en dos pasos: *_prepare valida y devuelve una vista previa sin guardar nada; enseña summary_es a la persona y pide un sí explícito; *_commit ejecuta exactamente lo previsualizado. Aprobar, rechazar, emitir, anular, enviar y borrar también van así, y la app aplica sus reglas (quién aprueba, passkey si el propietario la exige). Si no ves la herramienta que necesitas, búscala con system_tools_search.";

export interface ToolListing {
  /** Only the core tools and the two gateway tools. */
  compact?: boolean;
  /** Only these modules (system tools always). */
  modules?: readonly string[];
}

const commitInput = z.object({
  confirmation_token: z.string().min(1),
  idempotency_key: z.string().min(1).optional(),
});

export type ExposedKind = "read" | "direct" | "prepare" | "commit";

interface ExposedTool {
  name: string;
  kind: ExposedKind;
  title: string;
  description: string;
  input: ZodType;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export interface JsonObjectSchema {
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
}

export type ToolCallResult = CallToolResult;

interface ToolErrorBody {
  code: string;
  message_es: string;
  fields?: Record<string, string>;
}

function toolErrorBody(error: DomainError): ToolErrorBody {
  const body: ToolErrorBody = { code: error.code, message_es: error.message };
  if (error.fields && Object.keys(error.fields).length > 0) body.fields = error.fields;
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function successResult(data: unknown): CallToolResult {
  const text = JSON.stringify(data);
  const content: CallToolResult["content"] = [{ type: "text", text }];
  if (isRecord(data)) return { content, structuredContent: data };
  return { content, structuredContent: { data } };
}

function failureResult(body: ToolErrorBody): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(body) }],
  };
}

function issueMessage(code: string): string {
  switch (code) {
    case "invalid_type":
      return "Tipo no válido";
    case "invalid_format":
      return "Formato no válido";
    case "too_small":
      return "Valor demasiado corto";
    case "too_big":
      return "Valor demasiado largo";
    case "unrecognized_keys":
      return "Campo no permitido";
    default:
      return "Valor no válido";
  }
}

function validationError(error: z.ZodError): DomainError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "input";
    if (fields[key] === undefined) fields[key] = issueMessage(issue.code);
  }
  return domainError("WC_VALIDATION", fields, "Los datos de entrada no son válidos.");
}

function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

const schemas = new WeakMap<ZodType, JsonObjectSchema>();

function jsonObjectSchema(schema: ZodType): JsonObjectSchema {
  const cached = schemas.get(schema);
  if (cached) return cached;
  const raw = z.toJSONSchema(schema, { target: "draft-7" });
  const out: JsonObjectSchema = { type: "object" };
  if (isRecord(raw.properties)) out.properties = raw.properties as Record<string, object>;
  if (Array.isArray(raw.required) && raw.required.every((item) => typeof item === "string")) {
    out.required = raw.required;
  }
  schemas.set(schema, out);
  return out;
}

function expose(tool: AnyTool): ExposedTool[] {
  if (tool.kind === "direct") {
    return [
      {
        name: tool.name,
        kind: "direct",
        title: tool.title,
        description: tool.description,
        input: tool.input,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ];
  }
  if (tool.kind === "read") {
    return [
      {
        name: tool.name,
        kind: "read",
        title: tool.title,
        description: tool.description,
        input: tool.input,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ];
  }
  return [
    {
      name: `${tool.name}_prepare`,
      kind: "prepare",
      title: `${tool.title} · preparar`,
      description: `${tool.description} Valida y devuelve una vista previa; no escribe datos de negocio.`,
      input: tool.input,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name: `${tool.name}_commit`,
      kind: "commit",
      title: `${tool.title} · confirmar`,
      description: `${tool.description} Ejecuta la operación preparada si el token de confirmación es válido.`,
      input: commitInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ];
}

function visibleExposed(ctx: McpContext, tools: readonly AnyTool[]): ExposedTool[] {
  const listed: ExposedTool[] = [];
  for (const tool of tools) {
    if (!toolVisible(tool, ctx)) continue;
    listed.push(...expose(tool));
  }
  return listed;
}

function listed(tools: readonly AnyTool[], listing: ToolListing | undefined): readonly AnyTool[] {
  if (!listing) return tools;
  return tools.filter((tool) => {
    if (listing.compact && !coreToolNames.has(tool.name)) return false;
    if (listing.modules && tool.module !== "system" && !listing.modules.includes(tool.module)) return false;
    return true;
  });
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const toolsSearch = defineReadTool({
  name: "system_tools_search",
  module: "system",
  scope: "",
  title: "Buscar herramientas",
  description: "Busca entre todas las herramientas de WineCore por palabras («remesa», «factura rectificativa», «trasiego») y devuelve su nombre, qué hace y su esquema de entrada.",
  input: z.object({
    q: z.string().trim().min(2).max(80),
    module: z.string().trim().max(40).optional(),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  handler: (ctx, input) => {
    const words = fold(input.q).split(/[^a-z0-9_]+/).filter((word) => word.length >= 2);
    const modules = new Map<string, string>();
    for (const tool of baseTools) for (const name of mcpNames(tool)) modules.set(name, tool.module);
    const scored = visibleToolCatalogue(ctx)
      .filter((tool) => tool.kind !== "commit")
      .filter((tool) => !input.module || modules.get(tool.name) === input.module)
      .map((tool) => {
        const haystack = fold(`${tool.name} ${tool.title} ${tool.description}`);
        return { tool, score: words.filter((word) => haystack.includes(word)).length };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
    return {
      items: scored.slice(0, input.limit ?? 12).map(({ tool }) => ({
        name: tool.name,
        kind: tool.kind,
        title: tool.title,
        description: tool.description,
        input_schema: tool.inputSchema,
        ...(tool.kind === "prepare" ? { commit: `${tool.name.slice(0, -"_prepare".length)}_commit` } : {}),
      })),
    };
  },
});

const toolRun = defineDirectWrite({
  name: "system_tool_run",
  module: "system",
  scope: "",
  title: "Usar una herramienta",
  description: "Llama a cualquier herramienta por su nombre (de system_tools_search) con sus argumentos. Una *_commit sigue necesitando el confirmation_token de su *_prepare.",
  input: z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/),
    arguments: z.record(z.string(), z.unknown()).optional(),
  }),
  handler: async (ctx, input) => {
    if (input.name === "system_tool_run") throw domainError("WC_VALIDATION", { name: "No puede llamarse a sí misma" });
    const result = await callTool(ctx, input.name, input.arguments ?? {});
    if (result.isError === true) {
      const block = result.content[0];
      const body = block?.type === "text" ? JSON.parse(block.text) as ToolErrorBody : null;
      throw new DomainError(body?.code ?? "WC002", 400, body?.message_es ?? "La herramienta ha fallado.", body?.fields);
    }
    return result.structuredContent ?? {};
  },
});

const gatewayTools: readonly AnyTool[] = [toolsSearch, toolRun];

export const baseTools: readonly AnyTool[] = [...mcpTools, ...gatewayTools];

/** The curated tools plus the gateway: what `?tools=compact` lists. */
export const coreToolNames: ReadonlySet<string> = new Set([...coreTools, ...gatewayTools].map((tool) => tool.name));

type Resolved =
  | { kind: "read"; tool: ReadTool }
  | { kind: "direct"; tool: DirectWriteTool }
  | { kind: "prepare"; tool: WriteTool }
  | { kind: "commit"; tool: WriteTool };

function resolve(name: string, tools: readonly AnyTool[]): Resolved | null {
  for (const tool of tools) {
    if (tool.kind === "read") {
      if (tool.name === name) return { kind: "read", tool };
      continue;
    }
    if (tool.kind === "direct") {
      if (tool.name === name) return { kind: "direct", tool };
      continue;
    }
    if (`${tool.name}_prepare` === name) return { kind: "prepare", tool };
    if (`${tool.name}_commit` === name) return { kind: "commit", tool };
  }
  return null;
}

function assertAccess(tool: AnyTool, ctx: McpContext): void {
  if (toolVisible(tool, ctx)) return;
  if (!moduleActive(tool.module, ctx.activeModules)) {
    throw domainError("WC_MODULE_DISABLED");
  }
  throw domainError("WC_FORBIDDEN");
}

async function runRead(ctx: McpContext, tool: ReadTool | DirectWriteTool, args: unknown): Promise<unknown> {
  assertAccess(tool, ctx);
  const input = parseInput(tool.input, args);
  return tool.handler(ctx, input);
}

async function runPrepare(ctx: McpContext, tool: WriteTool, args: unknown): Promise<unknown> {
  assertAccess(tool, ctx);
  const input = parseInput(tool.input, args);
  const prepared = await tool.prepare(ctx, input);
  const issued = await issueConfirmation({
    store: ctx.deps.confirmations,
    now: ctx.now(),
    toolName: tool.name,
    clientId: ctx.client.id,
    preview: prepared.preview,
    payload: prepared.payload,
  });
  const summary = prepared.summary_es?.trim();
  return {
    preview: prepared.preview,
    summary_es: summary && summary.length > 0
      ? summary
      : `Vista previa de «${tool.title}». Revisa el detalle y confirma solo si quieres que se ejecute.`,
    confirmation_token: issued.token,
    expires_at: issued.expiresAt,
  };
}

async function runCommit(ctx: McpContext, tool: WriteTool, args: unknown): Promise<unknown> {
  assertAccess(tool, ctx);
  const input = parseInput(commitInput, args);
  return consumeConfirmation({
    store: ctx.deps.confirmations,
    now: ctx.now(),
    token: input.confirmation_token,
    toolName: tool.name,
    clientId: ctx.client.id,
    execute: (payload) => Promise.resolve(tool.commit(ctx, payload)),
  });
}

export function visibleToolNames(ctx: McpContext, tools: readonly AnyTool[] = baseTools): string[] {
  return visibleExposed(ctx, tools).map((tool) => tool.name);
}

export interface ToolDescriptor {
  name: string;
  kind: ExposedKind;
  title: string;
  description: string;
  inputSchema: JsonObjectSchema;
}

/** The same list `tools/list` returns for this context, plus the kind of each tool. */
export function visibleToolCatalogue(ctx: McpContext, tools: readonly AnyTool[] = baseTools): ToolDescriptor[] {
  return visibleExposed(ctx, tools).map((tool) => ({
    name: tool.name,
    kind: tool.kind,
    title: tool.title,
    description: tool.description,
    inputSchema: jsonObjectSchema(tool.input),
  }));
}

export function toolKindOf(name: string, tools: readonly AnyTool[] = baseTools): ExposedKind | null {
  return resolve(name, tools)?.kind ?? null;
}

export function catalogueNames(tools: readonly AnyTool[] = baseTools): string[] {
  const names: string[] = [];
  for (const tool of tools) names.push(...mcpNames(tool));
  return names;
}

export async function callTool(
  ctx: McpContext,
  name: string,
  args: unknown,
  tools: readonly AnyTool[] = baseTools,
): Promise<ToolCallResult> {
  try {
    const resolved = resolve(name, tools);
    if (!resolved) {
      throw domainError("WC_FORBIDDEN");
    }
    let data: unknown;
    if (resolved.kind === "read" || resolved.kind === "direct") data = await runRead(ctx, resolved.tool, args);
    else if (resolved.kind === "prepare") data = await runPrepare(ctx, resolved.tool, args);
    else data = await runCommit(ctx, resolved.tool, args);
    const result = successResult(data);
    await recordCall(ctx, name, args, result);
    return result;
  } catch (error) {
    const result = error instanceof DomainError
      ? failureResult(toolErrorBody(error))
      : failureResult(toolErrorBody(domainError("WC002", undefined, "Error interno al ejecutar la herramienta.")));
    try {
      await recordCall(ctx, name, args, result);
    } catch {
      return failureResult(toolErrorBody(domainError("WC002", undefined, "No se ha podido registrar la llamada.")));
    }
    return result;
  }
}

function resultCode(result: CallToolResult): string | null {
  if (result.isError !== true) return null;
  const block = result.content[0];
  if (!block || block.type !== "text") return null;
  try {
    const body = JSON.parse(block.text) as { code?: unknown };
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

async function recordCall(ctx: McpContext, name: string, args: unknown, result: CallToolResult): Promise<void> {
  if (!ctx.deps.audit) return;
  let argsSha256 = "0".repeat(64);
  try {
    argsSha256 = sha256Hex(canonicalJson(args ?? {}));
  } catch {
    argsSha256 = sha256Hex("unserializable");
  }
  await ctx.deps.audit({
    tool: name,
    clientId: ctx.client.id,
    onBehalfOf: ctx.actor?.id ?? null,
    argsSha256,
    ok: result.isError !== true,
    code: resultCode(result),
  });
}

export function createMcpServer(ctx: McpContext, tools: readonly AnyTool[] = baseTools, listing?: ToolListing): Server {
  const seen = new Set<string>();
  for (const name of catalogueNames(tools)) {
    if (seen.has(name)) throw new Error(`Duplicate MCP tool: ${name}`);
    seen.add(name);
  }
  const server = new Server(
    { name: "winecore", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  const exposed = visibleExposed(ctx, listed(tools, listing));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: exposed.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: jsonObjectSchema(tool.input),
      annotations: tool.annotations,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return callTool(ctx, request.params.name, request.params.arguments ?? {}, tools);
  });
  return server;
}
