// Lista blanca de personas. El acceso lo hace Timbal; aquí solo se admite el correo.
import { isRoleCode, type RoleCode } from './permissions';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['invited', 'active', 'suspended', 'revoked'] as const;

export interface UserRoleView {
  role: RoleCode;
  legal_entity_id: string | null;
  legal_entity_code: string | null;
}

export interface UserView {
  id: string;
  display_name: string;
  email: string;
  roles: UserRoleView[];
  status: string;
}

export interface RoleInput {
  role: RoleCode;
  legalEntityId: string | null;
}

export async function listUsers(writer: Writer): Promise<UserView[]> {
  const people = await writer.read<Record<string, unknown>>(`
    SELECT id::VARCHAR AS id, email, display_name, status
    FROM core.app_user
    ORDER BY display_name, email
  `);
  const roles = await loadRoles(writer, null);
  return people.map((row) => toUser(row, roles.get(String(row.id).toLowerCase()) ?? []));
}

export async function inviteUser(
  writer: Writer,
  actor: Actor,
  input: { email: string; displayName: string; roles: RoleInput[]; status: 'active' | 'invited' },
): Promise<UserView> {
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const taken = await tx.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM core.app_user WHERE lower(email) = ${input.email}
    `);
    if (taken.length > 0) {
      throw domainError('WC_VALIDATION', { email: 'Ya hay una persona con este correo' });
    }
    await assertEntities(tx, input.roles);
    tx.write(sql`
      INSERT INTO core.app_user (id, email, display_name, locale, status)
      VALUES (CAST(${id} AS UUID), ${input.email}, ${input.displayName}, 'es-ES', ${input.status})
    `);
    tx.audit({
      table: 'core.app_user',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { id, email: input.email, display_name: input.displayName, status: input.status },
    });
    for (const role of input.roles) insertRole(tx, id, role, actor.id);
  });
  const created = await userById(writer, id);
  if (!created) throw domainError('WC_NOT_FOUND');
  return created;
}

export async function patchUser(
  writer: Writer,
  actor: Actor,
  id: string,
  input: { displayName?: string; status?: (typeof STATUSES)[number]; roles?: RoleInput[] },
  now: Date,
): Promise<UserView> {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  await writer.withWrite(actor, async (tx) => {
    const rows = await tx.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, email, display_name, status
      FROM core.app_user
      WHERE id = CAST(${id} AS UUID)
    `);
    const current = rows[0];
    if (!current) throw domainError('WC_NOT_FOUND');
    const userId = String(current.id).toLowerCase();
    const nextStatus = input.status ?? String(current.status);
    const nextName = input.displayName ?? String(current.display_name);
    const currentRoles = await loadRoles(tx, userId);
    const active = currentRoles.get(userId) ?? [];
    const nextRoles = input.roles ?? active.map((role) => ({
      role: role.role,
      legalEntityId: role.legal_entity_id,
    }));
    if (input.roles) await assertEntities(tx, input.roles);
    await assertKeepsOwner(tx, userId, nextStatus, nextRoles);
    if (nextName !== String(current.display_name) || nextStatus !== String(current.status)) {
      tx.write(sql`
        UPDATE core.app_user
        SET display_name = ${nextName},
            status = ${nextStatus},
            updated_at = ${now}
        WHERE id = CAST(${userId} AS UUID)
      `);
      tx.audit({
        table: 'core.app_user',
        rowId: userId,
        action: 'UPDATE',
        before: { display_name: String(current.display_name), status: String(current.status) },
        after: { display_name: nextName, status: nextStatus },
      });
    }
    if (input.roles) await replaceRoles(tx, userId, active, input.roles, actor.id, now);
  });
  const updated = await userById(writer, id);
  if (!updated) throw domainError('WC_NOT_FOUND');
  return updated;
}

