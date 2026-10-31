import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { requestIdFor, requireOwner, requirePermission, requireUser } from './auth/guard';
import { createTimbalAuth } from './auth/timbal';
import type { FetchLike } from './core/db/timbal';
import type { Config } from './config';
import type { Writer } from './core/db/writer';
import { asDomainError, domainError, errorBody } from './core/errors';
import { listAudit, verifyAudit } from './routes/audit';
import { health } from './routes/health';
import { me } from './routes/me';
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
