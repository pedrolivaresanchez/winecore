import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { copy } from '@/i18n'
import { formatDate } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { readStorage, writeStorage } from '@/lib/storage'
import type { Me } from '@/lib/types'
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  MenuItem,
  Reveal,
  Select,
  Skeleton,
  useToast,
} from '@/ui'
import { RecordBar } from '@/pages/bodega/chrome'
import { addSample, castVote, getSession, messageOf, revealSession, setSelection } from '@/pages/catas/api'
import { MoreMenu, RecordColumn } from '@/pages/catas/frame'
import { formatRatio, formatScore } from '@/pages/catas/labels'
import type { Session, SessionAggregate } from '@/pages/catas/types'
import { useCatalog } from '@/pages/catas/use-catalog'

const TASTER_KEY = 'winecore.catas.taster'

type Draft = { vote: '' | 'yes' | 'no'; score: string; comment: string }

export function SessionPage({ me, sessionId }: { me: Me; sessionId: string }) {
  const toast = useToast()
  const catalog = useCatalog(true)
  const canWrite = allows(me, 'tasting.write')
  const [session, setSession] = useState<Session | null>(null)
  useChromeTitle(session?.title || copy.catas.blindTitle)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [day, setDay] = useState(1)
  const [name, setName] = useState(() => readStorage(TASTER_KEY) || me.display_name)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [savingVote, setSavingVote] = useState<number | null>(null)
  const [savingPick, setSavingPick] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [revealOpen, setRevealOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [lotId, setLotId] = useState('')
  const [adding, setAdding] = useState(false)
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    getSession(sessionId, controller.signal)
      .then((next) => {
        if (!active) return
        setSession(next)
        setError(null)
        setPicked(selectedLots(next.aggregate))
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(messageOf(err))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, sessionId])

  useEffect(() => {
    writeStorage(TASTER_KEY, name)
  }, [name])

  useEffect(() => {
    const current = sessionRef.current
    if (!current) return
    setDrafts(hydrate(current, day, name))
  }, [session?.id, day, name])

  function patchDraft(sampleNo: number, partial: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [sampleNo]: { ...(current[sampleNo] ?? { vote: '', score: '', comment: '' }), ...partial },
    }))
  }

  async function saveVote(sampleNo: number) {
    const draft = drafts[sampleNo]
    if (!session || !draft || draft.vote === '' || savingVote != null) return
    const score = readScore(draft.score)
    if (score === undefined) {
      toast(copy.catas.scoreRange)
      return
    }
    setSavingVote(sampleNo)
    try {
      await castVote(session.id, {
        sample_no: sampleNo,
        day_no: day,
        vote: draft.vote,
        taster_name: name.trim(),
        ...(score != null ? { score } : {}),
        ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}),
      })
      const next = await getSession(session.id)
      setSession(next)
      toast(copy.catas.voteSaved)
    } catch (err: unknown) {
      toast(messageOf(err))
    } finally {
      setSavingVote(null)
    }
  }

  async function onAdd() {
    if (!session || !lotId || adding) return
    setAdding(true)
    try {
      await addSample(session.id, lotId)
      const next = await getSession(session.id)
      setSession(next)
      setLotId('')
      setAddOpen(false)
      toast(copy.catas.sampleAdded)
    } catch (err: unknown) {
      toast(messageOf(err))
    } finally {
      setAdding(false)
    }
  }

  async function onReveal() {
    if (!session || revealing) return
    setRevealing(true)
    try {
      const next = await revealSession(session.id)
      setSession(next)
      setPicked(selectedLots(next.aggregate))
      setRevealOpen(false)
    } catch (err: unknown) {
      toast(messageOf(err))
    } finally {
      setRevealing(false)
    }
  }

  async function savePicked(next: Set<string>) {
    if (!session || savingPick) return
    setSavingPick(true)
    try {
      await setSelection(session.id, [...next])
      const fresh = await getSession(session.id)
      setSession(fresh)
      setPicked(selectedLots(fresh.aggregate))
      toast(next.size === 0 ? copy.catas.cleared : copy.catas.selectionSaved)
      setClearOpen(false)
    } catch (err: unknown) {
      toast(messageOf(err))
    } finally {
      setSavingPick(false)
    }
  }

  if (error) {
    return (
      <RecordColumn screen="catas-ciegas-cata">
        <div className="p-4">
          <ErrorState title={error} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      </RecordColumn>
    )
  }
  if (!session) {
    return (
      <RecordColumn screen="catas-ciegas-cata">
        <div className="grid gap-3 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32" />
        </div>
      </RecordColumn>
    )
  }

  const revealed = session.revealed
  const saved = selectedLots(session.aggregate)
  const dirty = !sameSet(picked, saved)
  const screen = revealed ? 'catas-revelacion' : 'catas-ciegas-cata'

  return (
    <RecordColumn screen={screen}>
      <RecordBar backTo="/bodega/catas/ciegas" backLabel={copy.catas.backSessions}>
        {canWrite && !revealed && session.samples.length > 0 ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
            {copy.catas.add}
          </Button>
        ) : null}
        {canWrite && !revealed ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => (session.samples.length === 0 ? setAddOpen(true) : setRevealOpen(true))}
          >
            {session.samples.length === 0 ? copy.catas.addSample : copy.catas.reveal}
          </Button>
        ) : null}
        {canWrite && revealed && dirty ? (
          <Button type="button" variant="primary" size="sm" loading={savingPick} onClick={() => void savePicked(picked)}>
            {copy.catas.saveSelection}
          </Button>
        ) : null}
        {canWrite && revealed ? (
          <MoreMenu label={copy.catas.more}>
            {(close) => (
              <MenuItem
                tone="danger"
                onClick={() => {
                  close()
                  setClearOpen(true)
                }}
              >
                {copy.catas.clearSelection}
              </MenuItem>
            )}
          </MoreMenu>
        ) : null}
      </RecordBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{session.title}</h1>
            <p className="mt-0.5 text-label text-text-secondary">
              {[session.target, formatDate(session.started_on)].join(' · ')}
            </p>
          </header>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={revealed ? 'success' : 'info'}>{revealed ? copy.catas.revealed : copy.catas.open}</Badge>
            <Badge tone="neutral">{session.days === 3 ? copy.catas.threeDays : copy.catas.twoDays}</Badge>
          </div>
          {!revealed ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: session.days }, (_, index) => index + 1).map((number) => (
                  <Chip key={number} pressed={day === number} active={day === number} onClick={() => setDay(number)}>
                    {`${copy.catas.day} ${number}`}
                  </Chip>
                ))}
              </div>
              <label className="grid gap-1.5 text-label text-text-secondary" htmlFor="catador-ciego">
                {copy.catas.taster}
                <Input
                  id="catador-ciego"
                  value={name}
                  disabled={!canWrite}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {session.samples.length === 0 ? (
                <p className="text-label text-text-secondary">{copy.catas.emptySessionsHint}</p>
              ) : (
                session.samples.map((sample) => {
                  const draft = drafts[sample.sample_no] ?? { vote: '' as const, score: '', comment: '' }
                  return (
                    <article key={sample.sample_no} className="grid gap-3 rounded-2xl border border-border-subtle p-4">
                      <h2 className="text-label font-medium text-ink-900">
                        {copy.catas.sample} {sample.sample_no}
                      </h2>
                      <div className="flex gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant={draft.vote === 'yes' ? 'primary' : 'secondary'}
                          disabled={!canWrite}
                          onClick={() => patchDraft(sample.sample_no, { vote: 'yes' })}
                        >
                          {copy.catas.yes}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={draft.vote === 'no' ? 'primary' : 'secondary'}
                          disabled={!canWrite}
                          onClick={() => patchDraft(sample.sample_no, { vote: 'no' })}
                        >
                          {copy.catas.no}
                        </Button>
                      </div>
                      <label className="grid gap-1.5 text-label text-text-secondary" htmlFor={`nota-${sample.sample_no}`}>
                        {copy.catas.score}
                        <Input
                          id={`nota-${sample.sample_no}`}
                          inputMode="decimal"
                          value={draft.score}
                          disabled={!canWrite}
                          placeholder="0-100"
                          onChange={(event) => patchDraft(sample.sample_no, { score: event.target.value })}
                        />
                      </label>
                      <label className="grid gap-1.5 text-label text-text-secondary" htmlFor={`comentario-${sample.sample_no}`}>
                        {copy.catas.comment}
                        <Input
                          id={`comentario-${sample.sample_no}`}
                          value={draft.comment}
                          disabled={!canWrite}
                          onChange={(event) => patchDraft(sample.sample_no, { comment: event.target.value })}
                        />
                      </label>
                      {canWrite ? (
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            loading={savingVote === sample.sample_no}
                            onClick={() => void saveVote(sample.sample_no)}
                          >
                            {copy.catas.save}
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  )
                })
              )}
            </>
          ) : (
            <div className="grid gap-3">
              {(session.aggregate ?? []).map((row) => (
                <AggregateCard
                  key={row.sample_no}
                  row={row}
                  checked={row.lot_id ? picked.has(row.lot_id) : false}
                  disabled={!canWrite || !row.lot_id}
                  onChange={(checked) => {
                    if (!row.lot_id) return
                    setPicked((current) => {
                      const next = new Set(current)
                      if (checked) next.add(row.lot_id as string)
                      else next.delete(row.lot_id as string)
                      return next
                    })
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} labelledBy="anadir-muestra">
        <DialogHeader titleId="anadir-muestra" title={copy.catas.addSample} onClose={() => setAddOpen(false)} />
        <DialogBody>
          <label className="grid gap-1.5 pb-2 text-label text-text-secondary" htmlFor="lote-muestra">
            {copy.catas.pickLot}
            <Select id="lote-muestra" className="w-full" value={lotId} onChange={(event) => setLotId(event.target.value)}>
              <option value="">{copy.catas.choose}</option>
              {catalog.lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.code}
                </option>
              ))}
            </Select>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
            {copy.catas.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={adding} onClick={() => void onAdd()}>
            {copy.catas.add}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog open={revealOpen} onClose={() => setRevealOpen(false)} labelledBy="revelar-cata">
        <DialogHeader titleId="revelar-cata" title={copy.catas.reveal} description={copy.catas.revealHint} onClose={() => setRevealOpen(false)} />
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRevealOpen(false)}>
            {copy.catas.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={revealing} onClick={() => void onReveal()}>
            {copy.catas.reveal}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog open={clearOpen} onClose={() => setClearOpen(false)} labelledBy="vaciar-seleccion">
        <DialogHeader titleId="vaciar-seleccion" title={copy.catas.clearSelection} onClose={() => setClearOpen(false)} />
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setClearOpen(false)}>
            {copy.catas.cancel}
          </Button>
          <Button type="button" variant="danger" size="sm" loading={savingPick} onClick={() => void savePicked(new Set())}>
            {copy.catas.clearSelection}
          </Button>
        </DialogFooter>
      </Dialog>
    </RecordColumn>
  )
}

function AggregateCard({
  row,
  checked,
  disabled,
  onChange,
}: {
  row: SessionAggregate
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  const lot = row.lot_code ?? copy.catas.lot
  return (
    <article className="grid gap-2 rounded-2xl border border-border-subtle p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-label font-medium text-ink-900">
            {copy.catas.sample} {row.sample_no}
          </h2>
          {row.lot_id && row.lot_code ? (
            <Link to={`/bodega/lotes/${encodeURIComponent(row.lot_code)}`} className="text-label text-ink-900 underline">
              {lot}
              {row.vessel_code ? ` · ${row.vessel_code}` : ''}
            </Link>
          ) : (
            <p className="text-label text-text-secondary">{lot}</p>
          )}
        </div>
        <Checkbox checked={checked} disabled={disabled} size="sm" label={copy.catas.selection} onChange={onChange} />
      </div>
      <p className="text-caption tabular-nums text-text-tertiary">
        {[
          `${copy.catas.yesRatio} ${formatRatio(row.yes_ratio)}`,
          `${copy.catas.mean} ${formatScore(row.mean_score)}`,
          `${copy.catas.consistency} ${formatRatio(row.consistency)}`,
        ].join(' · ')}
      </p>
      <Reveal summary={copy.catas.byDays}>
        <ul className="grid gap-1">
          {row.days.map((ballot) => (
            <li key={ballot.day_no} className="text-label text-text-secondary">
              {`${copy.catas.day} ${ballot.day_no} · ${formatRatio(ballot.yes_ratio)} · ${formatScore(ballot.mean_score)}`}
            </li>
          ))}
        </ul>
      </Reveal>
    </article>
  )
}

function selectedLots(rows: SessionAggregate[] | null): Set<string> {
  return new Set((rows ?? []).filter((row) => row.selected && row.lot_id).map((row) => row.lot_id as string))
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

function hydrate(session: Session, day: number, name: string): Record<number, Draft> {
  const key = name.trim().toLowerCase()
  const drafts: Record<number, Draft> = {}
  for (const sample of session.samples) {
    const vote = session.votes.find(
      (item) => item.sample_no === sample.sample_no && item.day_no === day && item.taster_name.trim().toLowerCase() === key,
    )
    drafts[sample.sample_no] = {
      vote: vote?.vote ?? '',
      score: vote?.score == null ? '' : String(vote.score),
      comment: vote?.comment ?? '',
    }
  }
  return drafts
}

function readScore(text: string): number | null | undefined {
  const trimmed = text.trim().replace(',', '.')
  if (!trimmed) return null
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  if (value > 100) return undefined
  return value
}