export function parseInvite(body: Record<string, unknown>): {
  email: string;
  displayName: string;
  roles: RoleInput[];
  status: 'active' | 'invited';
} {
  const fields: Record<string, string> = {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 160) fields.email = 'Correo no válido';
  const rawName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const displayName = rawName || email.split('@')[0] || '';
  if (displayName.length < 2 || displayName.length > 80) fields.display_name = 'El nombre tiene que tener entre 2 y 80 caracteres';
  const roles = parseRoles(body.roles, fields);
  let status: 'active' | 'invited' = 'active';
  if (body.status !== undefined && body.status !== null && body.status !== '') {
    if (body.status !== 'active' && body.status !== 'invited') {
      fields.status = 'El alta es active o invited';
    } else {
      status = body.status;
    }
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return { email, displayName, roles: roles ?? [], status };
}

export function parsePatch(body: Record<string, unknown>): {
  displayName?: string;
  status?: (typeof STATUSES)[number];
  roles?: RoleInput[];
} {
  const fields: Record<string, string> = {};
  const patch: { displayName?: string; status?: (typeof STATUSES)[number]; roles?: RoleInput[] } = {};
  if (Object.prototype.hasOwnProperty.call(body, 'display_name')) {
    const name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    if (name.length < 2 || name.length > 80) fields.display_name = 'El nombre tiene que tener entre 2 y 80 caracteres';
    else patch.displayName = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    if (typeof body.status !== 'string' || !(STATUSES as readonly string[]).includes(body.status)) {
      fields.status = 'Estado no válido';
    } else {
      patch.status = body.status as (typeof STATUSES)[number];
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'roles')) {
    const roles = parseRoles(body.roles, fields);
    if (roles) patch.roles = roles;
  }
  if (!patch.displayName && !patch.status && !patch.roles && Object.keys(fields).length === 0) {
    fields.body = 'No hay cambios';
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return patch;
}

function parseRoles(value: unknown, fields: Record<string, string>): RoleInput[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) {
    fields.roles = 'Indica entre 1 y 24 roles';
    return null;
  }
  const roles: RoleInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fields.roles = 'Cada rol es un objeto';
      return null;
    }
    const row = item as Record<string, unknown>;
    const role = typeof row.role === 'string' ? row.role : '';
    if (!isRoleCode(role)) {
      fields.roles = 'Rol no válido';
      return null;
    }
    let legalEntityId: string | null = null;
    if (row.legal_entity_id != null && row.legal_entity_id !== '') {
      if (typeof row.legal_entity_id !== 'string' || !UUID.test(row.legal_entity_id)) {
        fields.legal_entity_id = 'Identificador no válido';
        return null;
      }
      legalEntityId = row.legal_entity_id.toLowerCase();
    }
    const key = `${role}|${legalEntityId ?? ''}`;
    if (seen.has(key)) {
      fields.roles = 'Rol repetido';
      return null;
    }
    seen.add(key);
    roles.push({ role, legalEntityId });
  }
  return roles;
}

async function assertEntities(tx: Tx, roles: readonly RoleInput[]): Promise<void> {
  const ids = [...new Set(roles.flatMap((role) => (role.legalEntityId ? [role.legalEntityId] : [])))];
  if (ids.length === 0) return;
  const list = ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ');
  const found = await tx.read<{ id: string }>(`
    SELECT id::VARCHAR AS id FROM core.legal_entity WHERE id IN (${list})
  `);
  if (found.length !== ids.length) {
    throw domainError('WC_VALIDATION', { legal_entity_id: 'La entidad no existe' });
  }
}

async function assertKeepsOwner(
  tx: Tx,
  userId: string,
  status: string,
  roles: readonly { role: string; legalEntityId: string | null }[],
): Promise<void> {
  const owners = await tx.read<{ id: string }>(sql`
    SELECT DISTINCT u.id::VARCHAR AS id
    FROM core.app_user u
    JOIN core.user_role r ON r.user_id = u.id
    WHERE u.status = 'active'
      AND r.role_code = 'owner'
      AND r.revoked_at IS NULL
  `);
  const ids = new Set(owners.map((row) => String(row.id).toLowerCase()));
  const stays = status === 'active' && roles.some((role) => role.role === 'owner');
  if (stays) ids.add(userId);
  else ids.delete(userId);
  if (ids.size === 0) {
    throw domainError(
      'WC_VALIDATION',
      { roles: 'Tiene que quedar al menos un propietario activo' },
      'Tiene que quedar al menos un propietario activo',
    );
  }
}

