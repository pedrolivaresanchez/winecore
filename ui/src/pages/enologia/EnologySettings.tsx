import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useEntity } from '@/app/entity-context'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import type { Me } from '@/lib/types'
import { isOwner } from '@/pages/aprobaciones/model'
import { writeEnologySettings } from '@/pages/enologia/api'
import {
  entityShort,
  NULLABLE_CODES,
  ownedEntities,
  parameterLabel,
  processLabel,
  stateLabel,
  sugarLabel,
  TARGET_CODES,
  TEXT_CODES,
  THRESHOLD_CODES,
  unitSuffix,
  wineLabel,
} from '@/pages/enologia/labels'
import { buildSettingsPut, draftFrom, type Draft, type LossDraft, type ParamDraft, type So2Draft } from '@/pages/enologia/put'
import { canonicalQty, esQty } from '@/pages/enologia/qty'
import type { Basis, SettingsView, So2Scope } from '@/pages/enologia/types'
import { Alert, Badge, Button, Input, SegmentedControl, Select, Skeleton, Switch, Table, Textarea, useToast, type TableColumn } from '@/ui'

export function EnologySettings({ me }: { me: Me }) {
  const toast = useToast()
  const { filter } = useEntity()
  const owned = useMemo(() => ownedEntities(me), [me])
  const initial = owned.find((entity) => entity.code === filter)?.id
    ?? owned.find((entity) => entity.code === 'PO')?.id
    ?? owned[0]?.id
    ?? ''
  const [entityId, setEntityId] = useState(initial)
  const remote = useApi<SettingsView>(isOwner(me) && entityId ? `/v1/enology/settings?legal_entity_id=${entityId}` : null)
  const [server, setServer] = useState<SettingsView | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState<So2Scope>('organic')
  const [openParam, setOpenParam] = useState<string | null>(null)
  const [openSo2, setOpenSo2] = useState<string | null>(null)
  const [openLoss, setOpenLoss] = useState<string | null>(null)

  useEffect(() => {
    if (filter === 'all') return
    const match = owned.find((entity) => entity.code === filter)
    if (match) setEntityId(match.id)
  }, [filter, owned])

  useEffect(() => {
    if (!remote.data || remote.data.legal_entity_id !== entityId) return
    setServer(remote.data)
    setDraft(draftFrom(remote.data))
    setErrors({})
    setFormError(null)
  }, [entityId, remote.data])

  if (!isOwner(me)) return <NoPermission />

  const ready = server?.legal_entity_id === entityId && draft != null

  async function save() {
    if (!server || !draft || busy) return
    const next = buildSettingsPut(entityId, server, draft)
    setErrors(next.errors)
    if (Object.keys(next.errors).length > 0) {
      setFormError(copy.enology.saveFail)
      return
    }
    if (!next.body) return
    setBusy(true)
    setFormError(null)
    try {
      const saved = await writeEnologySettings(next.body)
      setServer(saved)
      setDraft(draftFrom(saved))
      toast(copy.enology.saved, { tone: 'success' })
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      const detail = error instanceof ApiError && error.fields ? Object.values(error.fields).join(' ') : ''
      setFormError(detail || (error instanceof ApiError ? error.message : copy.enology.saveFail))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      data-screen={ready ? 'enologia-ajustes' : 'enologia-ajustes-cargando'}
      className="flex flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {owned.length > 1 ? (
          <SegmentedControl
            aria-label={copy.entity.label}
            value={entityId}
            onChange={setEntityId}
            options={owned.map((entity) => ({ value: entity.id, content: entityShort(entity.code) }))}
          />
        ) : (
          <span className="text-label text-text-secondary">{entityShort(owned[0]?.code ?? '')}</span>
        )}
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          {copy.enology.save}
        </Button>
      </div>

      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      {!ready && remote.loading ? (
        <div aria-busy="true" className="grid gap-2">
          <p className="sr-only">{copy.loading}</p>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : null}

      {!ready && remote.error ? (
        <div className="grid gap-3">
          <Alert tone="danger">{`${copy.error.load} (${remote.error.code})`}</Alert>
          <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={remote.reload}>
            {copy.error.retry}
          </Button>
        </div>
      ) : null}

      {ready && draft ? (
        <>
          <Group title={copy.enology.targets}>
            <Frame>
              {TARGET_CODES.map((code) => {
                const row = draft.parameters.find((item) => item.code === code)
                if (!row) return null
                return (
                  <ParameterRow
                    key={code}
                    row={row}
                    open={openParam === code}
                    error={errors[`parameter:${code}`]}
                    onOpen={() => setOpenParam((current) => (current === code ? null : code))}
                    onPatch={(patch, edited) => patchDraft(setDraft, 'parameters', code, patch, edited)}
                  />
                )
              })}
            </Frame>
          </Group>

          <Group title={copy.enology.thresholds}>
            <Frame>
              {THRESHOLD_CODES.map((code) => {
                const row = draft.parameters.find((item) => item.code === code)
                if (!row) return null
                return (
                  <ParameterRow
                    key={code}
                    row={row}
                    open={openParam === code}
                    error={errors[`parameter:${code}`]}
                    onOpen={() => setOpenParam((current) => (current === code ? null : code))}
                    onPatch={(patch, edited) => patchDraft(setDraft, 'parameters', code, patch, edited)}
                  />
                )
              })}
            </Frame>
          </Group>

          <Group title={copy.enology.limits}>
            <SegmentedControl
              aria-label={copy.enology.limits}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'organic', content: copy.enology.organic },
                { value: 'legal', content: copy.enology.legal },
              ]}
            />
            <Frame>
              {draft.so2
                .filter((row) => row.scope === scope)
                .map((row) => {
                  const key = `${row.scope}:${row.wine_color}:${row.sugar_band}`
                  return (
                    <So2Row
                      key={key}
                      row={row}
                      open={openSo2 === key}
                      error={errors[`so2:${key}`]}
                      onOpen={() => setOpenSo2((current) => (current === key ? null : key))}
                      onPatch={(patch, edited) =>
                        setDraft((current) => {
                          if (!current) return current
                          return {
                            ...current,
                            so2: current.so2.map((item) => {
                              if (`${item.scope}:${item.wine_color}:${item.sugar_band}` !== key) return item
                              const next = { ...item, ...patch }
                              if (edited && item.basis !== 'hecho') next.confirm = false
                              return next
                            }),
                          }
                        })
                      }
                    />
                  )
                })}
            </Frame>
          </Group>

          <Group title={copy.enology.losses} hint={copy.enology.lossesHint}>
            <div id="enologia-mermas" data-screen="enologia-mermas">
              <LossTable
                rows={draft.loss}
                errors={errors}
                openKey={openLoss}
                onOpen={setOpenLoss}
                onPatch={(key, patch, edited) =>
                  setDraft((current) => {
                    if (!current) return current
                    return {
                      ...current,
                      loss: current.loss.map((item) => {
                        if (`${item.process}:${item.product_state}` !== key) return item
                        const next = { ...item, ...patch }
                        if (edited && item.basis !== 'hecho') next.confirm = false
                        if ('max' in patch && canonicalQty(next.max) == null) next.confirm = false
                        return next
                      }),
                    }
                  })
                }
              />
            </div>
          </Group>

          <Group title={copy.enology.practices}>
            <Frame>
              {draft.practices.map((row) => (
                <div key={row.name_key} className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-label font-medium text-ink-900">{row.name_es}</span>
                      <StatusMark basis={row.basis} confirm={row.confirm} />
                    </span>
                    <p className="mt-0.5 truncate text-caption text-text-tertiary">{row.source}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-3">
                    {row.basis !== 'hecho' ? (
                      <Switch
                        checked={row.confirm}
                        aria-label={copy.enology.confirm}
                        onChange={(checked) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  practices: current.practices.map((item) =>
                                    item.name_key === row.name_key ? { ...item, confirm: checked } : item,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                    ) : null}
                    <Switch
                      checked={row.active}
                      aria-label={copy.enology.active}
                      onChange={(checked) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                practices: current.practices.map((item) =>
                                  item.name_key === row.name_key ? { ...item, active: checked } : item,
                                ),
                              }
                            : current,
                        )
                      }
                    />
                  </span>
                </div>
              ))}
              <div className="px-4 py-3">
                <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="enologia-practica">
                  {copy.enology.newPractice}
                  <Input
                    id="enologia-practica"
                    value={draft.newPractice}
                    invalid={Boolean(errors['practice:new'])}
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, newPractice: event.target.value } : current))
                    }
                  />
                </label>
                {errors['practice:new'] ? <p className="mt-1 text-caption text-danger-600">{errors['practice:new']}</p> : null}
              </div>
            </Frame>
          </Group>

          <Group title={copy.enology.analyses}>
            <Frame>
              {draft.required.map((row) => (
                <div key={row.parameter_code} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 text-label text-ink-900">{row.name_es}</span>
                  <Switch
                    checked={row.active}
                    aria-label={row.name_es}
                    onChange={(checked) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              required: current.required.map((item) =>
                                item.parameter_code === row.parameter_code ? { ...item, active: checked } : item,
                              ),
                            }
                          : current,
                      )
                    }
                  />
                </div>
              ))}
            </Frame>
          </Group>
        </>
      ) : null}
    </form>
  )
}

