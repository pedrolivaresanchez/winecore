import { copy } from '../../i18n'
import type { DeliveryKind } from '../../lib/sales'

/** Kinds the «Desde albaranes» flow already invoices. Transfers and returns are not a sale. */
export const INVOICEABLE_KINDS: readonly DeliveryKind[] = ['sale', 'consignment', 'sample']

export type DeliveryStageId = 'draft' | 'issued' | 'delivered' | 'invoiced'
export type DeliveryAction = 'issue' | 'deliver' | 'invoice'

export type DeliveryStageInput = {
  status: string
  invoicingStatus?: string | null
  kind?: string | null
  customerId?: string | null
  /** Present so both companies stay covered. The stage does not depend on which one it is. */
  entityCode?: string | null
}

export type DeliveryStage = {
  /** 0–3 on the bar. −1 when the note is voided. */
  index: number
  id: DeliveryStageId | 'cancelled'
  chip: string
  action: DeliveryAction | null
}

export function deliverySteps(status: string): { id: DeliveryStageId; label: string }[] {
  return [
    { id: 'draft', label: copy.sales.stageDraft },
    { id: 'issued', label: status === 'shipped' ? copy.sales.stageSent : copy.sales.stageIssued },
    { id: 'delivered', label: copy.sales.stageDelivered },
    { id: 'invoiced', label: copy.sales.stageInvoiced },
  ]
}

/**
 * Four stages: Borrador → Emitido (shipped counts as Enviado, same step) → Entregado → Facturado.
 * The primary button is only the next step. Facturar waits until the note is delivered and
 * its invoicing mode still allows a sale (not a sample or gift marked not invoiceable, not voided).
 */
export function deliveryStage(input: DeliveryStageInput): DeliveryStage {
  const invoicing = input.invoicingStatus ?? 'not_invoiced'
  if (input.status === 'cancelled') {
    return { index: -1, id: 'cancelled', chip: copy.sales.cancelled, action: null }
  }
  if (invoicing === 'invoiced') {
    return { index: 3, id: 'invoiced', chip: copy.sales.stageInvoiced, action: null }
  }
  if (input.status === 'draft') {
    return { index: 0, id: 'draft', chip: copy.sales.stageDraft, action: 'issue' }
  }
  if (input.status === 'issued' || input.status === 'shipped') {
    return {
      index: 1,
      id: 'issued',
      chip: input.status === 'shipped' ? copy.sales.stageSent : copy.sales.stageIssued,
      action: 'deliver',
    }
  }
  if (input.status === 'delivered') {
    return {
      index: 2,
      id: 'delivered',
      chip: invoicing === 'partially_invoiced' ? copy.sales.partiallyInvoiced : copy.sales.stageDelivered,
      action: canInvoiceDelivery(input) ? 'invoice' : null,
    }
  }
  return { index: -1, id: 'cancelled', chip: input.status, action: null }
}

export function canInvoiceDelivery(input: DeliveryStageInput): boolean {
  if (input.status !== 'delivered') return false
  if (input.invoicingStatus !== 'not_invoiced') return false
  if (!input.customerId) return false
  if (!input.kind || !INVOICEABLE_KINDS.includes(input.kind as DeliveryKind)) return false
  return true
}

export function deliveryPrimaryAction(
  input: DeliveryStageInput,
  permissions: { write: boolean; billing: boolean },
): DeliveryAction | null {
  const action = deliveryStage(input).action
  if (action === 'issue' || action === 'deliver') return permissions.write ? action : null
  if (action === 'invoice') return permissions.billing ? action : null
  return null
}

/** Chip in the albaranes list. Shipped stays its own word and shares the Emitido step. */
export function deliveryListChip(status: string): string {
  switch (status) {
    case 'draft':
      return copy.sales.stageDraft
    case 'issued':
      return copy.sales.stageIssued
    case 'shipped':
      return copy.sales.stageSent
    case 'delivered':
      return copy.sales.stageDelivered
    case 'invoiced':
      return copy.sales.stageInvoiced
    case 'partially_invoiced':
      return copy.sales.partiallyInvoiced
    case 'cancelled':
      return copy.sales.stageVoided
    default:
      return status
  }
}

export function listRowInvoiceable(row: {
  origin: string
  status: string
  invoicing_status?: string | null
  note_kind?: string | null
  customerId?: string | null
  entityCode?: string | null
}): boolean {
  if (row.origin !== 'winecore') return false
  return canInvoiceDelivery({
    status: row.status,
    invoicingStatus: row.invoicing_status,
    kind: row.note_kind,
    customerId: row.customerId,
    entityCode: row.entityCode,
  })
}
