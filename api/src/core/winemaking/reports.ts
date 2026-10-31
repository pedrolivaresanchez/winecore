import { sessionOf } from '../../auth/guard';
import { detectMime, MAX_ATTACHMENT_BYTES } from '../attachments/mime';
import { putAttachment, readAttachmentMeta, readContent } from '../attachments/store';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { actorFor, invalid } from '../cellar/service/http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORT_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

interface AnalysisTarget {
  table: 'cellar.analysis' | 'cellar.parcel_analysis';
  id: string;
}

/** Sube el PDF o la foto del laboratorio y lo deja en report_attachment_id. */
export async function uploadAnalysisReport(
  writer: Writer,
  request: Request,
  analysisId: string,
): Promise<Record<string, unknown>> {
  const id = normalizeId(analysisId);
  const form = await readForm(request);
  const upload = fileOf(form.get('file'));
  if (!upload) invalid({ file: 'Falta el fichero' });
  if (upload.size === 0) invalid({ file: 'El fichero está vacío' });
  if (upload.size > MAX_ATTACHMENT_BYTES) invalid({ file: 'El fichero supera el límite de 20 MB' });
  const bytes = new Uint8Array(await upload.blob.arrayBuffer());
  const mime = detectMime(bytes);
  if (!mime || !REPORT_MIME.has(mime)) invalid({ file: 'El informe tiene que ser PDF, JPEG o PNG' });
  const actor = actorFor(request, 'informe de laboratorio');
  return writer.withWrite(actor, async (tx) => {
    const target = await locate(tx, id);
    if (!target) throw domainError('WC_NOT_FOUND');
    const stored = await putAttachment(
      tx,
      { bytes, mime, name: upload.name || 'informe' },
      { table: target.table, rowId: target.id, role: 'lab_report', createdBy: actor.id },
    );
    const beforeId = await currentReport(tx, target);
    await assignReport(tx, target, stored.id);
    tx.audit({
      table: target.table,
      rowId: target.id,
      action: 'UPDATE',
      before: { report_attachment_id: beforeId },
      after: { report_attachment_id: stored.id },
    });
    return {
      analysis_id: target.id,
      subject: target.table === 'cellar.analysis' ? 'lot' : 'parcel',
      report_attachment_id: stored.id,
      sha256: stored.sha256,
      mime_type: mime,
      filename: baseName(upload.name || 'informe'),
      size_bytes: bytes.byteLength,
    };
  });
}

/** Descarga el informe. El permiso cellar.read lo aplica la ruta. */
export async function downloadAnalysisReport(writer: Writer, request: Request, analysisId: string): Promise<Response> {
  sessionOf(request);
  const id = normalizeId(analysisId);
  const target = await locate(writer, id);
  if (!target) throw domainError('WC_NOT_FOUND');
  const linked = await latestLabReport(writer, target.table, target.id);
  const column = await currentReport(writer, target);
  const attachmentId = linked ?? column;
  if (!attachmentId) throw domainError('WC_NOT_FOUND');
  const read = <T = Record<string, unknown>>(statement: string) => writer.read<T>(statement);
  const meta = await readAttachmentMeta(read, attachmentId);
  if (!meta) throw domainError('WC_NOT_FOUND');
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

async function currentReport(
  reader: { read<T = Record<string, unknown>>(statement: string): Promise<T[]> },
  target: AnalysisTarget,
): Promise<string | null> {
  const rows = await reader.read<{ report_attachment_id: string | null }>(sql`
    SELECT report_attachment_id::VARCHAR AS report_attachment_id
    FROM ${sql.raw(target.table)}
    WHERE id = CAST(${target.id} AS UUID)
  `);
  return rows[0]?.report_attachment_id ?? null;
}

/**
 * El enlace `lab_report` es la fuente del informe. En `cellar.analysis` además
 * se escribe la columna: no tiene índice secundario y el UPDATE cabe.
 * `cellar.parcel_analysis` sí tiene índice y resultados que la referencian;
 * DuckDB reescribe ese UPDATE y choca con la clave. Ahí basta el enlace.
 */
async function assignReport(
  tx: { write(statement: string): void },
  target: AnalysisTarget,
  attachmentId: string,
): Promise<void> {
  if (target.table !== 'cellar.analysis') return;
  tx.write(sql`
    UPDATE cellar.analysis
    SET report_attachment_id = CAST(${attachmentId} AS UUID)
    WHERE id = CAST(${target.id} AS UUID)
  `);
}

export async function latestLabReport(
  reader: { read<T = Record<string, unknown>>(statement: string): Promise<T[]> },
  table: AnalysisTarget['table'],
  analysisId: string,
): Promise<string | null> {
  const rows = await reader.read<{ attachment_id: string }>(sql`
    SELECT attachment_id::VARCHAR AS attachment_id
    FROM core.attachment_link
    WHERE entity_table = ${table}
      AND entity_id = CAST(${analysisId} AS UUID)
      AND role = 'lab_report'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  return rows[0]?.attachment_id ?? null;
}

function normalizeId(value: string): string {
  if (!UUID.test(value)) throw domainError('WC_NOT_FOUND');
  return value.toLowerCase();
}

async function locate(
  reader: { read<T = Record<string, unknown>>(statement: string): Promise<T[]> },
  id: string,
): Promise<AnalysisTarget | null> {
  const lot = await reader.read(sql`SELECT id FROM cellar.analysis WHERE id = CAST(${id} AS UUID)`);
  if (lot[0]) return { table: 'cellar.analysis', id };
  const parcel = await reader.read(sql`SELECT id FROM cellar.parcel_analysis WHERE id = CAST(${id} AS UUID)`);
  if (parcel[0]) return { table: 'cellar.parcel_analysis', id };
  return null;
}

function contentDisposition(filename: string): string {
  const cleaned = filename.replace(/[\r\n]/g, '').slice(0, 180);
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'informe';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}

function baseName(name: string): string {
  const cleaned = name.replace(/[\r\n]/g, '').split(/[/\\]/).pop()?.trim() ?? '';
  return cleaned.slice(0, 180) || 'informe';
}

function fileOf(value: unknown): { blob: Blob; name: string; size: number } | null {
  if (typeof File !== 'undefined' && value instanceof File) {
    return { blob: value, name: value.name, size: value.size };
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { blob: value, name: 'informe', size: value.size };
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
