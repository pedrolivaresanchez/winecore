import { api } from "@/lib/api";
import { asClient, type McpClient } from "@/pages/ajustes/conectores/model";

export type IssuedToken = {
  client: McpClient;
  token: string;
};

type CreateResponse = {
  id: string;
  code: string;
  description: string;
  scopes: unknown;
  on_behalf_of_user_id: string | null;
  prefix: string;
  expires_at: string;
  token: string;
};

type RotateResponse = {
  id: string;
  prefix: string;
  expires_at: string;
  token: string;
};

export async function createMcpClient(input: {
  code: string;
  description: string;
  scopes: string[];
  on_behalf_of_user_id: string | null;
}): Promise<IssuedToken> {
  const body = await api<CreateResponse>("/v1/mcp/clients", {
    method: "POST",
    body: JSON.stringify({
      code: input.code,
      description: input.description,
      role_code: "mcp_client",
      scopes: input.scopes,
      on_behalf_of_user_id: input.on_behalf_of_user_id,
    }),
  });
  const client = asClient({
    id: body.id,
    code: body.code,
    description: body.description,
    scopes: body.scopes,
    on_behalf_of_user_id: body.on_behalf_of_user_id,
    token_prefix: body.prefix,
    token_expires_at: body.expires_at,
    created_at: new Date().toISOString(),
    revoked_at: null,
  });
  if (!client || typeof body.token !== "string" || body.token.length === 0) {
    throw new Error("respuesta");
  }
  return { client, token: body.token };
}

export async function rotateMcpClient(id: string): Promise<RotateResponse> {
  return api<RotateResponse>(`/v1/mcp/clients/${encodeURIComponent(id)}/rotate`, { method: "POST" });
}

export async function revokeMcpClient(id: string): Promise<{ id: string; revoked_at: string }> {
  return api(`/v1/mcp/clients/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}