function patchDraft(
  setDraft: (value: Draft | null | ((current: Draft | null) => Draft | null)) => void,
  _kind: 'parameters',
  code: string,
  patch: Partial<ParamDraft>,
  editedValue: boolean,
) {
  setDraft((current) => {
    if (!current) return current
    return {
      ...current,
      parameters: current.parameters.map((row) => {
        if (row.code !== code) return row
        const next = { ...row, ...patch }
        if (editedValue && row.basis !== 'hecho') next.confirm = false
        return next
      }),
    }
  })
}

function valueEdited(before: string, next: string): boolean {
  const right = canonicalQty(next)
  if (right === undefined) return false
  return canonicalQty(before) !== right
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="grid gap-0.5">
        <h2 className="text-caption font-medium text-text-tertiary">{title}</h2>
        {hint ? <p className="text-caption text-text-tertiary">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">{children}</div>
}

function StatusMark({ basis, confirm }: { basis: Basis; confirm: boolean }) {
  if (basis === 'hecho') return <Badge tone="neutral">{copy.enology.fact}</Badge>
  if (confirm) return <Badge tone="success">{copy.enology.confirmed}</Badge>
  return <Badge tone="warning">{copy.enology.pending}</Badge>
}

function ParameterRow({
  row,
  open,
  error,
  onOpen,
  onPatch,
}: {
  row: ParamDraft
  open: boolean
  error?: string
  onOpen: () => void
  onPatch: (patch: Partial<ParamDraft>, editedValue: boolean) => void
}) {
  const id = `enologia-param-${row.code}`
  const unit = unitSuffix(row.unit)
  const textMode = TEXT_CODES.has(row.code)
  const nullable = NULLABLE_CODES.has(row.code)
  return (
    <div className="grid gap-2 px-4 py-3">
      <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-label font-medium text-ink-900">{parameterLabel(row.code)}</span>
            <StatusMark basis={row.basis} confirm={row.confirm} />
          </span>
          <button type="button" className="mt-0.5 block w-full truncate text-left text-caption text-text-tertiary max-sm:mt-0 max-sm:py-3.5" onClick={onOpen}>
            {row.source}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {textMode ? (
            <Select
              id={id}
              className="w-36"
              value={row.valueText ?? 'warning'}
              onChange={(event) => onPatch({ valueText: event.target.value }, true)}
            >
              <option value="warning">{copy.enology.mode.warning}</option>
              <option value="block">{copy.enology.mode.block}</option>
            </Select>
          ) : (
            <Input
              id={id}
              className="w-28"
              inputMode="decimal"
              autoComplete="off"
              invalid={Boolean(error)}
              value={row.value}
              onChange={(event) => onPatch({ value: event.target.value }, valueEdited(row.value, event.target.value))}
              onBlur={() => {
                const parsed = canonicalQty(row.value)
                if (typeof parsed === 'string') onPatch({ value: esQty(parsed) }, false)
              }}
            />
          )}
          {unit ? <span className="text-caption text-text-tertiary">{unit}</span> : null}
          {row.basis !== 'hecho' ? (
            <Switch checked={row.confirm} aria-label={copy.enology.confirm} onChange={(checked) => onPatch({ confirm: checked }, false)} />
          ) : null}
        </div>
      </div>
      {nullable && row.value.trim() === '' ? <p className="text-caption text-text-tertiary">{copy.enology.noFigure}</p> : null}
      {open ? (
        <label className="grid gap-1.5 text-caption text-text-tertiary" htmlFor={`${id}-fuente`}>
          {copy.enology.source}
          <Input id={`${id}-fuente`} value={row.source} onChange={(event) => onPatch({ source: event.target.value }, false)} />
        </label>
      ) : null}
      {error ? <p className="text-caption text-danger-600">{error}</p> : null}
    </div>
  )
}

function So2Row({
  row,
  open,
  error,
  onOpen,
  onPatch,
}: {
  row: So2Draft
  open: boolean
  error?: string
  onOpen: () => void
  onPatch: (patch: Partial<So2Draft>, editedValue: boolean) => void
}) {
  const id = `enologia-so2-${row.scope}-${row.wine_color}-${row.sugar_band}`
  const empty = row.limit.trim() === ''
  return (
    <div className="grid gap-2 px-4 py-3">
      <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-label font-medium text-ink-900">
              {wineLabel(row.wine_color)} · {sugarLabel(row.sugar_band)}
            </span>
            <StatusMark basis={row.basis} confirm={row.confirm} />
          </span>
          <button type="button" className="mt-0.5 block w-full truncate text-left text-caption text-text-tertiary max-sm:mt-0 max-sm:py-3.5" onClick={onOpen}>
            {row.source}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Input
            id={id}
            className="w-28"
            inputMode="decimal"
            autoComplete="off"
            invalid={Boolean(error)}
            value={row.limit}
            onChange={(event) => onPatch({ limit: event.target.value }, valueEdited(row.limit, event.target.value))}
            onBlur={() => {
              const parsed = canonicalQty(row.limit)
              if (typeof parsed === 'string') onPatch({ limit: esQty(parsed) }, false)
            }}
          />
          <span className="text-caption text-text-tertiary">{copy.enology.units.mgL}</span>
          {row.basis !== 'hecho' ? (
            <Switch
              checked={row.confirm}
              disabled={empty}
              aria-label={copy.enology.confirm}
              onChange={(checked) => onPatch({ confirm: checked }, false)}
            />
          ) : null}
        </div>
      </div>
      {empty ? <p className="text-caption text-text-tertiary">{copy.enology.noFigure}</p> : null}
      {open ? (
        <label className="grid gap-1.5 text-caption text-text-tertiary" htmlFor={`${id}-fuente`}>
          {copy.enology.source}
          <Input id={`${id}-fuente`} value={row.source} onChange={(event) => onPatch({ source: event.target.value }, false)} />
        </label>
      ) : null}
      {error ? <p className="text-caption text-danger-600">{error}</p> : null}
    </div>
  )
}

function LossTable({
  rows,
  errors,
  openKey,
  onOpen,
  onPatch,
}: {
  rows: LossDraft[]
  errors: Record<string, string>
  openKey: string | null
  onOpen: (key: string) => void
  onPatch: (key: string, patch: Partial<LossDraft>, editedValue: boolean) => void
}) {
  const open = rows.find((row) => `${row.process}:${row.product_state}` === openKey) ?? null
  const columns = useMemo<TableColumn<LossDraft>[]>(
    () => [
      {
        id: 'process',
        header: copy.enology.columns.process,
        minWidth: '8rem',
        wrap: true,
        cell: (row) => (
          <span className="block min-w-0">
            <span className="block">{processLabel(row.process)}</span>
            <span className="block text-caption text-text-tertiary sm:hidden">{stateLabel(row.product_state)}</span>
          </span>
        ),
      },
      {
        id: 'state',
        header: copy.enology.columns.state,
        minWidth: '8rem',
        hideOnMobile: true,
        cell: (row) => stateLabel(row.product_state),
      },
      {
        id: 'max',
        header: copy.enology.columns.max,
        minWidth: '8rem',
        wrap: true,
        clip: false,
        cell: (row) => {
          const key = `${row.process}:${row.product_state}`
          const hasMax = typeof canonicalQty(row.max) === 'string'
          return (
            <span className="flex items-center justify-between gap-2">
              {row.max.trim() === '' ? (
                <span className="min-w-0 text-text-tertiary">{copy.enology.advisor}</span>
              ) : (
                <span className="tabular-nums">{row.max} %</span>
              )}
              <span className="shrink-0" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <Switch
                  checked={row.confirm && hasMax}
                  disabled={!hasMax || row.basis === 'hecho'}
                  aria-label={`${copy.enology.confirm} ${processLabel(row.process)}`}
                  onChange={(checked) => onPatch(key, { confirm: checked }, false)}
                />
              </span>
            </span>
          )
        },
      },
    ],
    [onPatch],
  )

  return (
    <div className="grid gap-3">
      <Table
        rows={rows}
        rowKey={(row) => `${row.process}:${row.product_state}`}
        columns={columns}
        onRowClick={(row) => onOpen(`${row.process}:${row.product_state}`)}
      />
      {open ? (
        <LossEditor
          row={open}
          error={errors[`loss:${open.process}:${open.product_state}`]}
          onPatch={(patch, edited) => onPatch(`${open.process}:${open.product_state}`, patch, edited)}
        />
      ) : null}
    </div>
  )
}

function LossEditor({
  row,
  error,
  onPatch,
}: {
  row: LossDraft
  error?: string
  onPatch: (patch: Partial<LossDraft>, editedValue: boolean) => void
}) {
  const id = `enologia-merma-${row.process}-${row.product_state}`
  return (
    <div className="grid gap-3 rounded-2xl border border-border-subtle px-4 py-3">
      <p className="text-label font-medium text-ink-900">
        {processLabel(row.process)} · {stateLabel(row.product_state)}
      </p>
      <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor={id}>
        {copy.enology.columns.max}
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          invalid={Boolean(error)}
          value={row.max}
          placeholder={copy.enology.advisor}
          suffix={<span className="text-caption text-text-tertiary">%</span>}
          onChange={(event) => onPatch({ max: event.target.value }, valueEdited(row.max, event.target.value))}
          onBlur={() => {
            const parsed = canonicalQty(row.max)
            if (typeof parsed === 'string') onPatch({ max: esQty(parsed) }, false)
          }}
        />
      </label>
      <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor={`${id}-fuente`}>
        {copy.enology.source}
        <Textarea id={`${id}-fuente`} rows={3} value={row.source} onChange={(event) => onPatch({ source: event.target.value }, false)} />
      </label>
      {error ? <p className="text-caption text-danger-600">{error}</p> : null}
    </div>
  )
}
