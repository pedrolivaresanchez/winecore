import { sql } from '../../db/sql';
import type { Tx } from '../../db/writer';
import { newId } from '../../ids';

const TITLE_MAX = 80;
const BODY_MAX = 500;

export async function notifyInvoiceDelivery(
  tx: Tx,
  input: {
    legalEntityId: string;
    invoiceId: string;
    number: string;
    kind: 'delivery.overdue' | 'delivery.failed' | 'delivery.no_recipient';
    title: string;
    body: string;
    now: Date;
  },
): Promise<number> {
  const users = await tx.read<{ id: string }>(sql`
    SELECT DISTINCT u.id
    FROM core.app_user u
    JOIN core.user_role r ON r.user_id = u.id AND r.revoked_at IS NULL
    WHERE u.status = 'active'
      AND r.role_code IN ('owner', 'admin')
      AND (r.legal_entity_id IS NULL OR r.legal_entity_id = CAST(${input.legalEntityId} AS UUID))
  `);
  const link = `/facturas/${input.invoiceId}`;
  const title = clip(input.title, TITLE_MAX);
  const body = clip(input.body, BODY_MAX);
  let created = 0;
  for (const user of users) {
    const userId = String(user.id);
    const existing = await tx.read<{ id: string }>(sql`
      SELECT id FROM core.notification
      WHERE user_id = CAST(${userId} AS UUID)
        AND kind = ${input.kind}
        AND link = ${link}
        AND read_at IS NULL
      LIMIT 1
    `);
    if (existing[0]) continue;
    tx.write(sql`
      INSERT INTO core.notification (id, user_id, kind, title, body, link, created_at)
      VALUES (
        CAST(${newId()} AS UUID),
        CAST(${userId} AS UUID),
        ${input.kind},
        ${title},
        ${body},
        ${link},
        ${input.now}
      )
    `);
    created += 1;
  }
  return created;
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
