import { Elysia } from 'elysia';
import { requestIdFor, requirePermission, sessionOf, type GuardDeps } from '../auth/guard';
import { readJsonObject } from '../core/catalog/fields';
import type { Actor } from '../core/db/writer';
import { listCuePending, scanCueReminders } from '../core/vineyard-notebook/cue';
import { exportCue } from '../core/vineyard-notebook/export-load';
import { createOperation, listOperations } from '../core/vineyard-notebook/operations';
import {
  createNotebookProduct,
  getNotebookProduct,
  listNotebookProducts,
  updateNotebookProduct,
} from '../core/vineyard-notebook/products';
import {
  asOfDate,
  createTreatments,
  getTreatment,
  listTreatments,
  updateTreatment,
} from '../core/vineyard-notebook/treatments';

function actor(request: Request, reason: string): Actor {
  const user = sessionOf(request);
  return { type: 'user', id: user.id, requestId: requestIdFor(request), reason };
}

/** Cuaderno de explotación. Exporta CSV para el agricultor y no presenta nada. */
export function vineyardNotebookRoutes(deps: GuardDeps) {
  const { writer } = deps;
  const now = () => (deps.now ?? (() => new Date()))();
  const read = requirePermission(deps, 'vineyard.read');
  const write = requirePermission(deps, 'vineyard.write');
  return new Elysia({ name: 'vineyard-notebook' })
    .get('/v1/vineyard-notebook/products', ({ request }) => listNotebookProducts(writer, request), { beforeHandle: read })
    .post('/v1/vineyard-notebook/products', async ({ request, set }) => {
      const created = await createNotebookProduct(writer, actor(request, 'alta de producto del cuaderno'), await readJsonObject(request));
      set.status = 201;
      return created;
    }, { beforeHandle: write })
    .get('/v1/vineyard-notebook/products/:id', ({ params }) => getNotebookProduct(writer, params.id), { beforeHandle: read })
    .patch('/v1/vineyard-notebook/products/:id', async ({ request, params }) => (
      updateNotebookProduct(writer, actor(request, 'editar producto del cuaderno'), params.id, await readJsonObject(request))
    ), { beforeHandle: write })
    .get('/v1/vineyard-notebook/operations', ({ request }) => listOperations(writer, request), { beforeHandle: read })
    .post('/v1/vineyard-notebook/operations', async ({ request, set }) => {
      const created = await createOperation(writer, actor(request, 'alta de labor del cuaderno'), await readJsonObject(request));
      set.status = 201;
      return created;
    }, { beforeHandle: write })
    .get('/v1/vineyard-notebook/cue-pending', ({ request }) => listCuePending(writer, asOfDate(request, now())), {
      beforeHandle: read,
    })
    .post('/v1/vineyard-notebook/cue-reminders', ({ request }) => (
      scanCueReminders(writer, actor(request, 'aviso de anotación en el CUE'), now())
    ), { beforeHandle: write })
    .get('/v1/treatments/export', ({ request }) => exportCue(writer, request, asOfDate(request, now())), { beforeHandle: read })
    .get('/v1/treatments', ({ request }) => listTreatments(writer, request, asOfDate(request, now())), { beforeHandle: read })
    .post('/v1/treatments', async ({ request, set }) => {
      const created = await createTreatments(writer, actor(request, 'alta de tratamiento'), await readJsonObject(request), now());
      set.status = 201;
      return created;
    }, { beforeHandle: write })
    .get('/v1/treatments/:id', ({ request, params }) => getTreatment(writer, params.id, asOfDate(request, now())), {
      beforeHandle: read,
    })
    .patch('/v1/treatments/:id', async ({ request, params }) => (
      updateTreatment(writer, actor(request, 'completar tratamiento'), params.id, await readJsonObject(request), asOfDate(request, now()))
    ), { beforeHandle: write });
}
