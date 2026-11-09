import { Link } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { ListFrame } from '@/pages/existencias/components/ListFrame'
import { VesselSilhouette } from '@/pages/existencias/silhouettes'
import { formatMl } from '@/pages/existencias/volume'
import { Box } from '@/ui/icons'
import { Badge, EmptyState } from '@/ui'
import { iconStroke } from '@/lib/motion'

type Line = {
  slot_code: string
  wine_label: string
  lot_code: string | null
  color: 'tinto' | 'blanco' | 'rosado' | 'otro' | null
  bottles: number
  volume_ml: number
  bottle_ml: number | null
  abv_pct: string | null
  organic: boolean | null
  state: string
  not_for_sale: boolean
  note: string | null
  match_status: string
  match_note: string | null
  pallet_count: number | null
}

type Niche = { number: number; empty: boolean; bottles: number; note: string | null; lines: Line[] }

type Layout = {
  photo_date: string
  loaded: boolean
  barrel_gap: { note: string; pedro_memory: number; operational: number[] }
  bodega: {
    name: string
    boxes: Line[]
    cages: Line[]
    niches: Niche[]
    barrels: { code: string; capacity_ml: number; volume_ml: number; fill_pct: number; wine: string | null; empty: boolean }[]
    demijohns: { count: number; volume_ml: number; expected_units: number }
    deposits: { count: number; volume_ml: number }
    lees: { capacity_ml: number; volume_ml: number } | null
  }
  tfrp: {
    name: string
    lines: Line[]
    counted_pallets: number
    price_eur_per_pallet_month: string
    operator: string
    invoices: { number: string; date: string; billed_pallets: number; amount_eur: string; mismatch: boolean }[]
  }
}

function litresOf(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.volume_ml, 0)
}

function bottlesOf(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.bottles, 0)
}

