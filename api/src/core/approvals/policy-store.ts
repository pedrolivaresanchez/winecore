import { domainError } from '../errors';
import { newId } from '../ids';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { DEFAULT_POLICIES, isApprovalKind, resolvePolicy, withStepUpSwitch, type PolicyList } from './policy';
import { APPROVAL_KINDS, type ApprovalKind, type ApprovalPolicy } from './types';

const SELF_KEY = 'approvals.allow_self';
const STEP_UP_KEY = 'approvals.require_step_up';

export interface PolicyView {
  id: string | null;
  kind: ApprovalKind;
  legal_entity_code: string | null;
  allowed_roles: string[];
  min_approvals: number;
  requires_step_up: boolean;
  validity_hours: number;
  allow_self_approval: boolean;
}

export interface PolicyWrite {
  kind: ApprovalKind;
  legalEntityId: string | null;
  allowedRoles: readonly string[];
  minApprovals: number;
  requiresStepUp: boolean;
  validityMinutes: number;
  allowSelfApproval: boolean;
  updatedBy: string;
}

export async function loadApprovalPolicies(writer: Writer): Promise<PolicyList> {
  const [rows, self, stepUp] = await Promise.all([
    writer.read<Record<string, unknown>>(policySelect()),
    readSelfMap(writer),
    readStepUpRequired(writer),
  ]);
  const policies = rows.flatMap((row) => {
    const policy = mapPolicy(row, self);
    return policy ? [policy] : [];
  });
  return withStepUpSwitch(policies, stepUp);
}

type Reader = { read<T>(statement: string): Promise<T[]> };

/** Sin ajuste guardado no se pide passkey ni TOTP al aprobar (decisión de Pedro, 1-11-2026). */
export async function readStepUpRequired(reader: Reader): Promise<boolean> {
  const rows = await reader.read<{ value: unknown }>(sql`
    SELECT value FROM core.setting WHERE key = ${STEP_UP_KEY}
  `);
  const value = rows[0]?.value;
  return value === true || value === 'true';
}

export async function saveStepUpRequired(
  writer: Writer,
  actor: Actor,
  required: boolean,
  now: Date,
): Promise<boolean> {
  await writer.withWrite(actor, async (tx) => {
    const rows = await tx.read<{ value: unknown }>(sql`
      SELECT value FROM core.setting WHERE key = ${STEP_UP_KEY}
    `);
    const before = rows[0] ? { value: rows[0].value } : null;
    if (rows[0]) {
      tx.write(sql`
        UPDATE core.setting
        SET value = ${sql.json(required)}, updated_at = ${now}, updated_by = ${actor.id}
        WHERE key = ${STEP_UP_KEY}
      `);
    } else {
      tx.write(sql`
        INSERT INTO core.setting (key, value, updated_at, updated_by)
        VALUES (${STEP_UP_KEY}, ${sql.json(required)}, ${now}, ${actor.id})
      `);
    }
    tx.audit({
      table: 'core.setting',
      rowId: STEP_UP_KEY,
      action: rows[0] ? 'UPDATE' : 'INSERT',
      before,
      after: { value: required },
    });
  });
  return required;
}

export async function listPolicyViews(writer: Writer): Promise<PolicyView[]> {
  const [rows, self] = await Promise.all([
    writer.read<Record<string, unknown>>(policySelect()),
    readSelfMap(writer),
  ]);
  const stored = rows.flatMap((row) => {
    const policy = mapPolicy(row, self);
    if (!policy) return [];
    return [{ policy, code: row.legal_entity_code == null ? null : String(row.legal_entity_code) }];
  });
  const globals = new Map<ApprovalKind, PolicyView>();
  const specific: PolicyView[] = [];
  for (const row of stored) {
    const view = toView(row.policy, row.code);
    if (row.policy.legalEntityId === null) globals.set(row.policy.kind, view);
    else specific.push(view);
  }
  const items = APPROVAL_KINDS.map((kind) => globals.get(kind) ?? defaultView(kind, self));
  return [...items, ...specific];
}

