import { describe, expect, it } from 'bun:test';
import { openApprovalService } from '../../src/core/approvals/sql-store';
import { sql } from '../../src/core/db/sql';
import type { Writer } from '../../src/core/db/writer';
import { DomainError } from '../../src/core/errors';
import { postInventoryCount } from '../../src/core/inventory/service/counts.service';
import { createTestApp } from '../helpers';
import { call, countTable, insertStockMove, jsonOf, seedCellar, type Cellar } from './fixture';

const SRC = '019a1000-0000-7000-8000-0000000000e0';

describe('aforos', () => {
  it('el arranque abre por propietario y por mayor, y un aforo periódico regulariza con motivo', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      const actor = { type: 'user' as const, id: cellar.ownerUser, requestId: 'stock-post' };

      const regular = await jsonOf<CountBody>(await ctx.app.handle(call('POST', '/v1/inventory-counts', {
        legal_entity_id: cellar.po,
        kind: 'regular',
        counted_at: '2027-02-01T10:00:00+01:00',
        location_ids: [cellar.bod],
      })));
      expect(regular.kind).toBe('periodic');
      expect(regular.status).toBe('counting');
      const listed = await jsonOf<{ items: { id: string }[]; total: number }>(
        await ctx.app.handle(call('GET', `/v1/inventory-counts?legal_entity_id=${cellar.po}`)),
      );
      expect(listed.total).toBeGreaterThanOrEqual(1);
      expect(listed.items.some((item) => item.id === regular.id)).toBe(true);
      const detail = await jsonOf<{ id: string; status: string }>(
        await ctx.app.handle(call('GET', `/v1/inventory-counts/${regular.id}`)),
      );
      expect(detail.id).toBe(regular.id);
      expect(detail.status).toBe('counting');
      const missing = await ctx.app.handle(call('GET', '/v1/inventory-counts/00000000-0000-4000-8000-000000000099'));
      expect(missing.status).toBe(404);
      expect(regular.lines.total).toBe(0);
      expect(regular.number).toMatch(/^AF-2027-\d{4}$/);

      const opening = await jsonOf<CountBody>(await ctx.app.handle(call('POST', '/v1/inventory-counts', {
        legal_entity_id: 'PO',
        kind: 'opening',
        counted_at: '2026-12-31T18:00:00+01:00',
        location_ids: [cellar.bod],
      })));
      expect(opening.lines.total).toBe(0);
      const openingLines = [
        line('019a1000-0000-7000-8000-0000000000e1', cellar.bod, cellar.tankPo, cellar.po, cellar.lotPo, 5_000_000),
        line('019a1000-0000-7000-8000-0000000000e2', cellar.bod, cellar.tankCvpo, cellar.cvpo, cellar.lotCvpo, 2_000_000),
        line('019a1000-0000-7000-8000-0000000000e3', cellar.bod, cellar.barrel, cellar.po, cellar.lotBarrel, 225_000),
      ];
      const saved = await jsonOf<CountBody>(await ctx.app.handle(call('PUT', `/v1/inventory-counts/${opening.id}/lines`, { lines: openingLines })));
      expect(saved.lines.total).toBe(3);
      const again = await jsonOf<CountBody>(await ctx.app.handle(call('PUT', `/v1/inventory-counts/${opening.id}/lines`, { lines: openingLines })));
      expect(again.lines.total).toBe(3);

      const closed = await jsonOf<CloseBody>(await ctx.app.handle(call('POST', `/v1/inventory-counts/${opening.id}/close`)));
      expect(closed.status).toBe('review');
      expect(closed.differences.total).toBe(3);
      expect(closed.differences.items.reduce((sum, item) => sum + item.difference_volume_ml, 0)).toBe(7_225_000);

      const submitted = await jsonOf<SubmitBody>(await ctx.app.handle(call('POST', `/v1/inventory-counts/${opening.id}/post-request`)));
      expect(submitted.status).toBe('review');
      expect(submitted.approval_status).toBe('pending');
      expect(submitted.adjustment_plan.mode).toBe('opening');
      expect(submitted.adjustment_plan.physical).toHaveLength(3);
      expect(new Set(submitted.adjustment_plan.physical.map((move) => move.owner_entity_id)).size).toBe(2);
      expect(submitted.adjustment_plan.physical.every((move) => move.move_type === 'opening')).toBe(true);
      expect(submitted.adjustment_plan.fiscal.map((move) => move.product_class).sort()).toEqual(['bulk', 'bulk_wood']);
      const bulk = submitted.adjustment_plan.fiscal.find((move) => move.product_class === 'bulk');
      const wood = submitted.adjustment_plan.fiscal.find((move) => move.product_class === 'bulk_wood');
      expect(bulk?.volume_ml).toBe(7_000_000);
      expect(wood?.volume_ml).toBe(225_000);
      const audits = await ctx.writer.read<{ after_data: unknown }>(sql`
        SELECT after_data FROM audit.audit_log
        WHERE table_name = 'inventory.inventory_count' AND row_id = ${opening.id}
        ORDER BY id DESC
      `);
      expect(JSON.stringify(audits.map((row) => row.after_data))).toContain('adjustment_plan');

      await approveCount(ctx.writer, actor.id, opening.id);
      const posted = await postInventoryCount(ctx.writer, actor, opening.id);
      expect(posted.status).toBe('posted');
      expect(posted.physical_move_ids).toHaveLength(3);
      expect(posted.fiscal_move_ids).toHaveLength(2);
      const physicalMoves = await ctx.writer.read<{ occurred_at: string; move_type: string; volume_ml: number }>(sql`
        SELECT occurred_at, move_type, volume_ml FROM inventory.stock_move WHERE source_id = CAST(${opening.id} AS UUID)
      `);
      expect(physicalMoves.every((move) => move.move_type === 'opening')).toBe(true);
      expect(Date.parse(physicalMoves[0]?.occurred_at ?? '')).toBe(Date.parse('2027-01-01T00:00:00+01:00'));
      const fiscalMoves = await ctx.writer.read<{ fiscal_date: string; physical_date: string | null }>(sql`
        SELECT fiscal_date, physical_date FROM inventory.fiscal_move WHERE source_id = CAST(${opening.id} AS UUID)
      `);
      expect(fiscalMoves.every((move) => String(move.fiscal_date).slice(0, 10) === '2027-01-01')).toBe(true);
      expect(fiscalMoves.every((move) => String(move.physical_date).slice(0, 10) === '2026-12-31')).toBe(true);

      const atOpen = await jsonOf<{ items: { volume_ml: number }[]; total: number }>(await ctx.app.handle(call(
        'GET',
        '/v1/stock/balances?at=2027-01-01&owner=PO&vessel_id=' + cellar.tankPo,
      )));
      expect(atOpen.items[0]?.volume_ml).toBe(5_000_000);
      const beforeOpen = await jsonOf<{ total: number }>(await ctx.app.handle(call(
        'GET',
        '/v1/stock/balances?at=2026-12-31&lot_id=' + cellar.lotPo,
      )));
      expect(beforeOpen.total).toBe(0);

      const second = await jsonOf<CountBody>(await ctx.app.handle(call('POST', '/v1/inventory-counts', {
        legal_entity_id: cellar.po,
        kind: 'opening',
        counted_at: '2026-12-31T18:00:00+01:00',
        location_ids: [cellar.bod],
      })));
      await ctx.app.handle(call('PUT', `/v1/inventory-counts/${second.id}/lines`, {
        lines: [line('019a1000-0000-7000-8000-0000000000e4', cellar.bod, cellar.tankPo, cellar.po, cellar.lotPo, 1_000)],
      }));
      expect((await ctx.app.handle(call('POST', `/v1/inventory-counts/${second.id}/close`))).status).toBe(200);
      expect((await ctx.app.handle(call('POST', `/v1/inventory-counts/${second.id}/post-request`))).status).toBe(200);
      const movesBefore = await countTable(ctx.writer, 'inventory.stock_move');
      await expectDomain(postInventoryCount(ctx.writer, { ...actor, requestId: 'post-opening-2' }, second.id), 'WC_VALIDATION');
      expect(await countTable(ctx.writer, 'inventory.stock_move')).toBe(movesBefore);

      const periodic = await jsonOf<CountBody>(await ctx.app.handle(call('POST', '/v1/inventory-counts', {
        legal_entity_id: cellar.po,
        kind: 'periodic',
        counted_at: '2027-06-01T10:00:00+02:00',
        location_ids: [cellar.bod],
      })));
      expect(periodic.lines.total).toBe(3);
      const tank = periodic.lines.items.find((item) => item.vessel_id === cellar.tankPo);
      const other = periodic.lines.items.find((item) => item.vessel_id === cellar.tankCvpo);
      const barrel = periodic.lines.items.find((item) => item.vessel_id === cellar.barrel);
      expect(tank?.expected_volume_ml).toBe(5_000_000);
      expect(other?.expected_volume_ml).toBe(2_000_000);
      expect(barrel?.expected_volume_ml).toBe(225_000);
      if (!tank || !other || !barrel) throw new Error('faltan líneas');

      await ctx.app.handle(call('PUT', `/v1/inventory-counts/${periodic.id}/lines`, {
        lines: [
          counted(tank, 4_990_000, null),
          counted(other, 2_000_000, null),
          counted(barrel, 225_000, null),
        ],
      }));
      const missingReason = await ctx.app.handle(call('POST', `/v1/inventory-counts/${periodic.id}/close`));
      expect(missingReason.status).toBe(422);
      const missingBody = await jsonOf<{ code: string; details?: { line_ids?: string[] } }>(missingReason);
      expect(missingBody.code).toBe('WC_VALIDATION');
      expect(missingBody.details?.line_ids).toContain(tank.id);

      await ctx.app.handle(call('PUT', `/v1/inventory-counts/${periodic.id}/lines`, {
        lines: [
          counted(tank, 4_990_000, 'Merma de medición'),
          counted(other, 2_000_000, 'Sin diferencia'),
          counted(barrel, 225_000, null),
        ],
      }));
      const over = await ctx.app.handle(call('PUT', `/v1/inventory-counts/${periodic.id}/lines`, {
        lines: [counted(tank, 20_000_001, 'Demasiado')],
      }));
      expect(over.status).toBe(422);
      expect((await jsonOf<{ code: string }>(over)).code).toBe('WC025');
      const kept = await ctx.writer.read<{ counted_volume_ml: number }>(sql`
        SELECT counted_volume_ml FROM inventory.inventory_count_line WHERE id = CAST(${tank.id} AS UUID)
      `);
      expect(Number(kept[0]?.counted_volume_ml)).toBe(4_990_000);

      const diff = await jsonOf<CloseBody>(await ctx.app.handle(call('POST', `/v1/inventory-counts/${periodic.id}/close`)));
      expect(diff.differences.items.find((item) => item.id === tank.id)?.difference_volume_ml).toBe(-10_000);
      const plan = await jsonOf<SubmitBody>(await ctx.app.handle(call('POST', `/v1/inventory-counts/${periodic.id}/post-request`)));
      expect(plan.adjustment_plan.mode).toBe('adjustment');
      expect(plan.adjustment_plan.physical.some((row) => row.move?.move_type === 'count_adjust_out' && row.move.volume_ml === -10_000)).toBe(true);
      expect(plan.adjustment_plan.fiscal.some((row) => row.move?.move_type === 'regularization_out' && row.move.volume_ml === -10_000)).toBe(true);
      await approveCount(ctx.writer, actor.id, periodic.id);
      await postInventoryCount(ctx.writer, { ...actor, requestId: 'post-periodic' }, periodic.id);
      const june = await jsonOf<{ items: { volume_ml: number }[] }>(await ctx.app.handle(call(
        'GET',
        '/v1/stock/balances?at=2027-06-15T12:00:00Z&lot_id=' + cellar.lotPo,
      )));
      expect(june.items[0]?.volume_ml).toBe(4_990_000);
      const january = await jsonOf<{ items: { volume_ml: number }[] }>(await ctx.app.handle(call(
        'GET',
        '/v1/stock/balances?at=2027-01-01&lot_id=' + cellar.lotPo,
      )));
      expect(january.items[0]?.volume_ml).toBe(5_000_000);
      const fiscalJune = await jsonOf<{ items: { product_class?: string; volume_ml: number }[] }>(await ctx.app.handle(call(
        'GET',
        '/v1/stock/fiscal-balances?at=2027-06-15',
      )));
      expect(fiscalJune.items.find((item) => item.product_class === 'bulk')?.volume_ml).toBe(6_990_000);
      expect(fiscalJune.items.find((item) => item.product_class === 'bulk_wood')?.volume_ml).toBe(225_000);

      await insertStockMove(ctx.client, {
        id: '019a1000-0000-7000-8000-0000000000e5',
        occurredAt: '2027-08-01T08:00:00Z',
        moveType: 'cellar_in',
        locationId: cellar.vlc,
        vesselId: cellar.tankVlc,
        ownerId: cellar.po,
        lotId: cellar.lotVlc,
        productId: null,
        productState: 'wine',
        qtyUnits: 0,
        volumeMl: 1_000,
        sourceId: SRC,
      });
      await insertStockMove(ctx.client, {
        id: '019a1000-0000-7000-8000-0000000000e6',
        occurredAt: '2027-08-01T18:00:00Z',
        moveType: 'delivery_out',
        locationId: cellar.vlc,
        vesselId: cellar.tankVlc,
        ownerId: cellar.po,
        lotId: cellar.lotVlc,
        productId: null,
        productState: 'wine',
        qtyUnits: 0,
        volumeMl: -400,
        sourceId: SRC,
      });
      const spot = await jsonOf<CountBody>(await ctx.app.handle(call('POST', '/v1/inventory-counts', {
        legal_entity_id: cellar.po,
        kind: 'spot',
        counted_at: '2027-08-01T12:00:00Z',
        location_ids: [cellar.vlc],
      })));
      const spotLine = spot.lines.items[0];
      if (!spotLine) throw new Error('sin línea');
      expect(spotLine.expected_volume_ml).toBe(1_000);
      await ctx.app.handle(call('PUT', `/v1/inventory-counts/${spot.id}/lines`, {
        lines: [counted(spotLine, 100, 'Rotura')],
      }));
      expect((await ctx.app.handle(call('POST', `/v1/inventory-counts/${spot.id}/close`))).status).toBe(200);
      expect((await ctx.app.handle(call('POST', `/v1/inventory-counts/${spot.id}/post-request`))).status).toBe(200);
      const beforeNegative = await countTable(ctx.writer, 'inventory.stock_move');
      await expectDomain(postInventoryCount(ctx.writer, { ...actor, requestId: 'post-negative' }, spot.id), 'WC024');
      expect(await countTable(ctx.writer, 'inventory.stock_move')).toBe(beforeNegative);
      expect(await countTable(ctx.writer, 'inventory.fiscal_move')).toBeGreaterThan(0);

      const locked = await jsonOf<CountBody>(await ctx.app.handle(call('POST', '/v1/inventory-counts', {
        legal_entity_id: cellar.po,
        kind: 'inspection',
        counted_at: '2027-06-02T10:00:00+02:00',
        location_ids: [cellar.bod],
      })));
      const lockedTank = locked.lines.items.find((item) => item.vessel_id === cellar.tankPo);
      const lockedOther = locked.lines.items.find((item) => item.vessel_id === cellar.tankCvpo);
      const lockedBarrel = locked.lines.items.find((item) => item.vessel_id === cellar.barrel);
      if (!lockedTank || !lockedOther || !lockedBarrel) throw new Error('faltan líneas del cierre');
      expect(lockedTank.expected_volume_ml).toBe(4_990_000);
      await ctx.app.handle(call('PUT', `/v1/inventory-counts/${locked.id}/lines`, {
        lines: [
          counted(lockedTank, 4_980_000, 'Merma de medición'),
          counted(lockedOther, lockedOther.expected_volume_ml, 'Sin diferencia'),
          counted(lockedBarrel, lockedBarrel.expected_volume_ml, null),
        ],
      }));
      expect((await ctx.app.handle(call('POST', `/v1/inventory-counts/${locked.id}/close`))).status).toBe(200);
      expect((await ctx.app.handle(call('POST', `/v1/inventory-counts/${locked.id}/post-request`))).status).toBe(200);
      await ctx.client.query(`
        INSERT INTO inventory.period_lock (ledger, locked_until, locked_by, reason)
        VALUES ('physical', DATE '2027-12-31', 'test', 'ejercicio cerrado')
      `);
      const stockBefore = await countTable(ctx.writer, 'inventory.stock_move');
      const fiscalBefore = await countTable(ctx.writer, 'inventory.fiscal_move');
      const failure = await expectDomain(
        postInventoryCount(ctx.writer, { ...actor, requestId: 'post-closed' }, locked.id),
        'WC021',
      );
      expect(failure.httpStatus).toBe(409);
      expect(await countTable(ctx.writer, 'inventory.stock_move')).toBe(stockBefore);
      expect(await countTable(ctx.writer, 'inventory.fiscal_move')).toBe(fiscalBefore);
      const status = await ctx.writer.read<{ status: string }>(sql`
        SELECT status FROM inventory.inventory_count WHERE id = CAST(${locked.id} AS UUID)
      `);
      expect(status[0]?.status).toBe('review');
      await expectDomain(postInventoryCount(ctx.writer, { ...actor, requestId: 'post-again' }, periodic.id), 'WC_VALIDATION');
    } finally {
      await ctx.close();
    }
  });

  it('pagina los aforos por el cursor sin repetir ni saltarse ninguno', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      const created: string[] = [];
      for (const day of ['01', '02', '03']) {
        const count = await jsonOf<CountBody>(await ctx.app.handle(call('POST', '/v1/inventory-counts', {
          legal_entity_id: cellar.po,
          kind: 'spot',
          counted_at: `2027-06-${day}T10:00:00+02:00`,
          location_ids: [cellar.bod],
        })));
        created.push(count.id);
      }
      type Listed = { items: { id: string; counted_at: string }[]; next_cursor: string | null; total: number };
      const seen: Listed['items'] = [];
      let cursor: string | null = null;
      let total = 0;
      for (let page = 0; page < 20; page += 1) {
        const query: string = cursor ? `&cursor=${cursor}` : '';
        const listed: Listed = await jsonOf<Listed>(
          await ctx.app.handle(call('GET', `/v1/inventory-counts?legal_entity_id=${cellar.po}&limit=2${query}`)),
        );
        expect(listed.items.length).toBeLessThanOrEqual(2);
        seen.push(...listed.items);
        total = listed.total;
        cursor = listed.next_cursor;
        if (!cursor) break;
      }
      expect(cursor).toBeNull();
      expect(seen.length).toBe(total);
      expect(new Set(seen.map((item) => item.id)).size).toBe(total);
      const order = seen.map((item) => item.id).filter((id) => created.includes(id));
      expect(order).toEqual([...created].reverse());
      const times = seen.map((item) => Date.parse(item.counted_at));
      expect(times).toEqual([...times].sort((a, b) => b - a));

      const bad = await ctx.app.handle(call('GET', '/v1/inventory-counts?cursor=no-es-un-cursor'));
      expect(bad.status).toBe(422);
    } finally {
      await ctx.close();
    }
  });

  it('rechaza un envasado cuyo volumen no es unidades por formato', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      const created = await jsonOf<CountBody>(await ctx.app.handle(call('POST', '/v1/inventory-counts', {
        legal_entity_id: cellar.po,
        kind: 'spot',
        counted_at: '2027-05-01T10:00:00+02:00',
        location_ids: [cellar.bod],
      })));
      const response = await ctx.app.handle(call('PUT', `/v1/inventory-counts/${created.id}/lines`, {
        lines: [{
          id: '019a1000-0000-7000-8000-0000000000e7',
          location_id: cellar.bod,
          vessel_id: null,
          owner_entity_id: cellar.po,
          lot_id: cellar.lotPack,
          product_id: cellar.product,
          product_state: 'packaged_labeled',
          counted_qty_units: 10,
          counted_volume_ml: 1_000,
          method: 'unit_count',
        }],
      }));
      expect(response.status).toBe(422);
      expect((await jsonOf<{ code: string }>(response)).code).toBe('WC023');
    } finally {
      await ctx.close();
    }
  });
});

