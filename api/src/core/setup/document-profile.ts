import { putAttachment, readAttachmentMeta, readContent, unlinkAttachment } from '../attachments/store';
import { detectMime } from '../attachments/mime';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { inspectLogo } from '../pdf/holded-layout';
import {
  DOCUMENT_VARIANTS,
  EMPTY_DOCUMENT_PROFILE,
  isDocumentVariant,
  readProfileRow,
  type DocumentVariant,
  type StoredProfileRow,
} from '../pdf/profile';

const CODE = /^[A-Z][A-Z0-9_]{1,15}$/;
const MAX_FOOTER_LINES = 12;
const MAX_LINE = 200;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

type Read = Pick<Writer, 'read'>;

export interface DocumentProfileJson {
  legal_entity_code: string;
  variants: readonly DocumentVariant[];
  variant: DocumentVariant;
  email: string | null;
  phone: string | null;
  website: string | null;
  footer_lines: string[];
  logo: { attachment_id: string; filename: string; mime_type: string; size_bytes: number } | null;
  configured: boolean;
  updated_at: string | null;
}

export interface ProfileInput {
  variant?: DocumentVariant;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  footerLines?: string[];
}

interface EntityRef {
  id: string;
  code: string;
}

export async function entityByCode(db: Read, rawCode: string): Promise<EntityRef> {
  const code = rawCode.trim().toUpperCase();
  if (!CODE.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await db.read<Record<string, unknown>>(sql`
    SELECT id, code FROM core.legal_entity WHERE code = ${code} LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return { id: String(row.id).toLowerCase(), code: String(row.code) };
}

export async function getDocumentProfile(db: Read, rawCode: string): Promise<DocumentProfileJson> {
  const entity = await entityByCode(db, rawCode);
  const row = await readProfileRow(db, entity.id);
  return present(db, entity, row);
}

async function present(db: Read, entity: EntityRef, row: StoredProfileRow | null): Promise<DocumentProfileJson> {
  let logo: DocumentProfileJson['logo'] = null;
  if (row?.logoAttachmentId) {
    const meta = await readAttachmentMeta((statement) => db.read(statement), row.logoAttachmentId);
    if (meta) {
      logo = {
        attachment_id: meta.id,
        filename: meta.filename,
        mime_type: meta.mime_type,
        size_bytes: Number(meta.size_bytes),
      };
    }
  }
  return {
    legal_entity_code: entity.code,
    variants: DOCUMENT_VARIANTS,
    variant: row?.variant ?? EMPTY_DOCUMENT_PROFILE.variant,
    email: row?.email ?? null,
    phone: row?.phone ?? null,
    website: row?.website ?? null,
    footer_lines: row?.footerLines ?? [],
    logo,
    configured: row !== null,
    updated_at: row?.updatedAt ?? null,
  };
}

export function parseProfileInput(raw: unknown): ProfileInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  const body = raw as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const input: ProfileInput = {};
  if ('variant' in body) {
    if (isDocumentVariant(body.variant)) input.variant = body.variant;
    else fields.variant = `Debe ser ${DOCUMENT_VARIANTS.join(' o ')}`;
  }
  if ('email' in body) {
    const email = optionalText(body.email, 'email', 200, fields);
    if (email && !EMAIL.test(email)) fields.email = 'El correo no es válido';
    input.email = email;
  }
  if ('phone' in body) input.phone = optionalText(body.phone, 'phone', 60, fields);
  if ('website' in body) input.website = optionalText(body.website, 'website', 200, fields);
  if ('footer_lines' in body) input.footerLines = footerLines(body.footer_lines, fields);
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return input;
}

function optionalText(value: unknown, field: string, max: number, fields: Record<string, string>): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    fields[field] = 'Debe ser texto';
    return null;
  }
  const text = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
  if (text.length > max) {
    fields[field] = `Máximo ${max} caracteres`;
    return null;
  }
  return text === '' ? null : text;
}

function footerLines(value: unknown, fields: Record<string, string>): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    fields.footer_lines = 'Debe ser una lista de líneas';
    return [];
  }
  const lines: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      fields.footer_lines = 'Cada línea debe ser texto';
      return [];
    }
    const text = item.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
    if (text.length > MAX_LINE) {
      fields.footer_lines = `Cada línea admite como máximo ${MAX_LINE} caracteres`;
      return [];
    }
    lines.push(text);
  }
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > MAX_FOOTER_LINES) {
    fields.footer_lines = `Como máximo ${MAX_FOOTER_LINES} líneas`;
    return [];
  }
  return lines;
}

function snapshot(row: { variant: DocumentVariant; email: string | null; phone: string | null; website: string | null; footerLines: readonly string[]; logoAttachmentId: string | null }) {
  return {
    variant: row.variant,
    email: row.email,
    phone: row.phone,
    website: row.website,
    footer_lines: [...row.footerLines],
    logo_attachment_id: row.logoAttachmentId,
  };
}

async function save(
  tx: Tx,
  actor: string,
  entity: EntityRef,
  current: StoredProfileRow | null,
  patch: ProfileInput,
  logo: { set: boolean; attachmentId: string | null },
  profileId: string,
): Promise<StoredProfileRow> {
  const now = new Date();
  const next = {
    variant: patch.variant ?? current?.variant ?? EMPTY_DOCUMENT_PROFILE.variant,
    email: patch.email !== undefined ? patch.email : current?.email ?? null,
    phone: patch.phone !== undefined ? patch.phone : current?.phone ?? null,
    website: patch.website !== undefined ? patch.website : current?.website ?? null,
    footerLines: patch.footerLines ?? current?.footerLines ?? [],
    logoAttachmentId: logo.set ? logo.attachmentId : current?.logoAttachmentId ?? null,
  };
  if (!current) {
    tx.write(sql`
      INSERT INTO core.document_profile (
        id, legal_entity_id, variant, email, phone, website, footer_lines, logo_attachment_id,
        updated_by, created_at, updated_at
      ) VALUES (
        CAST(${profileId} AS UUID), CAST(${entity.id} AS UUID), ${next.variant}, ${next.email}, ${next.phone},
        ${next.website}, ${next.footerLines}, CAST(${next.logoAttachmentId} AS UUID),
        ${actor}, ${now}, ${now}
      )
    `);
    tx.audit({ table: 'core.document_profile', rowId: profileId, action: 'INSERT', before: null, after: snapshot(next) });
  } else {
    tx.write(sql`
      UPDATE core.document_profile
      SET variant = ${next.variant},
          email = ${next.email},
          phone = ${next.phone},
          website = ${next.website},
          footer_lines = ${next.footerLines},
          logo_attachment_id = CAST(${next.logoAttachmentId} AS UUID),
          updated_by = ${actor},
          updated_at = ${now}
      WHERE id = CAST(${current.id} AS UUID)
    `);
    tx.audit({
      table: 'core.document_profile',
      rowId: current.id,
      action: 'UPDATE',
      before: snapshot(current),
      after: snapshot(next),
    });
  }
  return {
    id: profileId,
    variant: next.variant,
    email: next.email,
    phone: next.phone,
    website: next.website,
    footerLines: [...next.footerLines],
    logoAttachmentId: next.logoAttachmentId,
    updatedAt: now.toISOString(),
  };
}

/** Crea o actualiza los datos de la sociedad. Solo cambia lo que llega en el cuerpo. */
export async function putDocumentProfile(tx: Tx, actor: string, rawCode: string, raw: unknown): Promise<DocumentProfileJson> {
  const entity = await entityByCode(tx, rawCode);
  const patch = parseProfileInput(raw);
  if (Object.keys(patch).length === 0) throw domainError('WC_VALIDATION', { body: 'No hay ningún dato que cambiar' });
  const current = await readProfileRow(tx, entity.id);
  const saved = await save(tx, actor, entity, current, patch, { set: false, attachmentId: null }, current?.id ?? newId());
  return present(tx, entity, saved);
}

/** Sustituye el logotipo (PNG o JPEG). Los PDF ya emitidos conservan el suyo. */
export async function putDocumentLogo(
  tx: Tx,
  actor: string,
  rawCode: string,
  file: { bytes: Uint8Array; name: string },
): Promise<DocumentProfileJson> {
  const entity = await entityByCode(tx, rawCode);
  if (file.bytes.byteLength === 0) throw domainError('WC_VALIDATION', { file: 'El fichero está vacío' });
  if (file.bytes.byteLength > MAX_LOGO_BYTES) {
    throw domainError('WC_VALIDATION', { file: 'El logotipo no puede pasar de 2 MB' });
  }
  const mime = detectMime(file.bytes);
  if (mime !== 'image/png' && mime !== 'image/jpeg') {
    throw domainError('WC_VALIDATION', { file: 'El logotipo debe ser PNG o JPEG' });
  }
  try {
    await inspectLogo(file.bytes);
  } catch {
    throw domainError('WC_VALIDATION', { file: 'No se puede leer la imagen del logotipo' });
  }
  const current = await readProfileRow(tx, entity.id);
  const profileId = current?.id ?? newId();
  const stored = await putAttachment(
    tx,
    { bytes: file.bytes, mime, name: file.name.trim() === '' ? 'logotipo' : file.name },
    { table: 'core.document_profile', rowId: profileId, role: 'other', createdBy: actor },
  );
  await unlinkOldLogos(tx, profileId, stored.id);
  const saved = await save(tx, actor, entity, current, {}, { set: true, attachmentId: stored.id }, profileId);
  return present(tx, entity, saved);
}

export async function deleteDocumentLogo(tx: Tx, actor: string, rawCode: string): Promise<DocumentProfileJson> {
  const entity = await entityByCode(tx, rawCode);
  const current = await readProfileRow(tx, entity.id);
  if (!current || !current.logoAttachmentId) return present(tx, entity, current);
  await unlinkOldLogos(tx, current.id, null);
  const saved = await save(tx, actor, entity, current, {}, { set: true, attachmentId: null }, current.id);
  return present(tx, entity, saved);
}

async function unlinkOldLogos(tx: Tx, profileId: string, keep: string | null): Promise<void> {
  const links = await tx.read<Record<string, unknown>>(sql`
    SELECT id, attachment_id FROM core.attachment_link
    WHERE entity_table = 'core.document_profile'
      AND entity_id = CAST(${profileId} AS UUID)
      AND role = 'other'
  `);
  for (const link of links) {
    if (keep !== null && String(link.attachment_id).toLowerCase() === keep) continue;
    await unlinkAttachment(tx, String(link.id));
  }
}

export async function readDocumentLogo(
  db: Read,
  rawCode: string,
): Promise<{ bytes: Uint8Array; mime: string; filename: string } | null> {
  const entity = await entityByCode(db, rawCode);
  const row = await readProfileRow(db, entity.id);
  if (!row?.logoAttachmentId) return null;
  const read = <T = Record<string, unknown>>(statement: string) => db.read<T>(statement);
  const meta = await readAttachmentMeta(read, row.logoAttachmentId);
  if (!meta) return null;
  const bytes = await readContent(read, meta.sha256);
  return { bytes, mime: meta.mime_type, filename: meta.filename };
}
