import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { Field } from '@/components/Field'
import { Select } from '@/ui'

type PriceList = { id: string; code: string; name: string; tax_included: boolean; is_active: boolean }

/** Pregunta qué tarifa aplicar. Vacío = la asignada al cliente, o la del canal. */
export function TariffSelect({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (id: string) => void
}) {
  const lists = useApi<{ items: PriceList[] }>('/v1/price-lists')
  const items = (lists.data?.items ?? []).filter((item) => item.is_active)
  return (
    <Field id={id} label={copy.sales.tariffAsk}>
      <Select id={id} className="w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{copy.sales.tariffDefault}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}{item.tax_included ? ' · IVA incluido' : ''}
          </option>
        ))}
      </Select>
    </Field>
  )
}
