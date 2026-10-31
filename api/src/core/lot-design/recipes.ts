import { FieldBag, isUuid, readObject, rejectUnknown, textValue } from '../catalog/fields';
import { auditInsert, auditUpdate, uuidList } from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { assertDesignRefs, parseDesign, readStoredDesign, snapshotDesign, type DesignInput } from './design';
import { loadHistory, parseSteps, stepFromRow, type RecipeStep } from './history';
import { requireLot } from './lot-ref';
import { asInt, asRecord, asText, type SqlReader } from './rows';

const NIL = '00000000-0000-0000-0000-000000000000';
const PATCH_FIELDS = ['name', 'notes', 'steps', 'design'] as const;
const CAPTURE_FIELDS = ['name', 'notes'] as const;

export interface RecipeVersion {
  id: string;
  recipe_id: string;
  version_no: number;
  status: 'draft' | 'published';
  design: DesignInput | null;
  steps: RecipeStep[];
}

export interface RecipeSummary {
  id: string;
  code: string;
  name: string;
  status: string;
  source_lot_id: string | null;
  source_lot_code: string | null;
  notes: string | null;
  latest_version_no: number | null;
  latest_version_status: string | null;
  published_version_no: number | null;
  step_count: number;
  updated_at: string | null;
}

export interface RecipeDetail extends RecipeSummary {
  created_at: string | null;
  versions: Array<{
    id: string;
    version_no: number;
    status: string;
    design: Record<string, unknown>;
    published_at: string | null;
    published_by: string | null;
    steps: RecipeStep[];
  }>;
}

interface VersionRow {
  id: string;
  recipe_id: string;
  version_no: number;
  status: 'draft' | 'published';
  design: unknown;
  source_lot_id: string | null;
  published_at: string | null;
  published_by: string | null;
}

function versionFrom(row: Record<string, unknown>): VersionRow {
  const status = String(row.status);
  return {
    id: String(row.id).toLowerCase(),
    recipe_id: String(row.recipe_id).toLowerCase(),
    version_no: asInt(row.version_no) ?? 0,
    status: status === 'published' ? 'published' : 'draft',
    design: row.design,
    source_lot_id: asText(row.source_lot_id)?.toLowerCase() ?? null,
    published_at: asText(row.published_at),
    published_by: asText(row.published_by),
  };
}

async function readSteps(reader: SqlReader, versionId: string): Promise<RecipeStep[]> {
  const rows = await reader.read<Record<string, unknown>>(sql`
    SELECT
      position::VARCHAR AS position,
      op_type,
      offset_days::VARCHAR AS offset_days,
      duration_hours::VARCHAR AS duration_hours,
      temperature_c::VARCHAR AS temperature_c,
      additions,
      blend_proportions,
      parameters,
      source_operation_id::VARCHAR AS source_operation_id
    FROM cellar.recipe_step
    WHERE version_id = CAST(${versionId} AS UUID)
    ORDER BY position
  `);
  return rows.map(stepFromRow);
}

async function versionsOf(reader: SqlReader, recipeId: string): Promise<VersionRow[]> {
  const rows = await reader.read<Record<string, unknown>>(sql`
    SELECT
      id::VARCHAR AS id,
      recipe_id::VARCHAR AS recipe_id,
      version_no::VARCHAR AS version_no,
      status,
      design,
      source_lot_id::VARCHAR AS source_lot_id,
      published_at,
      published_by
    FROM cellar.recipe_version
    WHERE recipe_id = CAST(${recipeId} AS UUID)
    ORDER BY version_no
  `);
  return rows.map(versionFrom);
}

async function latestVersion(reader: SqlReader, recipeId: string): Promise<VersionRow | null> {
  const rows = await versionsOf(reader, recipeId);
  return rows[rows.length - 1] ?? null;
}

async function nextCode(reader: SqlReader, lotCode: string): Promise<string> {
  for (let suffix = 1; suffix <= 20; suffix += 1) {
    const candidate = suffix === 1 ? `REC-${lotCode}` : `REC-${lotCode}-${suffix}`;
    if (!/^[A-Z0-9][A-Z0-9./-]{1,39}$/.test(candidate)) break;
    const rows = await reader.read(sql`SELECT id FROM cellar.recipe WHERE code = ${candidate}`);
    if (rows.length === 0) return candidate;
  }
  throw domainError('WC_VALIDATION', { code: 'No hay un código de receta libre' });
}

