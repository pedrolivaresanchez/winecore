import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { requestIdFor, requireOwner, requirePermission, requireUser, requireUserOrMachine } from './auth/guard';
import { createTimbalAuth } from './auth/timbal';
import type { FetchLike } from './core/db/timbal';
import type { Config } from './config';
import type { Writer } from './core/db/writer';
import type { SupplierInvoiceApprovalHook } from './core/purchasing/approval';
import { noopApprovalHook } from './core/purchasing/approval';
import type { OcrWorkforce } from './core/purchasing/extract';
import { ocrFromEnv } from './core/purchasing/timbal';
import { asDomainError, domainError, errorBody } from './core/errors';
import type { InvoiceDocumentStore } from './core/billing/pdf/documents';
import { downloadInvoicePdf } from './routes/invoice-documents';
import {
  getInvoiceDelivery,
  listInvoiceDeliveries,
  markInvoiceDeliveryFailed,
  markInvoiceDeliverySent,
  resendInvoiceDelivery,
} from './routes/invoice-delivery';
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
import { catalogRoutes } from './routes/catalog';
import { cellarRoutes } from './routes/cellar';
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
import {
  approveExpense,
  captureExpense,
  exportExpenses,
  getExpense,
  listExpenses,
  patchExpense,
  rejectExpense,
  validateExpense,
} from './routes/expenses';
import {
  getExportDocuments,
  postExportChecklist,
  postExportDocuments,
  postExportReadiness,
  putExportDocuments,
} from './routes/export-docs';
import { materialRoutes } from './routes/materials';
import { health } from './routes/health';
import {
  getSettlement,
  getTariffs,
  patchTariff,
  postActivateTariff,
  postClosePeriod,
  postCloseSettlement,
  postInvoiceRequest,
  postRetireTariff,
  postSettlement,
  postTariff,
} from './routes/intercompany';
import {
  batchIssueExecute,
  batchIssueRequest,
  createInvoice,
  discardInvoice,
  exportInvoices,
  getInvoice,
  issueInvoiceRoute,
  listInvoices,
  patchInvoice,
  validateInvoiceRoute,
  voidInvoiceRoute,
} from './routes/invoices';
import { me } from './routes/me';
import { listNotifications, readAllNotifications, readNotification } from './routes/notifications';
import { getReport } from './routes/reports';
import { createNumberSeries, deactivateNumberSeries, listNumberSeries } from './routes/series';
import {
  closeInventoryCountRoute,
  getInventoryCountRoute,
  listInventoryCountsRoute,
  postInventoryCountRoute,
  putInventoryCountLinesRoute,
  submitInventoryCountRoute,
} from './routes/stock-counts';
import { salesRoutes } from './routes/sales';
import { stockBalances, stockFiscalBalances, stockInspection, stockMoves } from './routes/stock';

