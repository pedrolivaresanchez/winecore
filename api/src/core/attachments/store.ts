import { createHash } from 'node:crypto';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { businessDate } from '../time';
import { detectMime, MAX_ATTACHMENT_BYTES, safeAttachmentName } from './mime';

type Read = <T = Record<string, unknown>>(statement: string) => Promise<T[]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ATTACHMENT_ROLES = [
  'invoice_pdf',
  'delivery_note_pdf',
  'supplier_invoice_scan',
  'expense_photo',
  'evidence_screenshot',
  'evidence_request',
  'evidence_response',
  'official_receipt',
  'lab_report',
  'photo',
  'label_artwork',
  'contract',
  'other',
] as const;

export type AttachmentRole = (typeof ATTACHMENT_ROLES)[number];

/** PDF emitido, evidencia y acuse: el enlace no se quita (WC001). Igual que el trigger SQL. */
export const PERMANENT_LINK_ROLES = [
  'invoice_pdf',
  'delivery_note_pdf',
  'evidence_screenshot',
  'evidence_request',
  'evidence_response',
  'official_receipt',
  'lab_report',
] as const;

const PERMANENT = new Set<string>(PERMANENT_LINK_ROLES);

export function isAttachmentRole(value: string): value is AttachmentRole {
  return (ATTACHMENT_ROLES as readonly string[]).includes(value);
}

export type AttachmentMeta = {
  id: string;
  sha256: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
};

export type AttachmentLinkJson = {
  id: string;
  link_id: string;
  role: string;
  sha256: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

type Staged = {
  content: Set<string>;
  attachmentIdByHash: Map<string, string>;
  links: Set<string>;
};

const stagedByTx = new WeakMap<Tx, Staged>();

function staged(tx: Tx): Staged {
  let current = stagedByTx.get(tx);
  if (!current) {
    current = { content: new Set(), attachmentIdByHash: new Map(), links: new Set() };
    stagedByTx.set(tx, current);
  }
  return current;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function num(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  return Number(value);
}

function stamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function baseName(name: string): string {
  return safeAttachmentName(name);
}

function retentionUntil(now: Date): string {
  const parts = businessDate(now).split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) return '2032-01-01';
  const shifted = new Date(Date.UTC(year + 6, month - 1, day));
  if (shifted.getUTCMonth() !== month - 1) {
    return new Date(Date.UTC(year + 6, month, 0)).toISOString().slice(0, 10);
  }
  return shifted.toISOString().slice(0, 10);
}

export function bytesFromStored(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === 'string') return new Uint8Array(Buffer.from(value, 'base64'));
  throw new Error('Contenido de adjunto ilegible');
}

/**
 * Guarda el fichero una sola vez por SHA-256. El BLOB entra como literal
 * base64 del `sql`. `mime` se ignora: el tipo sale de los bytes.
 * `createdBy` es el actor: `Tx` no lo lleva y la columna es obligatoria.
 */
