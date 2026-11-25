import { describe, expect, it } from 'bun:test'
import {
  canInvoiceDelivery,
  deliveryListChip,
  deliveryPrimaryAction,
  deliveryStage,
  deliverySteps,
} from './delivery-stage'

const sale = {
  status: 'delivered',
  invoicingStatus: 'not_invoiced',
  kind: 'sale',
  customerId: 'cliente',
}

const both = { write: true, billing: true }

describe('pasos del albarán', () => {
  it('marca Borrador, Emitido, Entregado y Facturado, y Enviado sigue en el paso Emitido', () => {
    expect(deliveryStage({ status: 'draft', invoicingStatus: 'not_invoiced', kind: 'sale', customerId: 'c' })).toMatchObject({
      index: 0, chip: 'Borrador', action: 'issue',
    })
    expect(deliveryStage({ status: 'issued', invoicingStatus: 'not_invoiced', kind: 'sale', customerId: 'c' })).toMatchObject({
      index: 1, chip: 'Emitido', action: 'deliver',
    })
    expect(deliveryStage({ status: 'shipped', invoicingStatus: 'not_invoiced', kind: 'sale', customerId: 'c' })).toMatchObject({
      index: 1, chip: 'Enviado', action: 'deliver',
    })
    expect(deliverySteps('shipped')[1]?.label).toBe('Enviado')
    expect(deliverySteps('issued')[1]?.label).toBe('Emitido')
    expect(deliveryStage(sale)).toMatchObject({ index: 2, chip: 'Entregado', action: 'invoice' })
    expect(deliveryStage({ ...sale, invoicingStatus: 'invoiced', status: 'delivered' })).toMatchObject({
      index: 3, chip: 'Facturado', action: null,
    })
    expect(deliveryStage({ ...sale, status: 'cancelled', invoicingStatus: 'not_invoiced' })).toMatchObject({
      index: -1, chip: 'Cancelado', action: null,
    })
  })

  it('Facturar solo en un entregado que todavía se puede facturar, en P.O y en CVPO', () => {
    for (const entityCode of ['PO', 'CVPO']) {
      expect(deliveryPrimaryAction({ ...sale, entityCode }, both)).toBe('invoice')
      expect(canInvoiceDelivery({ ...sale, entityCode })).toBe(true)
    }
    expect(deliveryPrimaryAction({ ...sale, status: 'issued' }, both)).toBe('deliver')
    expect(deliveryPrimaryAction({ ...sale, status: 'shipped' }, both)).toBe('deliver')
    expect(deliveryPrimaryAction({ ...sale, status: 'draft' }, both)).toBe('issue')
    expect(canInvoiceDelivery({ ...sale, status: 'issued' })).toBe(false)
    expect(canInvoiceDelivery({ ...sale, status: 'shipped' })).toBe(false)
    expect(canInvoiceDelivery({ ...sale, invoicingStatus: 'invoiced' })).toBe(false)
    expect(canInvoiceDelivery({ ...sale, invoicingStatus: 'partially_invoiced' })).toBe(false)
    expect(canInvoiceDelivery({ ...sale, invoicingStatus: 'not_invoiceable', kind: 'sample' })).toBe(false)
    expect(canInvoiceDelivery({ ...sale, kind: 'sample' })).toBe(true)
    expect(canInvoiceDelivery({ ...sale, kind: 'transfer' })).toBe(false)
    expect(canInvoiceDelivery({ ...sale, kind: 'return' })).toBe(false)
    expect(canInvoiceDelivery({ ...sale, customerId: null })).toBe(false)
    expect(canInvoiceDelivery({ ...sale, status: 'cancelled' })).toBe(false)
    expect(deliveryPrimaryAction(sale, { write: true, billing: false })).toBeNull()
    expect(deliveryPrimaryAction({ ...sale, status: 'draft' }, { write: false, billing: true })).toBeNull()
  })

  it('la lista usa el mismo nombre de etapa', () => {
    expect(deliveryListChip('draft')).toBe('Borrador')
    expect(deliveryListChip('issued')).toBe('Emitido')
    expect(deliveryListChip('shipped')).toBe('Enviado')
    expect(deliveryListChip('delivered')).toBe('Entregado')
    expect(deliveryListChip('invoiced')).toBe('Facturado')
    expect(deliveryListChip('cancelled')).toBe('Anulado')
  })
})
