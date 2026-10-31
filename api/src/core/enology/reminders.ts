import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { emitEvent } from '../events/emit';
import { newId } from '../ids';
import { businessDate } from '../time';
import { postSpringBottlingDue, seasonKey, winterRackingDue } from './checks';
import { readSettings } from './settings';
import { parseInstant } from './text';
import type { SettingsView } from './types';

export interface ReminderRun {
  emitted: number;
}

/**
 * Primer trasiego tras el frío (febrero-marzo) y embotellado después de la primavera.
 * Un aviso por lote y temporada, en el outbox de notificaciones.
 */
export async function runSeasonalReminders(writer: Writer, now: Date): Promise<ReminderRun> {
  const day = businessDate(now);
  const lots = await writer.read<{ id: string; producer_entity_id: string; code: string }>(`
    SELECT id::VARCHAR AS id, producer_entity_id::VARCHAR AS producer_entity_id, code
    FROM inventory.lot
    WHERE status = 'active' AND kind = 'wine'
  `);
  if (lots.length === 0) return { emitted: 0 };
  const volumes = await volumesByLot(writer);
  const rackings = await rackingDays(writer);
  const settings = new Map<string, SettingsView>();
  const due: Due[] = [];
  for (const lot of lots) {
    const entityId = lot.producer_entity_id.toLowerCase();
    const volume = volumes.get(lot.id.toLowerCase()) ?? 0;
    if (volume <= 0) continue;
    let view = settings.get(entityId);
    if (!view) {
      view = await readSettings(writer, entityId);
      settings.set(entityId, view);
    }
    const racked = rackedThisWinter(rackings.get(lot.id.toLowerCase()) ?? [], day, view);
    const context = {
      day,
      lot_kind: 'wine',
      has_volume: true,
      racked_this_winter: racked,
      settings: view,
    };
    if (winterRackingDue(context)) {
      due.push({ lotId: lot.id.toLowerCase(), entityId, code: lot.code, rule: 'winter_racking', season: seasonKey(day) });
    }
    if (postSpringBottlingDue(context)) {
      due.push({ lotId: lot.id.toLowerCase(), entityId, code: lot.code, rule: 'post_spring_bottling', season: seasonKey(day) });
    }
  }
  if (due.length === 0) return { emitted: 0 };
  let emitted = 0;
  await writer.withWrite({ type: 'system', id: 'enology-reminders', requestId: newId() }, async (tx) => {
    for (const item of due) {
      const existing = await tx.read<{ id: string }>(sql`
        SELECT id::VARCHAR AS id
        FROM enology.reminder_dispatch
        WHERE lot_id = CAST(${item.lotId} AS UUID)
          AND rule_code = ${item.rule}
          AND season_key = ${item.season}
      `);
      if (existing[0]) continue;
      const id = newId();
      tx.write(sql`
        INSERT INTO enology.reminder_dispatch (id, legal_entity_id, lot_id, rule_code, season_key)
        VALUES (
          CAST(${id} AS UUID),
          CAST(${item.entityId} AS UUID),
          CAST(${item.lotId} AS UUID),
          ${item.rule},
          ${item.season}
        )
      `);
      const link = safeLotLink(item.code);
      emitEvent(tx, {
        type: 'cellar.seasonal.reminder',
        aggregate: 'inventory.lot',
        aggregateId: item.lotId,
        payload: {
          legal_entity_id: item.entityId,
          lot_id: item.lotId,
          rule: item.rule,
          season: item.season,
          ...(link ? { link } : {}),
        },
      });
      emitted += 1;
    }
  });
  return { emitted };
}

interface Due {
  lotId: string;
  entityId: string;
  code: string;
  rule: 'winter_racking' | 'post_spring_bottling';
  season: string;
}

async function volumesByLot(writer: Writer): Promise<Map<string, number>> {
  const rows = await writer.read<{ lot_id: string; volume_ml: string }>(`
    SELECT lot_id::VARCHAR AS lot_id, SUM(volume_ml)::VARCHAR AS volume_ml
    FROM inventory.v_stock_balance
    WHERE lot_id IS NOT NULL AND product_state = 'wine'
    GROUP BY lot_id
  `);
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.lot_id.toLowerCase(), Number(row.volume_ml));
  return map;
}

async function rackingDays(writer: Writer): Promise<Map<string, string[]>> {
  const rows = await writer.read<{ lot_id: string; occurred_at: string }>(`
    SELECT ol.lot_id::VARCHAR AS lot_id, o.occurred_at::VARCHAR AS occurred_at
    FROM cellar.operation_line ol
    JOIN cellar.operation o ON o.id = ol.operation_id
    WHERE o.op_type = 'racking' AND o.status = 'confirmed'
  `);
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const instant = parseInstant(row.occurred_at);
    if (Number.isNaN(instant.getTime())) continue;
    const key = row.lot_id.toLowerCase();
    const days = map.get(key) ?? [];
    days.push(businessDate(instant));
    map.set(key, days);
  }
  return map;
}

function rackedThisWinter(days: readonly string[], asOf: string, settings: SettingsView): boolean {
  const year = asOf.slice(0, 4);
  const from = Number(settings.parameters.find((row) => row.code === 'winter_racking_month_from')?.value ?? '2');
  const to = Number(settings.parameters.find((row) => row.code === 'winter_racking_month_to')?.value ?? '3');
  return days.some((day) => {
    if (!day.startsWith(year)) return false;
    const month = Number(day.slice(5, 7));
    return month >= from && month <= to;
  });
}

function safeLotLink(code: string): string | null {
  const link = `/v1/lots/${code}`;
  return /^\/[A-Za-z0-9._~/-]{1,180}$/u.test(link) ? link : null;
}