export interface AppDeps {
  config: Config;
  writer: Writer;
  log?: (line: string) => void;
  fetchImpl?: FetchLike;
  /** Reloj inyectable (tests). Por defecto el reloj del sistema. */
  now?: () => Date;
  ocr?: OcrWorkforce;
  approvalHook?: SupplierInvoiceApprovalHook;
  invoiceDocuments?: InvoiceDocumentStore;
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
  const expenses = { ocr: deps.ocr ?? ocrFromEnv(), approvalHook: deps.approvalHook ?? noopApprovalHook };
  const invoiceDeps = {
    writer: deps.writer,
    config: deps.config,
    documents: deps.invoiceDocuments,
  };
  const deliveryDeps = { writer: deps.writer, documents: deps.invoiceDocuments };
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
        message: error instanceof Error ? error.message : 'Error interno',
      }));
      set.status = 500;
      return { code: 'WC_INTERNAL', message: 'Error interno' };
    })
    .get('/health', () => health(deps.config, deps.writer))
    // Timbal's readiness probe: liveness only, it must not depend on the Knowledge Base.
    .get('/healthcheck', () => ({ status: 'ok' }))
    .get('/v1/me', ({ request }) => me(deps.writer, request), {
      beforeHandle: requireUser(guardDeps),
    })
    .get('/v1/reports/sales.csv', ({ request }) => getReport(deps.writer, request, 'sales'), {
      beforeHandle: requirePermission(guardDeps, 'reports.read'),
    })
    .get('/v1/reports/expenses.csv', ({ request }) => getReport(deps.writer, request, 'expenses'), {
      beforeHandle: requirePermission(guardDeps, 'reports.read'),
    })
    .get('/v1/reports/stock.csv', ({ request }) => getReport(deps.writer, request, 'stock'), {
      beforeHandle: requirePermission(guardDeps, 'reports.read'),
    })
    .get('/v1/reports/sales', ({ request }) => getReport(deps.writer, request, 'sales'), {
      beforeHandle: requirePermission(guardDeps, 'reports.read'),
    })
    .get('/v1/reports/expenses', ({ request }) => getReport(deps.writer, request, 'expenses'), {
      beforeHandle: requirePermission(guardDeps, 'reports.read'),
    })
    .get('/v1/reports/stock', ({ request }) => getReport(deps.writer, request, 'stock'), {
      beforeHandle: requirePermission(guardDeps, 'reports.read'),
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
    // Facturación (TASK-FACT-002, 003, 005, 006, 008, 011). Sin Verifactu: el módulo sigue apagado.
    .get('/v1/invoices', ({ request }) => listInvoices(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'billing.read'),
    })
    .get('/v1/invoices/export', ({ request }) => exportInvoices(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'billing.read'),
    })
    .get('/v1/invoices/deliveries/pending', ({ request }) => listInvoiceDeliveries(deliveryDeps, request), {
      beforeHandle: requirePermission(guardDeps, 'billing.deliver'),
    })
    .post('/v1/invoices/batch-issue-request', ({ request }) => batchIssueRequest(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'billing.write'),
    })
    .post('/v1/invoices/batch-issue/:requestId/execute', ({ request, params }) => batchIssueExecute(deps.writer, request, params.requestId), {
      beforeHandle: requirePermission(guardDeps, 'billing.issue'),
    })
    .post('/v1/invoices', async ({ request, set }) => {
      const body = await createInvoice(deps.writer, request);
      set.status = 201;
      return body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'billing.write'),
    })
    .get('/v1/invoices/:id', ({ request, params }) => getInvoice(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.read'),
    })
    .get('/v1/invoices/:id/pdf', ({ request, params }) => downloadInvoicePdf(invoiceDeps, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.read'),
    })
    .get('/v1/invoices/:id/delivery', ({ request, params }) => getInvoiceDelivery(deliveryDeps, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.deliver'),
    })
    .post('/v1/invoices/:id/delivery/sent', ({ request, params }) => markInvoiceDeliverySent(deliveryDeps, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.deliver'),
    })
    .post('/v1/invoices/:id/delivery/failed', ({ request, params }) => markInvoiceDeliveryFailed(deliveryDeps, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.deliver'),
    })
    .post('/v1/invoices/:id/delivery/resend', ({ request, params }) => resendInvoiceDelivery(deliveryDeps, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.deliver'),
    })
    .patch('/v1/invoices/:id', ({ request, params }) => patchInvoice(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.write'),
    })
    .post('/v1/invoices/:id/validate', ({ request, params }) => validateInvoiceRoute(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.write'),
    })
    .post('/v1/invoices/:id/issue', async ({ request, params, set }) => {
      const result = await issueInvoiceRoute(deps.writer, request, params.id);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'billing.issue'),
    })
    .post('/v1/invoices/:id/void', async ({ request, params, set }) => {
      const result = await voidInvoiceRoute(deps.writer, request, params.id);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'billing.void'),
    })
    .post('/v1/invoices/:id/discard', ({ request, params }) => discardInvoice(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.write'),
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
    .get('/v1/inventory-counts', ({ request }) => listInventoryCountsRoute(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'inventory.read'),
    })
    .get('/v1/inventory-counts/:id', ({ params }) => getInventoryCountRoute(deps.writer, params.id), {
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
    })
    // Bodega: ubicaciones, recipientes, lotes y operaciones.
    .use(cellarRoutes({ writer: deps.writer, guard: guardDeps, publicUrl: deps.config.appPublicUrl }))
    // Exportación (TASK-FACT-013). El ajuste es solo del titular y queda auditado.
    .get('/v1/export/documents-by-country', () => getExportDocuments(deps.writer), {
      beforeHandle: requireOwner(guardDeps),
    })
    .put('/v1/export/documents-by-country', ({ request }) => putExportDocuments(deps.writer, request), {
      beforeHandle: requireOwner(guardDeps),
    })
    .post('/v1/export/readiness', ({ request }) => postExportReadiness(deps.writer, request), {
      beforeHandle: requireOwner(guardDeps),
    })
    .post('/v1/export/checklist', ({ request }) => postExportChecklist(deps.writer, request), {
      beforeHandle: requireOwner(guardDeps),
    })
    .post('/v1/export/documents', ({ request }) => postExportDocuments(deps.writer, request), {
      beforeHandle: requireOwner(guardDeps),
    })
    .use(materialRoutes(guardDeps))
    // Ventas: reglas D3, presupuestos, pedidos y albaranes.
    .use(salesRoutes(deps.writer, guardDeps))
    // Intercompañía (TASK-CAT-003, TASK-FACT-009). La tarifa la cambia solo dirección.
    .get('/v1/intercompany/tariffs', () => getTariffs(deps.writer), {
      beforeHandle: requirePermission(guardDeps, 'billing.read'),
    })
    .post('/v1/intercompany/tariffs', async ({ request, set }) => {
      const result = await postTariff(deps.writer, request);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requireOwner(guardDeps),
    })
    .patch('/v1/intercompany/tariffs/:id', ({ request, params }) => patchTariff(deps.writer, request, params.id), {
      beforeHandle: requireOwner(guardDeps),
    })
    .post('/v1/intercompany/tariffs/:id/activate', ({ request, params }) => postActivateTariff(deps.writer, request, params.id), {
      beforeHandle: requireOwner(guardDeps),
    })
    .post('/v1/intercompany/tariffs/:id/retire', ({ request, params }) => postRetireTariff(deps.writer, request, params.id), {
      beforeHandle: requireOwner(guardDeps),
    })
    .get('/v1/intercompany/settlements', ({ request }) => getSettlement(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'billing.read'),
    })
    .post('/v1/intercompany/settlements/close', ({ request }) => postClosePeriod(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'billing.write'),
    })
    .post('/v1/intercompany/settlements', ({ request }) => postSettlement(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'billing.write'),
    })
    .post('/v1/intercompany/settlements/:id/close', ({ request, params }) => postCloseSettlement(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.write'),
    })
    .post('/v1/intercompany/settlements/:id/invoice-request', ({ request, params }) => postInvoiceRequest(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'billing.write'),
    })
    // Gastos (TASK-COMP-001..003). export y capture van antes de /:id.
    .get('/v1/supplier-invoices/export', ({ request }) => exportExpenses(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'purchasing.read'),
    })
    .get('/v1/supplier-invoices', ({ request }) => listExpenses(deps.writer, request), {
      beforeHandle: requirePermission(guardDeps, 'purchasing.read'),
    })
    .post('/v1/supplier-invoices/capture', async ({ request, set }) => {
      const result = await captureExpense(deps.writer, request, expenses);
      set.status = result.status;
      return result.body;
    }, {
      beforeHandle: requirePermission(guardDeps, 'purchasing.write'),
    })
    .get('/v1/supplier-invoices/:id', ({ request, params }) => getExpense(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'purchasing.read'),
    })
    .patch('/v1/supplier-invoices/:id', ({ request, params }) => patchExpense(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'purchasing.write'),
    })
    .post('/v1/supplier-invoices/:id/validate', ({ request, params }) => validateExpense(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'purchasing.write'),
    })
    .post('/v1/supplier-invoices/:id/approve', ({ request, params }) => approveExpense(deps.writer, request, params.id, expenses), {
      beforeHandle: requirePermission(guardDeps, 'purchasing.approve'),
    })
    .post('/v1/supplier-invoices/:id/reject', ({ request, params }) => rejectExpense(deps.writer, request, params.id), {
      beforeHandle: requirePermission(guardDeps, 'purchasing.write'),
    });
  return app;
}
