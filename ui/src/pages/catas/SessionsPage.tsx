import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { Plus } from '@/ui/icons'
import {
  Badge,
  Button,
  DataGrid,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Input,
  SegmentedControl,
  Select,
  Textarea,
  useToast,
  type GridColumn,
} from '@/ui'
import { createSession, listSessions, messageOf } from '@/pages/catas/api'
import { CatasFrame } from '@/pages/catas/frame'
import { GRID_LABELS, todayMadrid } from '@/pages/catas/labels'
import type { Session } from '@/pages/catas/types'

const DATE_LABELS = { clear: copy.catas.clearDate, today: copy.catas.today }

export function SessionsPage({ me }: { me: Me }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const canWrite = allows(me, 'tasting.write')
  const [items, setItems] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ title: 240, target: 160, when: 120, status: 120, samples: 110 })
  const [open, setOpen] = useState(params.get('nueva') === '1')
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState(copy.catas.targetA)
  const [started, setStarted] = useState(todayMadrid)
  const [days, setDays] = useState<'2' | '3'>('2')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!allows(me, 'cellar.read')) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    listSessions(controller.signal)
      .then((page) => {
        if (!active) return
        setItems(page.items)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(messageOf(err instanceof ApiError ? err : err))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, me])

  function closeDialog() {
    setOpen(false)
    if (params.get('nueva')) {
      const next = new URLSearchParams(params)
      next.delete('nueva')
      setParams(next, { replace: true })
    }
  }

  async function onCreate() {
    if (!title.trim()) {
      setFormError(copy.catas.required)
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const created = await createSession({
        title: title.trim(),
        target,
        started_on: started,
        days: Number(days),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      toast(copy.catas.sessionSaved)
      navigate(`/bodega/catas/ciegas/${created.id}`)
    } catch (err: unknown) {
      setFormError(messageOf(err))
      setSaving(false)
    }
  }

  const columns = useMemo<GridColumn<Session>[]>(
    () => [
      { id: 'title', header: copy.catas.columns.title, cell: (row) => row.title },
      { id: 'target', header: copy.catas.columns.target, cell: (row) => row.target },
      { id: 'when', header: copy.catas.columns.when, cell: (row) => formatDate(row.started_on) },
      {
        id: 'status',
        header: copy.catas.columns.status,
        cell: (row) => <Badge tone={row.revealed ? 'success' : 'info'}>{row.revealed ? copy.catas.revealed : copy.catas.open}</Badge>,
      },
      { id: 'samples', header: copy.catas.columns.samples, align: 'right', cell: (row) => String(row.samples.length) },
    ],
    [],
  )

  function addButton() {
    if (!canWrite) return null
    return (
      <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Plus strokeWidth={iconStroke} />
        {copy.catas.newSession}
      </Button>
    )
  }
  const screen = open ? 'catas-dialogo' : loading ? 'catas-ciegas-cargando' : items.length === 0 ? 'catas-ciegas-vacio' : 'catas-ciegas'

  return (
    <CatasFrame screen={screen} section="ciegas" title={copy.catas.blindTitle} action={addButton()}>
      {error && items.length === 0 ? (
        <div className="p-4">
          <ErrorState title={error} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          labels={{ ...GRID_LABELS, openRecord: copy.catas.blindTitle }}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => navigate(`/bodega/catas/ciegas/${row.id}`)}
          rowHref={(row) => `/bodega/catas/ciegas/${row.id}`}
          total={items.length}
          loading={loading}
          scrollKey="catas-ciegas"
          empty={<EmptyState size="sm" title={copy.catas.emptySessions} description={copy.catas.emptySessionsHint} action={addButton()} />}
        />
      )}
      <Dialog open={open} onClose={closeDialog} labelledBy="nueva-cata" size="md">
        <DialogHeader titleId="nueva-cata" title={copy.catas.newSession} onClose={closeDialog} />
        <DialogBody>
          <div className="grid gap-4 pb-2">
            {formError ? <p className="text-label text-danger-600">{formError}</p> : null}
            <label className="grid gap-1.5 text-label text-text-secondary" htmlFor="titulo-cata">
              {copy.catas.titleLabel}
              <Input id="titulo-cata" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-label text-text-secondary" htmlFor="objetivo-cata">
              {copy.catas.target}
              <Select id="objetivo-cata" className="w-full" value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value={copy.catas.targetA}>{copy.catas.targetA}</option>
                <option value={copy.catas.targetB}>{copy.catas.targetB}</option>
                <option value={copy.catas.targetNew}>{copy.catas.targetNew}</option>
              </Select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-label text-text-secondary">
                {copy.catas.started}
                <DatePicker size="sm" value={started} onChange={(next) => setStarted(next?.slice(0, 10) ?? started)} labels={DATE_LABELS} />
              </label>
              <div className="grid gap-1.5">
                <span className="text-label text-text-secondary">{copy.catas.days}</span>
                <SegmentedControl
                  aria-label={copy.catas.days}
                  value={days}
                  onChange={setDays}
                  options={[
                    { value: '2', content: copy.catas.twoDays },
                    { value: '3', content: copy.catas.threeDays },
                  ]}
                />
              </div>
            </div>
            <label className="grid gap-1.5 text-label text-text-secondary" htmlFor="notas-cata">
              {copy.catas.notesField}
              <Textarea id="notas-cata" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={closeDialog}>
            {copy.catas.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void onCreate()}>
            {copy.catas.create}
          </Button>
        </DialogFooter>
      </Dialog>
    </CatasFrame>
  )
}
