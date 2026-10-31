import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import {
  Badge,
  Button,
  Chip,
  DataGrid,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Input,
  useToast,
  type GridColumn,
} from '@/ui'
import { Search } from '@/ui/icons'
import { createFormat } from '@/pages/catalogo/api'
import { ListFrame } from '@/pages/catalogo/frame'
import { GRID_LABELS } from '@/pages/catalogo/labels'
import { formatVolumeMl } from '@/pages/catalogo/money'
import { containerLabel, emptyFormatInput, type Format, type FormatInput, type ListPage } from '@/pages/catalogo/model'
import { FormatForm } from '@/pages/catalogo/ProductForm'
import { validateFormat } from '@/pages/catalogo/validate'

export function FormatsPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const canWrite = allows(me, 'catalog.write')
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const formats = useApi<ListPage<Format>>('/v1/formats?limit=100')
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ name: 260, code: 110 })

  useEffect(() => {
    if (params.get('crear') === 'formato') setOpen(true)
  }, [params])

  function closeCreate() {
    setOpen(false)
    if (params.has('crear')) {
      const next = new URLSearchParams(params)
      next.delete('crear')
      setParams(next, { replace: true })
    }
  }

  const needle = q.trim().toLowerCase()
  const rows = (formats.data?.items ?? []).filter((format) => {
    if (activeOnly && !format.is_active) return false
    if (!needle) return true
    return format.name.toLowerCase().includes(needle) || format.code.toLowerCase().includes(needle)
  })
  const columns = useMemo<GridColumn<Format>[]>(
    () => [
      { id: 'name', header: 'Nombre', cell: (row) => row.name },
      { id: 'code', header: 'Código', cell: (row) => <span className="font-mono text-caption">{row.code}</span> },
      { id: 'container', header: 'Envase', cell: (row) => containerLabel(row.container) },
      { id: 'volume', header: 'Volumen', align: 'right', cell: (row) => formatVolumeMl(row.nominal_volume_ml) },
      { id: 'case', header: 'Uds/caja', align: 'right', cell: (row) => String(row.units_per_case) },
      { id: 'pallet', header: 'Cajas/palé', align: 'right', cell: (row) => String(row.cases_per_pallet) },
      {
        id: 'active',
        header: 'Activo',
        cell: (row) => <Badge tone={row.is_active ? 'success' : 'neutral'}>{row.is_active ? 'Activo' : 'Inactivo'}</Badge>,
      },
    ],
    [],
  )

  if (!allows(me, 'catalog.read')) return <NoPermission />
  const loading = formats.loading && !formats.data
  const empty = !loading && !formats.error && (formats.data?.items.length ?? 0) === 0 && !needle
  const screen = loading ? 'formatos-cargando' : empty ? 'formatos-vacio' : 'formatos'
  const filtered = Boolean(needle || activeOnly)
  const create = canWrite ? (
    <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
      <span className="sm:hidden">Nuevo</span>
      <span className="hidden sm:inline">{copy.catalog.newFormat}</span>
    </Button>
  ) : null

  return (
    <ListFrame
      screen={screen}
      object="formatos"
      actions={create}
      mobileActions={create}
      toolbar={
        <Input
          id="buscar-formatos"
          size="sm"
          type="search"
          value={q}
          placeholder={copy.catalog.search}
          aria-label={copy.catalog.search}
          className="w-28 min-w-0 flex-1 sm:w-56 sm:flex-none"
          prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          onChange={(event) => setQ(event.target.value)}
        />
      }
      filters={
        <Chip pressed={activeOnly} active={activeOnly} onClick={() => setActiveOnly((current) => !current)}>
          {copy.catalog.activeOnly}
        </Chip>
      }
    >
      {formats.error ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${formats.error.code})`} detail={formats.error.message} onRetry={formats.reload} />
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
          onOpenRow={(row) => navigate(`/catalogo/formatos/${row.id}`)}
          rowHref={(row) => `/catalogo/formatos/${row.id}`}
          loading={loading}
          total={rows.length}
          empty={
            <EmptyState
              size="sm"
              title={filtered ? copy.catalog.noMatch : copy.catalog.emptyFormats}
              description={filtered ? undefined : copy.catalog.emptyFormatsHint}
              action={canWrite && !filtered ? create : undefined}
            />
          }
        />
      )}
      <FormatDialog
        open={open}
        onClose={closeCreate}
        onCreated={(id) => {
          toast('Formato creado')
          formats.reload()
          closeCreate()
          navigate(`/catalogo/formatos/${id}`)
        }}
      />
    </ListFrame>
  )
}

function FormatDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [value, setValue] = useState<FormatInput>(emptyFormatInput)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const idempotency = useRef(crypto.randomUUID())

  useEffect(() => {
    if (!open) return
    setValue(emptyFormatInput())
    setErrors({})
    idempotency.current = crypto.randomUUID()
  }, [open])

  async function onSubmit() {
    const found = validateFormat(value)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    try {
      const created = await createFormat(value, idempotency.current)
      onCreated(created.id)
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else setErrors({ name: error instanceof ApiError ? error.message : 'No se ha podido crear el formato.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="nuevo-formato" size="lg">
      <DialogHeader titleId="nuevo-formato" title={copy.catalog.newFormat} onClose={onClose} />
      <DialogBody>
        <form
          id="formato-alta"
          data-screen="formato-alta"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onSubmit()
          }}
        >
          <FormatForm value={value} onChange={setValue} errors={errors} disabled={saving} />
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" form="formato-alta" variant="primary" size="sm" loading={saving}>
          {saving ? 'Creando…' : copy.catalog.createFormat}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
