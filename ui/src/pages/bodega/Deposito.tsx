import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { useApi } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api'
import { contentLabel, fillPercent, holding, kindLabel, type CellarOperation, type Vessel, type VesselLabel } from '@/lib/cellar'
import { formatDateTime, formatLitres } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { Badge, Button, Dialog, DialogBody, DialogFooter, DialogHeader, EmptyState, GlassMenu, MenuItem, Textarea, useMenuOpen, useToast } from '@/ui'
import { MoreVertical, Printer } from '@/ui/icons'
import { Fact, FactCard, FillMeter, ReadingColumn, RecordBar, SectionTabs } from '@/pages/bodega/chrome'
import { materialLabel, opLabel, opStatusLabel, opStatusTone, vesselStatusLabel, vesselTone } from '@/pages/bodega/labels'
import { BarrelMenu, BarrelRetireHost } from '@/pages/bodega-plano/BarrelMenu'
import { BarrelPane } from '@/pages/bodega-plano/BarrelPane'
import { DemijohnPane } from '@/pages/bodega-plano/DemijohnPane'
import { vesselTabs, type VesselTabId } from '@/pages/bodega-plano/text'
import { LotAnalyses } from '@/pages/elaboracion/Analiticas'
import { LotCurve } from '@/pages/elaboracion/Lecturas'
import { RecordSkeleton } from '@/components/RecordSkeleton'

type HistoryPage = { items: CellarOperation[] }

type TabId = VesselTabId

