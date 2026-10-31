import { Elysia } from 'elysia';
import { requestIdFor, requirePermission, sessionOf, type GuardDeps } from '../auth/guard';
import { listMaterialStock, receiveMaterial } from '../core/catalog/material-stock';
import type { Actor } from '../core/db/writer';
import { readJsonObject } from '../core/catalog/fields';

function actor(request: Request, reason: string): Actor {
  const user = sessionOf(request);
  return { type: 'user', id: user.id, requestId: requestIdFor(request), reason };
}

export function materialRoutes(deps: GuardDeps) {
  return new Elysia({ name: 'materials' })
    .get('/v1/materials/stock', ({ request }) => listMaterialStock(deps.writer, request), {
      beforeHandle: requirePermission(deps, 'cellar.read'),
    })
    .post('/v1/materials/receipts', async ({ request, set }) => {
      const created = await receiveMaterial(
        deps.writer,
        actor(request, 'entrada de material de envasado'),
        await readJsonObject(request),
      );
      set.status = 201;
      return created;
    }, {
      beforeHandle: requirePermission(deps, 'cellar.operate'),
    });
}
