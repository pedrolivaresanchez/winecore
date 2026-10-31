import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { Badge, Skeleton } from '@/ui'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { FormatMaterials } from '@/pages/catalogo/FormatMaterials'
import { Fact, FactCard, RecordBar, RecordTabs } from '@/pages/catalogo/frame'
import { formatVolumeMl } from '@/pages/catalogo/money'
import { containerLabel, type Format, type ListPage } from '@/pages/catalogo/model'

const TABS = [
  { id: 'datos', label: 'Datos' },
  { id: 'materiales', label: copy.catalog.materials },
] as const

type TabId = (typeof TABS)[number]['id']

export function FormatPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const formats = useApi<ListPage<Format>>('/v1/formats?limit=100')
  const format = formats.data?.items.find((item) => item.id === id) ?? null
  const [tab, setTab] = useState<TabId>('datos')
  useChromeTitle(format?.name || 'Formato')

  if (!allows(me, 'catalog.read')) return <NoPermission />
  if (formats.loading && !formats.data) {
    return (
      <div data-screen="formato-cargando" aria-busy="true" className="grid gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (formats.error) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${formats.error.code})`} detail={formats.error.message} onRetry={formats.reload} />
      </div>
    )
  }
  if (!format) {
    return (
      <div className="p-6">
        <ErrorState title="No encuentro ese formato" />
      </div>
    )
  }

  return (
    <div data-screen="formato" data-tab={tab} className="flex min-h-0 flex-1 flex-col">
      <RecordBar backTo="/catalogo/formatos" backLabel={copy.catalog.backFormats} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{format.name}</h1>
            <p className="mt-0.5 text-label text-text-secondary">
              <span className="font-mono text-caption">{format.code}</span>
              {` · ${format.units_per_case} por caja · ${format.cases_per_pallet} por palé`}
            </p>
          </header>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={format.is_active ? 'success' : 'neutral'}>{format.is_active ? 'Activo' : 'Inactivo'}</Badge>
            <Badge tone="neutral">{containerLabel(format.container)}</Badge>
            <Badge tone="neutral">{formatVolumeMl(format.nominal_volume_ml)}</Badge>
          </div>
          <RecordTabs label="Secciones" tabs={[...TABS]} value={tab} onChange={setTab} />
          {tab === 'datos' ? (
            <FactCard title="Envase">
              <Fact label="Código" value={format.code} />
              <Fact label="Envase" value={containerLabel(format.container)} />
              <Fact label="Volumen" value={formatVolumeMl(format.nominal_volume_ml)} />
              <Fact label="Unidades por caja" value={String(format.units_per_case)} />
              <Fact label="Cajas por palé" value={String(format.cases_per_pallet)} />
              <Fact label="Peso bruto" value={format.unit_gross_weight_g == null ? '—' : `${format.unit_gross_weight_g} g`} />
              <Fact label="Peso neto" value={format.unit_net_weight_g == null ? '—' : `${format.unit_net_weight_g} g`} />
            </FactCard>
          ) : (
            <FormatMaterials formatId={format.id} canWrite={allows(me, 'catalog.write')} />
          )}
        </div>
      </div>
    </div>
  )
}