export function DepositoPage({ me }: { me: Me }) {
  const { vesselId = '' } = useParams()
  const path = allows(me, 'cellar.read') && vesselId ? `/v1/vessels/${encodeURIComponent(vesselId)}` : null
  const data = useApi<Vessel>(path)
  const history = useApi<HistoryPage>(path ? `${path}/history?limit=20` : null)
  const [tab, setTab] = useState<TabId>('contenido')
  useChromeTitle(data.data?.code || copy.cellar.vessels)

  if (!allows(me, 'cellar.read')) return <NoPermission />
  if (data.loading && !data.data) {
    return <RecordSkeleton />
  }
  if (data.error || !data.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${data.error?.code ?? 'WC_ERROR'})`} detail={data.error?.message} onRetry={data.reload} />
      </div>
    )
  }

  return (
    <Loaded
      me={me}
      vessel={data.data}
      operations={history.data?.items ?? []}
      tab={tab}
      onTab={setTab}
      onReload={data.reload}
    />
  )
}

function Loaded({
  me,
  vessel,
  operations,
  tab,
  onTab,
  onReload,
}: {
  me: Me
  vessel: Vessel
  operations: CellarOperation[]
  tab: TabId
  onTab: (tab: TabId) => void
  onReload: () => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const more = useMenuOpen()
  const canOperate = allows(me, 'cellar.operate')
  const canManage = allows(me, 'cellar.manage')
  const [retireOpen, setRetireOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const pct = fillPercent(vessel)
  const inside = holding(vessel)
  const tabs = vesselTabs(vessel.kind)
  const nueva = `/bodega/operaciones/nueva?tipo=racking&vessel=${encodeURIComponent(vessel.code)}`
  const limpieza = `/bodega/operaciones/nueva?tipo=cleaning&vessel=${encodeURIComponent(vessel.code)}`
  const cleanings = operations.filter((item) => item.op_type === 'cleaning')

  async function retire() {
    setBusy(true)
    try {
      await api(`/v1/vessels/${encodeURIComponent(vessel.code)}/retire`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      })
      setRetireOpen(false)
      toast('Depósito dado de baja')
      onReload()
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : 'No se ha podido dar de baja.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ReadingColumn screen="bodega-deposito" tab={tab}>
      <RecordBar backTo="/bodega/depositos" backLabel={copy.cellar.vessels}>
        {canOperate ? (
          <Button type="button" variant="primary" size="sm" onClick={() => navigate(nueva)}>
            {copy.cellar.operation}
          </Button>
        ) : null}
        {canOperate ? (
          <Button type="button" variant="secondary" size="sm" className="hidden sm:inline-flex" onClick={() => navigate(limpieza)}>
            {copy.cellar.cleaning}
          </Button>
        ) : null}
        <GlassMenu
          open={more.open}
          onOpenChange={more.setOpen}
          placement="bottom-end"
          trigger={
            <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.cellar.more} onClick={more.toggle}>
              <MoreVertical strokeWidth={iconStroke} />
            </Button>
          }
        >
          {canOperate ? (
            <MenuItem
              className="sm:hidden"
              onClick={() => {
                more.close()
                navigate(limpieza)
              }}
            >
              {copy.cellar.cleaning}
            </MenuItem>
          ) : null}
          <MenuItem
            onClick={() => {
              more.close()
              onTab('qr')
            }}
          >
            {copy.cellar.qr}
          </MenuItem>
          <MenuItem
            onClick={() => {
              more.close()
              onTab('qr')
              window.setTimeout(() => window.print(), 50)
            }}
          >
            {copy.cellar.printQr}
          </MenuItem>
          {canManage ? (
            <MenuItem
              tone="danger"
              onClick={() => {
                more.close()
                setRetireOpen(true)
              }}
            >
              {copy.cellar.retire}
            </MenuItem>
          ) : null}
          <MenuItem
            onClick={() => {
              more.close()
              navigate(`/bodega/depositos?vista=plano&recipiente=${encodeURIComponent(vessel.code)}`)
            }}
          >
            {copy.plano.onPlan}
          </MenuItem>
          {canOperate && vessel.kind === 'barrel' ? <BarrelMenu code={vessel.code} close={more.close} /> : null}
        </GlassMenu>
      </RecordBar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{vessel.code}</h1>
            <p className="mt-0.5 text-label text-text-secondary">
              {vessel.name} · {kindLabel(vessel.kind)}
            </p>
          </header>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={vesselTone(vessel)}>{contentLabel(vessel)}</Badge>
            <Badge tone="neutral">{vesselStatusLabel(vessel.status)}</Badge>
            {vessel.alert ? <Badge tone="warning">{vessel.alert}</Badge> : null}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Metric label={copy.cellar.litres} value={formatLitres(vessel.volume_ml / 1000)} />
            <Metric label={copy.cellar.capacity} value={formatLitres(vessel.capacity_ml / 1000)} />
            <Metric label={copy.cellar.fill} value={`${pct} %`} />
          </div>
          <FillMeter pct={pct} label={`${copy.cellar.fill} ${pct} %`} />
          <SectionTabs label="Secciones" tabs={tabs} value={tab} onChange={onTab} />

          {tab === 'contenido' ? (
            <FactCard title="Datos">
              <div className="px-4 py-3">
                {inside ? (
                  <Link to={`/bodega/lotes/${encodeURIComponent(inside.lot_code)}`} className="text-label font-medium text-ink-900 underline max-sm:-my-3.25 max-sm:block max-sm:py-3.25">
                    {inside.lot_code}
                    {inside.wine_name ? ` · ${inside.wine_name}` : ''}
                    {inside.vintage ? ` · ${inside.vintage}` : ''}
                  </Link>
                ) : (
                  <p className="text-label text-text-secondary">Sin vino dentro.</p>
                )}
              </div>
              <Fact label={copy.cellar.zone} value={vessel.zone || '—'} />
              <Fact label={copy.cellar.material} value={materialLabel(vessel.material)} />
              <Fact label={copy.cellar.status} value={vesselStatusLabel(vessel.status)} />
              {vessel.kind === 'tank_fermenter' ? <Fact label="Camisa de frío" value={vessel.has_cooling_jacket ? 'Sí' : 'No'} /> : null}
              {vessel.sisv_code ? <Fact label="Código SISV" value={vessel.sisv_code} /> : null}
            </FactCard>
          ) : null}

          {tab === 'barrica' ? <BarrelPane me={me} code={vessel.code} /> : null}
          {tab === 'damajuana' ? <DemijohnPane code={vessel.code} canOperate={canOperate} /> : null}

          {tab === 'lecturas' ? (
            inside ? <LotCurve lotCode={inside.lot_code} /> : <EmptyState size="sm" title={copy.cellar.emptyReadings} description={copy.cellar.emptyReadingsHint} />
          ) : null}
          {tab === 'analiticas' ? (
            inside ? <LotAnalyses me={me} lotCode={inside.lot_code} /> : <EmptyState size="sm" title={copy.cellar.emptyAnalyses} description={copy.cellar.emptyAnalysesHint} />
          ) : null}
          {tab === 'limpiezas' ? (
            cleanings.length === 0 ? (
              <EmptyState size="sm" title={copy.cellar.emptyCleanings} description="Cuando se registre una limpieza, aparecerá aquí." />
            ) : (
              <OperationList operations={cleanings} />
            )
          ) : null}
          {tab === 'historial' ? (
            operations.length === 0 ? (
              <EmptyState size="sm" title={copy.cellar.emptyHistory} description="Los trasiegos y mermas de este depósito." />
            ) : (
              <OperationList operations={operations} />
            )
          ) : null}
          {tab === 'qr' ? <QrPanel code={vessel.code} fallback={vessel.qr_token ?? null} /> : null}
        </div>
      </div>

      <Dialog open={retireOpen} onClose={() => setRetireOpen(false)} labelledBy="baja-titulo" size="sm">
        <DialogHeader titleId="baja-titulo" title={copy.cellar.retireTitle} description={copy.cellar.retireHint} onClose={() => setRetireOpen(false)} />
        <DialogBody>
          <Textarea id="motivo-baja" aria-label={copy.cellar.reason} value={reason} onChange={(event) => setReason(event.target.value)} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRetireOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" size="sm" loading={busy} disabled={reason.trim().length < 3} onClick={() => void retire()}>
            {copy.cellar.retire}
          </Button>
        </DialogFooter>
      </Dialog>
      {vessel.kind === 'barrel' ? <BarrelRetireHost /> : null}
    </ReadingColumn>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border-subtle px-3 py-2">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="text-label font-medium break-words text-ink-900 tabular-nums">{value}</p>
    </div>
  )
}

function OperationList({ operations }: { operations: CellarOperation[] }) {
  return (
    <ul className="grid gap-2">
      {operations.map((operation) => (
        <li key={operation.id}>
          <Link to={`/bodega/operaciones/${operation.id}`} className="block rounded-2xl border border-border-subtle px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-label font-medium text-ink-900">{opLabel(operation.op_type)}</p>
              <Badge tone={opStatusTone(operation.status)} size="sm">
                {opStatusLabel(operation.status)}
              </Badge>
            </div>
            <p className="mt-1 text-caption text-text-tertiary">
              {formatDateTime(operation.occurred_at)} · {operation.performed_by}
              {operation.number ? ` · ${operation.number}` : ''}
            </p>
            {operation.reason ? <p className="mt-1 text-label text-text-secondary">{operation.reason}</p> : null}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function QrPanel({ code, fallback }: { code: string; fallback: string | null }) {
  const data = useApi<VesselLabel>(`/v1/vessels/${encodeURIComponent(code)}/qr`)
  const token = data.data?.qr_token ?? fallback ?? ''
  const url = data.data?.payload ?? `${window.location.origin}/bodega/depositos/${encodeURIComponent(code)}`
  return (
    <div className="grid max-w-sm gap-3">
      {data.error ? (
        <p className="text-label text-text-secondary" role="status">
          {data.error.code === 'WC_QR_FOREIGN' ? copy.cellar.qrForeign : data.error.message}
        </p>
      ) : null}
      <section className="grid gap-3 rounded-2xl border border-border-subtle bg-surface p-4">
        <p className="text-caption text-text-tertiary">{copy.cellar.qrLabel}</p>
        <QrMark code={code} />
        <p className="text-center text-label font-medium text-ink-900">{code}</p>
        <p className="text-center font-mono text-caption break-all text-text-tertiary">{url}</p>
        {token ? <p className="text-center font-mono text-caption break-all text-text-tertiary">{token}</p> : null}
      </section>
      <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
        <Printer strokeWidth={iconStroke} />
        {copy.cellar.printQr}
      </Button>
    </div>
  )
}

function QrMark({ code }: { code: string }) {
  const cells = code.split('').map((char, index) => (char.charCodeAt(0) + index) % 2 === 0)
  return (
    <svg viewBox="0 0 21 21" className="mx-auto size-40 bg-surface" role="img" aria-label={`QR de ${code}`}>
      {Array.from({ length: 21 * 21 }, (_, index) => {
        const x = index % 21
        const y = Math.floor(index / 21)
        const on = (cells[(x * 3 + y * 5) % Math.max(cells.length, 1)] ?? false) || (x < 4 && y < 4) || (x > 16 && y < 4) || (x < 4 && y > 16)
        return on ? <rect key={index} x={x} y={y} width="1" height="1" className="fill-ink-900" /> : null
      })}
    </svg>
  )
}
