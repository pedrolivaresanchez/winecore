import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { bytesFromStored } from '../attachments/store';
import { logPdfFallback } from './fallback';

/**
 * Datos de la sociedad que salen en sus PDF: logotipo, contacto, líneas de pie y
 * variante de plantilla. Viven en `core.document_profile` (migración 0042).
 */
export type DocumentVariant = 'po' | 'cvpo';

export const DOCUMENT_VARIANTS: readonly DocumentVariant[] = ['po', 'cvpo'];

export interface DocumentProfileView {
  variant: DocumentVariant;
  /** PNG o JPEG ya leído. */
  logo: Uint8Array | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  /** Una línea del pie por elemento; una cadena vacía deja un hueco. */
  footerLines: readonly string[];
}

export const EMPTY_DOCUMENT_PROFILE: DocumentProfileView = {
  variant: 'po',
  logo: null,
  email: null,
  phone: null,
  website: null,
  footerLines: [],
};

export function isDocumentVariant(value: unknown): value is DocumentVariant {
  return typeof value === 'string' && (DOCUMENT_VARIANTS as readonly string[]).includes(value);
}

type Read = Pick<Tx, 'read'>;

export interface StoredProfileRow {
  id: string;
  variant: DocumentVariant;
  email: string | null;
  phone: string | null;
  website: string | null;
  footerLines: string[];
  logoAttachmentId: string | null;
  updatedAt: string | null;
}

export async function readProfileRow(db: Read, legalEntityId: string): Promise<StoredProfileRow | null> {
  const rows = await db.read<Record<string, unknown>>(sql`
    SELECT id, variant, email, phone, website, footer_lines, logo_attachment_id, updated_at
    FROM core.document_profile
    WHERE legal_entity_id = CAST(${legalEntityId} AS UUID)
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  const variant = String(row.variant);
  return {
    id: String(row.id).toLowerCase(),
    variant: isDocumentVariant(variant) ? variant : 'po',
    email: textOrNull(row.email),
    phone: textOrNull(row.phone),
    website: textOrNull(row.website),
    footerLines: linesOf(row.footer_lines),
    logoAttachmentId: row.logo_attachment_id == null ? null : String(row.logo_attachment_id).toLowerCase(),
    updatedAt: stamp(row.updated_at),
  };
}

export async function readLogoBytes(db: Read, attachmentId: string): Promise<Uint8Array | null> {
  const rows = await db.read<{ content: unknown }>(sql`
    SELECT c.content
    FROM core.attachment a
    JOIN core.attachment_content c ON c.sha256 = a.sha256
    WHERE a.id = CAST(${attachmentId} AS UUID)
    LIMIT 1
  `);
  const content = rows[0]?.content;
  if (content == null) return null;
  return bytesFromStored(content);
}

/** Perfil documental de la sociedad con el logotipo ya leído. Sin fila, el de por defecto. */
export async function loadDocumentProfile(db: Read, legalEntityId: string): Promise<DocumentProfileView> {
  const row = await readProfileRow(db, legalEntityId);
  if (!row) return EMPTY_DOCUMENT_PROFILE;
  const logo = row.logoAttachmentId ? await readLogoBytes(db, row.logoAttachmentId) : null;
  return {
    variant: row.variant,
    logo,
    email: row.email,
    phone: row.phone,
    website: row.website,
    footerLines: row.footerLines,
  };
}

/** Para los PDF: sin perfil legible el documento sale con la maqueta básica en vez de fallar. */
export async function loadDocumentProfileSafe(db: Read, legalEntityId: string): Promise<DocumentProfileView> {
  try {
    return await loadDocumentProfile(db, legalEntityId);
  } catch (error) {
    logPdfFallback('profile', error);
    return EMPTY_DOCUMENT_PROFILE;
  }
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function linesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    } catch {
      return [];
    }
  }
  return [];
}

function stamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
