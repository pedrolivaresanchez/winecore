import { copy } from '@/i18n'
import type { CatalogLocation, CatalogLot, CatalogProduct } from '@/lib/sales-catalog'
import { blankLine, type DraftLine } from '@/lib/sales-draft'
import { formatAmount, pricesDiffer, TAX_CODES, taxLabel } from '@/lib/sales'
import { Button, InfoTip, Input, Select } from '@/ui'

export function LineEditor({
  lines,
  onChange,
  products,
  lots,
  locations,
  showLot,
  locationId,
  lockCount,
  askReason = true,
  freeLot,
  onPrice,
}: {
  lines: DraftLine[]
  onChange: (next: DraftLine[]) => void
  products: CatalogProduct[]
  lots: CatalogLot[]
  locations: CatalogLocation[]
  showLot?: boolean
  locationId?: string
  lockCount?: boolean
  askReason?: boolean
  /** A lot-tracked product with no lot of it in stock takes a typed lot code instead of the empty list. */
  freeLot?: boolean
  onPrice: (line: DraftLine) => void
}) {
  function patch(key: string, partial: Partial<DraftLine>, reprice = false) {
    const next = lines.map((line) => (line.key === key ? { ...line, ...partial } : line))
    onChange(next)
    if (reprice) {
      const line = next.find((item) => item.key === key)
      if (line) onPrice(line)
    }
  }

  return (
    <div className="grid gap-3">
      {lockCount ? (
        <p className="flex items-center gap-1 text-label text-text-secondary">
          {copy.sales.lines}
          <InfoTip label={copy.sales.lines}>{copy.sales.lineLock}</InfoTip>
        </p>
      ) : null}
      {products.length === 0 ? <p className="text-label text-text-secondary">{copy.sales.noProducts}</p> : null}
      <ul className="grid gap-3">
        {lines.map((line, index) => {
          const place = locationId || (locations.length === 1 ? locations[0]?.id : '')
          const choices = lots.filter((lot) => lot.productId === line.productId && (!place || lot.locationId === place))
          const differs = askReason && line.touched && line.unitPrice !== '' && (line.quoted == null || pricesDiffer(line.unitPrice, line.quoted))
          return (
            <li key={line.key} className="grid gap-2 rounded-2xl border border-border-subtle p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption text-text-tertiary">{index + 1}</span>
                {lockCount || lines.length === 1 ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange(lines.filter((item) => item.key !== line.key))}
                  >
                    {copy.sales.removeLine}
                  </Button>
                )}
              </div>
              <label className="grid gap-1">
                <span className="text-label text-text-secondary">{copy.sales.product}</span>
                <Select
                  className="w-full"
                  value={line.productId}
                  aria-label={copy.sales.product}
                  onChange={(event) => patch(line.key, { productId: event.target.value, lotId: '', lotCode: '', touched: false }, true)}
                >
                  <option value="">{copy.sales.product}</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.label}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1">
                  <span className="text-label text-text-secondary">{copy.sales.quantity}</span>
                  <Input
                    inputMode="decimal"
                    value={line.quantity}
                    aria-label={copy.sales.quantity}
                    onChange={(event) => patch(line.key, { quantity: event.target.value }, true)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-label text-text-secondary">{copy.sales.discount}</span>
                  <Input
                    inputMode="decimal"
                    value={line.discount}
                    aria-label={copy.sales.discount}
                    onChange={(event) => patch(line.key, { discount: event.target.value })}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-label text-text-secondary">{copy.sales.price}</span>
                  <Input
                    inputMode="decimal"
                    value={line.unitPrice}
                    aria-label={copy.sales.price}
                    onChange={(event) => patch(line.key, { unitPrice: event.target.value, touched: true })}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-label text-text-secondary">{copy.sales.tax}</span>
                  <Select
                    className="w-full"
                    value={line.taxCode}
                    aria-label={copy.sales.tax}
                    onChange={(event) => patch(line.key, { taxCode: event.target.value })}
                  >
                    <option value="">{copy.sales.tax}</option>
                    {TAX_CODES.map((code) => (
                      <option key={code} value={code}>
                        {taxLabel(code)}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              {line.quoted ? (
                <p className="text-caption text-text-tertiary tabular-nums">
                  {formatAmount(line.quoted)}
                </p>
              ) : null}
              {differs ? (
                <label className="grid gap-1">
                  <span className="text-label text-text-secondary">{copy.sales.priceReason}</span>
                  <Input
                    value={line.reason}
                    aria-label={copy.sales.priceReason}
                    onChange={(event) => patch(line.key, { reason: event.target.value })}
                  />
                </label>
              ) : null}
              {showLot && freeLot && choices.length === 0 && products.find((item) => item.id === line.productId)?.requiresLot ? (
                <label className="grid gap-1">
                  <span className="text-label text-text-secondary">{copy.sales.lot}</span>
                  <Input
                    value={line.lotCode}
                    placeholder={copy.sales.lotCode}
                    aria-label={copy.sales.lot}
                    onChange={(event) => patch(line.key, { lotCode: event.target.value })}
                  />
                </label>
              ) : showLot ? (
                <label className="grid gap-1">
                  <span className="text-label text-text-secondary">{copy.sales.lot}</span>
                  <Select
                    className="w-full"
                    value={line.lotId}
                    aria-label={copy.sales.lot}
                    onChange={(event) => patch(line.key, { lotId: event.target.value })}
                  >
                    <option value="">{choices.length === 0 ? copy.sales.noLots : copy.sales.lot}</option>
                    {choices.map((lot, lotIndex) => (
                      <option key={`${lot.id}-${lot.locationId}`} value={lot.id}>
                        {lot.code}
                        {lotIndex === 0 ? ` · ${copy.sales.suggested}` : ''} · {lot.qty}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
            </li>
          )
        })}
      </ul>
      {lockCount ? null : (
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...lines, blankLine()])}>
            {copy.sales.addLine}
          </Button>
        </div>
      )}
    </div>
  )
}
