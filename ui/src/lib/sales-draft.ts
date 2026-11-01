import { copy } from '@/i18n'
import { pricesDiffer, type LineInput, type SalesLine } from '@/lib/sales'

export type DraftLine = {
  key: string
  productId: string
  quantity: string
  discount: string
  unitPrice: string
  quoted: string | null
  reason: string
  touched: boolean
  taxCode: string
  lotId: string
  lotCode: string
  orderLineId: string
}

export function blankLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    productId: '',
    quantity: '1',
    discount: '0',
    unitPrice: '',
    quoted: null,
    reason: '',
    touched: false,
    taxCode: '',
    lotId: '',
    lotCode: '',
    orderLineId: '',
  }
}

export function draftsFrom(lines: SalesLine[]): DraftLine[] {
  if (lines.length === 0) return [blankLine()]
  return lines.map((line) => ({
    key: line.id,
    productId: line.product_id ?? '',
    quantity: trimQty(line.quantity),
    discount: trimQty(line.discount_pct),
    unitPrice: line.unit_price ?? '',
    quoted: line.unit_price,
    reason: '',
    touched: false,
    taxCode: line.tax_code ?? '',
    lotId: line.lot_id ?? '',
    lotCode: '',
    orderLineId: line.order_line_id ?? '',
  }))
}

/** Tariffs carry six decimals; the price field shows the short form. */
export function shortPrice(value: string | null | undefined): string {
  if (value == null || value === '') return ''
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : value
}

function trimQty(value: string): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  return String(n)
}

export type BuiltLines = { ok: LineInput[]; error: string | null; badKey: string | null }

export function commercialLines(lines: DraftLine[]): BuiltLines {
  const ok: LineInput[] = []
  for (const line of lines) {
    const typedSomething = line.touched || line.unitPrice !== ''
    if (!line.productId && !line.orderLineId) {
      if (typedSomething) return { ok: [], error: copy.sales.pickProduct, badKey: line.key }
      continue
    }
    const qty = Number(line.quantity)
    if (!Number.isFinite(qty) || qty <= 0) return { ok: [], error: copy.sales.needQuantity, badKey: line.key }
    const override = line.touched && line.unitPrice !== '' && (line.quoted == null || pricesDiffer(line.unitPrice, line.quoted))
    const reason = line.quoted == null ? line.reason.trim() || copy.sales.manualPrice : line.reason.trim()
    if (override && reason.length < 3) {
      return { ok: [], error: copy.sales.priceReasonRequired, badKey: line.key }
    }
    const payload: LineInput = {
      quantity: line.quantity,
      discount_pct: line.discount || '0',
    }
    if (line.productId) payload.product_id = line.productId
    if (line.orderLineId) payload.order_line_id = line.orderLineId
    if (line.taxCode) payload.tax_code = line.taxCode
    if (line.lotId) payload.lot_id = line.lotId
    if (override) {
      payload.unit_price = line.unitPrice
      payload.price_reason = reason
    }
    ok.push(payload)
  }
  if (ok.length === 0) return { ok: [], error: copy.sales.needLine, badKey: lines[0]?.key ?? null }
  return { ok, error: null, badKey: null }
}
