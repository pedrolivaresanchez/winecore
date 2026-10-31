import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { fieldAria } from '@/lib/field'
import { Alert, InfoTip, Input, SegmentedControl, Select, Switch, Textarea } from '@/ui'
import {
  agingName,
  inoculationName,
  setPractice,
  singlePlotMessage,
  vinificationName,
  type AgingMethod,
  type DesignInput,
  type DesignView,
  type DestinationKind,
  type InoculationKind,
  type NamedRef,
  type Vinification,
} from '@/pages/lote-diseno/model'

const VINIFICATIONS: Vinification[] = ['blanco', 'tinto', 'rosado', 'orange', 'otro']
const AGING: AgingMethod[] = ['deposito', 'barrica', 'damajuana_intemperie', 'sin_crianza']

export function DisenoForm({
  value,
  view,
  wines,
  products,
  yeasts,
  errors,
  disabled,
  onChange,
}: {
  value: DesignInput
  view: DesignView
  wines: NamedRef[]
  products: NamedRef[]
  yeasts: NamedRef[]
  errors: Record<string, string>
  disabled?: boolean
  onChange: (next: DesignInput) => void
}) {
  const plotMessage = errors.parcel_id || singlePlotMessage(view.single_plot_allowed, view.origin_parcels, value.single_plot)
  const wineProducts = products.filter((item) => !value.wine_id || !item.wine_id || item.wine_id === value.wine_id)
  const parcels = [...view.origin_parcels]
  if (value.parcel_id && !parcels.some((parcel) => parcel.id === value.parcel_id)) {
    parcels.push({ id: value.parcel_id, code: value.parcel_id.slice(0, 8), name: '' })
  }

  function setDestination(kind: DestinationKind) {
    onChange({
      ...value,
      destination_kind: kind,
      wine_id: kind === 'reference' ? value.wine_id : null,
      product_id: kind === 'reference' ? value.product_id : null,
      collection_name: kind === 'new_collection' ? value.collection_name : null,
    })
  }

  function setSingle(on: boolean) {
    const only = view.origin_parcels.length === 1 ? view.origin_parcels[0] : undefined
    onChange({
      ...value,
      single_plot: on,
      parcel_id: on ? (only?.id ?? value.parcel_id) : null,
      label_number: on ? 1 : value.label_number === 1 ? null : value.label_number,
    })
  }

  return (
    <div className="grid gap-4" data-screen="lote-diseno-editar">
      <div className="grid gap-1.5">
        <span className="text-label text-text-secondary">{copy.lote.destination}</span>
        <SegmentedControl
          fill
          size="sm"
          aria-label={copy.lote.destination}
          value={value.destination_kind}
          onChange={setDestination}
          options={[
            { value: 'reference', content: copy.lote.reference },
            { value: 'new_collection', content: copy.lote.collection, 'aria-label': copy.lote.newCollection },
            { value: 'pending', content: copy.lote.pending },
          ]}
        />
      </div>
      {value.destination_kind === 'reference' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="wine" label={copy.lote.wine} error={errors.wine_id}>
            <Select
              {...fieldAria('wine', errors.wine_id)}
              className="w-full"
              value={value.wine_id ?? ''}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, wine_id: event.target.value || null })}
            >
              <option value="">{copy.lote.none}</option>
              {wines.map((wine) => (
                <option key={wine.id} value={wine.id}>
                  {wine.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="product" label={copy.lote.product} error={errors.product_id}>
            <Select
              {...fieldAria('product', errors.product_id)}
              className="w-full"
              value={value.product_id ?? ''}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, product_id: event.target.value || null })}
            >
              <option value="">{copy.lote.none}</option>
              {wineProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      {value.destination_kind === 'new_collection' ? (
        <Field id="collection" label={copy.lote.workingName} error={errors.collection_name}>
          <Input
            {...fieldAria('collection', errors.collection_name)}
            invalid={Boolean(errors.collection_name)}
            value={value.collection_name ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, collection_name: event.target.value })}
          />
        </Field>
      ) : null}
      <div className="grid gap-1.5">
        <div className="flex items-center gap-1">
          <label htmlFor="vinification" className="text-label text-text-secondary">
            {copy.lote.vinification}
          </label>
          <InfoTip label={copy.lote.vinification}>{copy.lote.vinificationTip}</InfoTip>
        </div>
        <Select
          id="vinification"
          className="w-full"
          value={value.vinification}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, vinification: event.target.value as Vinification })}
        >
          {VINIFICATIONS.map((item) => (
            <option key={item} value={item}>
              {vinificationName(item)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-label text-ink-900">{copy.lote.destemmed}</span>
        <Switch aria-label={copy.lote.destemmed} checked={value.destemmed} disabled={disabled} onChange={(on) => onChange({ ...value, destemmed: on })} />
      </div>
      <div className="grid gap-1.5">
        <span className="text-label text-text-secondary">{copy.lote.inoculation}</span>
        <SegmentedControl
          fill
          size="sm"
          aria-label={copy.lote.inoculation}
          value={value.inoculation_kind}
          onChange={(kind) =>
            onChange({
              ...value,
              inoculation_kind: kind,
              yeast_product_id: kind === 'comercial' ? value.yeast_product_id : null,
              yeast_lot_code: kind === 'comercial' ? value.yeast_lot_code : null,
              yeast_name: kind === 'comercial' ? value.yeast_name : null,
            })
          }
          options={[
            { value: 'espontanea' as InoculationKind, content: inoculationName('espontanea') },
            { value: 'comercial' as InoculationKind, content: inoculationName('comercial') },
          ]}
        />
      </div>
      {value.inoculation_kind === 'comercial' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="yeast" label={copy.lote.yeast} error={errors.yeast_name}>
            <Input
              {...fieldAria('yeast', errors.yeast_name)}
              invalid={Boolean(errors.yeast_name)}
              value={value.yeast_name ?? ''}
              disabled={disabled}
              list="cepas"
              onChange={(event) => {
                const name = event.target.value
                const match = yeasts.find((item) => item.name === name)
                onChange({ ...value, yeast_name: name, yeast_product_id: match?.id ?? null })
              }}
            />
            <datalist id="cepas">
              {yeasts.map((item) => (
                <option key={item.id} value={item.name} />
              ))}
            </datalist>
          </Field>
          <Field id="yeast-lot" label={copy.lote.yeastLot} error={errors.yeast_lot_code}>
            <Input
              {...fieldAria('yeast-lot', errors.yeast_lot_code)}
              invalid={Boolean(errors.yeast_lot_code)}
              value={value.yeast_lot_code ?? ''}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, yeast_lot_code: event.target.value })}
            />
          </Field>
        </div>
      ) : null}
      <section className="grid gap-2">
        <h3 className="text-label font-medium text-ink-900">{copy.lote.practices}</h3>
        <ul className="overflow-hidden rounded-2xl border border-border-subtle">
          {view.practice_catalog.map((practice) => {
            const applied = value.practices_applied.includes(practice.code)
            const skipped = value.practices_not_applied.includes(practice.code)
            return (
              <li key={practice.code} className="grid gap-2 border-b border-border-subtle px-3 py-2.5 last:border-b-0">
                <span className="text-label text-ink-900">{practice.name_es}</span>
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex items-center gap-2 text-caption text-text-secondary">
                    <Switch
                      aria-label={`${practice.name_es}, ${copy.lote.applied}`}
                      checked={applied}
                      disabled={disabled}
                      onChange={(on) => onChange(setPractice(value, view.practice_catalog, practice.code, on ? 'applied' : 'clear'))}
                    />
                    {copy.lote.applied}
                  </span>
                  <span className="flex items-center gap-2 text-caption text-text-secondary">
                    <Switch
                      aria-label={`${practice.name_es}, ${copy.lote.notApplied}`}
                      checked={skipped}
                      disabled={disabled}
                      onChange={(on) => onChange(setPractice(value, view.practice_catalog, practice.code, on ? 'not' : 'clear'))}
                    />
                    {copy.lote.notApplied}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="aging" label={copy.lote.aging}>
          <Select
            id="aging"
            className="w-full"
            value={value.aging_method}
            disabled={disabled}
            onChange={(event) => {
              const aging_method = event.target.value as AgingMethod
              onChange({
                ...value,
                aging_method,
                aging_duration_days: aging_method === 'sin_crianza' ? null : value.aging_duration_days,
              })
            }}
          >
            {AGING.map((item) => (
              <option key={item} value={item}>
                {agingName(item)}
              </option>
            ))}
          </Select>
        </Field>
        {value.aging_method === 'sin_crianza' ? null : (
          <Field id="aging-days" label={copy.lote.agingDays} error={errors.aging_duration_days}>
            <Input
              {...fieldAria('aging-days', errors.aging_duration_days)}
              invalid={Boolean(errors.aging_duration_days)}
              inputMode="numeric"
              value={value.aging_duration_days ?? ''}
              disabled={disabled}
              onChange={(event) => {
                const raw = event.target.value.trim()
                onChange({ ...value, aging_duration_days: raw === '' ? null : Number(raw) })
              }}
            />
          </Field>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-label text-ink-900">{copy.lote.singlePlot}</span>
        <Switch aria-label={copy.lote.singlePlot} checked={value.single_plot} disabled={disabled} onChange={setSingle} />
      </div>
      {plotMessage ? <Alert tone="warning">{plotMessage}</Alert> : null}
      {value.single_plot ? (
        <Field id="parcel" label={copy.lote.parcel} error={errors.parcel_id && errors.parcel_id !== plotMessage ? errors.parcel_id : undefined}>
          <Select
            {...fieldAria('parcel', errors.parcel_id)}
            className="w-full"
            value={value.parcel_id ?? ''}
            disabled={disabled || parcels.length === 0}
            onChange={(event) => onChange({ ...value, parcel_id: event.target.value || null, label_number: 1 })}
          >
            <option value="">{copy.lote.none}</option>
            {parcels.map((parcel) => (
              <option key={parcel.id} value={parcel.id}>
                {parcel.name ? `${parcel.code} · ${parcel.name}` : parcel.code}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="grid gap-1.5">
        <div className="flex items-center gap-1">
          <label htmlFor="label-number" className="text-label text-text-secondary">
            {copy.lote.labelNumber}
          </label>
          <InfoTip label={copy.lote.labelNumber}>{copy.lote.labelTip}</InfoTip>
        </div>
        <Input
          id="label-number"
          inputMode="numeric"
          invalid={Boolean(errors.label_number)}
          aria-invalid={errors.label_number ? true : undefined}
          aria-describedby={errors.label_number ? 'label-number-error' : undefined}
          value={value.single_plot ? 1 : (value.label_number ?? '')}
          disabled={disabled || value.single_plot}
          onChange={(event) => {
            const raw = event.target.value.trim()
            onChange({ ...value, label_number: raw === '' ? null : Number(raw) })
          }}
        />
        {errors.label_number ? (
          <p id="label-number-error" role="alert" className="text-caption text-danger-600">
            {errors.label_number}
          </p>
        ) : null}
      </div>
      {view.origin_parcels.length > 0 ? (
        <p className="text-caption text-text-tertiary">
          {copy.lote.origin} · {view.origin_parcels.map((parcel) => parcel.code).join(' · ')}
        </p>
      ) : null}
      <Field id="notes" label={copy.lote.notes} error={errors.notes}>
        <Textarea
          {...fieldAria('notes', errors.notes)}
          invalid={Boolean(errors.notes)}
          value={value.notes ?? ''}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, notes: event.target.value })}
        />
      </Field>
    </div>
  )
}
