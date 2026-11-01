import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MoreVertical } from '@/ui/icons'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { activateTariff, createTariff, retireTariff, updateTariff } from '@/pages/intercompania/api'
import { Fact, RecordBar } from '@/pages/intercompania/frame'
import {
  baseListOptions,
  discountLabel,
  draftFromTariff,
  formatCivil,
  isOwner,
  madridToday,
  overlappingActive,
  shiftPeriod,
  tariffStatusLabel,
  tariffTone,
  windowLabel,
  type Tariff,
  type TariffDraft,
} from '@/pages/intercompania/model'
import { TariffDialog } from '@/pages/intercompania/TariffDialog'
import { RecordSkeleton } from '@/components/RecordSkeleton'
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  GlassMenu,
  MenuItem,
  Reveal,
  useMenuOpen,
  useToast,
} from '@/ui'

type TabId = 'resumen' | 'vigencias'

export function TariffPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const record = useApi<Tariff>(id ? `/v1/intercompany/tariffs/${id}` : null)
  const tariffs = useApi<{ items: Tariff[] }>('/v1/intercompany/tariffs')
  const [tariff, setTariff] = useState<Tariff | null>(null)
  const [items, setItems] = useState<Tariff[] | null>(null)
  useChromeTitle(copy.intercompany.tariffs)

  useEffect(() => {
    if (record.data) setTariff(record.data)
  }, [record.data])

  useEffect(() => {
    if (tariffs.data) setItems(tariffs.data.items)
  }, [tariffs.data])

  if (!allows(me, 'billing.read')) return <NoPermission />
  if (record.loading && !tariff) {
    return <RecordSkeleton screen="intercompania-tarifa-cargando" />
  }
  if (record.error?.status === 404) {
    return (
      <div className="p-6">
        <ErrorState title={copy.intercompany.notFound} />
      </div>
    )
  }
  if ((record.error && !tariff) || !tariff) {
    return (
      <div className="p-6">
        <ErrorState
          title={`${copy.error.load} (${record.error?.code ?? 'WC_ERROR'})`}
          detail={record.error?.message}
          onRetry={record.reload}
        />
      </div>
    )
  }
  const catalog = items ?? []
  const windows = catalog.some((item) => item.id === tariff.id) ? catalog : [tariff, ...catalog]
  return <Loaded me={me} tariff={tariff} items={windows} onTariff={setTariff} onChange={setItems} />
}

