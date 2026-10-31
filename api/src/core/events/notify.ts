import { sha256Hex } from '../hash';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import type { RoleCode } from '../auth/permissions';
import { eventSpec } from './catalogue';
import { amountText, safeLink } from './payload';

export const FAILURE_KIND = 'ops.outbox.failed';

const FAILURE_ROLES: readonly RoleCode[] = ['owner', 'admin'];

export interface Notice {
  kind: string;
  title: string;
  body: string;
  link: string | null;
  roles: readonly RoleCode[];
}

export function noticeFor(type: string, payload: Record<string, unknown>): Notice {
  const spec = eventSpec(type);
  if (!spec) {
    throw new Error('Tipo de evento desconocido');
  }
  const amount = amountText(payload);
  const body = amount ? `${spec.body} Importe: ${amount}.` : spec.body;
  return {
    kind: type,
    title: clip(spec.title, 80),
    body: clip(body, 500),
    link: safeLink(payload),
    roles: spec.roles,
  };
}

export function failureNotice(type: string, payload: Record<string, unknown>): Notice {
  return {
    kind: FAILURE_KIND,
    title: 'Aviso no entregado',
    body: clip(`No se ha podido entregar el aviso ${type}.`, 500),
    link: safeLink(payload),
    roles: FAILURE_ROLES,
  };
}

export async function ensureNotifications(
  tx: Tx,
  eventId: string,
  legalEntityId: string | null,
  notice: Notice,
): Promise<void> {
  const users = await recipientIds(tx, notice.roles, legalEntityId);
  for (const userId of users) {
    const id = notificationId(eventId, userId, notice.kind);
    tx.write(sql`
      INSERT INTO core.notification (id, user_id, kind, title, body, link)
      SELECT
        CAST(${id} AS UUID),
        CAST(${userId} AS UUID),
        ${notice.kind},
        ${notice.title},
        ${notice.body},
        ${notice.link}
      WHERE NOT EXISTS (
        SELECT 1 FROM core.notification WHERE id = CAST(${id} AS UUID)
      )
    `);
  }
}

export function notificationId(eventId: string, userId: string, kind: string): string {
  const hex = sha256Hex(`${kind}\n${eventId}\n${userId}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function recipientIds(tx: Tx, roles: readonly RoleCode[], legalEntityId: string | null): Promise<string[]> {
  if (roles.length === 0) return [];
  const roleList = roles.map((role) => sql`${role}`).join(', ');
  const entityClause = legalEntityId
    ? sql`(r.legal_entity_id IS NULL OR r.legal_entity_id = CAST(${legalEntityId} AS UUID))`
    : 'TRUE';
  const rows = await tx.read<{ id: string }>(`
    SELECT DISTINCT u.id AS id
    FROM core.app_user u
    JOIN core.user_role r ON r.user_id = u.id
    WHERE u.status = 'active'
      AND r.revoked_at IS NULL
      AND r.role_code IN (${roleList})
      AND ${entityClause}
  `);
  return rows.map((row) => String(row.id));
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
