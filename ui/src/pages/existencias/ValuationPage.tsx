import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError, api } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { formatInteger, formatLitres, formatMoney } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { ListFrame } from '@/pages/existencias/components/ListFrame'
import { Badge, Button, InfoTip, Input, Select, useToast } from '@/ui'
import { ChartBar } from '@/ui/icons'
import { cn } from '@/lib/cn'
import { FRAME_GUTTER } from '@/ui/frame'

const LISTS = [
  { code: 'distributor', label: 'Distribución' },
  { code: 'shop', label: 'Tienda' },
  { code: 'custom-horeca', label: 'Restaurante' },
  { code: 'final', label: 'PVP' },
] as const

type ListCode = (typeof LISTS)[number]['code']

type Line = {
  kind: 'packaged' | 'demijohn' | 'bulk'
  wine_id: string | null
  wine_name: string
  location_code: string
  location_name: string
  reference: string
  sku: string | null
  product_id: string | null
  lot_id: string | null
  lot_code: string | null
  vessel_code: string | null
  bottles: number | null
  litres: string
  unit_price: string | null
  price_unit: 'bottle' | 'litre'
  price_origin: 'override' | 'current' | 'previous' | 'worthless' | null
  price_note: string | null
  value: string | null
  missing_price: boolean
}

type Group = {
  wine_id: string | null
  wine_name: string
  bottles: number
  litres: string
  value: string | null
  partial: boolean
  lines: Line[]
}

type WineType = {
  code: string
  label: string
  bottles: number
  litres: string
  value: string | null
  partial: boolean
  groups: Group[]
}

type Body = {
  list: { code: ListCode; label: string; name: string | null; tax_included: boolean; available: boolean; version: number | null; valid_from: string | null }
  rates: { demijohn_eur_per_litre: string; bulk_eur_per_litre: string; bulk_wines: { wine_id: string; wine_name: string | null; eur_per_litre: string }[] }
  groups: Group[]
  types: WineType[]
  packaged: { bottles: number; litres: string; value: string | null; partial: boolean; missing: number; previous: number }
  demijohns: { litres: string; value: string | null; vessels: number }
  bulk: { litres: string; value: string | null; vessels: number }
  total: { value: string | null; partial: boolean }
}

function isList(value: string | null): value is ListCode {
  return LISTS.some((item) => item.code === value)
}

