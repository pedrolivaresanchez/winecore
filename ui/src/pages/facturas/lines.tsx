import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { Button, Input, Select } from '@/ui'
import { decimalDot } from '@/lib/sales-draft'
import { TAX_CODES, type LineDraft } from '@/pages/facturas/types'

export function LineEditor({
  lines,
  onChange,
}: {
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
}) {
  function update(key: string, patch: Partial<LineDraft>) {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  return (
    <div className="grid gap-3">
      {lines.map((line, index) => (
        <div key={line.key} className="grid gap-3 rounded-2xl border border-border-subtle p-3">
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`ud-${line.key}`} label={copy.facturas.quantity}>
              <Input
                id={`ud-${line.key}`}
                size="sm"
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) => update(line.key, { quantity: decimalDot(event.target.value) })}
              />
            </Field>
            <Field id={`precio-${line.key}`} label={copy.facturas.price}>
              <Input
                id={`precio-${line.key}`}
                size="sm"
                inputMode="decimal"
                value={line.unitPrice}
                onChange={(event) => update(line.key, { unitPrice: decimalDot(event.target.value) })}
              />
            </Field>
            <Field id={`dto-${line.key}`} label={copy.facturas.discount}>
              <Input
                id={`dto-${line.key}`}
                size="sm"
                inputMode="decimal"
                value={line.discountPct}
                onChange={(event) => update(line.key, { discountPct: decimalDot(event.target.value) })}
              />
            </Field>
            <Field id={`lote-${line.key}`} label={copy.facturas.lot}>
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
