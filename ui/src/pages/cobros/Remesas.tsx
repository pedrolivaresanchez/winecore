import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { Badge, Button, Chip, DataGrid, EmptyState, Input, useToast, type GridColumn } from '@/ui'
import { Search } from '@/ui/icons'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { listRemittances, type Remittance } from '@/lib/finance'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { CobrosFrame } from '@/pages/cobros/CobrosFrame'
import { vistaOf } from '@/pages/cobros/vista'
import { entityLabel, gridLabels, kindLabel, moneyOf, statusLabel } from '@/pages/cobros/money'
import { NuevaRemesaDialog } from '@/pages/cobros/NuevaRemesaDialog'

export function Remesas({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { entityCode } = useEntity()
  const [params, setParams] = useSearchParams()
  const kind = params.get('clase') ?? ''
  const vista = vistaOf(params.get('vista'))
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Remittance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [widths, setWidths] = useState<Record<string, number>>({ date: 140, kind: 150, entity: 110, status: 200, total: 140 })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const canManage = allows(me, 'finance.manage')
  const entityId = me.entities.find((entity) => entity.code === entityCode)?.id ?? null

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    listRemittances(controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setRows(items)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => controller.abort()
  }, [attempt])

  const query = q.trim().toLocaleLowerCase('es')
  const shown = useMemo(
    () =>
      rows.filter((row) => {
        if (entityId && row.legal_entity_id !== entityId) return false
        if (kind && row.kind !== kind) return false
        if (!query) return true
        return `${kindLabel(row.kind)} ${row.total} ${row.execution_date ?? ''}`.toLocaleLowerCase('es').includes(query)
      }),
    [entityId, kind, query, rows],
  )
  const filtersActive = Boolean(query || kind)
  const screen = loading ? 'cobros-cargando' : shown.length === 0 ? 'cobros-remesas-vacio' : 'cobros-remesas'
  const showEntity = entityCode === null && me.entities.length > 1

  function setKind(next: string) {
    const queryParams = new URLSearchParams(params)
    if (next) queryParams.set('clase', next)
    else queryParams.delete('clase')
    setParams(queryParams, { replace: true })
  }

  const columns = useMemo<GridColumn<Remittance>[]>(() => {
    const list: GridColumn<Remittance>[] = [
      { id: 'date', header: copy.cobros.executionDate, cell: (row) => (row.execution_date ? formatDate(row.execution_date) : '—') },
      { id: 'kind', header: copy.cobros.kind, cell: (row) => kindLabel(row.kind) },
    ]
    if (showEntity) list.push({ id: 'entity', header: copy.cobros.entity, cell: (row) => entityLabel(row.legal_entity_id, me.entities) })
    list.push(
      {
        id: 'status',
        header: copy.cobros.status,
        cell: (row) => <Badge size="sm" tone={toneOf(row.status)}>{statusLabel(row.status)}</Badge>,
      },
      { id: 'total', header: copy.cobros.total, align: 'right', cell: (row) => <span className="tabular-nums">{moneyOf(row.total)}</span> },
    )
    return list
  }, [me.entities, showEntity])

  return (
    <CobrosFrame
      screen={screen}
      vista={vista}
      action={canManage ? { label: copy.cobros.newRemittance, onClick: () => setCreating(true) } : null}
      toolbar={
        <Input
          id="buscar-remesas"
          size="sm"
          type="search"
          value={q}
          placeholder={copy.cobros.searchRemittances}
          aria-label={copy.cobros.searchRemittances}
          className="w-56 shrink-0"
          prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          onChange={(event) => setQ(event.target.value)}
        />
      }
      filters={
        <>
          {[
            { id: '', label: copy.cobros.allKinds },
            { id: 'direct_debit', label: copy.cobros.debitKind },
            { id: 'credit_transfer', label: copy.cobros.transferKind },
          ].map((pill) => (
            <Chip key={pill.id || 'all'} pressed={kind === pill.id} active={kind === pill.id} onClick={() => setKind(kind === pill.id ? '' : pill.id)}>
              {pill.label}
            </Chip>
          ))}
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
          rows={shown}
          rowKey={(row) => row.id}
          labels={gridLabels(copy.cobros.remittance)}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/cobros/remesas/${row.id}`)}
          rowHref={(row) => `/cobros/remesas/${row.id}`}
          total={shown.length}
          loading={loading && rows.length === 0}
          scrollKey="cobros-remesas"
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

function toneOf(status: string): 'neutral' | 'warning' | 'info' | 'success' {
  if (status === 'pending_approval') return 'warning'
  if (status === 'file_generated') return 'info'
  if (status === 'uploaded_by_user') return 'success'
  return 'neutral'
}
