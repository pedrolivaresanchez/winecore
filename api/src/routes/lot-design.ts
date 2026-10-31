import { Elysia } from 'elysia';
import { requestIdFor, requireOwner, requirePermission, sessionOf, type GuardDeps } from '../auth/guard';
import { isUuid } from '../core/catalog/fields';
import type { Actor, Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import { readDesign, saveDesign } from '../core/lot-design/design';
import { compareLot } from '../core/lot-design/deviations';
import { applyRecipe, readLatestPlan } from '../core/lot-design/plan';
import {
  captureRecipe,
  listRecipeSummaries,
  openRecipeVersion,
  publishRecipe,
  readRecipe,
  updateRecipe,
} from '../core/lot-design/recipes';
import { parseVintageFilter, vintageCsvResponse, vintageReport } from '../core/lot-design/vintage';

function actor(request: Request, reason: string): Actor {
  const user = sessionOf(request);
  return { type: 'user', id: user.id, requestId: requestIdFor(request), reason };
}

function producerId(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get('producer_entity_id');
  if (raw == null || raw.trim() === '') return null;
  if (!isUuid(raw)) throw domainError('WC_VALIDATION', { producer_entity_id: 'Debe ser un UUID' });
  return raw.toLowerCase();
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

function versionNo(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get('version_no');
  if (raw == null || raw.trim() === '') return null;
  if (!/^\d{1,4}$/.test(raw)) throw domainError('WC_VALIDATION', { version_no: 'Versión no válida' });
  const parsed = Number(raw);
  if (parsed < 1) throw domainError('WC_VALIDATION', { version_no: 'Versión no válida' });
  return parsed;
}

export function lotDesignRoutes(deps: { writer: Writer; guard: GuardDeps }) {
  const { writer } = deps;
  const read = { beforeHandle: requirePermission(deps.guard, 'cellar.read') };
  const operate = { beforeHandle: requirePermission(deps.guard, 'cellar.operate') };
  const owner = { beforeHandle: requireOwner(deps.guard) };
  return new Elysia({ name: 'lot-design' })
    .get('/v1/vintage-comparison.csv', async ({ request }) => (
      vintageCsvResponse(await vintageReport(writer, parseVintageFilter(request)))
    ), read)
    .get('/v1/vintage-comparison', ({ request }) => vintageReport(writer, parseVintageFilter(request)), read)
    .get('/v1/recipes', ({ request }) => {
      const url = new URL(request.url);
      const limitRaw = url.searchParams.get('limit');
      return listRecipeSummaries(writer, {
        status: url.searchParams.get('status'),
        lot_id: url.searchParams.get('lot_id'),
        limit: limitRaw == null || limitRaw.trim() === '' ? undefined : Number(limitRaw),
      });
    }, read)
    .get('/v1/recipes/:id', ({ params }) => readRecipe(writer, params.id), read)
    .patch('/v1/recipes/:id', async ({ request, params }) => (
      updateRecipe(writer, actor(request, 'editar receta'), params.id, await jsonBody(request))
    ), operate)
    .post('/v1/recipes/:id/versions', async ({ request, params, set }) => {
      const created = await openRecipeVersion(writer, actor(request, 'nueva versión de receta'), params.id);
      set.status = 201;
      return created;
    }, operate)
    .post('/v1/recipes/:id/publish', ({ request, params }) => (
      publishRecipe(writer, actor(request, 'publicar receta'), params.id)
    ), owner)
    .get('/v1/lots/:code/design', ({ request, params }) => readDesign(writer, params.code, producerId(request)), read)
    .put('/v1/lots/:code/design', async ({ request, params }) => (
      saveDesign(
        writer,
        actor(request, 'diseño de lote'),
        params.code,
        producerId(request),
        await jsonBody(request),
      )
    ), operate)
    .post('/v1/lots/:code/recipe', async ({ request, params, set }) => {
      const created = await captureRecipe(
        writer,
        actor(request, 'capturar receta'),
        params.code,
        producerId(request),
        await jsonBody(request, true),
      );
      set.status = 201;
      return created;
    }, operate)
    .post('/v1/lots/:code/plan', async ({ request, params, set }) => {
      const body = await jsonBody(request);
      const version = body.version_no;
      const created = await applyRecipe(writer, actor(request, 'plan de receta'), {
        code: params.code,
        producer_entity_id: producerId(request),
        recipe_id: String(body.recipe_id ?? ''),
        version_no: typeof version === 'number' ? version : null,
        start_date: String(body.start_date ?? ''),
      });
      set.status = 201;
      return created;
    }, operate)
    .get('/v1/lots/:code/plan', ({ request, params }) => readLatestPlan(writer, params.code, producerId(request)), read)
    .get('/v1/lots/:code/deviations', ({ request, params }) => {
      const recipeId = new URL(request.url).searchParams.get('recipe_id') ?? '';
      if (!isUuid(recipeId)) throw domainError('WC_VALIDATION', { recipe_id: 'Debe ser un UUID' });
      return compareLot(writer, params.code, producerId(request), recipeId, versionNo(request));
    }, read);
}
