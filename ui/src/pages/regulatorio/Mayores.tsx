import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { Field } from '@/components/Field'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Badge, Button, DataGrid, Drawer, DrawerBody, DrawerHeader, EmptyState, Input, Select, useToast, type GridColumn } from '@/ui'
import { ledgerOf, validateLedger, type Ledger } from '@/pages/regulatorio/api'
import { Fact, FactCard, ListFrame } from '@/pages/regulatorio/frame'
import { canValidateLedger, classLabel, validAdvisorRef } from '@/pages/regulatorio/model'
import { useWarehouses } from '@/pages/regulatorio/warehouses'

const GRID_LABELS = {
  addCalculation: copy.regulatorio.grid.addCalculation,
  aggregation: () => copy.regulatorio.grid.aggregation,
  aggregations: copy.regulatorio.grid.aggregations,
  count: (n: number) => String(n),
  clearCalculation: copy.regulatorio.grid.clearCalculation,
  selectAll: copy.regulatorio.grid.selectAll,
  selectRow: copy.regulatorio.grid.selectRow,
  openRecord: copy.regulatorio.openLedger,
  sortAscending: copy.regulatorio.grid.sortAscending,
  sortDescending: copy.regulatorio.grid.sortDescending,
  columnOptions: copy.regulatorio.grid.columnOptions,
}

