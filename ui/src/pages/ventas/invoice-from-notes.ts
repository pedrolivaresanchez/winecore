import { ApiError } from '@/lib/api'
import { createInvoice } from '@/pages/facturas/api'

/**
 * The same draft «Nueva factura → Desde albaranes» creates: company, customer and the
 * albarán ids. Payment terms and method stay on the server, which copies the customer's.
 * Internal notes are not sent. A draft that already covers the albarán is opened instead.
 */
export async function openInvoiceFromNotes(input: {
  noteIds: string[]
  legalEntityId?: string
  customerId?: string
  existingInvoiceId?: string | null
}): Promise<string> {
  if (input.noteIds.length === 1 && input.existingInvoiceId) return input.existingInvoiceId
  try {
    const created = await createInvoice({
      legal_entity_id: input.legalEntityId,
      customer_id: input.customerId,
      from_delivery_notes: input.noteIds,
    })
    return created.id
  } catch (error) {
    if (input.noteIds.length === 1 && error instanceof ApiError && error.code === 'WC_INV_ALREADY_INVOICED') {
      const id = error.details?.invoice_id
      if (typeof id === 'string' && id.length > 0) return id
    }
    throw error
  }
}
