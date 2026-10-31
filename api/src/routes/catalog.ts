import { Elysia } from 'elysia';
import { requestIdFor, requirePermission, sessionOf, type GuardDeps } from '../auth/guard';
import { createFormat, listFormats, updateFormat } from '../core/catalog/formats';
import {
  createFormatMaterial,
  deleteFormatMaterial,
  listFormatMaterials,
  updateFormatMaterial,
} from '../core/catalog/format-materials';
import {
  createPriceList,
  createVersion,
  listPriceLists,
  listVersions,
  quoteFromRequest,
  replaceItems,
  requestVersionActivation,
  updatePriceList,
} from '../core/catalog/pricing';
import {
  createProduct,
  exportProducts,
  getProduct,
  listProductPrices,
  listProducts,
  markGtinCurrent,
  updateProduct,
} from '../core/catalog/products';
import { createWine, listWines, updateWine } from '../core/catalog/wines';
import type { Actor } from '../core/db/writer';
import { domainError } from '../core/errors';

function actor(request: Request, reason: string): Actor {
  const user = sessionOf(request);
  return { type: 'user', id: user.id, requestId: requestIdFor(request), reason };
}

async function jsonBody(request: Request, allowEmpty = false): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim() === '') {
    if (allowEmpty) return {};
    throw domainError('WC_VALIDATION', { body: 'El cuerpo está vacío' });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw domainError('WC_VALIDATION', { body: 'Se esperaba un objeto' });
  }
  return parsed as Record<string, unknown>;
}

export function catalogRoutes(deps: GuardDeps) {
  const { writer } = deps;
  const read = requirePermission(deps, 'catalog.read');
  const write = requirePermission(deps, 'catalog.write');
  return new Elysia({ name: 'catalog' })
    .get('/v1/wines', ({ request }) => listWines(writer, request), { beforeHandle: read })
    .post('/v1/wines', async ({ request, set }) => {
      const created = await createWine(writer, actor(request, 'alta de vino'), await jsonBody(request));
      set.status = 201;
      return created;
    }, { beforeHandle: write })
    .patch('/v1/wines/:id', async ({ request, params }) => (
      updateWine(writer, actor(request, 'editar vino'), params.id, await jsonBody(request))
    ), { beforeHandle: write })
    .get('/v1/formats', ({ request }) => listFormats(writer, request), { beforeHandle: read })
    .post('/v1/formats', async ({ request, set }) => {
      const created = await createFormat(writer, actor(request, 'alta de formato'), await jsonBody(request));
      set.status = 201;
      return created;
    }, { beforeHandle: write })
    .patch('/v1/formats/:id', async ({ request, params }) => (
      updateFormat(writer, actor(request, 'editar formato'), params.id, await jsonBody(request))
    ), { beforeHandle: write })
    .get('/v1/formats/:id/materials', ({ params }) => listFormatMaterials(writer, params.id), { beforeHandle: read })
    .post('/v1/formats/:id/materials', async ({ request, params, set }) => {
      const created = await createFormatMaterial(
        writer,
        actor(request, 'alta de material de formato'),
        params.id,
        await jsonBody(request),
      );
      set.status = 201;
      return created;
    }, { beforeHandle: write })
    .patch('/v1/formats/:id/materials/:materialId', async ({ request, params }) => (
      updateFormatMaterial(
        writer,
        actor(request, 'editar material de formato'),
        params.id,
        params.materialId,
        await jsonBody(request),
      )
    ), { beforeHandle: write })
    .delete('/v1/formats/:id/materials/:materialId', ({ request, params }) => (
      deleteFormatMaterial(writer, actor(request, 'quitar material de formato'), params.id, params.materialId)
    ), { beforeHandle: write })
    .get('/v1/products', ({ request }) => listProducts(writer, request), { beforeHandle: read })
    .get('/v1/products/export.csv', ({ request }) => exportProducts(writer, request), { beforeHandle: read })
    .post('/v1/products', async ({ request, set }) => {
      const created = await createProduct(writer, actor(request, 'alta de producto'), await jsonBody(request));
      set.status = 201;
      return created;
    }, { beforeHandle: write })
    .get('/v1/products/:id/prices', ({ request, params }) => listProductPrices(writer, request, params.id), {
      beforeHandle: read,
    })
    .post('/v1/products/:id/gtin-current', async ({ request, params }) => (
      markGtinCurrent(writer, actor(request, 'gtin vigente'), params.id, await jsonBody(request, true))
    ), { beforeHandle: write })
    .get('/v1/products/:id', ({ params }) => getProduct(writer, params.id), { beforeHandle: read })
    .patch('/v1/products/:id', async ({ request, params }) => (
      updateProduct(writer, actor(request, 'editar producto'), request, params.id, await jsonBody(request))
    ), { beforeHandle: write })
    .get('/v1/price-lists', ({ request }) => listPriceLists(writer, request), { beforeHandle: read })
    .post('/v1/price-lists', async ({ request, set }) => {
      const created = await createPriceList(writer, actor(request, 'alta de tarifa'), await jsonBody(request));
      set.status = 201;
      return created;
    }, { beforeHandle: write })
    .patch('/v1/price-lists/:id', async ({ request, params }) => (
      updatePriceList(writer, actor(request, 'editar tarifa'), params.id, await jsonBody(request))
    ), { beforeHandle: write })
    .get('/v1/price-lists/:id/versions', ({ request, params }) => listVersions(writer, request, params.id), {
      beforeHandle: read,
    })
    .post('/v1/price-lists/:id/versions', async ({ request, params, set }) => {
      const created = await createVersion(
        writer,
        actor(request, 'nueva versión de tarifa'),
        params.id,
        await jsonBody(request),
      );
      set.status = 201;
      return created;
    }, { beforeHandle: write })
    .put('/v1/price-lists/:id/versions/:version/items', async ({ request, params }) => (
      replaceItems(
        writer,
        actor(request, 'precios de tarifa'),
        params.id,
        params.version,
        await jsonBody(request),
      )
    ), { beforeHandle: write })
    .post('/v1/price-lists/:id/versions/:version/request-activation', ({ request, params }) => (
      requestVersionActivation(writer, actor(request, 'pedir activación de tarifa'), params.id, params.version)
    ), { beforeHandle: write })
    .get('/v1/price-quote', ({ request }) => quoteFromRequest(writer, request), { beforeHandle: read });
}