export function ValuationPage({ me }: { me: Me }) {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tarifa')
  const list: ListCode = isList(requested) ? requested : 'distributor'
  const canEdit = allows(me, 'inventory.count')
  const path = allows(me, 'inventory.read') ? `/v1/stock/valuation?list=${list}` : null
  const data = useApi<Body>(path)
  const [demijohn, setDemijohn] = useState('')
  const [bulk, setBulk] = useState('')
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data.data) return
    setDemijohn(comma(data.data.rates.demijohn_eur_per_litre))
    setBulk(comma(data.data.rates.bulk_eur_per_litre))
  }, [data.data])

  if (!allows(me, 'inventory.read')) return <NoPermission />
  const body = data.data

  async function save(payload: Record<string, unknown>) {
    setSaving(true)
    try {
      await api(`/v1/stock/valuation-settings?list=${list}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      toast(copy.stock.valuationSaved, { tone: 'success' })
      data.reload()
    } catch (error) {
      toast(error instanceof ApiError ? error.message : copy.error.load, { tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <ListFrame
      screen="stock-valoracion"
      title={copy.stock.valuationTitle}
      section="valuation"
      icon={<ChartBar className="size-4" strokeWidth={iconStroke} />}
      toolbar={
        <Select
          aria-label={copy.stock.valuationTariff}
          size="sm"
          value={list}
          className="min-w-0 flex-1 md:flex-none"
          onChange={(event) => {
            const next = event.target.value
            if (isList(next)) setParams({ tarifa: next })
          }}
        >
          {LISTS.map((item) => (
            <option key={item.code} value={item.code}>{item.label}</option>
          ))}
        </Select>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={cn('flex flex-col gap-4 py-4', FRAME_GUTTER)}>
          <div className="flex items-center gap-2">
            <h2 className="text-label font-medium text-ink-900">{body?.list.label ?? copy.stock.valuation}</h2>
            <InfoTip label={copy.stock.valuationTitle}>{copy.stock.valuationHelp}</InfoTip>
            {body?.list.tax_included ? <span className="text-caption text-text-tertiary">Sin IVA</span> : null}
            {body?.list.version != null ? (
              <span className="text-caption text-text-tertiary">v{body.list.version} · {civil(body.list.valid_from)}</span>
            ) : null}
            {body && !body.list.available ? <Badge tone="warning" size="sm">Sin tarifa</Badge> : null}
          </div>
          {data.error ? (
            <ErrorState title={copy.error.load} detail={data.error.message} onRetry={data.reload} />
          ) : !body || data.loading ? (
            <p className="text-label text-text-tertiary">{copy.stock.valuationTitle}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Tile label={copy.stock.valuationPackaged} value={body.packaged.value} detail={`${formatInteger(body.packaged.bottles)} bot · ${litres(body.packaged.litres)}`} partial={body.packaged.partial} />
                <Tile label={copy.stock.valuationDemijohns} value={body.demijohns.value} detail={litres(body.demijohns.litres)} />
                <Tile label={copy.stock.valuationBulk} value={body.bulk.value} detail={litres(body.bulk.litres)} />
                <Tile label={copy.stock.valuationTotal} value={body.total.value} partial={body.total.partial} emphasis />
              </div>
              {body.types.length === 0 ? (
                <p className="text-label text-text-tertiary">{copy.stock.valuationEmpty}</p>
              ) : body.types.map((type) => (
                <section key={type.code} className="flex flex-col gap-2">
                  <header className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                    <h2 className="text-body font-medium text-ink-900">{type.label}</h2>
                    <p className="text-caption text-text-secondary">
                      {type.bottles > 0 ? `${formatInteger(type.bottles)} bot · ` : ''}
                      {litres(type.litres)} · {money(type.value)}
                      {type.partial ? ` · ${copy.stock.valuationPartial}` : ''}
                    </p>
                  </header>
                  {type.groups.map((group) => (
                <section key={group.wine_id ?? group.wine_name} className="overflow-hidden rounded-xl border border-border bg-surface">
                  <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle px-3 py-2">
                    <h3 className="text-label font-medium text-ink-900">{group.wine_name}</h3>
                    <p className="text-caption text-text-secondary">
                      {group.bottles > 0 ? `${formatInteger(group.bottles)} bot · ` : ''}
                      {litres(group.litres)} · {money(group.value)}
                      {group.partial ? ` · ${copy.stock.valuationPartial}` : ''}
                    </p>
                  </header>
                  <ul className="divide-y divide-border-subtle md:hidden">
                    {group.lines.map((line) => (
                      <li key={lineKey(line)} className="flex flex-col gap-2 px-3 py-3">
                        <LineFacts line={line} />
                        {canEdit ? <LineActions line={line} list={list} rates={body.rates.bulk_wines} draft={priceDraft} setDraft={setPriceDraft} saving={saving} onSave={save} /> : null}
                      </li>
                    ))}
                  </ul>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[880px] text-left text-label">
                      <thead className="text-caption text-text-tertiary">
                        <tr>
                          <th className="whitespace-nowrap px-3 py-2 font-medium">{copy.stock.valuationWarehouse}</th>
                          <th className="whitespace-nowrap px-3 py-2 font-medium">{copy.stock.valuationReference}</th>
                          <th className="whitespace-nowrap px-3 py-2 font-medium">{copy.stock.valuationLot}</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{copy.stock.valuationBottles}</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{copy.stock.valuationLitres}</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{copy.stock.valuationPrice}</th>
                          <th className="whitespace-nowrap px-3 py-2 font-medium">{copy.stock.valuationOrigin}</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{copy.stock.valuationValue}</th>
                          {canEdit ? <th className="px-3 py-2 font-medium" /> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {group.lines.map((line) => (
                          <tr key={lineKey(line)} className="border-t border-border-subtle">
                            <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{line.location_code}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-ink-900">{line.sku ? `${line.sku} · ${line.reference}` : line.reference}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{line.lot_code ?? line.vessel_code ?? '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{line.bottles == null ? '—' : formatInteger(line.bottles)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{litres(line.litres)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{line.unit_price ? formatMoney(Number(line.unit_price)) : '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2"><Origin line={line} /></td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium">{money(line.value)}</td>
                            {canEdit ? (
                              <td className="px-3 py-2">
                                <LineActions line={line} list={list} rates={body.rates.bulk_wines} draft={priceDraft} setDraft={setPriceDraft} saving={saving} onSave={save} />
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                  ))}
                </section>
              ))}
              {canEdit ? (
                <form
                  className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-3 md:flex-row md:items-end"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void save({ demijohn_eur_per_litre: demijohn, bulk_eur_per_litre: bulk })
                  }}
                >
                  <p className="text-label font-medium text-ink-900 md:mr-2">{copy.stock.valuationRates}</p>
                  <label className="flex flex-col gap-1 text-caption text-text-tertiary">
                    {copy.stock.valuationDemijohnRate}
                    <Input aria-label={copy.stock.valuationDemijohnRate} size="sm" inputMode="decimal" value={demijohn} onChange={(event) => setDemijohn(event.target.value)} className="w-28" />
                  </label>
                  <label className="flex flex-col gap-1 text-caption text-text-tertiary">
                    {copy.stock.valuationBulkRate}
                    <Input aria-label={copy.stock.valuationBulkRate} size="sm" inputMode="decimal" value={bulk} onChange={(event) => setBulk(event.target.value)} className="w-28" />
                  </label>
                  <Button type="submit" size="sm" loading={saving}>{copy.stock.save}</Button>
                </form>
              ) : null}
            </>
          )}
        </div>
      </div>
    </ListFrame>
  )
}

function LineFacts({ line }: { line: Line }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-label text-ink-900">{line.sku ? `${line.sku} · ${line.reference}` : line.reference}</p>
      <p className="text-caption text-text-secondary">
        {line.location_name} · {line.lot_code ?? line.vessel_code ?? '—'}
        {line.bottles != null ? ` · ${formatInteger(line.bottles)} bot` : ''} · {litres(line.litres)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums text-label">{line.unit_price ? formatMoney(Number(line.unit_price)) : '—'}</span>
        <span className="text-caption text-text-tertiary">{line.price_unit === 'bottle' ? copy.stock.valuationPerBottle : copy.stock.valuationPerLitre}</span>
        <Origin line={line} />
        <span className="ml-auto tabular-nums text-label font-medium">{money(line.value)}</span>
      </div>
    </div>
  )
}

function LineActions({
  line, list, rates, draft, setDraft, saving, onSave,
}: {
  line: Line
  list: ListCode
  rates: { wine_id: string; eur_per_litre: string }[]
  draft: Record<string, string>
  setDraft: (next: Record<string, string>) => void
  saving: boolean
  onSave: (payload: Record<string, unknown>) => Promise<void>
}) {
  const key = line.product_id ?? line.wine_id ?? ''
  const worthless = line.price_origin === 'worthless'
  return (
    <div className="flex flex-nowrap items-center gap-1.5">
      {line.kind === 'packaged' && line.product_id && !worthless ? (
        <>
          <Input
            aria-label={copy.stock.valuationPrice}
            size="sm"
            inputMode="decimal"
            value={draft[key] ?? (line.price_origin === 'override' && line.unit_price ? comma(line.unit_price) : '')}
            placeholder={line.unit_price ? comma(line.unit_price) : '0,00'}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            className="w-24"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={saving}
            onClick={() => void onSave({ price: { product_id: line.product_id, list, unit_price: draft[key] || line.unit_price } })}
          >
            {copy.stock.valuationFix}
          </Button>
          {line.price_origin === 'override' ? (
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void onSave({ price: { product_id: line.product_id, list, unit_price: null } })}>
              {copy.stock.valuationClear}
            </Button>
          ) : null}
        </>
      ) : null}
      {line.kind === 'bulk' && line.wine_id && !worthless ? (
        <>
          <Input
            aria-label={copy.stock.valuationBulkRate}
            size="sm"
            inputMode="decimal"
            value={draft[line.wine_id] ?? ''}
            placeholder={comma(rates.find((row) => row.wine_id === line.wine_id)?.eur_per_litre ?? line.unit_price ?? '')}
            onChange={(event) => setDraft({ ...draft, [line.wine_id ?? '']: event.target.value })}
            className="w-24"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={saving}
            onClick={() => {
              const typed = draft[line.wine_id ?? '']
              if (!typed || !line.wine_id) return
              const others = rates.filter((row) => row.wine_id !== line.wine_id)
              void onSave({ bulk_wines: [...others, { wine_id: line.wine_id, eur_per_litre: typed }] })
            }}
          >
            {copy.stock.valuationFix}
          </Button>
        </>
      ) : null}
      {line.lot_id || line.vessel_code ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={() => {
            const target = line.vessel_code
              ? { subject: 'vessel' as const, subject_key: line.vessel_code, enabled: !worthless }
              : line.lot_id
                ? { subject: 'lot' as const, subject_key: line.lot_id, enabled: !worthless }
                : null
            if (target) void onSave({ worthless: target })
          }}
        >
          {worthless ? copy.stock.valuationRestore : copy.stock.valuationWorthless}
        </Button>
      ) : null}
    </div>
  )
}

function Origin({ line }: { line: Line }) {
  if (line.missing_price) return <Badge tone="warning" size="sm">{copy.stock.valuationMissing}</Badge>
  if (!line.price_note) return null
  const tone = line.price_origin === 'previous' ? 'warning' : line.price_origin === 'override' ? 'info' : line.price_origin === 'worthless' ? 'neutral' : 'success'
  return <span className="text-caption text-text-secondary"><Badge tone={tone} size="sm" variant="dot">{line.price_note}</Badge></span>
}

function Tile({ label, value, detail, partial, emphasis }: { label: string; value: string | null; detail?: string; partial?: boolean; emphasis?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface px-3 py-2', emphasis && 'border-border-strong')}>
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="tabular-nums text-body font-medium text-ink-900">{money(value)}</p>
      {detail ? <p className="text-caption text-text-secondary">{detail}</p> : null}
      {partial ? <p className="text-caption text-text-tertiary">{copy.stock.valuationPartial}</p> : null}
    </div>
  )
}

function lineKey(line: Line): string {
  return [line.kind, line.location_code, line.product_id, line.lot_id, line.vessel_code, line.reference].join(':')
}

function money(value: string | null): string {
  if (value == null) return '—'
  return formatMoney(Number(value))
}

function litres(value: string): string {
  return formatLitres(Number(value))
}

function comma(value: string): string {
  return value.replace('.', ',')
}

function civil(value: string | null): string {
  if (!value) return ''
  const [year, month, day] = value.slice(0, 10).split('-')
  return day && month && year ? `${day}/${month}/${year}` : value
}
