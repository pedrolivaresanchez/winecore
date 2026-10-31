import { sessionOf } from '../auth/guard';
import { permissionsFor } from '../core/auth/permissions';
import { sql } from '../core/db/sql';
import type { Writer } from '../core/db/writer';

export async function me(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const entities = await writer.read<{ id: string; code: string; legal_name: string }>(sql`
    SELECT id, code, legal_name
    FROM core.legal_entity
    WHERE is_active
    ORDER BY code
  `);
  const unrestricted = user.roles.some((role) => role.legalEntityId === null);
  const visible = unrestricted
    ? entities
    : entities.filter((entity) => user.roles.some((role) => role.legalEntityId === entity.id));
  const roles = [...user.roles]
    .map((role) => ({ role: role.role, legal_entity_code: role.legalEntityCode }))
    .sort((left, right) =>
      left.role.localeCompare(right.role) ||
      (left.legal_entity_code ?? '').localeCompare(right.legal_entity_code ?? ''),
    );
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    roles,
    entities: visible.map((entity) => ({
      id: entity.id,
      code: entity.code,
      legal_name: entity.legal_name,
    })),
    permissions: permissionsFor(user),
  };
}
