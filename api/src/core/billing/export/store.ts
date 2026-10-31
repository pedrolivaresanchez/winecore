import type { Actor, Writer } from '../../db/writer';
import { sql } from '../../db/sql';
import { domainError } from '../../errors';
import {
  EXPORT_DOCUMENTS_SETTING_KEY,
  exampleExportDocuments,
  parseExportDocuments,
} from './setting';
import type { ExportDocumentsSetting } from './types';

export interface StoredExportDocuments {
  key: typeof EXPORT_DOCUMENTS_SETTING_KEY;
  updated_at: string | null;
  updated_by: string | null;
  persisted: boolean;
  value: ExportDocumentsSetting;
}

export async function readExportDocuments(writer: Writer): Promise<StoredExportDocuments> {
  const rows = await writer.read<{ value: unknown; updated_at: unknown; updated_by: unknown }>(sql`
    SELECT value, updated_at, updated_by
    FROM core.setting
    WHERE key = ${EXPORT_DOCUMENTS_SETTING_KEY}
  `);
  const row = rows[0];
  if (!row) {
    return {
      key: EXPORT_DOCUMENTS_SETTING_KEY,
      updated_at: null,
      updated_by: null,
      persisted: false,
      value: exampleExportDocuments(),
    };
  }
  return {
    key: EXPORT_DOCUMENTS_SETTING_KEY,
    updated_at: asInstant(row.updated_at),
    updated_by: row.updated_by == null ? null : String(row.updated_by),
    persisted: true,
    value: parseExportDocuments(row.value),
  };
}

export async function saveExportDocuments(
  writer: Writer,
  actor: Actor,
  value: unknown,
  ifMatch: string | null,
): Promise<StoredExportDocuments> {
  const parsed = parseExportDocuments(value);
  const now = new Date();
  await writer.withWrite(actor, async (tx) => {
    const current = await tx.read<{ value: unknown; updated_at: unknown }>(sql`
      SELECT value, updated_at
      FROM core.setting
      WHERE key = ${EXPORT_DOCUMENTS_SETTING_KEY}
    `);
    const row = current[0];
    if (!row) {
      if (ifMatch) throw domainError('WC_STALE_VERSION');
      tx.write(sql`
        INSERT INTO core.setting (key, value, updated_at, updated_by)
        VALUES (${EXPORT_DOCUMENTS_SETTING_KEY}, ${sql.json(parsed)}, ${now}, ${actor.id})
      `);
      tx.audit({
        table: 'core.setting',
        rowId: EXPORT_DOCUMENTS_SETTING_KEY,
        action: 'INSERT',
        before: null,
        after: parsed,
      });
      return;
    }
    if (!sameInstant(row.updated_at, ifMatch)) throw domainError('WC_STALE_VERSION');
    const before = parseExportDocuments(row.value);
    tx.write(sql`
      UPDATE core.setting
      SET value = ${sql.json(parsed)}, updated_at = ${now}, updated_by = ${actor.id}
      WHERE key = ${EXPORT_DOCUMENTS_SETTING_KEY}
    `);
    tx.audit({
      table: 'core.setting',
      rowId: EXPORT_DOCUMENTS_SETTING_KEY,
      action: 'UPDATE',
      before,
      after: parsed,
    });
  });
  return readExportDocuments(writer);
}

function sameInstant(current: unknown, offered: string | null): boolean {
  if (!offered) return false;
  const left = Date.parse(asInstant(current));
  const right = Date.parse(offered.trim().replace(/^"|"$/g, ''));
  return Number.isFinite(left) && left === right;
}

function asInstant(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  return new Date(parsed).toISOString();
}
