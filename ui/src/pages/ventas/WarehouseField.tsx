import { Field } from '@/components/Field'
import { copy, fill } from '@/i18n'
import { formatQty } from '@/lib/sales'
import type { CatalogLocation, CatalogLot } from '@/lib/sales-catalog'
import { Select } from '@/ui'
import { unitsAt, warehouseLabel, warehouseOptions } from '@/pages/ventas/warehouse'

export function WarehouseField({
  id,
  locations,
  lots,
  value,
  onChange,
  products = [],
}: {
  id: string
  locations: CatalogLocation[]
  lots: CatalogLot[]
  value: string
  onChange: (id: string) => void
  /** Products already on the albarán, so the stock line names them. */
  products?: { id: string; label: string }[]
}) {
  const options = warehouseOptions(locations)
  const picked = products.filter((item) => item.id)
  const stock = picked.length > 0
    ? picked.map((item) => fill(copy.sales.warehouseLine, { name: item.label, qty: formatQty(unitsAt(lots, value, item.id)) })).join(' · ')
    : unitsAt(lots, value) > 0
      ? fill(copy.sales.warehouseStock, { qty: formatQty(unitsAt(lots, value)) })
      : copy.sales.warehouseEmpty
  return (
    <Field id={id} label={copy.sales.warehouse} hint={value ? stock : undefined}>
      <Select id={id} className="w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {warehouseLabel(item)}
          </option>
        ))}
      </Select>
    </Field>
  )
}
