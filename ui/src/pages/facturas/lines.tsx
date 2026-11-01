import { Combobox, type ComboOption } from '@/components/Combobox'
import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { Button, Input, Select } from '@/ui'
import { TAX_CODES, type LineDraft } from '@/pages/facturas/types'

export function LineEditor({
  lines,
  onChange,
  showProduct,
  products,
  invalidKey,
  hint,
}: {
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
  showProduct?: boolean
  /** Con catálogo, el producto se busca por nombre en vez de teclear su identificador. */
  products?: ComboOption[]
  invalidKey?: string | null
  hint?: (line: LineDraft) => string | null
}) {
  function update(key: string, patch: Partial<LineDraft>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  return (
    <div className="grid gap-3">
      {lines.map((line, index) => (
        <div
          key={line.key}
          data-line-invalid={invalidKey === line.key ? 'true' : undefined}
          className={`grid gap-3 rounded-2xl border p-3 ${invalidKey === line.key ? 'border-danger-500' : 'border-border-subtle'}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-label text-ink-900">{line.description || `${copy.facturas.product} ${index + 1}`}</p>
            {lines.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(lines.filter((item) => item.key !== line.key))}
              >
                {copy.facturas.removeLine}
              </Button>
            ) : null}
          </div>
          {showProduct ? (
            <Field id={`producto-${line.key}`} label={copy.facturas.product}>
              {products ? (
                <Combobox
                  id={`producto-${line.key}`}
                  size="sm"
                  options={products}
                  value={line.productId}
                  placeholder={copy.facturas.findProduct}
                  emptyText={copy.combobox.empty}
                  invalid={invalidKey === line.key && !line.productId}
                  onChange={(next) => update(line.key, { productId: next })}
                />
              ) : (
                <Input
                  id={`producto-${line.key}`}
                  size="sm"
                  value={line.productId}
                  onChange={(event) => update(line.key, { productId: event.target.value })}
                />
              )}
            </Field>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`ud-${line.key}`} label={copy.facturas.quantity}>
              <Input
                id={`ud-${line.key}`}
                size="sm"
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) => update(line.key, { quantity: event.target.value })}
              />
            </Field>
            <Field id={`precio-${line.key}`} label={copy.facturas.price} hint={hint?.(line) ?? undefined}>
              <Input
                id={`precio-${line.key}`}
                size="sm"
                inputMode="decimal"
                value={line.unitPrice}
                invalid={invalidKey === line.key && !!line.productId && line.unitPrice.trim() === ''}
                onChange={(event) => update(line.key, { unitPrice: event.target.value })}
              />
            </Field>
            <Field id={`dto-${line.key}`} label={copy.facturas.discount}>
              <Input
                id={`dto-${line.key}`}
                size="sm"
                inputMode="decimal"
                value={line.discountPct}
                onChange={(event) => update(line.key, { discountPct: event.target.value })}
              />
            </Field>
            <Field id={`lote-${line.key}`} label={showProduct ? copy.facturas.lotOptional : copy.facturas.lot}>
              <Input
                id={`lote-${line.key}`}
                size="sm"
                value={line.lotCode}
                onChange={(event) => update(line.key, { lotCode: event.target.value })}
              />
            </Field>
          </div>
          <Field id={`iva-${line.key}`} label={copy.facturas.taxCode}>
            <Select
              id={`iva-${line.key}`}
              size="sm"
              value={line.taxCode}
              onChange={(event) => update(line.key, { taxCode: event.target.value })}
            >
              {TAX_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ))}
    </div>
  )
}
