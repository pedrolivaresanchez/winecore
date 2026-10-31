import { Elysia } from 'elysia';
import { requireOwner, requirePermission, type GuardDeps } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import {
  createBarrel,
  getBarrel,
  getCapacity,
  getDemijohn,
  patchBarrel,
  recordCapacity,
  upsertDemijohn,
} from '../core/cellar-assets/barrels';
import { addHolderCountLine } from '../core/cellar-assets/holder-counts';
import { createHolder, getHolder, listHolderMoves, listHolderStock, listHolders, patchHolder, postHolderMove } from '../core/cellar-assets/holders';
import { backfillBarrelUseCounts } from '../core/cellar-assets/use-count-backfill';
import { getCellarMap } from '../core/cellar-assets/map';
import { getPlanCard } from '../core/cellar-assets/plan-card';
import { createPosition, createZone, deletePosition, getZone, listZones, patchPosition, patchZone } from '../core/cellar-assets/zones';

/** Zonas, plano, barricas, damajuanas, nichos y jaulones. cellar.read / cellar.operate. */
export function cellarAssetRoutes(deps: { writer: Writer; guard: GuardDeps }) {
  const { writer, guard } = deps;
  const read = { beforeHandle: requirePermission(guard, 'cellar.read') };
  const operate = { beforeHandle: requirePermission(guard, 'cellar.operate') };
  const owner = { beforeHandle: requireOwner(guard) };
  return new Elysia()
    .get('/v1/cellar-map', ({ request }) => getCellarMap(writer, request), read)
    .get('/v1/cellar-zones', ({ request }) => listZones(writer, request), read)
    .post('/v1/cellar-zones', async ({ request, set }) => {
      const created = await createZone(writer, request);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/cellar-zones/:code', ({ request, params }) => getZone(writer, request, params.code), read)
    .patch('/v1/cellar-zones/:code', ({ request, params }) => patchZone(writer, request, params.code), operate)
    .post('/v1/cellar-zones/:code/positions', async ({ request, params, set }) => {
      const created = await createPosition(writer, request, params.code);
      set.status = 201;
      return created;
    }, operate)
    .patch('/v1/cellar-zones/:code/positions/:positionId', ({ request, params }) => patchPosition(writer, request, params.code, params.positionId), operate)
    .delete('/v1/cellar-zones/:code/positions/:positionId', ({ request, params }) => deletePosition(writer, request, params.code, params.positionId), operate)
    .get('/v1/vessels/:code/plan-card', ({ request, params }) => getPlanCard(writer, request, params.code), read)
    .get('/v1/holder-stock', ({ request }) => listHolderStock(writer, request), read)
    .get('/v1/holders', ({ request }) => listHolders(writer, request), read)
    .post('/v1/holders', async ({ request, set }) => {
      const created = await createHolder(writer, request);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/holders/:code', ({ request, params }) => getHolder(writer, request, params.code), read)
    .patch('/v1/holders/:code', ({ request, params }) => patchHolder(writer, request, params.code), operate)
    .get('/v1/holders/:code/moves', ({ request, params }) => listHolderMoves(writer, request, params.code), read)
    .post('/v1/holders/:code/moves', async ({ request, params, set }) => {
      const moved = await postHolderMove(writer, request, params.code);
      set.status = 201;
      return moved;
    }, operate)
    .get('/v1/vessels/:code/barrel', ({ request, params }) => getBarrel(writer, request, params.code), read)
    .post('/v1/vessels/:code/barrel', async ({ request, params, set }) => {
      const created = await createBarrel(writer, request, params.code);
      set.status = 201;
      return created;
    }, operate)
    .patch('/v1/vessels/:code/barrel', ({ request, params }) => patchBarrel(writer, request, params.code), operate)
    .get('/v1/vessels/:code/demijohn', ({ request, params }) => getDemijohn(writer, request, params.code), read)
    .put('/v1/vessels/:code/demijohn', ({ request, params }) => upsertDemijohn(writer, request, params.code), operate)
    .get('/v1/vessels/:code/capacity', ({ request, params }) => getCapacity(writer, request, params.code), read)
    .post('/v1/vessels/:code/capacity', async ({ request, params, set }) => {
      const recorded = await recordCapacity(writer, request, params.code);
      set.status = 201;
      return recorded;
    }, operate)
    .post('/v1/barrels/use-count-backfill', ({ request }) => backfillBarrelUseCounts(writer, request), owner)
    .post('/v1/inventory-counts/:id/holder-lines', async ({ request, params, set }) => {
      const created = await addHolderCountLine(writer, request, params.id);
      set.status = 201;
      return created;
    }, operate);
}
