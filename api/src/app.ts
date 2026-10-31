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
import {
  confirmTotp,
  enrollTotp,
  listCredentials,
  passkeyRegistrationOptions,
  revokeCredential,
  stepUpOptions,
  stepUpVerify,
  verifyPasskeyRegistration,
} from './routes/auth-credentials';
import { health } from './routes/health';
import { me } from './routes/me';

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
  const guardDeps = { config: deps.config, writer: deps.writer, timbalAuth };
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
    });
  return app;
}
