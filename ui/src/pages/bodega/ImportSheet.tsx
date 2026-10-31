import { useMemo, useRef, useState } from 'react'
import { useEntity } from '@/app/entity-context'
import { Field } from '@/components/Field'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError, api, apiText } from '@/lib/api'
import { kindLabel, type VesselKind, type VesselMaterial } from '@/lib/cellar'
import { fieldAria } from '@/lib/field'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { materialLabel } from '@/pages/bodega/labels'
import { Alert, Button, Drawer, DrawerBody, DrawerHeader, Input, Select, Textarea } from '@/ui'

const KINDS: VesselKind[] = ['tank_storage', 'tank_fermenter', 'barrel', 'demijohn', 'ibc', 'other']
const MATERIALS: VesselMaterial[] = ['stainless_steel', 'oak', 'glass', 'concrete', 'plastic', 'other']

type Location = {
  id: string
  code: string
  name: string
  kind: string
  controlling_entity_id: string
  is_active: boolean
}

type Report = {
  created: number
  updated: number
  skipped: number
  errors: { row: number; code: string | null; message: string }[]
}

export function ImportSheet({
  me,
  open,
  onClose,
  onDone,
}: {
  me: Me
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const { filter, entities } = useEntity()
  const locations = useApi<{ items: Location[] }>(open && allows(me, 'cellar.read') ? '/v1/locations?limit=100' : null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [paste, setPaste] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<VesselKind>('tank_storage')
  const [litres, setLitres] = useState('')
  const [material, setMaterial] = useState<VesselMaterial>('stainless_steel')
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  const cellars = useMemo(() => {
    const items = (locations.data?.items ?? []).filter((item) => item.kind === 'cellar' && item.is_active !== false)
    if (filter === 'all') return items
    const entity = entities.find((entry) => entry.code === filter)
    if (!entity) return items
    return items.filter((item) => item.controlling_entity_id.toLowerCase() === entity.id.toLowerCase())
  }, [locations.data, entities, filter])
  const locationId =
    (picked && cellars.some((item) => item.id === picked) ? picked : null) ??
    cellars.find((item) => item.code === 'BOD')?.id ??
    cellars[0]?.id ??
    null
  const mode = file ? 'file' : paste.trim() ? 'paste' : 'quick'
  const action =
    mode === 'file' ? copy.cellar.importFileAction : mode === 'paste' ? copy.cellar.importPasteAction : copy.cellar.importRowAction

  async function downloadTemplate() {
    try {
      const text = await apiText('/v1/vessels/import-template')
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'recipientes.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error: unknown) {
      setFailure(error instanceof ApiError ? error.message : copy.cellar.importNeed)
    }
  }

  async function submit() {
    if (!locationId || busy) return
    setFailure(null)
    if (mode === 'quick' && (!code.trim() || !name.trim() || !litres.trim())) {
      setFailure(copy.cellar.importNeed)
      return
    }
    const amount = litresOf(litres)
    if (mode === 'quick' && amount === null) {
      setFailure(copy.cellar.importNeed)
      return
    }
    setBusy(true)
    try {
      const body = mode === 'quick'
        ? JSON.stringify({
            location_id: locationId,
            rows: [
              {
                code: code.trim().toUpperCase(),
                name: name.trim(),
                kind,
                capacity_litres: amount,
                material,
                cooling: kind === 'tank_fermenter' ? 'si' : 'no',
              },
            ],
          })
        : formBody(locationId, file, paste)
      const next = await api<Report>('/v1/vessels/import', { method: 'POST', body })
      setReport(next)
      onDone()
    } catch (error: unknown) {
      setFailure(error instanceof ApiError ? error.message : copy.cellar.importNeed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onClose={onClose} labelledBy="importar-depositos-titulo" size="lg" mobileSheet>
      <DrawerHeader titleId="importar-depositos-titulo" title={copy.cellar.importTitle} onClose={onClose} />
      <DrawerBody>
        <form
          data-screen="bodega-importar"
          className="grid gap-4"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {report ? (
            <div data-screen="bodega-importar-resultado" className="grid gap-3">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Count label={copy.cellar.importCreated} value={report.created} />
                <Count label={copy.cellar.importUpdated} value={report.updated} />
                <Count label={copy.cellar.importSkipped} value={report.skipped} />
                <Count label={copy.cellar.importErrors} value={report.errors.length} />
              </dl>
              {report.errors.length > 0 ? (
                <ul className="grid gap-1">
                  {report.errors.map((error) => (
                    <li key={`${error.row}-${error.message}`} className="text-caption text-danger-700">
                      {fill(copy.cellar.importError, { row: String(error.row), message: error.message })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
          {locations.loading ? null : cellars.length === 0 ? <Alert tone="warning">{copy.cellar.importNoCellar}</Alert> : null}
          {cellars.length > 1 ? (
            <Field id="importar-bodega" label={copy.cellar.place}>
              <Select
                {...fieldAria('importar-bodega')}
                className="w-full"
                value={locationId ?? ''}
                onChange={(event) => setPicked(event.target.value)}
              >
                {cellars.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="grid gap-2">
            <Field id="importar-fichero" label={copy.cellar.importFile}>
              <input
                {...fieldAria('importar-fichero')}
                ref={fileRef}
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <div className="flex min-w-0 items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                  {copy.cellar.importChoose}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => void downloadTemplate()}>
                  {copy.cellar.importTemplate}
                </Button>
                {file ? <span className="min-w-0 truncate text-caption text-text-tertiary">{file.name}</span> : null}
              </div>
            </Field>
          </div>
          <Field id="importar-pegar" label={copy.cellar.importPaste}>
            <Textarea
              {...fieldAria('importar-pegar')}
              value={paste}
              rows={3}
              spellCheck={false}
              onChange={(event) => setPaste(event.target.value)}
            />
          </Field>
          <fieldset className="grid grid-cols-2 gap-3">
            <legend className="col-span-2 text-label text-text-secondary">{copy.cellar.importQuick}</legend>
            <Field id="importar-codigo" label={copy.cellar.code}>
              <Input {...fieldAria('importar-codigo')} value={code} autoCapitalize="characters" onChange={(event) => setCode(event.target.value)} />
            </Field>
            <Field id="importar-litros" label={copy.cellar.litres}>
              <Input
                {...fieldAria('importar-litros')}
                inputMode="decimal"
                value={litres}
                onChange={(event) => setLitres(event.target.value)}
              />
            </Field>
            <div className="col-span-2">
              <Field id="importar-nombre" label={copy.cellar.importName}>
                <Input {...fieldAria('importar-nombre')} value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
            </div>
            <Field id="importar-tipo" label={copy.cellar.kind}>
              <Select {...fieldAria('importar-tipo')} className="w-full" value={kind} onChange={(event) => setKind(event.target.value as VesselKind)}>
                {KINDS.map((item) => (
                  <option key={item} value={item}>
                    {kindLabel(item)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="importar-material" label={copy.cellar.material}>
              <Select
                {...fieldAria('importar-material')}
                className="w-full"
                value={material}
                onChange={(event) => setMaterial(event.target.value as VesselMaterial)}
              >
                {MATERIALS.map((item) => (
                  <option key={item} value={item}>
                    {materialLabel(item)}
                  </option>
                ))}
              </Select>
            </Field>
          </fieldset>
        </form>
      </DrawerBody>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-4 py-3 sm:px-6">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {copy.plano.cancel}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={busy} disabled={!locationId} onClick={() => void submit()}>
          {action}
        </Button>
      </div>
    </Drawer>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-caption text-text-tertiary">{label}</dt>
      <dd className="text-label font-medium tabular-nums text-ink-900">{value}</dd>
    </div>
  )
}

function formBody(locationId: string, file: File | null, paste: string): FormData {
  const body = new FormData()
  body.set('location_id', locationId)
  body.set('file', file ?? new File([paste], 'pegado.csv', { type: 'text/csv' }))
  return body
}

function litresOf(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, '')
  const normalized = text.includes(',') && !text.includes('.') ? text.replace(',', '.') : text
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}
