import { Elysia } from 'elysia';
import { requirePermission, type GuardDeps } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import {
  archiveIdea,
  createIdea,
  getIdea,
  listIdeas,
  requestCalendarExport,
  updateIdea,
} from '../core/agenda/ideas';

/** Agenda de ideas. Lectura agenda.read, escritura agenda.write. */
export function agendaRoutes(deps: { writer: Writer; guard: GuardDeps }) {
  const { writer, guard } = deps;
  const read = { beforeHandle: requirePermission(guard, 'agenda.read') };
  const write = { beforeHandle: requirePermission(guard, 'agenda.write') };
  return new Elysia()
    .get('/v1/agenda/ideas', ({ request }) => listIdeas(writer, request), read)
    .post('/v1/agenda/ideas', async ({ request, set }) => {
      const created = await createIdea(writer, request);
      set.status = 201;
      return created;
    }, write)
    .get('/v1/agenda/ideas/:id', ({ params }) => getIdea(writer, params.id), read)
    .patch('/v1/agenda/ideas/:id', ({ request, params }) => updateIdea(writer, request, params.id), write)
    .delete('/v1/agenda/ideas/:id', ({ request, params }) => archiveIdea(writer, request, params.id), write)
    .post('/v1/agenda/ideas/:id/calendar-export', ({ request, params }) => requestCalendarExport(writer, request, params.id), write);
}
