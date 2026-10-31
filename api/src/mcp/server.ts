import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodType } from "zod";

import { sha256Hex } from "../core/hash";
import { DomainError, domainError } from "../core/errors";
import { canonicalJson, consumeConfirmation, issueConfirmation } from "./confirm";
import {
  mcpNames,
  moduleActive,
  toolVisible,
  type AnyTool,
  type DirectWriteTool,
  type McpContext,
  type ReadTool,
  type WriteTool,
} from "./registry";
import { mcpTools } from "./tools";

export const baseTools: readonly AnyTool[] = mcpTools;

const INSTRUCTIONS =
  "Servidor MCP de WineCore. Las lecturas son inmediatas. Las escrituras van en dos pasos: *_prepare devuelve una vista previa y no guarda el negocio; la persona confirma; *_commit ejecuta exactamente lo previsualizado. No hay herramientas para aprobar, emitir, anular, enviar a terceros ni borrar.";

const commitInput = z.object({
  confirmation_token: z.string().min(1),
  idempotency_key: z.string().min(1).optional(),
});

interface ExposedTool {
  name: string;
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

interface JsonObjectSchema {
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

function jsonObjectSchema(schema: ZodType): JsonObjectSchema {
  const raw = z.toJSONSchema(schema, { target: "draft-7" });
  const out: JsonObjectSchema = { type: "object" };
  if (isRecord(raw.properties)) out.properties = raw.properties as Record<string, object>;
  if (Array.isArray(raw.required) && raw.required.every((item) => typeof item === "string")) {
    out.required = raw.required;
  }
  return out;
}

function expose(tool: AnyTool): ExposedTool[] {
  if (tool.kind === "direct") {
    return [
      {
        name: tool.name,
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

export function createMcpServer(ctx: McpContext, tools: readonly AnyTool[] = baseTools): Server {
  const seen = new Set<string>();
  for (const name of catalogueNames(tools)) {
    if (seen.has(name)) throw new Error(`Duplicate MCP tool: ${name}`);
    seen.add(name);
  }
  const server = new Server(
    { name: "winecore", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  const exposed = visibleExposed(ctx, tools);
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
