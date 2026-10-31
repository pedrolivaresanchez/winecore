import { createHash } from 'node:crypto';
import { sql } from '../../db/sql';
import type { Tx } from '../../db/writer';
import { domainError } from '../../errors';
import { newId } from '../../ids';

const MAX_PDF_BYTES = 20 * 1024 * 1024;

export interface SqlReader {
  read<T = Record<string, unknown>>(statement: string): Promise<T[]>;
}

export interface StoredInvoicePdf {
  attachmentId: string;
  sha256: string;
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

/**
 * Immutable invoice PDF store. `api/src/core/attachments` is not in this tree
 * (TASK-CORE-006); this writes `core.attachment*` and can be replaced by that
 * module without changing the renderer or the send flow.
 */
export interface InvoiceDocumentStore {
  putOnce(
    tx: Tx,
    input: {
      invoiceId: string;
      bytes: Uint8Array;
      filename: string;
      createdBy: string;
      /** When set, the issued PDF is already stored and must not be replaced. */
      existingAttachmentId: string | null;
    },
  ): Promise<{ attachmentId: string; sha256: string; created: boolean }>;

  /** DuckDB cannot UPDATE an invoice that already has lines, so the link is the pointer. */
  findInvoicePdf(reader: SqlReader, invoiceId: string): Promise<string | null>;

  read(reader: SqlReader, attachmentId: string): Promise<StoredInvoicePdf | null>;
}

export function knowledgeBaseInvoiceDocuments(): InvoiceDocumentStore {
  return {
    async putOnce(tx, input) {
      if (input.existingAttachmentId) throw domainError('WC080');
      if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_PDF_BYTES) {
        throw domainError('WC_VALIDATION', { pdf: 'El PDF no cabe en un adjunto' });
      }
      const sha = sha256(input.bytes);
      const now = new Date();
      const existing = await tx.read<{ id: string }>(sql`
        SELECT id FROM core.attachment
        WHERE storage_backend = 'knowledge_base' AND storage_key = ${sha}
      `);
      const attachmentId = existing[0] ? text(existing[0].id) : newId();
      if (!existing[0]) {
        tx.write(sql`
          INSERT INTO core.attachment_content (sha256, content)
          SELECT ${sha}, ${input.bytes}
          WHERE NOT EXISTS (SELECT 1 FROM core.attachment_content WHERE sha256 = ${sha})
        `);
        tx.write(sql`
          INSERT INTO core.attachment (
            id, sha256, storage_backend, storage_key, filename, mime_type, size_bytes,
            classification, created_by, created_at
          ) VALUES (
            CAST(${attachmentId} AS UUID),
            ${sha},
            'knowledge_base',
            ${sha},
            ${input.filename},
            'application/pdf',
            ${input.bytes.byteLength},
            'personal_data',
            ${input.createdBy},
            ${now}
          )
        `);
      }
      const linkId = newId();
      tx.write(sql`
        INSERT INTO core.attachment_link (
          id, attachment_id, entity_table, entity_id, role, created_by, created_at
        )
        SELECT
          CAST(${linkId} AS UUID),
          CAST(${attachmentId} AS UUID),
          'billing.invoice',
          CAST(${input.invoiceId} AS UUID),
          'invoice_pdf',
          ${input.createdBy},
          ${now}
        WHERE NOT EXISTS (
          SELECT 1 FROM core.attachment_link
          WHERE entity_table = 'billing.invoice'
            AND entity_id = CAST(${input.invoiceId} AS UUID)
            AND role = 'invoice_pdf'
        )
      `);
      tx.audit({
        table: 'billing.invoice',
        rowId: input.invoiceId,
        action: 'UPDATE',
        before: { pdf_attachment_id: null },
        after: { pdf_attachment_id: attachmentId, sha256: sha },
      });
      return { attachmentId, sha256: sha, created: !existing[0] };
    },

    async findInvoicePdf(reader, invoiceId) {
      const rows = await reader.read<{ attachment_id: string }>(sql`
        SELECT attachment_id
        FROM core.attachment_link
        WHERE entity_table = 'billing.invoice'
          AND entity_id = CAST(${invoiceId} AS UUID)
          AND role = 'invoice_pdf'
        ORDER BY created_at
        LIMIT 1
      `);
      const row = rows[0];
      return row ? text(row.attachment_id) : null;
    },

    async read(reader, attachmentId) {
      const rows = await reader.read<{
        filename: string;
        mime_type: string;
        sha256: string;
        content: unknown;
      }>(sql`
        SELECT a.filename, a.mime_type, a.sha256, c.content
        FROM core.attachment a
        JOIN core.attachment_content c ON c.sha256 = a.sha256
        WHERE a.id = CAST(${attachmentId} AS UUID)
      `);
      const row = rows[0];
      if (!row) return null;
      const bytes = decodeContent(row.content);
      const actual = sha256(bytes);
      if (actual !== text(row.sha256)) {
        throw domainError('WC_VALIDATION', { pdf: 'El PDF guardado no coincide con su huella' });
      }
      return {
        attachmentId,
        sha256: actual,
        bytes,
        filename: text(row.filename),
        mime: text(row.mime_type),
      };
    },
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

function decodeContent(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === 'string') return new Uint8Array(Buffer.from(value.replace(/\s+/gu, ''), 'base64'));
  throw domainError('WC_VALIDATION', { pdf: 'El PDF guardado no se puede leer' });
}
