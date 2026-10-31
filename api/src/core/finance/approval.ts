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
