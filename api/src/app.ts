import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { requestIdFor, requireOwner, requirePermission, requireUser } from './auth/guard';
import { createTimbalAuth } from './auth/timbal';
import type { FetchLike } from './core/db/timbal';
import type { Config } from './config';
import type { Writer } from './core/db/writer';
import { asDomainError, domainError, errorBody } from './core/errors';
import { listAudit, verifyAudit } from './routes/audit';
import {
  archiveAddress,
  archiveContact,
  archivePerson,
  createAddress,
  createContact,
  createPerson,
  exportContacts,
  getContact,
  listContacts,
  patchAddress,
  patchContact,
  patchPerson,
} from './routes/contacts';
import { downloadAttachment, listAttachmentLinks, uploadAttachment } from './routes/attachments';
import { health } from './routes/health';
import { me } from './routes/me';
import { listNotifications, readAllNotifications, readNotification } from './routes/notifications';
import { createNumberSeries, deactivateNumberSeries, listNumberSeries } from './routes/series';

export interface AppDeps {
  config: Config;
  writer: Writer;
  log?: (line: string) => void;
  fetchImpl?: FetchLike;
}

const startedAt = new WeakMap<Request, number>();

export function createApp(deps: AppDeps) {
  const log = deps.log ?? ((line: string) => console.log(line));
  const timbalAuth = createTimbalAuth(deps.config, deps.fetchImpl);
  const guardDeps = { config: deps.config, writer: deps.writer, timbalAuth };
  const app = new Elysia(deps.config.apiBasePath ? { prefix: deps.config.apiBasePath } : {})
    .use(cors())
    .onRequest(({ request, set }) => {
      startedAt.set(request, performance.now());
      set.headers['x-request-id'] = requestIdFor(request);
    })
    .onAfterResponse(({ request, set }) => {
      const start = startedAt.get(request) ?? performance.now();
      const status = typeof set.status === 'number' ? set.status : 200;
      log(JSON.stringify({
        request_id: requestIdFor(request),
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        ms: Math.max(0, Math.round(performance.now() - start)),
      }));
    })
    .onError(({ code, error, set, request }) => {
      const domain = asDomainError(error);
      if (domain) {
        set.status = domain.httpStatus;
        return errorBody(domain);
      }
      if (code === 'NOT_FOUND') {
        set.status = 404;
        return errorBody(domainError('WC_NOT_FOUND'));
      }
      if (code === 'VALIDATION' || code === 'PARSE') {
        set.status = 422;
        return errorBody(domainError('WC_VALIDATION'));
      }
      log(JSON.stringify({
        request_id: requestIdFor(request),
        code: 'WC_INTERNAL',
        level: 'error',
      }));
      set.status = 500;
      return { code: 'WC_INTERNAL', message: 'Error interno' };
    })
    .get('/health', () => health(deps.config, deps.writer))
    .get('/v1/me', ({ request }) => me(deps.writer, request), {
      beforeHandle: requireUser(guardDeps),
    })
    .get('/v1/audit', ({ request }) => listAudit(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'audit.read'),
    })
    .post('/v1/audit/verify', ({ request }) => verifyAudit(deps.writer, request), {
      beforeHandle: requireOwner(guardDeps),
    })
    // Contactos (TASK-CONT-001). export.csv va antes de /:id.
    .get('/v1/contacts', ({ request }) => listContacts(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'contacts.read'),
    })
    .get('/v1/contacts/export.csv', ({ request }) => exportContacts(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'contacts.read'),
    })
    .post('/v1/contacts', async ({ request, set }) => {
      const result = await createContact(deps.writer, request);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'contacts.write'),
    })
    .get('/v1/contacts/:id', ({ request, params }) => getContact(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'contacts.read'),
    })
    .patch('/v1/contacts/:id', ({ request, params }) => patchContact(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'contacts.write'),
    })
    .post('/v1/contacts/:id/archive', ({ request, params }) => archiveContact(deps.writer, request, params.id, false), {
      beforeHandle: requirePermission(guardDeps, 'contacts.write'),
    })
    .post('/v1/contacts/:id/unarchive', ({ request, params }) => archiveContact(deps.writer, request, params.id, true), {
      beforeHandle: requirePermission(guardDeps, 'contacts.write'),
    })
    .post('/v1/contacts/:id/addresses', ({ request, params }) => createAddress(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'contacts.write'),
    })
    .patch('/v1/contacts/:id/addresses/:aid', ({ request, params }) => patchAddress(deps.writer, request, params.id, params.aid), {
      beforeHandle: requirePermission(guardDeps, 'contacts.write'),
    })
    .post('/v1/contacts/:id/addresses/:aid/archive', ({ request, params }) => archiveAddress(deps.writer, request, params.id, params.aid), {
      beforeHandle: requirePermission(guardDeps, 'contacts.write'),
    })
    .post('/v1/contacts/:id/persons', ({ request, params }) => createPerson(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'contacts.write'),
    })
    .patch('/v1/contacts/:id/persons/:pid', ({ request, params }) => patchPerson(deps.writer, request, params.id, params.pid), {
      beforeHandle: requirePermission(guardDeps, 'contacts.write'),
    })
    .post('/v1/contacts/:id/persons/:pid/archive', ({ request, params }) => archivePerson(deps.writer, request, params.id, params.pid), {
      beforeHandle: requirePermission(guardDeps, 'contacts.write'),
    })
    // Series de numeración (TASK-CORE-004). Sin borrado.
    .get('/v1/number-series', ({ request }) => listNumberSeries(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'settings.manage'),
    })
    .post('/v1/number-series', async ({ request, set }) => {
      const body = await createNumberSeries(deps.writer, request);
      set.status = 201;
      return body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'settings.manage'),
    })
    .post('/v1/number-series/:id/deactivate', ({ request, params }) => deactivateNumberSeries(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'settings.manage'),
    })
    // Adjuntos (TASK-CORE-006). El permiso es el del módulo de la tabla enlazada.
    .post('/v1/attachments', async ({ request, set }) => {
      const body = await uploadAttachment(deps.writer, request);
      set.status = 201;
      return body;
    }, {
      beforeHandle: requireUser(guardDeps),
    })
    .get('/v1/attachments', ({ request }) => listAttachmentLinks(deps.writer, request), {
      beforeHandle: requireUser(guardDeps),
    })
    .get('/v1/attachments/:id', ({ request, params }) => downloadAttachment(deps.writer, request, params.id), {
      beforeHandle: requireUser(guardDeps),
    })
    // Avisos propios (TASK-CORE-007). read-all va antes de /:id.
    .get('/v1/notifications', ({ request }) => listNotifications(deps.writer, request), {
      beforeHandle: requireUser(guardDeps),
    })
    .post('/v1/notifications/read-all', ({ request }) => readAllNotifications(deps.writer, request), {
      beforeHandle: requireUser(guardDeps),
    })
    .post('/v1/notifications/:id/read', ({ request, params }) => readNotification(deps.writer, request, params.id), {
      beforeHandle: requireUser(guardDeps),
    });
  return app;
}