async function approveCount(writer: Writer, userId: string, countId: string): Promise<void> {
  const rows = await writer.read<{ id: string; payload_sha256: string }>(sql`
    SELECT id::VARCHAR AS id, payload_sha256
    FROM ops.approval_request
    WHERE subject_table = 'inventory.inventory_count'
      AND subject_id = CAST(${countId} AS UUID)
      AND kind = 'inventory_adjustment'
    ORDER BY requested_at DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw new Error('falta la aprobación del aforo');
  const service = await openApprovalService(writer, { type: 'user', id: userId, requestId: `approve-${countId}` });
  await service.decide({
    requestId: row.id,
    decision: 'approve',
    payloadSha256: row.payload_sha256,
    stepUpMethod: 'totp',
    actor: {
      userId,
      kind: 'user',
      stepUpAt: new Date().toISOString(),
      roles: [{ role: 'owner', legalEntityId: null }],
    },
  });
}

interface CountLine {
  id: string;
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: string;
  expected_volume_ml: number;
}

interface CountBody {
  id: string;
  number: string | null;
  kind: string;
  status: string;
  lines: { items: CountLine[]; total: number };
}

interface CloseBody {
  status: string;
  differences: { total: number; items: { id: string; difference_volume_ml: number }[] };
}

interface PlanMove {
  move_type?: string;
  volume_ml?: number;
  owner_entity_id?: string;
  product_class?: string;
  move?: { move_type: string; volume_ml: number };
}

interface SubmitBody {
  status: string;
  approval_status: string;
  adjustment_plan: {
    mode: string;
    physical: PlanMove[];
    fiscal: PlanMove[];
  };
}

function line(id: string, locationId: string, vesselId: string, ownerId: string, lotId: string, volume: number) {
  return {
    id,
    location_id: locationId,
    vessel_id: vesselId,
    owner_entity_id: ownerId,
    lot_id: lotId,
    product_id: null,
    product_state: 'wine',
    counted_qty_units: 0,
    counted_volume_ml: volume,
    method: 'dipstick',
  };
}

function counted(lineRow: CountLine, volume: number, reason: string | null) {
  return {
    id: lineRow.id,
    location_id: lineRow.location_id,
    vessel_id: lineRow.vessel_id,
    owner_entity_id: lineRow.owner_entity_id,
    lot_id: lineRow.lot_id,
    product_id: lineRow.product_id,
    product_state: lineRow.product_state,
    counted_qty_units: 0,
    counted_volume_ml: volume,
    method: 'dipstick',
    difference_reason: reason,
  };
}

async function expectDomain(promise: Promise<unknown>, code: string): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    const domain = error as DomainError;
    expect(domain.code).toBe(code);
    return domain;
  }
  throw new Error(`esperaba ${code}`);
}
