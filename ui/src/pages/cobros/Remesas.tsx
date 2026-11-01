import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import {
  Button,
  DataGrid,
  EmptyState,
  Pagination,
  StatusPill,
  useCursorPages,
  useToast,
  type FilterDef,
  type FilterValue,
  type GridColumn,
} from '@/ui'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { listRemittances, type RemittanceSummary } from '@/lib/finance'
import { allows } from '@/lib/permissions'
import { entityTone, type StatusTone } from '@/lib/status-tones'
import type { EntityChoice, Me } from '@/lib/types'
import { CobrosFrame } from '@/pages/cobros/CobrosFrame'
import { vistaOf } from '@/pages/cobros/vista'
import { entityLabel, gridLabels, kindLabel, moneyOf, statusLabel } from '@/pages/cobros/money'
import { NuevaRemesaDialog } from '@/pages/cobros/NuevaRemesaDialog'

/** The API pages at most 100 remittances at a time. */
const SIZES = [25, 50, 100] as const

const STATUS_TONE: Record<string, StatusTone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'info',
  file_generated: 'sky',
  uploaded_by_user: 'success',
  settled: 'success',
  partially_rejected: 'flame',
  cancelled: 'slate',
}

/** The rail picks the entity; `?entity=all` overrides it for this view only. */
function entityOf(raw: string | null, rail: EntityChoice): string {
  if (raw === 'all') return ''
  if (raw === 'PO' || raw === 'CVPO') return raw
  return rail === 'all' ? '' : rail
}

export function Remesas({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { filter: rail } = useEntity()
  const [params, setParams] = useSearchParams()
  const kindRaw = params.get('clase')
  const kind = kindRaw === 'direct_debit' || kindRaw === 'credit_transfer' ? kindRaw : ''
  const entity = entityOf(params.get('entity'), rail)
  const vista = vistaOf(params.get('vista'))
  const [q, setQ] = useState('')
  const [widths, setWidths] = useState<Record<string, number>>({ date: 140, kind: 150, entity: 110, status: 200, total: 140 })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const canManage = allows(me, 'finance.manage')
  const pages = useCursorPages<RemittanceSummary>({
    queryKey: [kind, entity].join('|'),
    storageKey: 'cobros-remesas',
    sizes: SIZES,
    fetchPage: ({ cursor, limit, signal }) => listRemittances({ entity, kind, cursor, limit }, signal),
  })

  useEffect(() => {
    setPicked(new Set())
  }, [pages.pageKey])

  const query = q.trim().toLocaleLowerCase('es')
  const shown = useMemo(
    () =>
      pages.items.filter((row) => {
        if (!query) return true
        return `${kindLabel(row.kind)} ${statusLabel(row.status)} ${row.total} ${row.execution_date ?? ''}`.toLocaleLowerCase('es').includes(query)
      }),
    [pages.items, query],
  )
  const filtersActive = Boolean(query || kind || entity)
  const loadingFirst = pages.loading && pages.items.length === 0 && !pages.error
  const screen = loadingFirst ? 'cobros-cargando' : shown.length === 0 ? 'cobros-remesas-vacio' : 'cobros-remesas'
  const error = pages.error ? (pages.error instanceof ApiError ? pages.error : new ApiError(0, 'WC_ERROR', copy.error.load)) : null

  function update(change: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params)
    change(next)
    setParams(next, { replace: true })
  }

  function setFilter(id: string, value: FilterValue) {
    const raw = typeof value === 'string' ? value : ''
    update((next) => {
      if (raw) next.set(id, raw)
      else if (id === 'entity' && rail !== 'all') next.set('entity', 'all')
      else next.delete(id)
    })
  }

  function clearFilters() {
    update((next) => {
      next.delete('clase')
      next.delete('entity')
      if (rail !== 'all') next.set('entity', 'all')
    })
    setQ('')
  }

  const filters: FilterDef[] = [
    {
      id: 'clase',
      label: copy.cobros.kind,
      kind: 'single',
      display: 'chips',
      options: [
        { value: 'direct_debit', label: copy.cobros.debitKind },
        { value: 'credit_transfer', label: copy.cobros.transferKind },
      ],
    },
    {
      id: 'entity',
      label: copy.salesDocs.entity,
      kind: 'single',
      options: me.entities.map((item) => ({ value: item.code, label: entityLabel(item.id, me.entities), tone: entityTone(item.code) })),
    },
  ]

  const columns = useMemo<GridColumn<RemittanceSummary>[]>(
    () => [
      { id: 'date', header: copy.cobros.executionDate, cell: (row) => (row.execution_date ? formatDate(row.execution_date) : '—') },
      { id: 'kind', header: copy.cobros.kind, cell: (row) => kindLabel(row.kind) },
      {
        id: 'entity',
        header: copy.salesDocs.entity,
        filterValue: (row) => entityLabel(row.legal_entity_id, me.entities),
        cell: (row) => <StatusPill tone={entityTone(row.entity_code)}>{entityLabel(row.legal_entity_id, me.entities)}</StatusPill>,
      },
      {
        id: 'status',
        header: copy.cobros.status,
        filterValue: (row) => statusLabel(row.status),
        cell: (row) => <StatusPill tone={STATUS_TONE[row.status] ?? 'neutral'}>{statusLabel(row.status)}</StatusPill>,
      },
      { id: 'total', header: copy.cobros.total, align: 'right', cell: (row) => <span className="tabular-nums">{moneyOf(row.total)}</span> },
    ],
    [me.entities],
  )

  return (
    <CobrosFrame
      screen={screen}
      vista={vista}
      action={canManage ? { label: copy.cobros.newRemittance, onClick: () => setCreating(true) } : null}
      bar={{
        search: { id: 'buscar-remesas', value: q, onChange: setQ, placeholder: copy.cobros.searchRemittances },
        filters,
        values: { clase: kind, entity },
        onChange: setFilter,
        onClear: clearFilters,
      }}
    >
      {error && pages.items.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={pages.reload} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={shown}
          rowKey={(row) => row.id}
          labels={gridLabels(copy.cobros.remittance)}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/cobros/remesas/${row.id}`)}
          rowHref={(row) => `/cobros/remesas/${row.id}`}
          total={pages.total ?? undefined}
          loading={pages.loading}
          scrollKey={pages.pageKey}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.cobros.noMatch : copy.cobros.remittancesEmpty}
              description={filtersActive ? undefined : copy.cobros.remittancesEmptyHint}
              action={
                canManage && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
                    {copy.cobros.newRemittance}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      <Pagination {...pages.pagination} />
      <NuevaRemesaDialog
        me={me}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          toast(copy.cobros.remittanceToast, { tone: 'success' })
          navigate(`/cobros/remesas/${id}`)
        }}
      />
    </CobrosFrame>
  )
}
