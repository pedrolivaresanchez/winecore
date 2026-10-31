import { payloadSha256 } from '../approvals/canonical';
import type { ApprovalKind } from '../approvals/types';
import { approvalServiceOn } from '../approvals/sql-store';
import {
  setBillingApprovalHook,
  type ApprovalNeed,
  type ApprovalReview,
} from '../billing/approval';
import { postInvoiceFiscalExits } from '../billing/fiscal-exit';
import { onInvoiceIssued } from '../billing/issued';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { remittanceApproval } from '../finance/approval';
import { setRemittanceApproval } from '../finance/runtime';

let installed = false;

/** Connect billing, remittances and fiscal stock to the modules that already exist. */
export function installIntegrations(): void {
  if (installed) return;
  installed = true;
  setBillingApprovalHook({ review: reviewWithApprovals });
  setRemittanceApproval(remittanceApproval);
  onInvoiceIssued(postInvoiceFiscalExits);
}

async function reviewWithApprovals(tx: Tx, need: ApprovalNeed, now: Date): Promise<ApprovalReview> {
  const kind = approvalKind(need.kind);
  const hash = payloadSha256(need.payload);
  const existing = await tx.read<{ id: unknown; status: unknown; expires_at: unknown }>(sql`
    SELECT id, status, expires_at
    FROM ops.approval_request
    WHERE kind = ${kind}
      AND payload_sha256 = ${hash}
      AND status IN ('pending', 'approved')
    ORDER BY requested_at DESC
    LIMIT 1
  `);
  const row = existing[0];
  if (row && !expired(row.expires_at, now)) {
    return {
      requestId: String(row.id).toLowerCase(),
      granted: String(row.status) === 'approved',
      payloadSha256: hash,
    };
  }
  if (row && String(row.status) === 'pending') {
    const staleId = String(row.id).toLowerCase();
    tx.write(sql`
      UPDATE ops.approval_request
      SET status = 'expired'
      WHERE id = CAST(${staleId} AS UUID) AND status = 'pending'
    `);
  }
  const created = await approvalServiceOn(tx, [], { now: () => now }).requestApproval({
    kind,
    legalEntityId: need.legalEntityId,
    subjectTable: need.subjectTable,
    subjectId: need.subjectId,
    payload: need.payload,
    summary: need.summary,
    requestedBy: need.requestedBy,
  });
  if (created.payloadSha256 !== hash) {
    throw domainError('WC040');
  }
  return { requestId: created.id, granted: false, payloadSha256: created.payloadSha256 };
}

function approvalKind(kind: ApprovalNeed['kind']): ApprovalKind {
  // docs/03-maquinas-estado.md §12: voiding an issued invoice uses invoice_batch_issue.
  return kind === 'invoice_void' ? 'invoice_batch_issue' : kind;
}

function expired(value: unknown, now: Date): boolean {
  const parsed = Date.parse(String(value ?? ''));
  return !Number.isFinite(parsed) || parsed <= now.getTime();
}
