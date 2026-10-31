import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { actorFor, auditInsert, auditUpdate, readJson, requireBool } from '../cellar/service/http';
import { CHECKLIST_SETTING_KEY } from './constants';

type Reader = { read<T>(statement: string): Promise<T[]> };

export async function checklistRequired(reader: Reader): Promise<boolean> {
  const rows = await reader.read<{ value: unknown }>(sql`
    SELECT value FROM core.setting WHERE key = ${CHECKLIST_SETTING_KEY}
  `);
  const value = rows[0]?.value;
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return true;
}

export async function getHygienePolicy(writer: Writer): Promise<{ bottling_checklist_required: boolean }> {
  return { bottling_checklist_required: await checklistRequired(writer) };
}

export async function putHygienePolicy(writer: Writer, request: Request): Promise<{ bottling_checklist_required: boolean }> {
  const body = await readJson(request);
  const required = requireBool(body.bottling_checklist_required, 'bottling_checklist_required');
  const actor = actorFor(request, 'ajuste del control de envasado');
  await writer.withWrite(actor, async (tx) => {
    const current = await checklistRequired(tx);
    const rows = await tx.read(sql`SELECT key FROM core.setting WHERE key = ${CHECKLIST_SETTING_KEY}`);
    if (rows.length === 0) {
      auditInsert(tx, 'core.setting', CHECKLIST_SETTING_KEY, { value: required }, sql`
        INSERT INTO core.setting (key, value, updated_at, updated_by)
        VALUES (${CHECKLIST_SETTING_KEY}, ${sql.json(required)}, now(), ${actor.id})
      `);
      return;
    }
    auditUpdate(tx, 'core.setting', CHECKLIST_SETTING_KEY, { value: current }, { value: required }, sql`
      UPDATE core.setting
      SET value = ${sql.json(required)}, updated_at = now(), updated_by = ${actor.id}
      WHERE key = ${CHECKLIST_SETTING_KEY}
    `);
  });
  return { bottling_checklist_required: required };
}
