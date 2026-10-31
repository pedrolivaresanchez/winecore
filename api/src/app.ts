import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { requestIdFor, requireOwner, requirePermission, requireUser } from './auth/guard';
import { createTimbalAuth } from './auth/timbal';
import type { FetchLike } from './core/db/timbal';
import type { Config } from './config';
import type { Writer } from './core/db/writer';
import { bindFinance } from './core/finance/runtime';
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
import { getBankAccounts, postBankAccount } from './routes/finance-accounts';
import { getPayments, getPaymentById, postPayment, postPaymentReverse } from './routes/finance-payments';
import { getReceivables } from './routes/finance-receivables';
import {
  getRemittanceById,
  getRemittanceFile,
  postRemittance,
  postRemittanceApproval,
  postRemittanceFile,
  postRemittanceSubmitted,
} from './routes/finance-remittances';
import {
  getBankStatementSuggestions,
  postBankStatement,
  postBankStatementConfirm,
  postBankStatementIgnore,
} from './routes/finance-statements';
import { health } from './routes/health';
import { me } from './routes/me';

export interface AppDeps {
  config: Config;
  writer: Writer;
  log?: (line: string) => void;
  fetchImpl?: FetchLike;
}

const startedAt = new WeakMap<Request, number>();

export function createApp(deps: AppDeps) {
  bindFinance(deps.writer, { dataKey: deps.config.dataKey });
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
    // Finanzas: cobros, pendientes, extractos y remesas SEPA.
    .get('/v1/receivables', ({ request }) => getReceivables(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'finance.read'),
    })
    .get('/v1/payments', ({ request }) => getPayments(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'finance.read'),
    })
    .post('/v1/payments', async ({ request, set }) => {
      const result = await postPayment(deps.writer, request);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'finance.write'),
    })
    .get('/v1/payments/:id', ({ request, params }) => getPaymentById(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'finance.read'),
    })
    .post('/v1/payments/:id/reverse', async ({ request, params, set }) => {
      const result = await postPaymentReverse(deps.writer, request, params.id);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'finance.manage'),
    })
    .get('/v1/bank-accounts', ({ request }) => getBankAccounts(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'finance.read'),
    })
    .post('/v1/bank-accounts', async ({ request, set }) => {
      const result = await postBankAccount(deps.writer, request);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'finance.manage'),
    })
    .post('/v1/bank-statements', async ({ request, set }) => {
      const result = await postBankStatement(deps.writer, request);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'finance.write'),
    })
    .get('/v1/bank-statements/:id/suggestions', ({ request, params }) => getBankStatementSuggestions(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'finance.read'),
    })
    .post('/v1/bank-statements/:id/lines/:lineId/confirm', async ({ request, params, set }) => {
      const result = await postBankStatementConfirm(deps.writer, request, params.id, params.lineId);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'finance.write'),
    })
    .post('/v1/bank-statements/:id/lines/:lineId/ignore', async ({ request, params, set }) => {
      const result = await postBankStatementIgnore(deps.writer, request, params.id, params.lineId);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'finance.write'),
    })
    .post('/v1/remittances', async ({ request, set }) => {
      const result = await postRemittance(deps.writer, request);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'finance.manage'),
    })
    .get('/v1/remittances/:id/file', ({ request, params }) => getRemittanceFile(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'finance.manage'),
    })
    .get('/v1/remittances/:id', ({ request, params }) => getRemittanceById(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'finance.read'),
    })
    .post('/v1/remittances/:id/request-approval', async ({ request, params, set }) => {
      const result = await postRemittanceApproval(deps.writer, request, params.id);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'finance.manage'),
    })
    .post('/v1/remittances/:id/generate', async ({ request, params, set }) => {
      const result = await postRemittanceFile(deps.writer, request, params.id);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'finance.manage'),
    })
    .post('/v1/remittances/:id/submitted', async ({ request, params, set }) => {
      const result = await postRemittanceSubmitted(deps.writer, request, params.id);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'finance.manage'),
    });
  return app;
}