export async function putAttachment(
  tx: Tx,
  file: { bytes: Uint8Array; mime: string; name: string },
  link: { table: string; rowId: string; role: string; createdBy: string },
): Promise<{ id: string; sha256: string }> {
  void file.mime;
  if (!(file.bytes instanceof Uint8Array)) {
    throw domainError('WC_VALIDATION', { file: 'Falta el fichero' });
  }
  if (file.bytes.byteLength === 0) {
    throw domainError('WC_VALIDATION', { file: 'El fichero está vacío' });
  }
  if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw domainError('WC_VALIDATION', { file: 'El fichero supera el límite de 20 MB' });
  }
  const mime = detectMime(file.bytes);
  if (!mime) throw domainError('WC_VALIDATION', { file: 'Tipo de fichero no admitido' });
  const filename = baseName(file.name);
  if (filename === '') throw domainError('WC_VALIDATION', { name: 'El nombre del fichero es obligatorio' });
  const role = link.role.trim().toLowerCase();
  if (!isAttachmentRole(role)) throw domainError('WC_VALIDATION', { role: 'Rol de adjunto no válido' });
  const table = link.table.trim().toLowerCase();
  if (!/^[a-z_]+\.[a-z_]+$/.test(table)) {
    throw domainError('WC_VALIDATION', { table: 'La tabla no es válida' });
  }
  const rowId = link.rowId.trim().toLowerCase();
  if (!UUID.test(rowId)) throw domainError('WC_VALIDATION', { row_id: 'Identificador no válido' });
  const createdBy = link.createdBy.trim();
  if (createdBy === '' || createdBy.includes('\0')) throw domainError('WC002');

  const sha = sha256Bytes(file.bytes);
  const memory = staged(tx);
  let attachmentId = memory.attachmentIdByHash.get(sha) ?? null;
  if (!attachmentId) {
    const existing = await tx.read<{ id: string }>(sql`
      SELECT id FROM core.attachment
      WHERE storage_backend = 'knowledge_base' AND storage_key = ${sha}
      LIMIT 1
    `);
    const found = existing[0];
    if (found) attachmentId = String(found.id).toLowerCase();
  }
  const stagedLink = `${attachmentId ?? ''}|${table}|${rowId}|${role}`;
  if (attachmentId && (memory.links.has(stagedLink) || await linkExists(tx, attachmentId, table, rowId, role))) {
    return { id: attachmentId, sha256: sha };
  }

  if (!attachmentId) {
    attachmentId = newId();
    if (!memory.content.has(sha)) {
      const have = await tx.read<{ sha256: string }>(sql`
        SELECT sha256 FROM core.attachment_content WHERE sha256 = ${sha} LIMIT 1
      `);
      if (!have[0]) {
        tx.write(sql`
          INSERT INTO core.attachment_content (sha256, content)
          VALUES (${sha}, ${file.bytes})
        `);
      }
      memory.content.add(sha);
    }
    const retention = retentionUntil(new Date());
    tx.write(sql`
      INSERT INTO core.attachment (
        id, sha256, storage_backend, storage_key, filename, mime_type, size_bytes,
        classification, retention_until, created_by
      ) VALUES (
        CAST(${attachmentId} AS UUID),
        ${sha},
        'knowledge_base',
        ${sha},
        ${filename},
        ${mime},
        ${file.bytes.byteLength},
        'internal',
        CAST(${retention} AS DATE),
        ${createdBy}
      )
    `);
    tx.audit({
      table: 'core.attachment',
      rowId: attachmentId,
      action: 'INSERT',
      before: null,
      after: {
        sha256: sha,
        storage_backend: 'knowledge_base',
        storage_key: sha,
        filename,
        mime_type: mime,
        size_bytes: file.bytes.byteLength,
        classification: 'internal',
        retention_until: retention,
      },
    });
    memory.attachmentIdByHash.set(sha, attachmentId);
  }

  const linkId = newId();
  tx.write(sql`
    INSERT INTO core.attachment_link (
      id, attachment_id, entity_table, entity_id, role, created_by
    ) VALUES (
      CAST(${linkId} AS UUID),
      CAST(${attachmentId} AS UUID),
      ${table},
      CAST(${rowId} AS UUID),
      ${role},
      ${createdBy}
    )
  `);
  tx.audit({
    table: 'core.attachment_link',
    rowId: linkId,
    action: 'INSERT',
    before: null,
    after: { attachment_id: attachmentId, entity_table: table, entity_id: rowId, role },
  });
  memory.links.add(`${attachmentId}|${table}|${rowId}|${role}`);
  return { id: attachmentId, sha256: sha };
}