export async function saveApprovalPolicy(
  writer: Writer,
  actor: Actor,
  input: PolicyWrite,
  now: Date,
): Promise<PolicyView> {
  const draftId = newId();
  const draft: ApprovalPolicy = {
    id: draftId,
    kind: input.kind,
    legalEntityId: input.legalEntityId,
    minApprovals: input.minApprovals,
    allowedRoles: input.allowedRoles,
    allowedUserIds: [],
    requiresStepUp: input.requiresStepUp,
    validityMinutes: input.validityMinutes,
    updatedAt: now.toISOString(),
    updatedBy: input.updatedBy,
    allowSelfApproval: input.allowSelfApproval,
  };
  resolvePolicy([draft], { kind: draft.kind, legalEntityId: draft.legalEntityId });

  return writer.withWrite(actor, async (tx) => {
    if (input.legalEntityId !== null) {
      const entities = await tx.read<{ id: string; code: string }>(sql`
        SELECT id, code FROM core.legal_entity WHERE id = CAST(${input.legalEntityId} AS UUID)
      `);
      if (!entities[0]) throw domainError('WC_VALIDATION', { legalEntityId: 'La entidad no existe' });
    }
    const existing = await tx.read<Record<string, unknown>>(sql`
      SELECT id
      FROM ops.approval_policy
      WHERE kind = ${input.kind}
        AND (
          (${input.legalEntityId} IS NULL AND legal_entity_id IS NULL)
          OR legal_entity_id = CASE
            WHEN ${input.legalEntityId} IS NULL THEN NULL
            ELSE CAST(${input.legalEntityId} AS UUID)
          END
        )
    `);
    const current = existing[0];
    const id = current ? String(current.id) : draftId;
    const before = current
      ? await tx.read<Record<string, unknown>>(sql`
          SELECT kind, legal_entity_id, min_approvals, allowed_roles, requires_step_up, validity_minutes, updated_by
          FROM ops.approval_policy WHERE id = CAST(${id} AS UUID)
        `)
      : [];
    if (current) {
      tx.write(sql`
        UPDATE ops.approval_policy
        SET min_approvals = ${input.minApprovals},
            allowed_roles = ${[...input.allowedRoles]}::VARCHAR[],
            requires_step_up = ${input.requiresStepUp},
            validity_minutes = ${input.validityMinutes},
            updated_at = ${now},
            updated_by = ${input.updatedBy}
        WHERE id = CAST(${id} AS UUID)
      `);
    } else {
      tx.write(sql`
        INSERT INTO ops.approval_policy (
          id, kind, legal_entity_id, min_approvals, allowed_roles,
          requires_step_up, validity_minutes, updated_at, updated_by
        ) VALUES (
          CAST(${id} AS UUID),
          ${input.kind},
          CASE WHEN ${input.legalEntityId} IS NULL THEN NULL ELSE CAST(${input.legalEntityId} AS UUID) END,
          ${input.minApprovals},
          ${[...input.allowedRoles]}::VARCHAR[],
          ${input.requiresStepUp},
          ${input.validityMinutes},
          ${now},
          ${input.updatedBy}
        )
      `);
    }
    const after = {
      kind: input.kind,
      legal_entity_id: input.legalEntityId,
      min_approvals: input.minApprovals,
      allowed_roles: [...input.allowedRoles],
      requires_step_up: input.requiresStepUp,
      validity_minutes: input.validityMinutes,
      allow_self_approval: input.allowSelfApproval,
      updated_by: input.updatedBy,
    };
    tx.audit({
      table: 'ops.approval_policy',
      rowId: id,
      action: current ? 'UPDATE' : 'INSERT',
      before: before[0] ?? null,
      after,
    });
    await writeSelfFlag(tx, input.kind, input.allowSelfApproval, input.updatedBy, now);
    let code: string | null = null;
    if (input.legalEntityId !== null) {
      const entities = await tx.read<{ code: string }>(sql`
        SELECT code FROM core.legal_entity WHERE id = CAST(${input.legalEntityId} AS UUID)
      `);
      code = entities[0]?.code ?? null;
    }
    return {
      id,
      kind: input.kind,
      legal_entity_code: code,
      allowed_roles: [...input.allowedRoles],
      min_approvals: input.minApprovals,
      requires_step_up: input.requiresStepUp,
      validity_hours: input.validityMinutes / 60,
      allow_self_approval: input.allowSelfApproval,
    };
  });
}

function policySelect(): string {
  return `
    SELECT p.id, p.kind, p.legal_entity_id, e.code AS legal_entity_code,
           p.min_approvals, p.allowed_roles, p.allowed_user_ids,
           p.requires_step_up, p.validity_minutes, p.updated_at, p.updated_by
    FROM ops.approval_policy p
    LEFT JOIN core.legal_entity e ON e.id = p.legal_entity_id
  `;
}

