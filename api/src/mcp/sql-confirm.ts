import { domainError } from "../core/errors";
import { sql } from "../core/db/sql";
import type { Writer } from "../core/db/writer";
import { newId } from "../core/ids";
import type { ConfirmationRecord, ConfirmationStore } from "./confirm";
import { iso, jsonValue } from "./runtime";

/**
 * Persists confirmations in ops.mcp_confirmation. The table has no payload
 * column; the business preview and the commit payload travel together in
 * `preview` so the existing checksummed migrations stay untouched.
 */
interface StoredPreview {
  v: 1;
  shown: unknown;
  payload: unknown;
}

function hexBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw domainError("WC_MCP_CONFIRMATION_INVALID", undefined, "La confirmación no es válida.");
  }
  const out = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function unpack(value: unknown): { shown: unknown; payload: unknown } {
  const parsed = jsonValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { shown: parsed, payload: null };
  }
  const record = parsed as Partial<StoredPreview>;
  if (record.v === 1 && "payload" in record) {
    return { shown: record.shown, payload: record.payload };
  }
  return { shown: parsed, payload: null };
}

export function sqlConfirmationStore(writer: Writer, onBehalfOf: string | null): ConfirmationStore {
  return {
    async create(record: ConfirmationRecord): Promise<void> {
      if (onBehalfOf) {
        const people = await writer.read<{ id: string }>(sql`
          SELECT id::VARCHAR AS id
          FROM core.app_user
          WHERE id = CAST(${onBehalfOf} AS UUID) AND status = 'active'
        `);
        if (!people[0]) {
          throw domainError("WC_VALIDATION", { on_behalf_of: "La persona no existe" });
        }
      }
      const body: StoredPreview = { v: 1, shown: record.preview, payload: record.payload };
      const behalf = onBehalfOf;
      await writer.withWrite(
        {
          type: "agent",
          id: record.clientId,
          onBehalfOf: behalf ?? undefined,
          requestId: "mcp-confirm",
          reason: "preparar confirmación",
        },
        async (tx) => {
          const statement = behalf
            ? sql`
              INSERT INTO ops.mcp_confirmation (
                id, token_hash, tool_name, args_sha256, client_id, on_behalf_of_user_id,
                preview, created_at, expires_at
              ) VALUES (
                CAST(${newId()} AS UUID),
                ${hexBytes(record.tokenHash)},
                ${record.toolName},
                ${record.payloadSha256},
                CAST(${record.clientId} AS UUID),
                CAST(${behalf} AS UUID),
                ${sql.json(body)},
                ${new Date(record.createdAt)},
                ${new Date(record.expiresAt)}
              )
            `
            : sql`
              INSERT INTO ops.mcp_confirmation (
                id, token_hash, tool_name, args_sha256, client_id, on_behalf_of_user_id,
                preview, created_at, expires_at
              ) VALUES (
                CAST(${newId()} AS UUID),
                ${hexBytes(record.tokenHash)},
                ${record.toolName},
                ${record.payloadSha256},
                CAST(${record.clientId} AS UUID),
                NULL,
                ${sql.json(body)},
                ${new Date(record.createdAt)},
                ${new Date(record.expiresAt)}
              )
            `;
          tx.write(statement);
        },
      );
    },

    async get(tokenHash: string): Promise<ConfirmationRecord | null> {
      const rows = await writer.read<Record<string, unknown>>(sql`
        SELECT tool_name, args_sha256, client_id::VARCHAR AS client_id, preview,
               created_at, expires_at, executed_at, result_ref
        FROM ops.mcp_confirmation
        WHERE token_hash = ${hexBytes(tokenHash)}
      `);
      const row = rows[0];
      if (!row) return null;
      const unpacked = unpack(row.preview);
      const executed = row.executed_at == null ? null : iso(row.executed_at);
      return {
        tokenHash,
        toolName: String(row.tool_name),
        clientId: String(row.client_id),
        payloadSha256: String(row.args_sha256),
        preview: unpacked.shown,
        payload: unpacked.payload,
        createdAt: iso(row.created_at),
        expiresAt: iso(row.expires_at),
        consumedAt: executed,
        result: executed ? jsonValue(row.result_ref) : null,
      };
    },

    async markConsumed(tokenHash: string, result: unknown): Promise<void> {
      const now = new Date();
      await writer.withWrite(
        {
          type: "agent",
          id: "mcp",
          requestId: "mcp-confirm",
          reason: "consumir confirmación",
        },
        async (tx) => {
          tx.write(sql`
            UPDATE ops.mcp_confirmation
            SET confirmed_at = ${now},
                executed_at = ${now},
                result_ref = ${result == null ? null : sql.json(result)}
            WHERE token_hash = ${hexBytes(tokenHash)}
              AND executed_at IS NULL
          `);
        },
      );
    },
  };
}
