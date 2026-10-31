import { Badge, Skeleton } from '@/ui'
import { ErrorState } from '@/components/ErrorState'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import type { Health } from '@/lib/types'

function versionOf(sha: string) {
  const clean = sha.trim()
  return clean ? clean.slice(0, 7) : '—'
}

function databaseLabel(db: string) {
  if (db === 'local') return copy.panel.dbLocal
  if (db === 'timbal') return copy.panel.dbTimbal
  return db
}

function writerLabel(writer: string) {
  if (writer === 'leader') return copy.panel.writerLeader
  if (writer === 'standby') return copy.panel.writerStandby
  return writer
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-4 py-2.5 last:border-b-0">
      <dt className="text-label text-text-tertiary">{label}</dt>
      <dd className="min-w-0 truncate text-label text-ink-900">{value}</dd>
    </div>
  )
}

export function SystemStatus() {
  const health = useApi<Health>('/health')
  return (
    <section aria-labelledby="estado-sistema" data-health={health.error ? 'error' : health.data ? 'ok' : 'loading'}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="estado-sistema" className="sr-only">
          {copy.panel.system}
        </h2>
        {health.data && health.data.status !== 'ok' ? <Badge tone="warning">{copy.panel.incident}</Badge> : null}
      </div>
      {health.loading ? (
        <div className="grid gap-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      ) : health.error ? (
        <ErrorState
          title={`${copy.error.load} (${health.error.code})`}
          detail={health.error.message}
          onRetry={health.reload}
        />
      ) : health.data ? (
        <dl className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-(--shadow-panel)">
          <Row label={copy.panel.version} value={versionOf(health.data.sha)} />
          <Row label={copy.panel.schema} value={health.data.schema_version || '—'} />
          <Row label={copy.panel.database} value={databaseLabel(health.data.db)} />
          <Row label={copy.panel.writer} value={writerLabel(health.data.writer)} />
        </dl>
      ) : null}
    </section>
  )
}