async function readSelfMap(writer: Writer): Promise<Partial<Record<ApprovalKind, boolean>>> {
  const rows = await writer.read<{ value: unknown }>(sql`
    SELECT value FROM core.setting WHERE key = ${SELF_KEY}
  `);
  return selfMap(rows[0]?.value);
}

async function writeSelfFlag(
  tx: Tx,
  kind: ApprovalKind,
  allow: boolean,
  updatedBy: string,
  now: Date,
): Promise<void> {
  const rows = await tx.read<{ value: unknown }>(sql`
    SELECT value FROM core.setting WHERE key = ${SELF_KEY}
  `);
  const next = { ...selfMap(rows[0]?.value), [kind]: allow };
  if (rows[0]) {
    tx.write(sql`
      UPDATE core.setting
      SET value = ${sql.json(next)}, updated_at = ${now}, updated_by = ${updatedBy}
      WHERE key = ${SELF_KEY}
    `);
    tx.audit({
      table: 'core.setting',
      rowId: SELF_KEY,
      action: 'UPDATE',
      before: { value: selfMap(rows[0].value) },
      after: { value: next },
    });
    return;
  }
  tx.write(sql`
    INSERT INTO core.setting (key, value, updated_at, updated_by)
    VALUES (${SELF_KEY}, ${sql.json(next)}, ${now}, ${updatedBy})
  `);
  tx.audit({
    table: 'core.setting',
    rowId: SELF_KEY,
    action: 'INSERT',
    before: null,
    after: { value: next },
  });
}

function mapPolicy(
  row: Record<string, unknown>,
  self: Partial<Record<ApprovalKind, boolean>>,
): ApprovalPolicy | null {
  const kind = typeof row.kind === 'string' && isApprovalKind(row.kind) ? row.kind : null;
  const id = typeof row.id === 'string' ? row.id : null;
  if (!kind || !id) return null;
  const updatedAt = row.updated_at == null ? new Date(0).toISOString() : asIso(String(row.updated_at));
  return {
    id,
    kind,
    legalEntityId: row.legal_entity_id == null ? null : String(row.legal_entity_id).toLowerCase(),
    minApprovals: asInt(row.min_approvals),
    allowedRoles: asStrings(row.allowed_roles),
    allowedUserIds: asStrings(row.allowed_user_ids),
    requiresStepUp: row.requires_step_up === true,
    validityMinutes: asInt(row.validity_minutes),
    updatedAt,
    updatedBy: row.updated_by == null ? '' : String(row.updated_by),
    allowSelfApproval: Object.hasOwn(self, kind) ? self[kind] === true : DEFAULT_POLICIES[kind].allowSelfApproval,
  };
}

function toView(policy: ApprovalPolicy, code: string | null): PolicyView {
  return {
    id: policy.id,
    kind: policy.kind,
    legal_entity_code: code,
    allowed_roles: [...policy.allowedRoles],
    min_approvals: policy.minApprovals,
    requires_step_up: policy.requiresStepUp,
    validity_hours: policy.validityMinutes / 60,
    allow_self_approval: policy.allowSelfApproval ?? DEFAULT_POLICIES[policy.kind].allowSelfApproval,
  };
}

function defaultView(kind: ApprovalKind, self: Partial<Record<ApprovalKind, boolean>>): PolicyView {
  const spec = DEFAULT_POLICIES[kind];
  return {
    id: null,
    kind,
    legal_entity_code: null,
    allowed_roles: [...spec.allowedRoles],
    min_approvals: spec.requiredApprovals,
    requires_step_up: spec.requiresStepUp,
    validity_hours: spec.validityMinutes / 60,
    allow_self_approval: Object.hasOwn(self, kind) ? self[kind] === true : spec.allowSelfApproval,
  };
}

function selfMap(value: unknown): Partial<Record<ApprovalKind, boolean>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<Record<ApprovalKind, boolean>> = {};
  for (const [key, flag] of Object.entries(value)) {
    if (isApprovalKind(key) && typeof flag === 'boolean') out[key] = flag;
  }
  return out;
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).toLowerCase());
}

function asInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return 0;
}

function asIso(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}
