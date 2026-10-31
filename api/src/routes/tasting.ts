import { Elysia } from 'elysia';
import { requirePermission, type GuardDeps } from '../auth/guard';
import { actorFor, readJson } from '../core/cellar/service/http';
import type { Writer } from '../core/db/writer';
import { getEvolution } from '../core/tasting/evolution';
import { createNote, getNote, listNotes, patchNote } from '../core/tasting/notes';
import {
  addSample,
  castVote,
  createSession,
  getSelection,
  getSession,
  listSessions,
  revealSession,
  setSelection,
} from '../core/tasting/sessions';
import {
  addField,
  createDescriptor,
  createTemplate,
  getTemplate,
  listDescriptors,
  listTemplates,
  patchDescriptor,
  patchField,
  patchTemplate,
} from '../core/tasting/templates';
import { invalid, isUuid } from '../core/tasting/validate';

/** Catas: lectura cellar.read, escritura tasting.write. */
export function tastingRoutes(deps: { writer: Writer; guard: GuardDeps }) {
  const { writer, guard } = deps;
  const read = { beforeHandle: requirePermission(guard, 'cellar.read') };
  const write = { beforeHandle: requirePermission(guard, 'tasting.write') };
  return new Elysia()
    .get('/v1/tasting-descriptors', () => listDescriptors(writer), read)
    .post('/v1/tasting-descriptors', async ({ request, set }) => {
      const created = await createDescriptor(writer, actorFor(request), await readJson(request));
      set.status = 201;
      return created;
    }, write)
    .patch('/v1/tasting-descriptors/:code', async ({ request, params }) => patchDescriptor(
      writer,
      actorFor(request),
      params.code,
      await readJson(request),
    ), write)
    .get('/v1/tasting-templates', ({ request }) => listTemplates(writer, request), read)
    .post('/v1/tasting-templates', async ({ request, set }) => {
      const created = await createTemplate(writer, actorFor(request), await readJson(request));
      set.status = 201;
      return created;
    }, write)
    .post('/v1/tasting-templates/:id/fields', async ({ request, params, set }) => {
      const updated = await addField(writer, actorFor(request), params.id, await readJson(request));
      set.status = 201;
      return updated;
    }, write)
    .patch('/v1/tasting-templates/:id/fields/:fieldId', async ({ request, params }) => patchField(
      writer,
      actorFor(request),
      params.id,
      params.fieldId,
      await readJson(request),
    ), write)
    .get('/v1/tasting-templates/:id', ({ params }) => getTemplate(writer, params.id), read)
    .patch('/v1/tasting-templates/:id', async ({ request, params }) => patchTemplate(writer, actorFor(request), params.id, await readJson(request)), write)
    .get('/v1/tasting-notes', ({ request }) => listNotes(writer, request), read)
    .post('/v1/tasting-notes', async ({ request, set }) => {
      const created = await createNote(writer, actorFor(request), await readJson(request));
      set.status = 201;
      return created;
    }, write)
    .get('/v1/tasting-notes/:id', ({ params }) => getNote(writer, params.id), read)
    .patch('/v1/tasting-notes/:id', async ({ request, params }) => patchNote(writer, actorFor(request), params.id, await readJson(request)), write)
    .get('/v1/tasting-sessions', ({ request }) => listSessions(writer, request), read)
    .post('/v1/tasting-sessions', async ({ request, set }) => {
      const created = await createSession(writer, actorFor(request), await readJson(request));
      set.status = 201;
      return created;
    }, write)
    .get('/v1/tasting-sessions/:id/selection', ({ params }) => getSelection(writer, uuidParam(params.id)), read)
    .patch('/v1/tasting-sessions/:id/selection', async ({ request, params }) => setSelection(writer, actorFor(request), {
      ...(await readJson(request)),
      session_id: uuidParam(params.id),
    }), write)
    .post('/v1/tasting-sessions/:id/samples', async ({ request, params, set }) => {
      const created = await addSample(writer, actorFor(request), {
        ...(await readJson(request)),
        session_id: uuidParam(params.id),
      });
      set.status = 201;
      return created;
    }, write)
    .post('/v1/tasting-sessions/:id/votes', async ({ request, params }) => castVote(writer, actorFor(request), {
      ...(await readJson(request)),
      session_id: uuidParam(params.id),
    }), write)
    .post('/v1/tasting-sessions/:id/reveal', ({ request, params }) => revealSession(writer, actorFor(request), {
      session_id: uuidParam(params.id),
    }), write)
    .get('/v1/tasting-sessions/:id', ({ params }) => getSession(writer, uuidParam(params.id)), read)
    .get('/v1/tasting-evolution', ({ request }) => getEvolution(writer, request), read);
}

function uuidParam(value: string): string {
  if (!isUuid(value)) invalid({ id: 'Debe ser un UUID' });
  return value.toLowerCase();
}
