import { Elysia } from 'elysia';
import { requireOwner, requirePermission, type GuardDeps } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { putBottlingCheck, getBottlingCheck } from '../core/hygiene/checklist';
import { createCleaningLog } from '../core/hygiene/cleaning';
import {
  addMaintenance,
  createEquipment,
  getEquipment,
  linkOperationEquipment,
  listEquipment,
  updateEquipment,
} from '../core/hygiene/equipment';
import { appccCsv, buildAppccReport } from '../core/hygiene/export';
import { createFiltration } from '../core/hygiene/filtration';
import { getHygienePolicy, putHygienePolicy } from '../core/hygiene/policy';
import { createProcedure, getProcedure, listProcedures, updateProcedure } from '../core/hygiene/procedures';
import { createReceipt, listConsumables, registerConsumable } from '../core/hygiene/stock';
import {
  listBottlingChecks,
  listCleaningLogs,
  listConsumableBalances,
  listEquipmentLinks,
  listFiltrations,
  listMaintenance,
  listReceipts,
} from '../core/hygiene/lists';

/** Higiene, APPCC y control de envasado. Lectura cellar.read, operación cellar.operate, procedimientos owner. */
export function hygieneRoutes(deps: { writer: Writer; guard: GuardDeps }) {
  const { writer, guard } = deps;
  const read = { beforeHandle: requirePermission(guard, 'cellar.read') };
  const operate = { beforeHandle: requirePermission(guard, 'cellar.operate') };
  const owner = { beforeHandle: requireOwner(guard) };
  return new Elysia()
    .get('/v1/hygiene/policy', () => getHygienePolicy(writer), read)
    .put('/v1/hygiene/policy', ({ request }) => putHygienePolicy(writer, request), owner)
    .get('/v1/hygiene/appcc', async ({ request }) => {
      const report = await buildAppccReport(writer, request);
      const format = new URL(request.url).searchParams.get('format');
      if (format === 'csv') {
        return new Response(Buffer.from(appccCsv(report), 'utf8'), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="appcc.csv"',
          },
        });
      }
      return report;
    }, read)
    .get('/v1/hygiene/procedures', ({ request }) => listProcedures(writer, request), read)
    .post('/v1/hygiene/procedures', async ({ request, set }) => {
      const created = await createProcedure(writer, request);
      set.status = 201;
      return created;
    }, owner)
    .get('/v1/hygiene/procedures/:id', ({ params }) => getProcedure(writer, params.id), read)
    .patch('/v1/hygiene/procedures/:id', ({ request, params }) => updateProcedure(writer, request, params.id), owner)
    .get('/v1/hygiene/equipment', () => listEquipment(writer), read)
    .post('/v1/hygiene/equipment', async ({ request, set }) => {
      const created = await createEquipment(writer, request);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/hygiene/equipment/:id', ({ params }) => getEquipment(writer, params.id), read)
    .patch('/v1/hygiene/equipment/:id', ({ request, params }) => updateEquipment(writer, request, params.id), operate)
    .post('/v1/hygiene/equipment/:id/maintenance', async ({ request, params, set }) => {
      const created = await addMaintenance(writer, request, params.id);
      set.status = 201;
      return created;
    }, operate)
    .post('/v1/hygiene/operations/:operationId/equipment', async ({ request, params, set }) => {
      const created = await linkOperationEquipment(writer, request, params.operationId);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/hygiene/consumables', () => listConsumables(writer), read)
    .post('/v1/hygiene/consumables', async ({ request, set }) => {
      const created = await registerConsumable(writer, request);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/hygiene/consumable-balances', ({ request }) => listConsumableBalances(writer, request), read)
    .get('/v1/hygiene/consumable-receipts', ({ request }) => listReceipts(writer, request), read)
    .post('/v1/hygiene/consumable-receipts', async ({ request, set }) => {
      const created = await createReceipt(writer, request);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/hygiene/cleaning-logs', ({ request }) => listCleaningLogs(writer, request), read)
    .post('/v1/hygiene/cleaning-logs', async ({ request, set }) => {
      const created = await createCleaningLog(writer, request);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/hygiene/filtrations', ({ request }) => listFiltrations(writer, request), read)
    .post('/v1/hygiene/filtrations', async ({ request, set }) => {
      const created = await createFiltration(writer, request);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/hygiene/bottling-checks', ({ request }) => listBottlingChecks(writer, request), read)
    .get('/v1/hygiene/maintenance', ({ request }) => listMaintenance(writer, request), read)
    .get('/v1/hygiene/equipment-links', ({ request }) => listEquipmentLinks(writer, request), read)
    .get('/v1/hygiene/bottling-checks/:operationId', ({ params }) => getBottlingCheck(writer, params.operationId), read)
    .put('/v1/hygiene/bottling-checks/:operationId', ({ request, params }) => putBottlingCheck(writer, request, params.operationId), operate);
}