function insertStep(tx: Tx, versionId: string, step: RecipeStep): void {
  const id = newId();
  const stored = { ...step, id, version_id: versionId };
  auditInsert(tx, 'cellar.recipe_step', id, stored, sql`
    INSERT INTO cellar.recipe_step (
      id, version_id, position, op_type, offset_days, duration_hours, temperature_c,
      additions, blend_proportions, parameters, source_operation_id
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${versionId} AS UUID),
      ${step.position},
      ${step.op_type},
      ${step.offset_days},
      ${step.duration_hours},
      ${step.temperature_c},
      ${sql.json(step.additions)},
      ${sql.json(step.blend_proportions)},
      ${sql.json(step.parameters)},
      CAST(${step.source_operation_id} AS UUID)
    )
  `);
}

async function replaceSteps(tx: Tx, versionId: string, steps: readonly RecipeStep[]): Promise<void> {
  const existing = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM cellar.recipe_step WHERE version_id = CAST(${versionId} AS UUID)
  `);
  if (existing.length > 0) {
    tx.write(sql`DELETE FROM cellar.recipe_step WHERE version_id = CAST(${versionId} AS UUID)`);
    for (const row of existing) {
      tx.audit({
        table: 'cellar.recipe_step',
        rowId: row.id,
        action: 'DELETE',
        before: { id: row.id, version_id: versionId },
        after: null,
      });
    }
  }
  for (const step of steps) insertStep(tx, versionId, step);
}

function summaryOf(
  row: Record<string, unknown>,
  versions: readonly VersionRow[],
  stepCount: number,
): RecipeSummary {
  const latest = versions[versions.length - 1];
  const published = [...versions].reverse().find((version) => version.status === 'published');
  return {
    id: String(row.id).toLowerCase(),
    code: String(row.code),
    name: String(row.name),
    status: String(row.status),
    source_lot_id: asText(row.source_lot_id)?.toLowerCase() ?? null,
    source_lot_code: asText(row.source_lot_code),
    notes: asText(row.notes),
    latest_version_no: latest?.version_no ?? null,
    latest_version_status: latest?.status ?? null,
    published_version_no: published?.version_no ?? null,
    step_count: stepCount,
    updated_at: asText(row.updated_at),
  };
}

async function recipeRow(reader: SqlReader, recipeId: string): Promise<Record<string, unknown>> {
  if (!isUuid(recipeId)) throw domainError('WC_NOT_FOUND');
  const rows = await reader.read<Record<string, unknown>>(sql`
    SELECT
      r.id::VARCHAR AS id,
      r.code,
      r.name,
      r.status,
      r.source_lot_id::VARCHAR AS source_lot_id,
      l.code AS source_lot_code,
      r.notes,
      r.created_at,
      r.updated_at
    FROM cellar.recipe r
    LEFT JOIN inventory.lot l ON l.id = r.source_lot_id
    WHERE r.id = CAST(${recipeId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

export async function readRecipe(writer: Writer, recipeId: string): Promise<RecipeDetail> {
  const row = await recipeRow(writer, recipeId);
  const versions = await versionsOf(writer, recipeId);
  const stepsByVersion = new Map<string, RecipeStep[]>();
  if (versions.length > 0) {
    const rows = await writer.read<Record<string, unknown>>(`
      SELECT
        s.version_id::VARCHAR AS version_id,
        s.position::VARCHAR AS position,
        s.op_type,
        s.offset_days::VARCHAR AS offset_days,
        s.duration_hours::VARCHAR AS duration_hours,
        s.temperature_c::VARCHAR AS temperature_c,
        s.additions,
        s.blend_proportions,
        s.parameters,
        s.source_operation_id::VARCHAR AS source_operation_id
      FROM cellar.recipe_step s
      WHERE s.version_id IN (${uuidList(versions.map((version) => version.id))})
      ORDER BY s.position
    `);
    for (const stepRow of rows) {
      const versionId = String(stepRow.version_id).toLowerCase();
      const list = stepsByVersion.get(versionId) ?? [];
      list.push(stepFromRow(stepRow));
      stepsByVersion.set(versionId, list);
    }
  }
  const latest = versions[versions.length - 1];
  const detailVersions = versions.map((version) => ({
    id: version.id,
    version_no: version.version_no,
    status: version.status,
    design: asRecord(version.design),
    published_at: version.published_at,
    published_by: version.published_by,
    steps: stepsByVersion.get(version.id) ?? [],
  }));
  return {
    ...summaryOf(row, versions, latest ? (stepsByVersion.get(latest.id)?.length ?? 0) : 0),
    created_at: asText(row.created_at),
    versions: detailVersions,
  };
}

export async function listRecipeSummaries(
  writer: Writer,
  input: { status?: string | null; limit?: number; lot_id?: string | null } = {},
): Promise<{ items: RecipeSummary[]; total: number }> {
  const status = input.status ?? null;
  if (status !== null && status !== 'draft' && status !== 'published') {
    throw domainError('WC_VALIDATION', { status: 'Estado no válido' });
  }
  const lotId = input.lot_id ?? null;
  if (lotId !== null && !isUuid(lotId)) throw domainError('WC_VALIDATION', { lot_id: 'Debe ser un UUID' });
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw domainError('WC_VALIDATION', { limit: 'Debe ser un entero entre 1 y 100' });
  }
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT
      r.id::VARCHAR AS id,
      r.code,
      r.name,
      r.status,
      r.source_lot_id::VARCHAR AS source_lot_id,
      l.code AS source_lot_code,
      r.notes,
      r.updated_at
    FROM cellar.recipe r
    LEFT JOIN inventory.lot l ON l.id = r.source_lot_id
    WHERE (${status !== null} = FALSE OR r.status = ${status ?? 'draft'})
      AND (${lotId !== null} = FALSE OR r.source_lot_id = CAST(${lotId ?? NIL} AS UUID))
    ORDER BY r.code
    LIMIT ${limit}
  `);
  const totals = await writer.read<{ total: unknown }>(sql`
    SELECT count(*)::VARCHAR AS total
    FROM cellar.recipe r
    WHERE (${status !== null} = FALSE OR r.status = ${status ?? 'draft'})
      AND (${lotId !== null} = FALSE OR r.source_lot_id = CAST(${lotId ?? NIL} AS UUID))
  `);
  const items: RecipeSummary[] = [];
  for (const row of rows) {
    const versions = await versionsOf(writer, String(row.id));
    const latest = versions[versions.length - 1];
    const countRows = latest
      ? await writer.read<{ n: unknown }>(sql`
        SELECT count(*)::VARCHAR AS n FROM cellar.recipe_step WHERE version_id = CAST(${latest.id} AS UUID)
      `)
      : [];
    items.push(summaryOf(row, versions, asInt(countRows[0]?.n) ?? 0));
  }
  return { items, total: asInt(totals[0]?.total) ?? items.length };
}

export async function captureRecipe(
  writer: Writer,
  actor: Actor,
  code: string,
  producerId: string | null,
  body: unknown,
): Promise<RecipeDetail> {
  const record = readObject(body ?? {});
  const errors = new FieldBag();
  rejectUnknown(record, CAPTURE_FIELDS, errors);
  const name = textValue(record.name, 'name', errors, { min: 2, max: 120 });
  const notes = textValue(record.notes, 'notes', errors, { max: 2000 });
  errors.fail();
  let recipeId = '';
  await writer.withWrite(actor, async (tx) => {
    const lot = await requireLot(tx, code, producerId);
    const steps = await loadHistory(tx, lot.id);
    if (steps.length === 0) throw domainError('WC_LOT_NOT_FINISHED');
    const stored = await readStoredDesign(tx, lot.id);
    const snapshot = stored ? { present: true, ...stored.input } : { present: false };
    recipeId = newId();
    const versionId = newId();
    const recipeCode = await nextCode(tx, lot.code);
    const recipeName = name ?? `Receta ${lot.code}`;
    auditInsert(tx, 'cellar.recipe', recipeId, { id: recipeId, code: recipeCode, name: recipeName }, sql`
      INSERT INTO cellar.recipe (id, code, name, source_lot_id, status, notes, created_by)
      VALUES (
        CAST(${recipeId} AS UUID),
        ${recipeCode},
        ${recipeName},
        CAST(${lot.id} AS UUID),
        'draft',
        ${notes},
        ${actor.id}
      )
    `);
    auditInsert(tx, 'cellar.recipe_version', versionId, { id: versionId, version_no: 1, status: 'draft' }, sql`
      INSERT INTO cellar.recipe_version (
        id, recipe_id, version_no, status, source_lot_id, design, created_by
      ) VALUES (
        CAST(${versionId} AS UUID),
        CAST(${recipeId} AS UUID),
        1,
        'draft',
        CAST(${lot.id} AS UUID),
        ${sql.json(snapshot)},
        ${actor.id}
      )
    `);
    for (const step of steps) insertStep(tx, versionId, step);
  });
  return readRecipe(writer, recipeId);
}

export async function updateRecipe(
  writer: Writer,
  actor: Actor,
  recipeId: string,
  body: unknown,
): Promise<RecipeDetail> {
  const record = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(record, PATCH_FIELDS, errors);
  const name = record.name === undefined ? undefined : textValue(record.name, 'name', errors, { required: true, min: 2, max: 120 });
  const notes = record.notes === undefined ? undefined : textValue(record.notes, 'notes', errors, { max: 2000 });
  const steps = record.steps === undefined ? undefined : parseSteps(record.steps);
  errors.fail();
  await writer.withWrite(actor, async (tx) => {
    const row = await recipeRow(tx, recipeId);
    const latest = await latestVersion(tx, recipeId);
    if (!latest || latest.status !== 'draft') throw domainError('WC_RECIPE_LOCKED');
    let snapshot = asRecord(latest.design);
    if (record.design !== undefined) {
      const currentDesign = snapshotDesign(latest.design);
      const merged = { ...(currentDesign ?? {}), ...readObject(record.design) };
      const input = await parseDesign(tx, merged);
      await assertDesignRefs(tx, input);
      snapshot = { present: true, ...input };
      auditUpdate(tx, 'cellar.recipe_version', latest.id, { design: latest.design }, { design: snapshot }, sql`
        UPDATE cellar.recipe_version
        SET design = ${sql.json(snapshot)}
        WHERE id = CAST(${latest.id} AS UUID) AND status = 'draft'
      `);
    }
    if (steps) await replaceSteps(tx, latest.id, steps);
    if (name !== undefined || notes !== undefined || steps || record.design !== undefined) {
      const nextName = name === undefined ? String(row.name) : name;
      const nextNotes = notes === undefined ? asText(row.notes) : notes;
      auditUpdate(tx, 'cellar.recipe', recipeId, { name: row.name, notes: row.notes }, { name: nextName, notes: nextNotes }, sql`
        UPDATE cellar.recipe
        SET name = ${nextName}, notes = ${nextNotes}, updated_at = now(), status = 'draft'
        WHERE id = CAST(${recipeId} AS UUID)
      `);
    }
  });
  return readRecipe(writer, recipeId);
}

export async function publishRecipe(writer: Writer, actor: Actor, recipeId: string): Promise<RecipeDetail> {
  await writer.withWrite(actor, async (tx) => {
    await recipeRow(tx, recipeId);
    const latest = await latestVersion(tx, recipeId);
    if (!latest || latest.status !== 'draft') {
      throw domainError('WC_VALIDATION', { version: 'No hay un borrador para publicar' });
    }
    auditUpdate(tx, 'cellar.recipe_version', latest.id, { status: 'draft' }, { status: 'published', published_by: actor.id }, sql`
      UPDATE cellar.recipe_version
      SET status = 'published', published_at = now(), published_by = ${actor.id}
      WHERE id = CAST(${latest.id} AS UUID) AND status = 'draft'
    `);
    auditUpdate(tx, 'cellar.recipe', recipeId, { status: 'draft' }, { status: 'published' }, sql`
      UPDATE cellar.recipe
      SET status = 'published', updated_at = now()
      WHERE id = CAST(${recipeId} AS UUID)
    `);
  });
  return readRecipe(writer, recipeId);
}

export async function openRecipeVersion(writer: Writer, actor: Actor, recipeId: string): Promise<RecipeDetail> {
  await writer.withWrite(actor, async (tx) => {
    await recipeRow(tx, recipeId);
    const latest = await latestVersion(tx, recipeId);
    if (!latest) throw domainError('WC_NOT_FOUND');
    if (latest.status !== 'published') {
      throw domainError('WC_VALIDATION', { version: 'Ya hay un borrador sin publicar' });
    }
    const versionId = newId();
    const versionNo = latest.version_no + 1;
    const steps = await readSteps(tx, latest.id);
    auditInsert(tx, 'cellar.recipe_version', versionId, { id: versionId, version_no: versionNo, status: 'draft' }, sql`
      INSERT INTO cellar.recipe_version (
        id, recipe_id, version_no, status, source_lot_id, design, created_by
      ) VALUES (
        CAST(${versionId} AS UUID),
        CAST(${recipeId} AS UUID),
        ${versionNo},
        'draft',
        CAST(${latest.source_lot_id} AS UUID),
        ${sql.json(asRecord(latest.design))},
        ${actor.id}
      )
    `);
    for (const step of steps) insertStep(tx, versionId, { ...step });
    auditUpdate(tx, 'cellar.recipe', recipeId, { status: 'published' }, { status: 'draft' }, sql`
      UPDATE cellar.recipe SET status = 'draft', updated_at = now() WHERE id = CAST(${recipeId} AS UUID)
    `);
  });
  return readRecipe(writer, recipeId);
}

export async function readRecipeVersion(
  reader: SqlReader,
  recipeId: string,
  versionNo: number | null,
  lotId: string | null,
): Promise<RecipeVersion> {
  await recipeRow(reader, recipeId);
  let version: VersionRow | null = null;
  if (versionNo != null) {
    const rows = await reader.read<Record<string, unknown>>(sql`
      SELECT
        id::VARCHAR AS id, recipe_id::VARCHAR AS recipe_id, version_no::VARCHAR AS version_no,
        status, design, source_lot_id::VARCHAR AS source_lot_id, published_at, published_by
      FROM cellar.recipe_version
      WHERE recipe_id = CAST(${recipeId} AS UUID) AND version_no = ${versionNo}
    `);
    version = rows[0] ? versionFrom(rows[0]) : null;
  } else if (lotId && isUuid(lotId)) {
    const plans = await reader.read<{ version_id: string }>(sql`
      SELECT version_id::VARCHAR AS version_id
      FROM cellar.elaboration_plan
      WHERE lot_id = CAST(${lotId} AS UUID) AND recipe_id = CAST(${recipeId} AS UUID)
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const versionId = plans[0]?.version_id;
    if (versionId) {
      const rows = await reader.read<Record<string, unknown>>(sql`
        SELECT
          id::VARCHAR AS id, recipe_id::VARCHAR AS recipe_id, version_no::VARCHAR AS version_no,
          status, design, source_lot_id::VARCHAR AS source_lot_id, published_at, published_by
        FROM cellar.recipe_version
        WHERE id = CAST(${versionId} AS UUID)
      `);
      version = rows[0] ? versionFrom(rows[0]) : null;
    }
  }
  if (!version) {
    const published = await reader.read<Record<string, unknown>>(sql`
      SELECT
        id::VARCHAR AS id, recipe_id::VARCHAR AS recipe_id, version_no::VARCHAR AS version_no,
        status, design, source_lot_id::VARCHAR AS source_lot_id, published_at, published_by
      FROM cellar.recipe_version
      WHERE recipe_id = CAST(${recipeId} AS UUID) AND status = 'published'
      ORDER BY version_no DESC
      LIMIT 1
    `);
    const fallback = published[0] ? published : await reader.read<Record<string, unknown>>(sql`
      SELECT
        id::VARCHAR AS id, recipe_id::VARCHAR AS recipe_id, version_no::VARCHAR AS version_no,
        status, design, source_lot_id::VARCHAR AS source_lot_id, published_at, published_by
      FROM cellar.recipe_version
      WHERE recipe_id = CAST(${recipeId} AS UUID)
      ORDER BY version_no DESC
      LIMIT 1
    `);
    version = fallback[0] ? versionFrom(fallback[0]) : null;
  }
  if (!version) throw domainError('WC_NOT_FOUND');
  return {
    id: version.id,
    recipe_id: version.recipe_id,
    version_no: version.version_no,
    status: version.status,
    design: snapshotDesign(version.design),
    steps: await readSteps(reader, version.id),
  };
}
