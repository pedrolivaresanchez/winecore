import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { requestIdFor, requireOwner, requirePermission, requireUser, requireUserOrMachine } from './auth/guard';
import { createTimbalAuth } from './auth/timbal';
import type { FetchLike } from './core/db/timbal';
import type { Config } from './config';
import type { Writer } from './core/db/writer';
import { asDomainError, domainError, errorBody } from './core/errors';
import { listAudit, verifyAudit } from './routes/audit';
import {
  decideApproval,
  getApproval,
  getApprovalPolicy,
  listApprovals,
  putApprovalPolicy,
} from './routes/approvals';
import { downloadAttachment, listAttachmentLinks, uploadAttachment } from './routes/attachments';
import {
  confirmTotp,
  enrollTotp,
  listCredentials,
  passkeyRegistrationOptions,
  renameCredential,
  revokeCredential,
  stepUpOptions,
  stepUpVerify,
  verifyPasskeyRegistration,
} from './routes/auth-credentials';
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
import { catalogRoutes } from './routes/catalog';
import { health } from './routes/health';
import { me } from './routes/me';
import { listNotifications, readAllNotifications, readNotification } from './routes/notifications';
import { createNumberSeries, deactivateNumberSeries, listNumberSeries } from './routes/series';
import {
  closeInventoryCountRoute,
  postInventoryCountRoute,
  putInventoryCountLinesRoute,
  submitInventoryCountRoute,
} from './routes/stock-counts';
import { stockBalances, stockFiscalBalances, stockInspection, stockMoves } from './routes/stock';

export interface AppDeps {
  config: Config;
  writer: Writer;
  log?: (line: string) => void;
  fetchImpl?: FetchLike;
  /** Reloj inyectable (tests). Por defecto el reloj del sistema. */
  now?: () => Date;
}

const startedAt = new WeakMap<Request, number>();

export function createApp(deps: AppDeps) {
  const log = deps.log ?? ((line: string) => console.log(line));
  const timbalAuth = createTimbalAuth(deps.config, deps.fetchImpl);
  const guardDeps = {
    config: deps.config,
    writer: deps.writer,
    timbalAuth,
    now: deps.now ?? (() => new Date()),
  };
  const http = { config: deps.config, writer: deps.writer, now: deps.now ?? (() => new Date()) };
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
    })
    // Verificación reforzada (passkey y TOTP) y bandeja de aprobaciones.
    .post('/v1/auth/passkeys/registration/options', ({ request, set }) => passkeyRegistrationOptions(http, request, set), {
      beforeHandle: requireUser(guardDeps),
    })
    .post('/v1/auth/passkeys/registration/verify', ({ request, set, body }) => verifyPasskeyRegistration(http, request, set, body), {
      beforeHandle: requireUser(guardDeps),
    })
    .get('/v1/auth/credentials', ({ request, set }) => listCredentials(http, request, set), {
      beforeHandle: requireUser(guardDeps),
    })
    .patch('/v1/auth/credentials/:id', ({ request, params, set, body }) => renameCredential(http, request, params.id, body, set), {
      beforeHandle: requireUser(guardDeps),
    })
    .post('/v1/auth/credentials/:id/revoke', ({ request, params, set }) => revokeCredential(http, request, params.id, set), {
      beforeHandle: requireUser(guardDeps),
    })
    .post('/v1/auth/totp/enroll', ({ request, set }) => enrollTotp(http, request, set), {
      beforeHandle: requireUser(guardDeps),
    })
    .post('/v1/auth/totp/confirm', ({ request, set, body }) => confirmTotp(http, request, set, body), {
      beforeHandle: requireUser(guardDeps),
    })
    .post('/v1/auth/step-up/options', ({ request, set }) => stepUpOptions(http, request, set), {
      beforeHandle: requireUser(guardDeps),
    })
    .post('/v1/auth/step-up/verify', ({ request, set, body }) => stepUpVerify(http, request, set, body), {
      beforeHandle: requireUser(guardDeps),
    })
    .get('/v1/approvals', ({ request }) => listApprovals(http, request), {
      beforeHandle: requireUserOrMachine(guardDeps),
    })
    .get('/v1/approvals/:id', ({ request, params }) => getApproval(http, request, params.id), {
      beforeHandle: requireUserOrMachine(guardDeps),
    })
    .post('/v1/approvals/:id/decide', ({ request, params, body }) => decideApproval(http, request, params.id, body), {
      beforeHandle: requireUserOrMachine(guardDeps),
    })
    .get('/v1/approval-policies', ({ request }) => getApprovalPolicy(http, request), {
      beforeHandle: requireOwner(guardDeps),
    })
    .put('/v1/approval-policies/:kind', ({ request, params, body }) => putApprovalPolicy(http, request, params.kind, body), {
      beforeHandle: requireOwner(guardDeps),
    })
    .use(catalogRoutes(guardDeps))
    // Existencias (stock): saldos, informe, movimientos y aforos.
    .get('/v1/stock/balances', ({ request }) => stockBalances(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'inventory.read'),
    })
    .get('/v1/stock/fiscal-balances', ({ request }) => stockFiscalBalances(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'inventory.read'),
    })
    .get('/v1/stock/inspection-report', ({ request }) => stockInspection(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'inventory.read'),
    })
    .get('/v1/stock/moves', ({ request }) => stockMoves(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'inventory.read'),
    })
    .post('/v1/inventory-counts', ({ request }) => postInventoryCountRoute(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'inventory.count'),
    })
    .put('/v1/inventory-counts/:id/lines', ({ request, params }) => putInventoryCountLinesRoute(deps.writer, request, params), {
      beforeHandle: requirePermission(guardDeps, 'inventory.count'),
    })
    .post('/v1/inventory-counts/:id/close', ({ request, params }) => closeInventoryCountRoute(deps.writer, request, params), {
      beforeHandle: requirePermission(guardDeps, 'inventory.count'),
    })
    .post('/v1/inventory-counts/:id/post-request', ({ request, params }) => submitInventoryCountRoute(deps.writer, request, params), {
      beforeHandle: requirePermission(guardDeps, 'inventory.count'),
    });
  return app;
}