function Loaded({
  me,
  tariff,
  items,
  onTariff,
  onChange,
}: {
  me: Me
  tariff: Tariff
  items: Tariff[]
  onTariff: (tariff: Tariff) => void
  onChange: (items: Tariff[]) => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const more = useMenuOpen()
  const owner = isOwner(me)
  const [tab, setTab] = useState<TabId>('resumen')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'activate' | 'retire' | null>(null)
  const [editor, setEditor] = useState<{ key: number; title: string; draft: TariffDraft; mode: 'edit' | 'version' } | null>(null)
  const clash = overlappingActive(tariff, items)
  useChromeTitle(windowLabel(tariff))

  function replace(next: Tariff) {
    onTariff(next)
    const rest = items.filter((item) => item.id !== next.id)
    onChange([next, ...rest])
  }

  async function run(action: 'activate' | 'retire') {
    setBusy(true)
    try {
      const next = action === 'activate' ? await activateTariff(tariff.id) : await retireTariff(tariff.id)
      replace(next)
      setConfirm(null)
      toast(action === 'activate' ? copy.intercompany.activated : copy.intercompany.retiredToast)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.api.generic, { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const ordered = [...items].sort((a, b) => b.valid_from.localeCompare(a.valid_from) || a.id.localeCompare(b.id))

  return (
    <div data-screen="intercompania-tarifa" data-tab={tab} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <RecordBar
        backTo="/intercompania/tarifas"
        backLabel={copy.intercompany.backTariffs}
        actions={
          owner ? (
            <>
              {tariff.status === 'draft' && !clash ? (
                <Button type="button" variant="primary" size="sm" onClick={() => setConfirm('activate')}>
                  {copy.intercompany.activate}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    setEditor({
                      key: Date.now(),
                      title: copy.intercompany.newVersion,
                      mode: 'version',
                      draft: draftFromTariff(tariff, `${shiftPeriod(madridToday().slice(0, 7), 1)}-01`),
                    })
                  }
                >
                  {copy.intercompany.newVersion}
                </Button>
              )}
              {tariff.status === 'draft' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setEditor({
                      key: Date.now(),
                      title: copy.intercompany.edit,
                      mode: 'edit',
                      draft: draftFromTariff(tariff),
                    })
                  }
                >
                  {copy.intercompany.edit}
                </Button>
              ) : null}
              {tariff.status === 'active' ? (
                <GlassMenu
                  open={more.open}
                  onOpenChange={more.setOpen}
                  placement="bottom-end"
                  trigger={
                    <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.intercompany.more} onClick={more.toggle}>
                      <MoreVertical strokeWidth={iconStroke} />
                    </Button>
                  }
                >
                  <MenuItem
                    tone="danger"
                    onClick={() => {
                      more.close()
                      setConfirm('retire')
                    }}
                  >
                    {copy.intercompany.retire}
                  </MenuItem>
                </GlassMenu>
              ) : null}
            </>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium text-ink-900">{discountLabel(tariff.discount_pct)}</h1>
            <p className="mt-0.5 text-label text-text-secondary">{windowLabel(tariff)}</p>
          </header>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={tariffTone(tariff.status)}>{tariffStatusLabel(tariff.status)}</Badge>
            <Badge tone="neutral">{copy.intercompany.pair}</Badge>
            {clash ? <Badge tone="warning">{copy.intercompany.overlapChip}</Badge> : null}
          </div>
          {clash ? (
            <Alert tone="warning">
              <p className="text-label">{fill(copy.intercompany.overlap, { window: windowLabel(clash) })}</p>
            </Alert>
          ) : null}
          <div role="tablist" aria-label={copy.intercompany.tariffs} className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border-subtle px-4">
            {(
              [
                ['resumen', copy.intercompany.summary],
                ['vigencias', copy.intercompany.windows],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={cn(
                  'h-8 shrink-0 border-b-2 px-2 text-label max-sm:h-11 max-sm:min-w-11 max-sm:px-3',
                  tab === id ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
                )}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'resumen' ? (
            <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
              <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">{copy.intercompany.pair}</h2>
              <Fact
                label={copy.intercompany.discount}
                value={discountLabel(tariff.discount_pct)}
                hint={fill(copy.intercompany.formula, { discount: discountLabel(tariff.discount_pct) })}
              />
              <Fact label={copy.intercompany.validFrom} value={formatCivil(tariff.valid_from)} hint={copy.intercompany.windowHint} />
              <Fact
                label={copy.intercompany.validTo}
                value={tariff.valid_to ? formatCivil(tariff.valid_to) : copy.intercompany.openEnded}
              />
              <Fact label={copy.intercompany.advisor} value={tariff.advisor_validation} />
              <div className="px-4 py-2">
                <Reveal summary={copy.intercompany.baseId}>
                  <p className="font-mono text-caption break-all text-ink-900">{tariff.base_price_list_id}</p>
                </Reveal>
              </div>
            </section>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
              {ordered.map((item) => (
                <li key={item.id} className="border-b border-border-subtle last:border-b-0">
                  <Link
                    to={`/intercompania/tarifas/${item.id}`}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 hover:bg-fill-hover',
                      item.id === tariff.id && 'bg-fill-selected',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label text-ink-900">{windowLabel(item)}</span>
                      <span className="block text-caption text-text-tertiary">{discountLabel(item.discount_pct)}</span>
                    </span>
                    {item.id === tariff.id ? (
                      <Badge tone="neutral" size="sm">
                        {copy.intercompany.thisWindow}
                      </Badge>
                    ) : null}
                    <Badge tone={tariffTone(item.status)} size="sm">
                      {tariffStatusLabel(item.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Dialog open={confirm === 'activate'} onClose={() => setConfirm(null)} labelledBy="activar-tarifa" size="sm">
        <DialogHeader titleId="activar-tarifa" title={copy.intercompany.activateTitle} onClose={() => setConfirm(null)} />
        <DialogBody>
          <div data-screen="intercompania-activar" className="grid gap-2">
            <Fact label={copy.intercompany.discount} value={discountLabel(tariff.discount_pct)} />
            <Fact label={copy.intercompany.validFrom} value={windowLabel(tariff)} />
            <Fact label={copy.intercompany.advisor} value={tariff.advisor_validation} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(null)} disabled={busy}>
            {copy.intercompany.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void run('activate')}>
            {copy.intercompany.activate}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={confirm === 'retire'} onClose={() => setConfirm(null)} labelledBy="retirar-tarifa" size="sm">
        <DialogHeader titleId="retirar-tarifa" title={copy.intercompany.retireTitle} onClose={() => setConfirm(null)} />
        <DialogBody>
          <p className="text-label text-text-secondary">{copy.intercompany.retireBody}</p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(null)} disabled={busy}>
            {copy.intercompany.cancel}
          </Button>
          <Button type="button" variant="danger" size="sm" loading={busy} onClick={() => void run('retire')}>
            {copy.intercompany.retire}
          </Button>
        </DialogFooter>
      </Dialog>

      {editor ? (
        <TariffDialog
          key={editor.key}
          open
          title={editor.title}
          initial={editor.draft}
          baseLists={baseListOptions(items)}
          busy={busy}
          onClose={() => {
            if (!busy) setEditor(null)
          }}
          onSubmit={async (input) => {
            setBusy(true)
            try {
              if (editor.mode === 'edit') {
                const next = await updateTariff(tariff.id, input)
                replace(next)
                toast(copy.intercompany.saved)
              } else {
                const next = await createTariff(input)
                onChange([next, ...items])
                toast(copy.intercompany.created)
                navigate(`/intercompania/tarifas/${next.id}`)
              }
              setEditor(null)
            } catch (error: unknown) {
              if (!(error instanceof ApiError && error.fields)) {
                toast(error instanceof ApiError ? error.message : copy.api.generic, { tone: 'danger' })
              }
              throw error
            } finally {
              setBusy(false)
            }
          }}
        />
      ) : null}
    </div>
  )
}
