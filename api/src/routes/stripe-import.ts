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
  if (outcome.dryRun) {
    return {
      status: 200,
      body: {
        dry_run: true,
        replayed: outcome.replayed,
        customer_created: false,
        customer_exists: outcome.customerExists,
        stripe_invoice_id: outcome.stripeInvoiceId,
        id: outcome.id,
        number: outcome.number,
        series_id: outcome.seriesId,
        invoice_type: outcome.invoiceType,
        currency: outcome.currency,
        subtotal: outcome.totals?.subtotal ?? null,
        tax_total: outcome.totals?.taxTotal ?? null,
        surcharge_total: outcome.totals?.surchargeTotal ?? null,
        withholding_total: outcome.totals?.withholdingTotal ?? null,
        total: outcome.totals?.total ?? null,
        warnings: outcome.warnings,
      },
    };
  }
  if (!outcome.id) throw domainError('WC_VALIDATION', { stripe_invoice_id: 'La importación no ha creado la factura' });
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
