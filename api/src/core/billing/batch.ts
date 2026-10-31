import { can, type UserCtx } from '../auth/permissions';
import { payloadSha256 } from '../approvals/canonical';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { asDomainError, domainError } from '../errors';
import { approvalStillValid, consumeApproval, readApproval, reviewApproval } from './approval';
import { invoiceContentHash } from './contentHash';
import { today } from './format';
import { raiseIssue } from './issues';
import { issueInvoice, type IssueResult } from './issue';
import { loadInvoice } from './readModel';
import { validateInvoice } from './validate';

export interface BatchInvoiceRef {
  id: string;
  content_sha256: string;
  issue_date: string;
  customer_name: string;
  total: string | null;
}

export interface BatchRequest {
  approval_request_id: string;
  status: 'pending' | 'approved';
  invoices: BatchInvoiceRef[];
}

export async function requestBatchIssue(
  tx: Tx,
  invoiceIds: readonly string[],
  actor: Actor,
  user: UserCtx,
  now = new Date(),
): Promise<BatchRequest> {
  if (invoiceIds.length === 0) throw domainError('WC_VALIDATION', { invoice_ids: 'Selecciona al menos un borrador' });
  if (invoiceIds.length > 100) throw domainError('WC_VALIDATION', { invoice_ids: 'El lote admite como máximo 100 borradores' });
  const views = [];
  for (const id of invoiceIds) views.push(await loadInvoice(tx, id));
  const entityId = views[0]?.header.legalEntityId;
  if (!entityId || views.some((view) => view.header.legalEntityId !== entityId)) {
    throw domainError('WC_VALIDATION', { invoice_ids: 'El lote tiene que ser de una sola entidad' });
  }
  if (!can(user, 'billing.write', entityId)) throw domainError('WC_FORBIDDEN');
  const sharedApproval = views.every((view) => view.header.status === 'pending_approval' && view.header.approvalRequestId)
    ? views[0]?.header.approvalRequestId
    : null;
  if (sharedApproval && views.every((view) => view.header.approvalRequestId === sharedApproval)) {
    const existing = await readApproval(tx, sharedApproval);
    const invoices = batchRefs(existing?.payload);
    if (existing && invoices && sameIds(invoices, views.map((view) => view.header.id))) {
      return { approval_request_id: existing.id, status: existing.status === 'approved' ? 'approved' : 'pending', invoices };
    }
  }
  if (views.some((view) => view.header.status !== 'draft')) {
    throw domainError('WC_INV_NOT_DRAFT');
  }
  const refs: BatchInvoiceRef[] = [];
  for (const view of views) {
    const validation = await validateInvoice(tx, view.header.id, now);
    const first = validation.errors[0];
    if (first) raiseIssue(first);
    const issueDate = view.header.issueDate ?? today(now);
    refs.push({
      id: view.header.id,
      content_sha256: invoiceContentHash(view, issueDate),
      issue_date: issueDate,
      customer_name: view.customer?.legalName ?? '',
      total: view.header.total,
    });
  }
  refs.sort((left, right) => left.issue_date.localeCompare(right.issue_date) || left.id.localeCompare(right.id));
  const total = refs.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  const summary = `Emitir ${refs.length} facturas por ${total.toFixed(2)} EUR`.slice(0, 300);
  const review = await reviewApproval(tx, {
    kind: 'invoice_batch_issue',
    legalEntityId: entityId,
    subjectTable: 'billing.invoice',
    subjectId: refs[0]?.id ?? entityId,
    summary,
    payload: { invoices: refs },
    requestedBy: actor.id,
  }, now);
  for (const ref of refs) {
    tx.write(sql`
      UPDATE billing.invoice
      SET status = 'pending_approval',
          approval_request_id = CAST(${review.requestId} AS UUID),
          issue_date = CAST(${ref.issue_date} AS DATE),
          updated_at = ${now}
      WHERE id = CAST(${ref.id} AS UUID) AND status = 'draft'
    `);
    tx.audit({
      table: 'billing.invoice',
      rowId: ref.id,
      action: 'UPDATE',
      before: { status: 'draft' },
      after: { status: 'pending_approval', approval_request_id: review.requestId, issue_date: ref.issue_date },
    });
  }
  return { approval_request_id: review.requestId, status: review.granted ? 'approved' : 'pending', invoices: refs };
}

