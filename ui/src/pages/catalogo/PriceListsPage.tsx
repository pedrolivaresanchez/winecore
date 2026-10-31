import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { formatDate } from '@/lib/format'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Badge, DataGrid, EmptyState, Input, type GridColumn } from '@/ui'
import { Search } from '@/ui/icons'
import { listVersions } from '@/pages/catalogo/api'
import { ListFrame } from '@/pages/catalogo/frame'
import { GRID_LABELS } from '@/pages/catalogo/labels'
import type { ListPage, PriceList, PriceListVersion } from '@/pages/catalogo/model'

export function PriceListsPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const lists = useApi<ListPage<PriceList>>('/v1/price-lists?limit=100')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ name: 260, code: 140 })
  const [versions, setVersions] = useState<Record<string, PriceListVersion[]>>({})
  const needle = q.trim().toLowerCase()
  const rows = (lists.data?.items ?? []).filter((list) => {
    if (!needle) return true
    return list.name.toLowerCase().includes(needle) || list.code.toLowerCase().includes(needle)
  })

  useEffect(() => {
    const items = lists.data?.items ?? []
    if (items.length === 0) return
    let live = true
    Promise.all(items.map((list) => listVersions(list.id).then((page) => [list.id, page.items] as const)))
      .then((pairs) => {
        if (!live) return
        setVersions(Object.fromEntries(pairs))
      })
      .catch(() => {
        if (live) setVersions({})
      })
    return () => {
      live = false
    }
  }, [lists.data])

  const columns = useMemo<GridColumn<PriceList>[]>(
    () => [
      { id: 'name', header: 'Nombre', cell: (row) => row.name },
      { id: 'code', header: 'Código', cell: (row) => <span className="font-mono text-caption">{row.code}</span> },
      { id: 'currency', header: 'Moneda', cell: (row) => row.currency },
      { id: 'tax', header: 'IVA', cell: (row) => (row.tax_included ? 'Incluido' : 'Aparte') },
      {
        id: 'version',
        header: 'Versión activa',
        cell: (row) => {
          const active = (versions[row.id] ?? []).find((version) => version.status === 'active')
          const version = row.active_version ?? active?.version
          const from = row.active_valid_from ?? active?.valid_from
          return version ? `v${version}${from ? ` · ${formatDate(from)}` : ''}` : '—'
        },
      },
      {
        id: 'active',
        header: 'Estado',
        cell: (row) => <Badge tone={row.is_active ? 'success' : 'neutral'}>{row.is_active ? 'Activa' : 'Inactiva'}</Badge>,
      },
    ],
    [versions],
  )

  if (!allows(me, 'catalog.read')) return <NoPermission />
  const loading = lists.loading && !lists.data
  const empty = !loading && !lists.error && (lists.data?.items.length ?? 0) === 0
  const screen = loading ? 'tarifas-cargando' : empty ? 'tarifas-vacio' : 'tarifas'

  return (
    <ListFrame
      screen={screen}
      object="tarifas"
      toolbar={
        <Input
          id="buscar-tarifas"
          size="sm"
          type="search"
          value={q}
          placeholder={copy.catalog.search}
          aria-label="Buscar tarifa"
          className="w-28 min-w-0 flex-1 sm:w-56 sm:flex-none"
          prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          onChange={(event) => setQ(event.target.value)}
        />
      }
    >
      {lists.error ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${lists.error.code})`} detail={lists.error.message} onRetry={lists.reload} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/catalogo/tarifas/${row.id}`)}
          rowHref={(row) => `/catalogo/tarifas/${row.id}`}
          loading={loading}
          total={rows.length}
          empty={
            <EmptyState
              size="sm"
              title={needle ? copy.catalog.noTariffMatch : copy.catalog.emptyTariffs}
              description={needle ? undefined : copy.catalog.emptyTariffsHint}
            />
          }
        />
      )}
    </ListFrame>
  )
}
