import { approvalServiceOn } from '../approvals/sql-store';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';

export interface RemittanceApprovalInput {
  /** Lectura dentro de la misma petición. No llames a writer.withWrite desde decide. */
  tx: Tx;
  remittanceId: string;
  legalEntityId: string;
  kind: 'direct_debit' | 'credit_transfer';
  contentSha256: string;
}

export interface RemittanceApprovalDecision {
  approved: boolean;
  approvalRequestId?: string | null;
}

/**
 * El módulo de aprobaciones se conecta más adelante.
 * Mientras tanto la generación del fichero queda cerrada.
 */
export interface RemittanceApproval {
  decide(input: RemittanceApprovalInput): Promise<RemittanceApprovalDecision> | RemittanceApprovalDecision;
}

export const remittanceApprovalDenied: RemittanceApproval = {
  decide() {
    return { approved: false };
  },
};

/** Solicitud con hash, aprobación con verificación reforzada y consumo en la misma escritura. */
export const remittanceApproval: RemittanceApproval = {
  async decide(input) {
    const rows = await input.tx.read<{ id: unknown; status: unknown; payload_sha256: unknown; details: unknown }>(sql`
      SELECT id, status, payload_sha256, details
      FROM ops.approval_request
      WHERE kind = 'sepa_remittance'
        AND subject_table = 'finance.remittance'
        AND subject_id = CAST(${input.remittanceId} AS UUID)
      ORDER BY requested_at DESC
      LIMIT 1
    `);
    const row = rows[0];
    if (!row || String(row.status) !== 'approved') return { approved: false };
    const stored = String(row.payload_sha256);
    const marked = contentShaOf(row.details);
    if (stored !== input.contentSha256 && marked !== input.contentSha256) return { approved: false };
    const requestId = String(row.id).toLowerCase();
    await approvalServiceOn(input.tx, []).consume({ requestId, payloadSha256: stored });
    return { approved: true, approvalRequestId: requestId };
  },
};

function contentShaOf(details: unknown): string | null {
  const value = typeof details === 'string' ? parseJson(details) : details;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sha = (value as { content_sha256?: unknown }).content_sha256;
  return typeof sha === 'string' ? sha : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
