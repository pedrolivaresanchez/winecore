import { describe, expect, it } from 'bun:test';
import { openApprovalService } from '../../src/core/approvals/sql-store';
import { executeTariffActivation } from '../../src/core/catalog/pricing';
import { sql } from '../../src/core/db/sql';
import type { Writer } from '../../src/core/db/writer';
import { DomainError } from '../../src/core/errors';
import { postInventoryCount } from '../../src/core/inventory/service/counts.service';
import { gs1CheckDigit } from '../../src/core/shared/gs1';
import { call as cellarCall, counts, entityId, seedHolding, seedWarehouse } from '../cellar-api/fixtures';
import { createTestApp } from '../helpers';
import { call as stockCall, jsonOf, seedCellar } from '../stock-api/fixture';

async function ownerId(writer: Writer): Promise<string> {
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.app_user WHERE email = 'owner@winecore.test'
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error('falta el propietario');
  return id;
}

async function approveSubject(writer: Writer, userId: string, subjectId: string): Promise<string> {
  const rows = await writer.read<{ id: string; payload_sha256: string }>(sql`
    SELECT id::VARCHAR AS id, payload_sha256
    FROM ops.approval_request
    WHERE subject_id = CAST(${subjectId} AS UUID)
    ORDER BY requested_at DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw new Error('falta la solicitud');
  const service = await openApprovalService(writer, { type: 'user', id: userId, requestId: `approve-${subjectId}` });
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
  return row.id;
}

async function approvalStatus(writer: Writer, id: string): Promise<string> {
  const rows = await writer.read<{ status: string }>(sql`
    SELECT status FROM ops.approval_request WHERE id = CAST(${id} AS UUID)
  `);
  return rows[0]?.status ?? '';
}

describe('aprobaciones enlazadas', () => {
  it('bodega: el borrador de destrucción abre cellar_loss y confirmar lo consume', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const warehouse = await seedWarehouse(ctx, po);
      const location = await cellarCall(ctx, 'POST', '/v1/locations', {
        code: 'BOD-APR',
        name: 'Bodega',
        kind: 'cellar',
        controlling_entity_id: po,
        tax_warehouse_id: warehouse,
      });
      const tank = await cellarCall(ctx, 'POST', '/v1/vessels', {
        code: 'APR-T1',
        name: 'Depósito',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: String(location.body.id),
        zone: 'Nave',
      });
      const lotId = await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId: String(location.body.id),
        vesselId: String(tank.body.id),
        code: 'APR-L1',
        volumeMl: 1_000_000,
      });
      const draft = await cellarCall(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'destruction',
        legal_entity_id: po,
        occurred_at: '2026-06-15T08:00:00Z',
        fiscal_date: '2026-06-15',
        performed_by: 'Operario sintético',
        reason: 'producto defectuoso',
        lines: [{
          role: 'loss',
          lot_id: lotId,
          vessel_id: String(tank.body.id),
          volume_ml: 1_000,
          loss_kind: 'incident',
          product_state: 'wine',
        }],
      });
      expect(draft.status).toBe(201);
      const operationId = String(draft.body.id);
      const linked = await ctx.writer.read<{ approval_request_id: string; kind: string; status: string; payload_sha256: string }>(sql`
        SELECT o.approval_request_id::VARCHAR AS approval_request_id, r.kind, r.status, r.payload_sha256
        FROM cellar.operation o
        JOIN ops.approval_request r ON r.id = o.approval_request_id
        WHERE o.id = CAST(${operationId} AS UUID)
      `);
      expect(linked[0]?.kind).toBe('cellar_loss');
      expect(linked[0]?.status).toBe('pending');
      expect(linked[0]?.payload_sha256).toMatch(/^[0-9a-f]{64}$/);

      const before = await counts(ctx);
      const blocked = await cellarCall(ctx, 'POST', `/v1/cellar-operations/${operationId}/confirm`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('WC_NOT_APPROVED');
      expect(await counts(ctx)).toEqual(before);

      const owner = await ownerId(ctx.writer);
      const requestId = await approveSubject(ctx.writer, owner, operationId);
      const confirmed = await cellarCall(ctx, 'POST', `/v1/cellar-operations/${operationId}/confirm`);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe('confirmed');
      expect(String(confirmed.body.number)).toMatch(/^OB26-/);
      expect(await approvalStatus(ctx.writer, requestId)).toBe('consumed');
    } finally {
      await ctx.close();
    }
  });

  it('bodega: confirmar con otro contenido responde WC040', async () => {
    const ctx = await createTestApp();
    try {
      const po = await entityId(ctx);
      const warehouse = await seedWarehouse(ctx, po);
      const location = await cellarCall(ctx, 'POST', '/v1/locations', {
        code: 'BOD-H',
        name: 'Bodega',
        kind: 'cellar',
        controlling_entity_id: po,
        tax_warehouse_id: warehouse,
      });
      const tank = await cellarCall(ctx, 'POST', '/v1/vessels', {
        code: 'H-T1',
        name: 'Depósito',
        kind: 'tank_storage',
        capacity_ml: 8_000_000,
        material: 'stainless_steel',
        location_id: String(location.body.id),
        zone: 'Nave',
      });
      const lotId = await seedHolding(ctx, {
        entityId: po,
        warehouseId: warehouse,
        locationId: String(location.body.id),
        vesselId: String(tank.body.id),
        code: 'H-L1',
        volumeMl: 1_000_000,
      });
      const draft = await cellarCall(ctx, 'POST', '/v1/cellar-operations', {
        op_type: 'destruction',
        legal_entity_id: po,
        occurred_at: '2026-06-15T08:00:00Z',
        fiscal_date: '2026-06-15',
        performed_by: 'Operario sintético',
        reason: 'producto defectuoso',
        lines: [{
          role: 'loss',
          lot_id: lotId,
          vessel_id: String(tank.body.id),
          volume_ml: 1_000,
          loss_kind: 'incident',
          product_state: 'wine',
        }],
      });
      const operationId = String(draft.body.id);
      const owner = await ownerId(ctx.writer);
      await approveSubject(ctx.writer, owner, operationId);
      await ctx.writer.withWrite({ type: 'system', id: 'hash', requestId: 'hash' }, async (tx) => {
        tx.write(sql`
          UPDATE cellar.operation
          SET details = json_merge_patch(details, '{"lines":[{"volume_ml":2000}]}')
          WHERE id = CAST(${operationId} AS UUID)
        `);
      });
      const before = await counts(ctx);
      const changed = await cellarCall(ctx, 'POST', `/v1/cellar-operations/${operationId}/confirm`);
      expect(changed.status).toBe(409);
      expect(changed.body.code).toBe('WC040');
      expect(await counts(ctx)).toEqual(before);
    } finally {
      await ctx.close();
    }
  });

  it('catálogo: pedir activación abre tariff_activation y el consumo activa la versión', async () => {
    const ctx = await createTestApp();
    try {
      const wine = await cellarCall(ctx, 'POST', '/v1/wines', {
        code: 'APRW',
        name: 'Tinto Aprobación',
        color: 'red',
        is_organic: false,
      });
      expect(wine.status).toBe(201);
      const format = await cellarCall(ctx, 'POST', '/v1/formats', {
        code: 'APRF075',
        name: '0,75',
        container: 'bottle',
        nominal_volume_ml: 750,
      });
      expect(format.status).toBe(201);
      const body = '841234567890';
      const product = await cellarCall(ctx, 'POST', '/v1/products', {
        sku: 'APR075',
        name: 'Tinto Aprobación 2025',
        kind: 'wine',
        wine_id: wine.body.id,
        vintage: 2025,
        format_id: format.body.id,
        alcohol_pct: '13.00',
        gtin: `${body}${gs1CheckDigit(body)}`,
      });
      expect(product.status).toBe(201);
      const list = await cellarCall(ctx, 'POST', '/v1/price-lists', {
        code: 'custom-aprobacion',
        name: 'Aprobación',
        currency: 'EUR',
      });
      expect(list.status).toBe(201);
      const listId = String(list.body.id);
      const version = await cellarCall(ctx, 'POST', `/v1/price-lists/${listId}/versions`, {
        valid_from: '2026-03-01',
      });
      expect(version.status).toBe(201);
      const versionId = String(version.body.id);
      const prices = await cellarCall(ctx, 'PUT', `/v1/price-lists/${listId}/versions/1/items`, {
        items: [{ product_id: product.body.id, min_qty: '1', unit_price: '8.5000' }],
      });
      expect(prices.status).toBe(200);

      const asked = await cellarCall(ctx, 'POST', `/v1/price-lists/${listId}/versions/1/request-activation`);
      expect(asked.status).toBe(200);
      expect(asked.body.status).toBe('pending');
      const requestId = String(asked.body.approval_request_id);
      const kind = await ctx.writer.read<{ kind: string; status: string }>(sql`
        SELECT kind, status FROM ops.approval_request WHERE id = CAST(${requestId} AS UUID)
      `);
      expect(kind[0]?.kind).toBe('tariff_activation');
      const still = await ctx.writer.read<{ status: string }>(sql`
        SELECT status FROM catalog.price_list_version WHERE id = CAST(${versionId} AS UUID)
      `);
      expect(still[0]?.status).toBe('draft');

      const owner = await ownerId(ctx.writer);
      await approveSubject(ctx.writer, owner, versionId);
      const actor = { type: 'user' as const, id: owner, requestId: 'activar-tarifa' };
      const activated = await executeTariffActivation(ctx.writer, actor, listId, '1');
      expect(activated.status).toBe('active');
      expect(await approvalStatus(ctx.writer, requestId)).toBe('consumed');
      const row = await ctx.writer.read<{ status: string }>(sql`
        SELECT status FROM catalog.price_list_version WHERE id = CAST(${versionId} AS UUID)
      `);
      expect(row[0]?.status).toBe('active');

      const next = await cellarCall(ctx, 'POST', `/v1/price-lists/${listId}/versions`, {
        valid_from: '2026-09-01',
      });
      expect(next.status).toBe(201);
      await cellarCall(ctx, 'PUT', `/v1/price-lists/${listId}/versions/2/items`, {
        items: [{ product_id: product.body.id, min_qty: '1', unit_price: '9.0000' }],
      });
      const second = await cellarCall(ctx, 'POST', `/v1/price-lists/${listId}/versions/2/request-activation`);
      expect(second.status).toBe(200);
      await approveSubject(ctx.writer, owner, String(next.body.id));
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          UPDATE catalog.price_list_item
          SET unit_price = 9.5000
          WHERE version_id = CAST(${String(next.body.id)} AS UUID)
        `);
      });
      let code = '';
      try {
        await executeTariffActivation(ctx.writer, { ...actor, requestId: 'activar-2' }, listId, '2');
      } catch (error) {
        code = error instanceof DomainError ? error.code : '';
      }
      expect(code).toBe('WC040');
      const draft = await ctx.writer.read<{ status: string }>(sql`
        SELECT status FROM catalog.price_list_version WHERE id = CAST(${String(next.body.id)} AS UUID)
      `);
      expect(draft[0]?.status).toBe('draft');
    } finally {
      await ctx.close();
    }
  });

  it('existencias: post-request liga el hash del plan y contabilizar falla con WC040 si cambia', async () => {
    const ctx = await createTestApp();
    try {
      const cellar = await seedCellar(ctx.client);
      const owner = cellar.ownerUser;
      const opening = await jsonOf<{ id: string }>(await ctx.app.handle(stockCall('POST', '/v1/inventory-counts', {
        legal_entity_id: cellar.po,
        kind: 'opening',
        counted_at: '2026-12-31T18:00:00+01:00',
        location_ids: [cellar.bod],
      })));
      const lineId = '019a1000-0000-7000-8000-0000000000aa';
      await ctx.app.handle(stockCall('PUT', `/v1/inventory-counts/${opening.id}/lines`, {
        lines: [{
          id: lineId,
          location_id: cellar.bod,
          vessel_id: cellar.tankPo,
          owner_entity_id: cellar.po,
          lot_id: cellar.lotPo,
          product_id: null,
          product_state: 'wine',
          counted_qty_units: 0,
          counted_volume_ml: 10_000,
          method: 'dipstick',
        }],
      }));
      expect((await ctx.app.handle(stockCall('POST', `/v1/inventory-counts/${opening.id}/close`))).status).toBe(200);
      const submitted = await jsonOf<{ approval_status: string }>(await ctx.app.handle(
        stockCall('POST', `/v1/inventory-counts/${opening.id}/post-request`),
      ));
      expect(submitted.approval_status).toBe('pending');
      const linked = await ctx.writer.read<{ kind: string; payload_sha256: string }>(sql`
        SELECT r.kind, r.payload_sha256
        FROM inventory.inventory_count c
        JOIN ops.approval_request r ON r.id = c.approval_request_id
        WHERE c.id = CAST(${opening.id} AS UUID)
      `);
      expect(linked[0]?.kind).toBe('inventory_adjustment');
      expect(linked[0]?.payload_sha256).toMatch(/^[0-9a-f]{64}$/);

      const actor = { type: 'user' as const, id: owner, requestId: 'post-hash' };
      await ctx.client.query(sql`
        UPDATE inventory.inventory_count_line
        SET counted_volume_ml = 11_000
        WHERE id = CAST(${lineId} AS UUID)
      `);
      let changed = '';
      try {
        await postInventoryCount(ctx.writer, actor, opening.id);
      } catch (error) {
        changed = error instanceof DomainError ? error.code : '';
      }
      expect(changed).toBe('WC040');
      const moves = await ctx.writer.read<{ total: number }>(sql`
        SELECT count(*)::INTEGER AS total FROM inventory.stock_move WHERE source_id = CAST(${opening.id} AS UUID)
      `);
      expect(Number(moves[0]?.total ?? 0)).toBe(0);

      await ctx.client.query(sql`
        UPDATE inventory.inventory_count_line
        SET counted_volume_ml = 10_000
        WHERE id = CAST(${lineId} AS UUID)
      `);
      await approveSubject(ctx.writer, owner, opening.id);
      const posted = await postInventoryCount(ctx.writer, { ...actor, requestId: 'post-ok' }, opening.id);
      expect(posted.status).toBe('posted');
      const status = await ctx.writer.read<{ status: string }>(sql`
        SELECT r.status
        FROM inventory.inventory_count c
        JOIN ops.approval_request r ON r.id = c.approval_request_id
        WHERE c.id = CAST(${opening.id} AS UUID)
      `);
      expect(status[0]?.status).toBe('consumed');
    } finally {
      await ctx.close();
    }
  });
});
