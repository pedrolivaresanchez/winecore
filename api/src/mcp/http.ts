import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { McpContext } from "./registry";
import { createMcpServer } from "./server";

/**
 * Stateless Streamable HTTP. One server and one transport per request, so no
 * session is kept between calls. JSON responses (the SDK also speaks SSE).
 */
export async function handleMcpRequest(request: Request, ctx: McpContext): Promise<Response> {
  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