async function replaceRoles(
  tx: Tx,
  userId: string,
  active: readonly UserRoleView[],
  desired: readonly RoleInput[],
  grantedBy: string,
  now: Date,
): Promise<void> {
  const wanted = new Set(desired.map((role) => roleKey(role.role, role.legalEntityId)));
  const have = new Set(active.map((role) => roleKey(role.role, role.legal_entity_id)));
  const stored = await tx.read<{ id: string; role_code: string; legal_entity_id: string | null }>(sql`
    SELECT id::VARCHAR AS id, role_code, legal_entity_id::VARCHAR AS legal_entity_id
    FROM core.user_role
    WHERE user_id = CAST(${userId} AS UUID) AND revoked_at IS NULL
  `);
  for (const row of stored) {
    const key = roleKey(String(row.role_code), row.legal_entity_id ? String(row.legal_entity_id).toLowerCase() : null);
    if (wanted.has(key)) continue;
    tx.write(sql`
      UPDATE core.user_role
      SET revoked_at = ${now}
      WHERE id = CAST(${row.id} AS UUID) AND revoked_at IS NULL
    `);
    tx.audit({
      table: 'core.user_role',
      rowId: String(row.id).toLowerCase(),
      action: 'UPDATE',
      before: { role: row.role_code, revoked_at: null },
      after: { role: row.role_code, revoked_at: now.toISOString() },
    });
  }
  for (const role of desired) {
    if (have.has(roleKey(role.role, role.legalEntityId))) continue;
    insertRole(tx, userId, role, grantedBy);
  }
}

function insertRole(tx: Tx, userId: string, role: RoleInput, grantedBy: string): void {
  const id = newId();
  tx.write(sql`
    INSERT INTO core.user_role (id, user_id, role_code, legal_entity_id, granted_by)
    VALUES (
      CAST(${id} AS UUID),
      CAST(${userId} AS UUID),
      ${role.role},
      CAST(${role.legalEntityId} AS UUID),
      CAST(${grantedBy} AS UUID)
    )
  `);
  tx.audit({
    table: 'core.user_role',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { user_id: userId, role: role.role, legal_entity_id: role.legalEntityId },
  });
}

async function userById(writer: Writer, id: string): Promise<UserView | null> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, email, display_name, status
    FROM core.app_user
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  const roles = await loadRoles(writer, String(row.id).toLowerCase());
  return toUser(row, roles.get(String(row.id).toLowerCase()) ?? []);
}

async function loadRoles(
  reader: { read<T>(statement: string): Promise<T[]> },
  userId: string | null,
): Promise<Map<string, UserRoleView[]>> {
  const where = userId
    ? sql`r.user_id = CAST(${userId} AS UUID) AND r.revoked_at IS NULL`
    : 'r.revoked_at IS NULL';
  const rows = await reader.read<Record<string, unknown>>(`
    SELECT r.user_id::VARCHAR AS user_id, r.role_code,
           r.legal_entity_id::VARCHAR AS legal_entity_id, e.code AS legal_entity_code
    FROM core.user_role r
    LEFT JOIN core.legal_entity e ON e.id = r.legal_entity_id
    WHERE ${where}
    ORDER BY r.role_code, e.code
  `);
  const map = new Map<string, UserRoleView[]>();
  for (const row of rows) {
    const role = String(row.role_code);
    if (!isRoleCode(role)) continue;
    const owner = String(row.user_id).toLowerCase();
    const list = map.get(owner) ?? [];
    list.push({
      role,
      legal_entity_id: row.legal_entity_id == null ? null : String(row.legal_entity_id).toLowerCase(),
      legal_entity_code: row.legal_entity_code == null ? null : String(row.legal_entity_code),
    });
    map.set(owner, list);
  }
  return map;
}

function toUser(row: Record<string, unknown>, roles: UserRoleView[]): UserView {
  return {
    id: String(row.id).toLowerCase(),
    display_name: String(row.display_name),
    email: String(row.email),
    roles,
    status: String(row.status),
  };
}

function roleKey(role: string, entityId: string | null): string {
  return `${role}|${entityId ?? ''}`;
}
