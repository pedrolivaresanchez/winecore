import { requestIdFor, sessionOf } from '../auth/guard';
import { assertLinkAccess, decideLinkAccess } from '../core/attachments/access';
import { MAX_ATTACHMENT_BYTES } from '../core/attachments/mime';
import {
  attachmentLinks,
  listLinks,
  putAttachment,
  readAttachmentMeta,
  readContent,
} from '../core/attachments/store';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function uploadAttachment(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const form = await readForm(request);
  const upload = fileOf(form.get('file'));
  const table = textOf(form.get('table')).toLowerCase();
  const rowId = textOf(form.get('row_id')).toLowerCase();
  const role = textOf(form.get('role')).toLowerCase();
  const fields: Record<string, string> = {};
  if (!upload) fields.file = 'Falta el fichero';
  if (!/^[a-z_]+\.[a-z_]+$/.test(table)) fields.table = 'La tabla no es válida';
  if (!UUID.test(rowId)) fields.row_id = 'Identificador no válido';
  if (role === '') fields.role = 'Rol de adjunto no válido';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  if (!upload) throw domainError('WC_VALIDATION', { file: 'Falta el fichero' });
  if (upload.size === 0) throw domainError('WC_VALIDATION', { file: 'El fichero está vacío' });
  if (upload.size > MAX_ATTACHMENT_BYTES) {
    throw domainError('WC_VALIDATION', { file: 'El fichero supera el límite de 20 MB' });
  }
  const bytes = new Uint8Array(await upload.blob.arrayBuffer());
  return writer.withWrite(actor(user.id, request), async (tx) => {
    await assertLinkAccess((statement) => tx.read(statement), user, table, rowId, 'write');
    return putAttachment(
      tx,
      { bytes, mime: upload.type, name: upload.name },
      { table, rowId, role, createdBy: user.id },
    );
  });
}

export async function listAttachmentLinks(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const table = (url.searchParams.get('table') ?? '').trim().toLowerCase();
  const rowId = (url.searchParams.get('row_id') ?? '').trim().toLowerCase();
  const fields: Record<string, string> = {};
  if (!/^[a-z_]+\.[a-z_]+$/.test(table)) fields.table = 'La tabla no es válida';
  if (!UUID.test(rowId)) fields.row_id = 'Identificador no válido';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  const read = <T = Record<string, unknown>>(statement: string) => writer.read<T>(statement);
  await assertLinkAccess(read, user, table, rowId, 'read');
  return { items: await listLinks(read, table, rowId) };
}

export async function downloadAttachment(writer: Writer, request: Request, id: string): Promise<Response> {
  const user = sessionOf(request);
  const read = <T = Record<string, unknown>>(statement: string) => writer.read<T>(statement);
  const meta = await readAttachmentMeta(read, id);
  if (!meta) throw domainError('WC_NOT_FOUND');
  const links = await attachmentLinks(read, meta.id);
  let allowed = false;
  for (const link of links) {
    if (await decideLinkAccess(read, user, link.table, link.rowId, 'read') === 'ok') {
      allowed = true;
      break;
    }
  }
  if (!allowed) throw domainError('WC_FORBIDDEN');
  const bytes = await readContent(read, meta.sha256);
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': meta.mime_type,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': contentDisposition(meta.filename),
    },
  });
}

function contentDisposition(filename: string): string {
  const cleaned = filename.replace(/[\r\n]/g, '').slice(0, 180);
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'adjunto';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fileOf(value: unknown): { blob: Blob; name: string; size: number; type: string } | null {
  if (typeof File !== 'undefined' && value instanceof File) {
    return { blob: value, name: value.name, size: value.size, type: value.type };
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { blob: value, name: 'adjunto', size: value.size, type: value.type };
  }
  return null;
}

async function readForm(request: Request) {
  try {
    return await request.formData();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'Se espera multipart con el fichero' });
  }
}

function actor(userId: string, request: Request) {
  return { type: 'user' as const, id: userId, requestId: requestIdFor(request) };
}
