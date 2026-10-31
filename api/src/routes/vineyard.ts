import { Elysia } from 'elysia';
import { requestIdFor, requirePermission, sessionOf, type GuardDeps } from '../auth/guard';
import { domainError } from '../core/errors';
import {
  closeHarvest,
  createFieldTask,
  createHarvest,
  createMaturityCheck,
  harvestSummary,
  listFieldTasks,
  listHarvests,
  listMaturityChecks,
} from '../core/vineyard/fieldwork';
import { createParcel, getParcel, listParcels, updateParcel } from '../core/vineyard/parcels';
import {
  confirmReception,
  createReception,
  getReception,
  listReceptions,
  previewReception,
  rectifyReception,
  updateReception,
} from '../core/vineyard/reception';
import { createVariety, listVarieties, requireVariety, updateVariety } from '../core/vineyard/varieties';

function campaignOf(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get('campaign');
  if (raw === null || raw.trim() === '') return null;
  if (!/^\d{4}$/.test(raw)) throw domainError('WC_VALIDATION', { campaign: 'La campaña es un año' });
  const year = Number(raw);
  if (year < 1990 || year > 2100) throw domainError('WC_VALIDATION', { campaign: 'La campaña está entre 1990 y 2100' });
  return year;
}

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.trim() === '') throw domainError('WC_VALIDATION', { body: 'El cuerpo está vacío' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw domainError('WC_VALIDATION', { body: 'El JSON no es válido' });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  return parsed as Record<string, unknown>;
}

function actor(request: Request, reason: string) {
  const user = sessionOf(request);
  return { type: 'user' as const, id: user.id, requestId: requestIdFor(request), reason };
}

/** Viñedo: parcelas, labores, maduración, vendimia y entrada de uva. */
export function vineyardRoutes(guard: GuardDeps) {
  const { writer } = guard;
  const read = { beforeHandle: requirePermission(guard, 'vineyard.read') };
  const write = { beforeHandle: requirePermission(guard, 'vineyard.write') };
  return new Elysia({ name: 'vineyard' })
    .get('/v1/grape-varieties', () => listVarieties(writer), read)
    .post('/v1/grape-varieties', async ({ request, set }) => {
      const created = await createVariety(writer, actor(request, 'alta de variedad'), await bodyOf(request));
      set.status = 201;
      return created;
    }, write)
    .get('/v1/grape-varieties/:code', ({ params }) => requireVariety(writer, params.code), read)
    .patch('/v1/grape-varieties/:code', async ({ request, params }) => (
      updateVariety(writer, actor(request, 'editar variedad'), params.code, await bodyOf(request))
    ), write)
    .get('/v1/parcels', () => listParcels(writer), read)
    .post('/v1/parcels', async ({ request, set }) => {
      const created = await createParcel(writer, actor(request, 'alta de parcela'), await bodyOf(request));
      set.status = 201;
      return created;
    }, write)
    .get('/v1/parcels/:code', ({ params }) => getParcel(writer, params.code), read)
    .patch('/v1/parcels/:code', async ({ request, params }) => (
      updateParcel(writer, actor(request, 'editar parcela'), params.code, await bodyOf(request))
    ), write)
    .get('/v1/field-tasks', ({ request }) => listFieldTasks(writer, new URL(request.url).searchParams.get('parcel_code')), read)
    .post('/v1/field-tasks', async ({ request, set }) => {
      const created = await createFieldTask(writer, actor(request, 'alta de labor'), await bodyOf(request));
      set.status = 201;
      return created;
    }, write)
    .get('/v1/maturity-checks', ({ request }) => listMaturityChecks(writer, new URL(request.url).searchParams.get('parcel_code')), read)
    .post('/v1/maturity-checks', async ({ request, set }) => {
      const created = await createMaturityCheck(
        writer,
        actor(request, 'control de maduración'),
        await bodyOf(request),
        sessionOf(request).displayName || 'operario',
      );
      set.status = 201;
      return created;
    }, write)
    .get('/v1/harvests/summary', ({ request }) => {
      const campaign = campaignOf(request);
      if (campaign === null) throw domainError('WC_VALIDATION', { campaign: 'La campaña es obligatoria' });
      return harvestSummary(writer, campaign);
    }, read)
    .get('/v1/harvests', ({ request }) => listHarvests(writer, campaignOf(request)), read)
    .post('/v1/harvests', async ({ request, set }) => {
      const created = await createHarvest(writer, actor(request, 'plan de vendimia'), await bodyOf(request));
      set.status = 201;
      return created;
    }, write)
    .post('/v1/harvests/:id/close', async ({ request, params }) => (
      closeHarvest(writer, actor(request, 'cierre de vendimia'), params.id, await bodyOf(request))
    ), write)
    .get('/v1/grape-receptions', () => listReceptions(writer), read)
    .post('/v1/grape-receptions', async ({ request, set }) => {
      const created = await createReception(writer, request);
      set.status = 201;
      return created;
    }, write)
    .get('/v1/grape-receptions/:id', ({ params }) => getReception(writer, params.id), read)
    .patch('/v1/grape-receptions/:id', ({ request, params }) => updateReception(writer, request, params.id), write)
    .post('/v1/grape-receptions/:id/preview', ({ request, params }) => previewReception(writer, request, params.id), write)
    .post('/v1/grape-receptions/:id/confirm', ({ request, params }) => confirmReception(writer, request, params.id), write)
    .post('/v1/grape-receptions/:id/rectify', async ({ request, params, set }) => {
      const created = await rectifyReception(writer, request, params.id);
      set.status = 201;
      return created;
    }, write);
}
