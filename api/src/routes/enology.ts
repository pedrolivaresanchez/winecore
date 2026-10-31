import { Elysia } from 'elysia';
import { requestIdFor, requireOwner, requirePermission, sessionOf, type GuardDeps } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import { runBlend, runChecks, runCold, runProbableAlcohol, runSo2 } from '../core/enology/service';
import { readSettings, writeSettings } from '../core/enology/settings';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enología: calculadoras (cellar.read), comprobaciones y ajustes del propietario. */
export function enologyRoutes(deps: { writer: Writer; guard: GuardDeps; now?: () => Date }) {
  const read = { beforeHandle: requirePermission(deps.guard, 'cellar.read') };
  const owner = { beforeHandle: requireOwner(deps.guard) };
  const now = () => deps.now?.() ?? deps.guard.now?.() ?? new Date();
  return new Elysia()
    .post('/v1/enology/calculators/so2', async ({ request }) => runSo2(deps.writer, await readBody(request)), read)
    .post('/v1/enology/calculators/cold_stabilisation', async ({ request }) => runCold(await readBody(request)), read)
    .post('/v1/enology/calculators/probable_alcohol', async ({ request }) => runProbableAlcohol(deps.writer, await readBody(request)), read)
    .post('/v1/enology/calculators/blend', async ({ request }) => runBlend(deps.writer, await readBody(request)), read)
    .post('/v1/enology/checks', async ({ request }) => runChecks(deps.writer, await readBody(request), now()), read)
    .get('/v1/enology/settings', ({ request }) => {
      sessionOf(request);
      return readSettings(deps.writer, entityFrom(request));
    }, owner)
    .put('/v1/enology/settings', async ({ request }) => {
      const user = sessionOf(request);
      const body = await readBody(request);
      return deps.writer.withWrite(
        { type: 'user', id: user.id, requestId: requestIdFor(request), reason: 'configuración de enología' },
        (tx) => writeSettings(tx, user.id, body, now()),
      );
    }, owner);
}

function entityFrom(request: Request): string {
  const entity = new URL(request.url).searchParams.get('legal_entity_id') ?? '';
  if (!UUID.test(entity)) throw domainError('WC_VALIDATION', { legal_entity_id: 'Identificador no válido' });
  return entity.toLowerCase();
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === '') throw domainError('WC_VALIDATION', { body: 'El cuerpo está vacío' });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw domainError('WC_VALIDATION', { body: 'El JSON no es válido' });
  }
}
