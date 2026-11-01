import { requestIdFor, sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import {
  deleteDocumentLogo,
  getDocumentProfile,
  previewDocumentProfile,
  putDocumentLogo,
  putDocumentProfile,
  readDocumentLogo,
} from '../core/setup/document-profile';

function actorOf(request: Request, reason: string) {
  const user = sessionOf(request);
  return { type: 'user' as const, id: user.id, requestId: requestIdFor(request), reason };
}

export function getDocumentProfileRoute(writer: Writer, request: Request, code: string) {
  sessionOf(request);
  return getDocumentProfile(writer, code);
}

export async function putDocumentProfileRoute(writer: Writer, request: Request, code: string) {
  const raw = await readJson(request);
  const actor = actorOf(request, 'perfil documental de la sociedad');
  return writer.withWrite(actor, (tx) => putDocumentProfile(tx, actor.id, code, raw));
}

export async function putDocumentLogoRoute(writer: Writer, request: Request, code: string) {
  const actor = actorOf(request, 'logotipo de la sociedad');
  const form = await readForm(request);
  const file = form.get('file');
  if (!(file instanceof Blob)) throw domainError('WC_VALIDATION', { file: 'Falta el fichero' });
  const name = typeof File !== 'undefined' && file instanceof File ? file.name : 'logotipo';
  const bytes = new Uint8Array(await file.arrayBuffer());
  return writer.withWrite(actor, (tx) => putDocumentLogo(tx, actor.id, code, { bytes, name }));
}

export function deleteDocumentLogoRoute(writer: Writer, request: Request, code: string) {
  const actor = actorOf(request, 'quitar el logotipo de la sociedad');
  return writer.withWrite(actor, (tx) => deleteDocumentLogo(tx, actor.id, code));
}

export async function getDocumentLogoRoute(writer: Writer, request: Request, code: string): Promise<Response> {
  sessionOf(request);
  const logo = await readDocumentLogo(writer, code);
  if (!logo) throw domainError('WC_NOT_FOUND');
  return new Response(Buffer.from(logo.bytes), {
    headers: { 'Content-Type': logo.mime, 'Content-Length': String(logo.bytes.byteLength), 'Cache-Control': 'no-cache' },
  });
}

export async function postDocumentSampleRoute(writer: Writer, request: Request, code: string): Promise<Response> {
  sessionOf(request);
  const text = await request.text();
  let raw: unknown = {};
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text);
    } catch {
      throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
    }
  }
  const preview = await previewDocumentProfile(writer, code, raw);
  return new Response(Buffer.from(preview.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${preview.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}

async function readForm(request: Request) {
  try {
    return await request.formData();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'Se espera multipart con el fichero' });
  }
}
