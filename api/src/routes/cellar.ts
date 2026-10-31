import { Elysia } from 'elysia';
import { requirePermission, type GuardDeps } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import {
  archiveLocationRoute,
  createLocationRoute,
  getLocationRoute,
  listLocationRoute,
  patchLocationRoute,
} from './locations';
import {
  getLotRoute,
  listLotRoute,
  lotAdditionsRoute,
  lotAnalysesRoute,
  lotMovesRoute,
  lotSalesRoute,
  lotTraceabilityRoute,
} from './cellar-lots';
import {
  confirmOperationRoute,
  createOperationRoute,
  getOperationRoute,
  listOperationRoute,
  previewOperationRoute,
  rectifyOperationRoute,
  updateOperationRoute,
} from './cellar-operations';
import {
  createVesselRoute,
  getVesselRoute,
  listVesselRoute,
  patchVesselRoute,
  resolveQrRoute,
  retireVesselRoute,
  vesselHistoryRoute,
  vesselQrRoute,
} from './cellar-vessels';

/** Bodega HTTP surface. Permissions: cellar.read, cellar.operate, cellar.manage. */
export function cellarRoutes(deps: { writer: Writer; guard: GuardDeps; publicUrl: string }) {
  const { writer, guard, publicUrl } = deps;
  const read = { beforeHandle: requirePermission(guard, 'cellar.read') };
  const operate = { beforeHandle: requirePermission(guard, 'cellar.operate') };
  const manage = { beforeHandle: requirePermission(guard, 'cellar.manage') };
  return new Elysia()
    .get('/v1/locations', ({ request }) => listLocationRoute(writer, request), read)
    .post('/v1/locations', async ({ request, set }) => {
      const created = await createLocationRoute(writer, request);
      set.status = 201;
      return created;
    }, manage)
    .get('/v1/locations/:code', ({ request, params }) => getLocationRoute(writer, request, params.code), read)
    .patch('/v1/locations/:code', ({ request, params }) => patchLocationRoute(writer, request, params.code), manage)
    .post('/v1/locations/:code/archive', ({ request, params }) => archiveLocationRoute(writer, request, params.code), manage)
    .get('/v1/vessels', ({ request }) => listVesselRoute(writer, request), read)
    .post('/v1/vessels', async ({ request, set }) => {
      const created = await createVesselRoute(writer, request);
      set.status = 201;
      return created;
    }, manage)
    .get('/v1/vessels/qr/:token', ({ request, params }) => resolveQrRoute(writer, request, params.token), read)
    .get('/v1/vessels/:code', ({ request, params }) => getVesselRoute(writer, request, params.code), read)
    .patch('/v1/vessels/:code', ({ request, params }) => patchVesselRoute(writer, request, params.code), manage)
    .post('/v1/vessels/:code/retire', ({ request, params }) => retireVesselRoute(writer, request, params.code), manage)
    .get('/v1/vessels/:code/qr', ({ request, params }) => vesselQrRoute(writer, request, params.code, publicUrl), read)
    .get('/v1/vessels/:code/history', ({ request, params }) => vesselHistoryRoute(writer, request, params.code), read)
    .get('/v1/lots', ({ request }) => listLotRoute(writer, request), read)
    .get('/v1/lots/:code/traceability', ({ request, params }) => lotTraceabilityRoute(writer, request, params.code), read)
    .get('/v1/lots/:code/moves', ({ request, params }) => lotMovesRoute(writer, request, params.code), read)
    .get('/v1/lots/:code/analyses', ({ request, params }) => lotAnalysesRoute(writer, request, params.code), read)
    .get('/v1/lots/:code/additions', ({ request, params }) => lotAdditionsRoute(writer, request, params.code), read)
    .get('/v1/lots/:code/sales', ({ request, params }) => lotSalesRoute(writer, request, params.code), read)
    .get('/v1/lots/:code', ({ request, params }) => getLotRoute(writer, request, params.code), read)
    .get('/v1/cellar-operations', ({ request }) => listOperationRoute(writer, request), read)
    .post('/v1/cellar-operations', async ({ request, set }) => {
      const created = await createOperationRoute(writer, request);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/cellar-operations/:id', ({ request, params }) => getOperationRoute(writer, request, params.id), read)
    .patch('/v1/cellar-operations/:id', ({ request, params }) => updateOperationRoute(writer, request, params.id), operate)
    .post('/v1/cellar-operations/:id/preview', ({ request, params }) => previewOperationRoute(writer, request, params.id), operate)
    .post('/v1/cellar-operations/:id/confirm', ({ request, params }) => confirmOperationRoute(writer, request, params.id), operate)
    .post('/v1/cellar-operations/:id/rectify', async ({ request, params, set }) => {
      const created = await rectifyOperationRoute(writer, request, params.id);
      set.status = 201;
      return created;
    }, operate);
}
