import { requestIdFor, sessionOf } from '../auth/guard';
import { importStripeInvoice } from '../core/billing/stripeImport';
import { loadInvoice, presentInvoice } from '../core/billing/readModel';
import { domainError } from '../core/errors';
import type { Writer } from '../core/db/writer';

/**
 * POST /v1/invoices/import/stripe
 *
 * Graba una factura de Stripe ya emitida. No llama a /issue: ver
 * `core/billing/stripeImport.ts`. Repetir el mismo `in_…` devuelve 200.
 */
export async function importStripeInvoiceRoute(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const raw = await request.json().catch(() => {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  });
  const outcome = await writer.withWrite({
    type: 'user',
    id: user.id,
    requestId: requestIdFor(request),
  }, (tx) => importStripeInvoice(tx, raw, {
    type: 'user',
    id: user.id,
    requestId: requestIdFor(request),
  }, user, new Date()));
  const view = await loadInvoice(writer, outcome.id);
  if (view.header.origin !== 'stripe_import') {
    throw domainError('WC_VALIDATION', { origin: 'La factura no quedó marcada como importación de Stripe' });
  }
  return {
    status: outcome.replayed ? 200 : 201,
    body: {
      ...presentInvoice(view),
      replayed: outcome.replayed,
      customer_created: outcome.customerCreated,
      stripe_invoice_id: outcome.stripeInvoiceId,
      legacy_refs: view.header.legacyRefs,
    },
  };
}
