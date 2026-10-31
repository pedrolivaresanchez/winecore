import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import {
  cleaningRows,
  fetchAppcc,
  listOperations,
  showDecimal,
  yearStart,
  todayMadrid,
  type AppccCleaning,
  type OperationHeader,
} from '@/pages/higiene/api'
import { useColumns } from '@/pages/higiene/columns'
import { EffluentField, FactList } from '@/pages/higiene/fields'
import { ColumnPicker, HygieneFrame } from '@/pages/higiene/frame'
import { GRID_LABELS, matches, purposeLabel } from '@/pages/higiene/labels'
import { Search } from '@/ui/icons'
import { iconStroke } from '@/lib/motion'
import { Badge, Button, Chip, DataGrid, Dialog, DialogBody, DialogHeader, EmptyState, Input, type GridColumn } from '@/ui'

type Row = {
  id: string
  procedure: string
  date: string
  target: string
  dose: string
  operator: string
  status: 'draft' | 'confirmed'
  draftId: string | null
  purpose: string
  contact: string
  rinsed: string
  notes: string
}

const COLUMN_IDS = ['procedure', 'date', 'target', 'dose', 'operator', 'status'] as const

export function Limpiezas({ me }: { me: Me }) {
  const navigate = useNavigate()
  const canOperate = allows(me, 'cellar.operate')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'' | 'draft' | 'confirmed'>('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Row | null>(null)
  const [widths, setWidths] = useState<Record<string, number>>({ procedure: 260, date: 120, target: 140, dose: 140, operator: 180, status: 120 })
  const columnsState = useColumns('winecore.columns.hygiene.limpiezas', COLUMN_IDS, [])

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    Promise.all([
      fetchAppcc(yearStart(), todayMadrid(), controller.signal),
      listOperations({ op_type: 'cleaning', status: 'draft', limit: 50 }, controller.signal),
    ])
      .then(([report, drafts]) => {
        if (!active) return
        setRows(merge(cleaningRows(report), drafts.items))
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, me])

  const visible = useMemo(
    () => rows.filter((row) => (status ? row.status === status : true) && matches(query, [row.procedure, row.target, row.operator, row.date])),
    [query, rows, status],
  )

  const columns = useMemo<GridColumn<Row>[]>(() => {
    const all: GridColumn<Row>[] = [
      { id: 'procedure', header: copy.higiene.procedure, cell: (row) => row.procedure },
      { id: 'date', header: copy.higiene.date, cell: (row) => row.date },
      { id: 'target', header: copy.higiene.target, cell: (row) => row.target },
      { id: 'dose', header: copy.higiene.dose, cell: (row) => row.dose },
      { id: 'operator', header: copy.higiene.operator, cell: (row) => row.operator },
      {
        id: 'status',
        header: copy.higiene.status,
        cell: (row) => (
          <Badge tone={row.status === 'confirmed' ? 'success' : 'warning'} size="sm">
            {row.status === 'confirmed' ? copy.higiene.confirmed : copy.higiene.draft}
          </Badge>
        ),
      },
    ]
    return all.filter((column) => !columnsState.hidden.has(column.id))
  }, [columnsState.hidden])

  if (!allows(me, 'cellar.read')) return <NoPermission />

  const filtersActive = Boolean(query.trim() || status)
  const screen = loading ? 'higiene-limpiezas-cargando' : visible.length === 0 && !filtersActive ? 'higiene-limpiezas-vacio' : 'higiene-limpiezas'

  return (
    <HygieneFrame
      me={me}
      screen={screen}
      primary={
        canOperate ? (
          <Button type="button" variant="primary" size="sm" onClick={() => navigate('/bodega/higiene/limpiezas/nueva')}>
            {copy.higiene.newCleaning}
          </Button>
        ) : null
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
            columns={COLUMN_IDS.map((id) => ({ id, header: headerOf(id) }))}
            hidden={columnsState.hidden}
            locked="procedure"
            onToggle={columnsState.toggle}
          />
        </>
      }
      filters={
        <>
          <Chip pressed={status === ''} active={status === ''} onClick={() => setStatus('')}>
            {copy.higiene.all}
          </Chip>
          <Chip pressed={status === 'confirmed'} active={status === 'confirmed'} onClick={() => setStatus(status === 'confirmed' ? '' : 'confirmed')}>
            {copy.higiene.confirmed}
          </Chip>
          <Chip pressed={status === 'draft'} active={status === 'draft'} onClick={() => setStatus(status === 'draft' ? '' : 'draft')}>
            {copy.higiene.draft}
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
          onOpenRow={(row) => {
            if (row.draftId) navigate(`/bodega/higiene/limpiezas/nueva?operation=${row.draftId}`)
            else setOpen(row)
          }}
          rowHref={(row) => (row.draftId ? `/bodega/higiene/limpiezas/nueva?operation=${row.draftId}` : undefined)}
          total={visible.length}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.higiene.noMatch : copy.higiene.emptyCleanings}
              description={filtersActive ? undefined : copy.higiene.emptyCleaningsHint}
              action={
                canOperate && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => navigate('/bodega/higiene/limpiezas/nueva')}>
                    {copy.higiene.newCleaning}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      <Dialog open={open !== null} onClose={() => setOpen(null)} labelledBy="limpieza-detalle" size="md">
        <DialogHeader titleId="limpieza-detalle" title={open?.procedure ?? copy.higiene.cleanings} onClose={() => setOpen(null)} />
        <DialogBody>
          {open ? (
            <div className="grid gap-4 pb-2">
              <FactList
                rows={[
                  { label: copy.higiene.date, value: open.date },
                  { label: copy.higiene.purpose, value: purposeLabel(open.purpose) },
                  { label: copy.higiene.target, value: open.target },
                  { label: copy.higiene.dose, value: open.dose },
                  { label: copy.higiene.contactTime, value: open.contact },
                  { label: copy.higiene.rinse, value: open.rinsed },
                  { label: copy.higiene.operator, value: open.operator },
                  { label: copy.higiene.notes, value: open.notes },
                ]}
              />
              <EffluentField id="efluente-limpieza" />
            </div>
          ) : null}
        </DialogBody>
      </Dialog>
    </HygieneFrame>
  )
}

function headerOf(id: (typeof COLUMN_IDS)[number]): string {
  if (id === 'procedure') return copy.higiene.procedure
  if (id === 'date') return copy.higiene.date
  if (id === 'target') return copy.higiene.target
  if (id === 'dose') return copy.higiene.dose
  if (id === 'operator') return copy.higiene.operator
  return copy.higiene.status
}

function merge(logs: AppccCleaning[], drafts: OperationHeader[]): Row[] {
  const confirmed: Row[] = logs.map((row, index) => ({
    id: `c-${row.occurred_on}-${row.procedure_code}-${index}`,
    procedure: row.procedure_name,
    date: formatDate(row.occurred_on),
    target: row.vessel_code || row.equipment_code || '—',
    dose: `${showDecimal(row.actual_dose)} ${row.actual_dose_unit}`,
    operator: row.operator,
    status: 'confirmed',
    draftId: null,
    purpose: row.purpose,
    contact: `${row.actual_contact_time_min} min`,
    rinsed: row.rinsed ? copy.higiene.yes : copy.higiene.no,
    notes: row.notes || '—',
  }))
  const pending: Row[] = drafts.map((row) => ({
    id: `d-${row.id}`,
    procedure: row.number || copy.higiene.draft,
    date: formatDate(row.occurred_at),
    target: '—',
    dose: '—',
    operator: row.performed_by,
    status: 'draft',
    draftId: row.id,
    purpose: 'cleaning',
    contact: '—',
    rinsed: '—',
    notes: '—',
  }))
  return [...pending, ...confirmed]
}