export interface BatchFailure {
  id: string;
  code: string;
  message: string;
}

export async function executeBatchIssue(
  writer: Writer,
  requestId: string,
  actor: Actor,
  user: UserCtx,
  now = new Date(),
): Promise<{ issued: IssueResult[]; failed: BatchFailure[] }> {
  const approval = await readApproval(writer, requestId);
  if (!approval) throw domainError('WC_NOT_FOUND');
  if (payloadSha256(approval.payload) !== approval.payloadSha256) throw domainError('WC040');
  if (approval.status !== 'approved') throw domainError('WC_INV_APPROVAL_REQUIRED');
  if (!approvalStillValid(approval.expiresAt, now)) throw domainError('WC043');
  const refs = batchRefs(approval.payload);
  if (!refs) throw domainError('WC040');
  const entityRows = await writer.read<{ legal_entity_id: unknown }>(sql`
    SELECT legal_entity_id FROM ops.approval_request WHERE id = CAST(${requestId} AS UUID)
  `);
  const entityId = entityRows[0] ? String(entityRows[0].legal_entity_id).toLowerCase() : '';
  if (!entityId || !can(user, 'billing.issue', entityId)) throw domainError('WC_FORBIDDEN');
  const ordered = [...refs].sort((left, right) => left.issue_date.localeCompare(right.issue_date) || left.id.localeCompare(right.id));
  const issued: IssueResult[] = [];
  const failed: BatchFailure[] = [];
  for (const ref of ordered) {
    const view = await loadInvoice(writer, ref.id);
    const currentDate = view.header.issueDate ?? '';
    if (currentDate !== ref.issue_date || invoiceContentHash(view, currentDate) !== ref.content_sha256) {
      await release(writer, actor, ref.id, now);
      failed.push({
        id: ref.id,
        code: 'WC_INV_HASH',
        message: 'El borrador cambió después de pedir la aprobación',
      });
      continue;
    }
    try {
      const result = await writer.withWrite(actor, (tx) => issueInvoice(tx, {
        invoiceId: ref.id,
        actor,
        fromBatch: true,
        now,
      }));
      issued.push(result);
    } catch (error) {
      const domain = asDomainError(error);
      await release(writer, actor, ref.id, now);
      failed.push({
        id: ref.id,
        code: domain?.code ?? 'WC_INTERNAL',
        message: domain?.message ?? 'No se ha podido emitir',
      });
    }
  }
  await writer.withWrite(actor, (tx) => consumeApproval(tx, requestId, now));
  return { issued, failed };
}

async function release(writer: Writer, actor: Actor, invoiceId: string, now: Date): Promise<void> {
  await writer.withWrite(actor, async (tx) => {
    const rows = await tx.read<{ status: unknown }>(sql`
      SELECT status FROM billing.invoice WHERE id = CAST(${invoiceId} AS UUID)
    `);
    if (String(rows[0]?.status) !== 'pending_approval') return;
    tx.write(sql`
      UPDATE billing.invoice
      SET status = 'draft', approval_request_id = NULL, updated_at = ${now}
      WHERE id = CAST(${invoiceId} AS UUID) AND status = 'pending_approval'
    `);
    tx.audit({
      table: 'billing.invoice',
      rowId: invoiceId,
      action: 'UPDATE',
      before: { status: 'pending_approval' },
      after: { status: 'draft' },
    });
  });
}

function batchRefs(payload: Record<string, unknown> | undefined): BatchInvoiceRef[] | null {
  const invoices = payload?.invoices;
  if (!Array.isArray(invoices)) return null;
  const refs: BatchInvoiceRef[] = [];
  for (const item of invoices) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.content_sha256 !== 'string' || typeof row.issue_date !== 'string') return null;
    refs.push({
      id: row.id,
      content_sha256: row.content_sha256,
      issue_date: row.issue_date,
      customer_name: typeof row.customer_name === 'string' ? row.customer_name : '',
      total: typeof row.total === 'string' ? row.total : null,
    });
  }
  return refs;
}

function sameIds(refs: readonly BatchInvoiceRef[], ids: readonly string[]): boolean {
  const left = [...refs.map((ref) => ref.id)].sort();
  const right = [...ids].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
