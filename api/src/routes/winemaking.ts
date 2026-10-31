import { Elysia } from 'elysia';
import { requirePermission, type GuardDeps } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { endPhase, listPhases, startPhase, stopPhase } from '../core/winemaking/phases';
import {
  createAnalysis,
  createParcelAnalysis,
  createReading,
  createTasting,
  fermentationCurve,
  latestAnalysis,
  listReadings,
  listTastings,
  lotEvolution,
  runFermentationAlerts,
} from '../core/winemaking/service';

/** Elaboración: lecturas, analíticas, catas y el barrido de alertas. */
export function winemakingRoutes(deps: { writer: Writer; guard: GuardDeps }) {
  const { writer, guard } = deps;
  const read = { beforeHandle: requirePermission(guard, 'cellar.read') };
  const operate = { beforeHandle: requirePermission(guard, 'cellar.operate') };
  return new Elysia()
    .get('/v1/fermentation-readings', ({ request }) => listReadings(writer, request), read)
    .post('/v1/fermentation-readings', async ({ request, set }) => {
      const created = await createReading(writer, request);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/lots/:code/fermentation-curve', ({ request, params }) => fermentationCurve(writer, request, params.code), read)
    .get('/v1/lots/:code/evolution', ({ request, params }) => lotEvolution(writer, request, params.code), read)
    .get('/v1/lots/:code/phases', ({ request, params }) => listPhases(writer, request, params.code), read)
    .post('/v1/lots/:code/phases', async ({ request, params, set }) => {
      const created = await startPhase(writer, request, params.code);
      set.status = 201;
      return created;
    }, operate)
    .post('/v1/lots/:code/phases/:id/end', ({ request, params }) => endPhase(writer, request, params.code, params.id), operate)
    .post('/v1/lots/:code/phases/:id/stop', ({ request, params }) => stopPhase(writer, request, params.code, params.id), operate)
    .post('/v1/lots/:code/analyses', async ({ request, params, set }) => {
      const created = await createAnalysis(writer, request, params.code);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/lots/:code/analyses/latest', ({ request, params }) => latestAnalysis(writer, request, params.code), read)
    .post('/v1/lots/:code/tastings', async ({ request, params, set }) => {
      const created = await createTasting(writer, request, params.code);
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/lots/:code/tastings', ({ request, params }) => listTastings(writer, request, params.code), read)
    .post('/v1/parcels/:code/analyses', async ({ request, params, set }) => {
      const created = await createParcelAnalysis(writer, request, params.code);
      set.status = 201;
      return created;
    }, operate)
    .post('/v1/winemaking/fermentation-alerts/run', () => runFermentationAlerts(writer), operate);
}
