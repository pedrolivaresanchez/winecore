import { Elysia } from 'elysia';
import { requirePermission, sessionOf, type GuardDeps } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import {
  getImpact,
  getResolve,
  getRuleSets,
  getRulesState,
  postActivate,
  postRequestActivation,
  postRuleSet,
  putRuleSet,
} from './sales-rules';
import { salesCatalog } from '../core/sales/catalog';
import {
  getQuoteById,
  getQuotePdf,
  getQuotes,
  patchQuoteById,
  postQuote,
  postQuoteAccept,
  postQuoteReject,
  postQuoteSend,
  postQuoteToOrder,
} from './sales-quotes';
import {
  getOrder,
  getOrders,
  patchOrder,
  postCancel,
  postClose,
  postConfirm,
  postException,
  postOrder,
  postOrderDelivery,
} from './sales-orders';
import {
  getIncidents,
  getNote,
  getNotePdf,
  getNotes,
  getUninvoiced,
  patchNote,
  postConfirmLoss,
  postDeliver,
  postDispatch,
  postIncident,
  postIssue,
  postNotInvoiceable,
  postNote,
  postReturn,
  postVoid,
} from './sales-delivery-notes';

export function salesRoutes(writer: Writer, guardDeps: GuardDeps) {
  const read = requirePermission(guardDeps, 'sales.read');
  const write = requirePermission(guardDeps, 'sales.write');
  const manage = requirePermission(guardDeps, 'sales.manage');
  const settings = requirePermission(guardDeps, 'settings.manage');
  return new Elysia()
    .get('/v1/billing-rules/sets', ({ request }) => getRuleSets(writer, request), { beforeHandle: settings })
    .post('/v1/billing-rules/sets', async ({ request, set }) => {
      const result = await postRuleSet(writer, request);
      set.status = result.status;
      return result.body;
    }, { beforeHandle: settings })
    .put('/v1/billing-rules/sets/:id/rules', ({ request, params }) => putRuleSet(writer, request, params.id), { beforeHandle: settings })
    .get('/v1/billing-rules/resolve', ({ request }) => getResolve(writer, request), { beforeHandle: read })
    .get('/v1/billing-rules/state', ({ request }) => getRulesState(writer, request), { beforeHandle: read })
    .get('/v1/billing-rules/sets/:id/impact', ({ request, params }) => getImpact(writer, request, params.id), { beforeHandle: settings })
    .post('/v1/billing-rules/sets/:id/request-activation', ({ request, params }) => postRequestActivation(writer, request, params.id), { beforeHandle: settings })
    .post('/v1/billing-rules/sets/:id/activate', ({ request, params }) => postActivate(writer, request, params.id), { beforeHandle: settings })
    .get('/v1/sales/catalog', ({ request }) => {
      sessionOf(request);
      return salesCatalog(writer, new URL(request.url), new Date());
    }, { beforeHandle: read })
    .get('/v1/quotes', ({ request }) => getQuotes(writer, request), { beforeHandle: read })
    .post('/v1/quotes', async ({ request, set }) => {
      const result = await postQuote(writer, request);
      set.status = result.status;
      return result.body;
    }, { beforeHandle: write })
    .get('/v1/quotes/:id/pdf', ({ request, params }) => getQuotePdf(writer, request, params.id), { beforeHandle: read })
    .post('/v1/quotes/:id/send', ({ request, params }) => postQuoteSend(writer, request, params.id), { beforeHandle: write })
    .post('/v1/quotes/:id/to-order', async ({ request, params, set }) => {
      const result = await postQuoteToOrder(writer, request, params.id);
      set.status = result.status;
      return result.body;
    }, { beforeHandle: write })
    .post('/v1/quotes/:id/accept', ({ request, params }) => postQuoteAccept(writer, request, params.id), { beforeHandle: write })
    .post('/v1/quotes/:id/reject', ({ request, params }) => postQuoteReject(writer, request, params.id), { beforeHandle: write })
    .patch('/v1/quotes/:id', ({ request, params }) => patchQuoteById(writer, request, params.id), { beforeHandle: write })
    .get('/v1/quotes/:id', ({ request, params }) => getQuoteById(writer, request, params.id), { beforeHandle: read })
    .get('/v1/sales-orders', ({ request }) => getOrders(writer, request), { beforeHandle: read })
    .post('/v1/sales-orders', async ({ request, set }) => {
      const result = await postOrder(writer, request);
      set.status = result.status;
      return result.body;
    }, { beforeHandle: write })
    .get('/v1/sales-orders/:id', ({ request, params }) => getOrder(writer, request, params.id), { beforeHandle: read })
    .patch('/v1/sales-orders/:id', ({ request, params }) => patchOrder(writer, request, params.id), { beforeHandle: write })
    .post('/v1/sales-orders/:id/confirm', ({ request, params }) => postConfirm(writer, request, params.id), { beforeHandle: write })
    .post('/v1/sales-orders/:id/cancel', ({ request, params }) => postCancel(writer, request, params.id), { beforeHandle: write })
    .post('/v1/sales-orders/:id/close', ({ request, params }) => postClose(writer, request, params.id), { beforeHandle: manage })
    .post('/v1/sales-orders/:id/entity-exception', ({ request, params }) => postException(writer, request, params.id), { beforeHandle: manage })
    .post('/v1/sales-orders/:id/delivery-notes', async ({ request, params, set }) => {
      const result = await postOrderDelivery(writer, request, params.id);
      set.status = result.status;
      return result.body;
    }, { beforeHandle: write })
    .get('/v1/delivery-notes/uninvoiced-lines', ({ request }) => getUninvoiced(writer, request), { beforeHandle: read })
    .get('/v1/delivery-notes', ({ request }) => getNotes(writer, request), { beforeHandle: read })
    .post('/v1/delivery-notes', async ({ request, set }) => {
      const result = await postNote(writer, request);
      set.status = result.status;
      return result.body;
    }, { beforeHandle: write })
    .get('/v1/delivery-notes/:id/pdf', ({ request, params }) => getNotePdf(writer, request, params.id), { beforeHandle: read })
    .get('/v1/delivery-notes/:id/incidents', ({ request, params }) => getIncidents(writer, request, params.id), { beforeHandle: read })
    .get('/v1/delivery-notes/:id', ({ request, params }) => getNote(writer, request, params.id), { beforeHandle: read })
    .patch('/v1/delivery-notes/:id', ({ request, params }) => patchNote(writer, request, params.id), { beforeHandle: write })
    .post('/v1/delivery-notes/:id/issue', ({ request, params }) => postIssue(writer, request, params.id), { beforeHandle: write })
    .post('/v1/delivery-notes/:id/dispatch', ({ request, params }) => postDispatch(writer, request, params.id), { beforeHandle: write })
    .post('/v1/delivery-notes/:id/deliver', ({ request, params }) => postDeliver(writer, request, params.id), { beforeHandle: write })
    .post('/v1/delivery-notes/:id/void', ({ request, params }) => postVoid(writer, request, params.id), { beforeHandle: manage })
    .post('/v1/delivery-notes/:id/return', async ({ request, params, set }) => {
      const result = await postReturn(writer, request, params.id);
      set.status = result.status;
      return result.body;
    }, { beforeHandle: write })
    .post('/v1/delivery-notes/:id/not-invoiceable', ({ request, params }) => postNotInvoiceable(writer, request, params.id), { beforeHandle: manage })
    .post('/v1/delivery-notes/:id/incidents', ({ request, params }) => postIncident(writer, request, params.id), { beforeHandle: write })
    .post('/v1/delivery-notes/:id/incidents/:incidentId/confirm-loss', ({ request, params }) => postConfirmLoss(writer, request, params.id, params.incidentId), { beforeHandle: write });
}