async function linkExists(tx: Tx, attachmentId: string, table: string, rowId: string, role: string): Promise<boolean> {
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id FROM core.attachment_link
    WHERE attachment_id = CAST(${attachmentId} AS UUID)
      AND entity_table = ${table}
      AND entity_id = CAST(${rowId} AS UUID)
      AND role = ${role}
    LIMIT 1
  `);
  return Boolean(rows[0]);
}

/** Quita un enlace que no es evidencia, PDF emitido ni acuse. El contenido no se toca. */
export async function unlinkAttachment(tx: Tx, linkId: string): Promise<void> {
  if (!UUID.test(linkId)) throw domainError('WC_NOT_FOUND');
  const rows = await tx.read<{
    role: unknown;
    attachment_id: unknown;
    entity_table: unknown;
    entity_id: unknown;
  }>(sql`
    SELECT role, attachment_id, entity_table, entity_id
    FROM core.attachment_link
    WHERE id = CAST(${linkId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const role = String(row.role);
  if (PERMANENT.has(role)) throw domainError('WC001', undefined, { role });
  tx.write(sql`DELETE FROM core.attachment_link WHERE id = CAST(${linkId} AS UUID)`);
  tx.audit({
    table: 'core.attachment_link',
    rowId: linkId.toLowerCase(),
    action: 'DELETE',
    before: {
      attachment_id: String(row.attachment_id).toLowerCase(),
      entity_table: String(row.entity_table),
      entity_id: String(row.entity_id).toLowerCase(),
      role,
    },
    after: null,
  });
}

export async function readAttachmentMeta(read: Read, id: string): Promise<AttachmentMeta | null> {
  if (!UUID.test(id)) return null;
  const rows = await read<{
    id: unknown;
    sha256: unknown;
    filename: unknown;
    mime_type: unknown;
    size_bytes: unknown;
  }>(sql`
    SELECT id, sha256, filename, mime_type, size_bytes
    FROM core.attachment
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id).toLowerCase(),
    sha256: String(row.sha256),
    filename: String(row.filename),
    mime_type: String(row.mime_type),
    size_bytes: num(row.size_bytes),
  };
}

export async function attachmentLinks(
  read: Read,
  id: string,
): Promise<{ table: string; rowId: string; role: string }[]> {
  const rows = await read<{ entity_table: unknown; entity_id: unknown; role: unknown }>(sql`
    SELECT entity_table, entity_id, role
    FROM core.attachment_link
    WHERE attachment_id = CAST(${id} AS UUID)
  `);
  return rows.map((row) => ({
    table: String(row.entity_table),
    rowId: String(row.entity_id).toLowerCase(),
    role: String(row.role),
  }));
}

export async function readContent(read: Read, sha256: string): Promise<Uint8Array> {
  const rows = await read<{ content: unknown }>(sql`
    SELECT content FROM core.attachment_content WHERE sha256 = ${sha256} LIMIT 1
  `);
  const content = rows[0]?.content;
  if (content == null) throw domainError('WC_NOT_FOUND');
  return bytesFromStored(content);
}

export async function listLinks(read: Read, table: string, rowId: string): Promise<AttachmentLinkJson[]> {
  const rows = await read<{
    id: unknown;
    sha256: unknown;
    filename: unknown;
    mime_type: unknown;
    size_bytes: unknown;
    link_id: unknown;
    role: unknown;
    created_at: unknown;
  }>(sql`
    SELECT a.id, a.sha256, a.filename, a.mime_type, a.size_bytes,
           l.id AS link_id, l.role, l.created_at
    FROM core.attachment_link l
    JOIN core.attachment a ON a.id = l.attachment_id
    WHERE l.entity_table = ${table} AND l.entity_id = CAST(${rowId} AS UUID)
    ORDER BY l.created_at, l.id
  `);
  return rows.map((row) => ({
    id: String(row.id).toLowerCase(),
    link_id: String(row.link_id).toLowerCase(),
    role: String(row.role),
    sha256: String(row.sha256),
    filename: String(row.filename),
    mime_type: String(row.mime_type),
    size_bytes: num(row.size_bytes),
    created_at: stamp(row.created_at),
  }));
}
