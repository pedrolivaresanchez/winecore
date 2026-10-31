/** Business error returned to an MCP client as a tool result, never as a thrown protocol failure. */
export class McpToolError extends Error {
  readonly code: string;
  readonly messageEs: string;
  readonly fields?: Record<string, string>;

  constructor(code: string, messageEs: string, fields?: Record<string, string>) {
    super(messageEs);
    this.name = "McpToolError";
    this.code = code;
    this.messageEs = messageEs;
    this.fields = fields;
  }
}

export interface ToolErrorBody {
  code: string;
  message_es: string;
  fields?: Record<string, string>;
}

export function toolErrorBody(error: McpToolError): ToolErrorBody {
  const body: ToolErrorBody = { code: error.code, message_es: error.messageEs };
  if (error.fields && Object.keys(error.fields).length > 0) {
    body.fields = error.fields;
  }
  return body;
}