export function WarehousePage({ me }: { me: Me }) {
  const data = useApi<Layout>(allows(me, 'inventory.read') ? '/v1/stock/warehouses' : null)
  if (!allows(me, 'inventory.read')) return <NoPermission />
  const layout = data.data
  return (
    <ListFrame
      screen="stock-almacenes"
      title={copy.stock.warehouses}
      section="warehouses"
      icon={<Box className="size-4" strokeWidth={iconStroke} />}
    >
      {data.error ? (
        <div className="p-4">
          <ErrorState title={copy.error.load} detail={data.error.message} onRetry={data.reload} />
        </div>
      ) : !layout || data.loading ? (
        <div className="p-4">
          <EmptyState size="sm" title={copy.stock.warehouses} />
        </div>
      ) : !layout.loaded ? (
        <div className="p-4">
          <EmptyState size="sm" title="Sin foto de envasado" description="La carga está en el script de existencias, lista para ejecutar." />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
            <p className="text-caption text-text-tertiary">Foto del {layout.photo_date.split('-').reverse().join('/')}</p>
            <section className="flex flex-col gap-3">
              <h2 className="text-label font-medium text-ink-900">{layout.bodega.name}</h2>
              <p className="text-caption text-text-tertiary">
                Depósitos {layout.bodega.deposits.count} · {formatMl(layout.bodega.deposits.volume_ml)}
                {' · '}Damajuanas {layout.bodega.demijohns.count}/{layout.bodega.demijohns.expected_units} · {formatMl(layout.bodega.demijohns.volume_ml)}
                {layout.bodega.lees ? ` · Lías ${formatMl(layout.bodega.lees.volume_ml)}` : ''}
              </p>
              <h3 className="text-label text-ink-900">Zona barricas</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {layout.bodega.barrels.map((barrel) => (
                  <Link key={barrel.code} to={`/bodega/depositos/${encodeURIComponent(barrel.code)}`} className="rounded-2xl border border-border-subtle bg-surface p-2">
                    <VesselSilhouette kind="barrel" fill={barrel.fill_pct} wine={barrel.empty ? null : 'tinto'} label={`${barrel.code}, ${barrel.fill_pct} %`} />
                    <p className="truncate text-center text-caption text-ink-900">{barrel.code}</p>
                    <p className="truncate text-center text-caption text-text-tertiary">{barrel.empty ? 'Vacía' : barrel.wine}</p>
                  </Link>
                ))}
              </div>
              <p className="text-caption text-text-tertiary">{layout.barrel_gap.note}</p>
              <h3 className="text-label text-ink-900">Nichos</h3>
              <p className="text-caption text-text-tertiary">Un nicho puede partirse en etiquetado y sin etiquetar. Los jaulones son solo sin etiquetar. Pedro dirá el viernes qué parte de cada nicho va sin etiqueta.</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {layout.bodega.niches.map((niche) => (
                  <article key={niche.number} className="rounded-2xl border border-border-subtle bg-surface p-2">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-label font-medium text-ink-900">{niche.number}</p>
                      {niche.empty ? <Badge tone="neutral" size="sm">Vacío</Badge> : <Badge tone="info" size="sm">{niche.bottles}</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-3 text-caption text-text-tertiary">{niche.empty ? niche.note || 'Sin vino' : niche.lines.map((line) => `${line.wine_label}${line.state === 'packaged_unlabeled' ? ' · sin etiquetar' : ''}`).join(' · ')}</p>
                  </article>
                ))}
              </div>
              <LineBlock title="Envasado en cajas" lines={layout.bodega.boxes} />
              <LineBlock title="Vinos en jaulones (sin etiquetar)" lines={layout.bodega.cages} />
            </section>
            <section className="flex flex-col gap-3">
              <h2 className="text-label font-medium text-ink-900">{layout.tfrp.name}</h2>
              <p className="text-caption text-text-tertiary">
                {layout.tfrp.operator} · {layout.tfrp.counted_pallets} palets en stock · {layout.tfrp.price_eur_per_pallet_month.replace('.', ',')} €/palet/mes
              </p>
              {layout.tfrp.invoices.filter((invoice) => invoice.mismatch).map((invoice) => (
                <p key={invoice.number} className="text-caption text-warning-700">
                  Factura {invoice.number} ({invoice.date}): {invoice.billed_pallets} palets, {invoice.amount_eur.replace('.', ',')} €. La hoja cuenta {layout.tfrp.counted_pallets}.
                </p>
              ))}
              <LineBlock title="Palets" lines={layout.tfrp.lines} />
            </section>
          </div>
        </div>
      )}
    </ListFrame>
  )
}

function LineBlock({ title, lines }: { title: string; lines: Line[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <h3 className="border-b border-border-subtle px-4 py-2 text-label text-ink-900">
        {title} · {bottlesOf(lines)} bot · {formatMl(litresOf(lines))}
      </h3>
      <ul>
        {lines.filter((line) => line.bottles > 0 || line.note || line.wine_label).map((line) => (
          <li key={`${line.slot_code}-${line.wine_label}-${line.lot_code ?? ''}`} className="grid gap-1 border-b border-border-subtle px-4 py-2 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-label text-ink-900">{line.wine_label || line.slot_code}</p>
              {line.not_for_sale ? <Badge tone="warning" size="sm">No se vende</Badge> : null}
              {line.match_status === 'unmatched' ? <Badge tone="neutral" size="sm">Sin ficha</Badge> : null}
            </div>
            <p className="text-caption text-text-tertiary">
              {line.lot_code ? `Lote ${line.lot_code} · ` : ''}
              {line.bottles} bot
              {line.bottle_ml ? ` · ${(line.bottle_ml / 1000).toFixed(2).replace('.', ',')} L` : ''}
              {' · '}{formatMl(line.volume_ml)}
              {line.abv_pct ? ` · ${String(line.abv_pct).replace('.', ',')} % vol` : ''}
              {line.organic === true ? ' · eco' : line.organic === false ? ' · no eco' : ''}
              {line.color ? ` · ${line.color}` : ''}
              {line.pallet_count ? ` · ${line.pallet_count} palets` : ''}
            </p>
            {line.note || line.match_note ? <p className="text-caption text-text-tertiary">{line.note || line.match_note}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
