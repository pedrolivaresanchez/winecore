import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { isOwner } from '@/pages/aprobaciones/model'
import { listProcedures, showDecimal, type Procedure } from '@/pages/higiene/api'
import { useColumns } from '@/pages/higiene/columns'
import { ColumnPicker, HygieneFrame } from '@/pages/higiene/frame'
import { GRID_LABELS, matches, purposeLabel } from '@/pages/higiene/labels'
import { Search } from '@/ui/icons'
import { Badge, Button, Chip, DataGrid, EmptyState, Input, type GridColumn } from '@/ui'

const COLUMN_IDS = ['name', 'code', 'purpose', 'dose', 'contact', 'status'] as const

export function Procedimientos({ me }: { me: Me }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<'' | 'true' | 'false'>('')
  const [rows, setRows] = useState<Procedure[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ name: 260, code: 120, purpose: 140, dose: 160, contact: 110, status: 110 })
  const columnsState = useColumns('winecore.columns.hygiene.procedimientos', COLUMN_IDS, [])

  useEffect(() => {
    if (!isOwner(me)) return
    const controller = new AbortController()
    let activeRequest = true
    setLoading(true)
    listProcedures('', controller.signal)
      .then((body) => {
        if (!activeRequest) return
        setRows(body.items)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!activeRequest || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      activeRequest = false
      controller.abort()
    }
  }, [attempt, me])

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (active === 'true' && !row.is_active) return false
        if (active === 'false' && row.is_active) return false
        return matches(query, [row.name, row.code, row.product_name, purposeLabel(row.purpose)])
      }),
    [active, query, rows],
  )

  const columns = useMemo<GridColumn<Procedure>[]>(() => {
    const all: GridColumn<Procedure>[] = [
      { id: 'name', header: copy.higiene.name, cell: (row) => row.name },
      { id: 'code', header: copy.higiene.code, cell: (row) => row.code },
      { id: 'purpose', header: copy.higiene.purpose, cell: (row) => purposeLabel(row.purpose) },
      { id: 'dose', header: copy.higiene.dose, cell: (row) => `${showDecimal(row.dose_min)}–${showDecimal(row.dose_max)} ${row.dose_unit}` },
      { id: 'contact', header: copy.higiene.minutes, align: 'right', cell: (row) => `${row.contact_time_min}` },
      {
        id: 'status',
        header: copy.higiene.status,
        cell: (row) => (
          <Badge tone={row.is_active ? 'success' : 'neutral'} size="sm">
            {row.is_active ? copy.higiene.active : copy.higiene.inactive}
          </Badge>
        ),
      },
    ]
    return all.filter((column) => !columnsState.hidden.has(column.id))
  }, [columnsState.hidden])

  if (!isOwner(me)) return <NoPermission />

  const filtersActive = Boolean(query.trim() || active)
  const screen = loading ? 'higiene-procedimientos-cargando' : visible.length === 0 && !filtersActive ? 'higiene-procedimientos-vacio' : 'higiene-procedimientos'

  return (
    <HygieneFrame
      me={me}
      screen={screen}
      primary={
        <Button type="button" variant="primary" size="sm" onClick={() => navigate('/bodega/higiene/procedimientos/nuevo')}>
          {copy.higiene.newProcedure}
        </Button>
      }
      toolbar={
        <>
          <Input
            size="sm"
            type="search"
            value={query}
            placeholder={copy.higiene.search}
            aria-label={copy.higiene.search}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ColumnPicker
            columns={[
              { id: 'name', header: copy.higiene.name },
              { id: 'code', header: copy.higiene.code },
              { id: 'purpose', header: copy.higiene.purpose },
              { id: 'dose', header: copy.higiene.dose },
              { id: 'contact', header: copy.higiene.minutes },
              { id: 'status', header: copy.higiene.status },
            ]}
            hidden={columnsState.hidden}
            locked="name"
            onToggle={columnsState.toggle}
          />
        </>
      }
      filters={
        <>
          <Chip pressed={active === ''} active={active === ''} onClick={() => setActive('')}>
            {copy.higiene.all}
          </Chip>
          <Chip pressed={active === 'true'} active={active === 'true'} onClick={() => setActive(active === 'true' ? '' : 'true')}>
            {copy.higiene.active}
          </Chip>
          <Chip pressed={active === 'false'} active={active === 'false'} onClick={() => setActive(active === 'false' ? '' : 'false')}>
            {copy.higiene.inactive}
          </Chip>
        </>
      }
    >
      {error && rows.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/bodega/higiene/procedimientos/${row.id}`)}
          rowHref={(row) => `/bodega/higiene/procedimientos/${row.id}`}
          total={visible.length}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.higiene.noMatch : copy.higiene.emptyProcedures}
              description={filtersActive ? undefined : copy.higiene.emptyProceduresHint}
              action={
                !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => navigate('/bodega/higiene/procedimientos/nuevo')}>
                    {copy.higiene.newProcedure}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
    </HygieneFrame>
  )
}