export function MayoresPage({ me }: { me: Me }) {
  const toast = useToast()
  const { filter, entities } = useEntity()
  const entityId = filter === 'all' ? undefined : entities.find((entity) => entity.code === filter)?.id
  const [params, setParams] = useSearchParams()
  const places = useWarehouses()
  const warehouses = useMemo(
    () => places.warehouses.filter((item) => !entityId || item.entityId === entityId),
    [entityId, places.warehouses],
  )
  const requested = params.get('establecimiento') ?? ''
  const known = warehouses.some((item) => item.id === requested)
  const warehouseId = known ? requested : warehouses.length === 1 ? warehouses[0]?.id ?? '' : ''
  const query = useApi<{ items: Record<string, unknown>[] }>(
    allows(me, 'regulatory.read') && warehouseId ? `/v1/silicie-ledgers?tax_warehouse_id=${warehouseId}` : null,
  )
  const loaded = useMemo(() => (query.data?.items ?? []).map(ledgerOf), [query.data])
  const rows = warehouseId && !query.loading ? loaded : []
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({
    reference: 220,
    description: 280,
    class: 130,
    nc: 110,
    epigrafe: 120,
    status: 140,
  })
  const [open, setOpen] = useState<Ledger | null>(null)
  const [advisor, setAdvisor] = useState('')
  const [advisorError, setAdvisorError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = loaded.find((row) => row.id === open?.id) ?? open
  const mayValidate = canValidateLedger(me)

  const columns = useMemo<GridColumn<Ledger>[]>(
    () => [
      { id: 'reference', header: copy.regulatorio.reference, cell: (row) => row.reference },
      { id: 'description', header: copy.regulatorio.description, cell: (row) => row.description || '—' },
      { id: 'class', header: copy.regulatorio.productClass, cell: (row) => classLabel(row.productClass) },
      { id: 'nc', header: copy.regulatorio.nc, cell: (row) => row.ncCode || '—' },
      { id: 'epigrafe', header: copy.regulatorio.epigrafe, cell: (row) => row.epigrafeCode || row.epigrafe || '—' },
      {
        id: 'status',
        header: copy.regulatorio.status,
        cell: (row) => (
          <Badge tone={row.validatedBy ? 'success' : 'neutral'} dot size="sm">
            {row.validatedBy ? copy.regulatorio.validated : copy.regulatorio.pendingLedger}
          </Badge>
        ),
      },
    ],
    [],
  )

  function chooseWarehouse(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('establecimiento', value)
    else next.delete('establecimiento')
    setParams(next)
    setOpen(null)
  }

  async function validate() {
    if (!shown) return
    if (!validAdvisorRef(advisor)) {
      setAdvisorError(copy.regulatorio.advisorHint)
      return
    }
    setBusy(true)
    setAdvisorError(null)
    try {
      await validateLedger(shown.id, advisor.trim())
      toast(copy.regulatorio.ledgerValidated, { tone: 'success' })
      setAdvisor('')
      query.reload()
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields?.advisor_ref) setAdvisorError(error.fields.advisor_ref)
      else toast(error instanceof ApiError ? error.message : copy.regulatorio.saveFail)
    } finally {
      setBusy(false)
    }
  }

  if (!allows(me, 'regulatory.read')) return <NoPermission />

  const loading = Boolean(warehouseId) && query.loading && !query.data
  const screen = loading ? 'regulatorio-mayores-cargando' : !warehouseId || rows.length === 0 ? 'regulatorio-mayores-vacio' : 'regulatorio-mayores'

  return (
    <>
      <ListFrame
        screen={screen}
        view="mayores"
        toolbar={
          <Select
            id="mayor-establecimiento"
            size="sm"
            aria-label={copy.regulatorio.warehouse}
            value={warehouseId}
            className="w-56 shrink-0"
            onChange={(event) => chooseWarehouse(event.target.value)}
          >
            <option value="">{copy.regulatorio.warehouse}</option>
            {warehouses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        }
      >
        {query.error && rows.length === 0 ? (
          <div className="p-4">
            <ErrorState title={`${copy.error.load} (${query.error.code})`} detail={query.error.message} onRetry={query.reload} />
          </div>
        ) : (
          <DataGrid
            columns={columns}
            rows={loading ? [] : rows}
            rowKey={(row) => row.id}
            labels={GRID_LABELS}
            widths={widths}
            onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
            selected={picked}
            onSelectedChange={setPicked}
            onOpenRow={(row) => {
              setOpen(row)
              setAdvisor(row.validatedBy ?? '')
              setAdvisorError(null)
            }}
            total={rows.length}
            loading={loading}
            empty={
              <EmptyState
                size="sm"
                title={warehouseId ? copy.regulatorio.noLedgers : copy.regulatorio.pickWarehouse}
                description={warehouseId ? copy.regulatorio.noLedgersHint : copy.regulatorio.pickWarehouseHint}
              />
            }
          />
        )}
      </ListFrame>
      <Drawer open={shown !== null} onClose={() => setOpen(null)} labelledBy="mayor-titulo" size="md">
        {shown ? (
          <>
            <DrawerHeader titleId="mayor-titulo" title={shown.reference} description={classLabel(shown.productClass)} onClose={() => setOpen(null)} />
            <DrawerBody>
              <FactCard title={copy.regulatorio.mayores}>
                <Fact label={copy.regulatorio.description} value={shown.description || '—'} />
                <Fact label={copy.regulatorio.nc} value={shown.ncCode || '—'} mono />
                <Fact label={copy.regulatorio.epigrafe} value={shown.epigrafeCode || shown.epigrafe || '—'} />
                <Fact label={copy.regulatorio.status} value={shown.validatedBy ? shown.validatedBy : copy.regulatorio.pendingLedger} />
              </FactCard>
              {mayValidate ? (
                <form
                  className="mt-4 grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void validate()
                  }}
                >
                  <Field id="asesor-ref" label={copy.regulatorio.advisorRef} error={advisorError ?? undefined} hint={copy.regulatorio.advisorHint}>
                    <Input
                      id="asesor-ref"
                      value={advisor}
                      aria-invalid={Boolean(advisorError)}
                      onChange={(event) => setAdvisor(event.target.value)}
                    />
                  </Field>
                  <Button type="submit" variant="primary" size="sm" loading={busy}>
                    {copy.regulatorio.validateLedger}
                  </Button>
                </form>
              ) : null}
            </DrawerBody>
          </>
        ) : null}
      </Drawer>
    </>
  )
}
