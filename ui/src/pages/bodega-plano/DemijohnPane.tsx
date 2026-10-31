import { useState } from 'react'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { useApi } from '@/hooks/use-api'
import { ErrorState } from '@/components/ErrorState'
import { Badge, Skeleton, Switch, useToast } from '@/ui'
import { saveDemijohn } from '@/pages/bodega-plano/api'
import type { DemijohnView } from '@/pages/bodega-plano/types'

export function DemijohnPane({ code, canOperate }: { code: string; canOperate: boolean }) {
  const data = useApi<DemijohnView>(`/v1/vessels/${encodeURIComponent(code)}/demijohn`)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const outdoor = data.data?.outdoor_aging === true

  async function toggle(next: boolean) {
    setBusy(true)
    try {
      await saveDemijohn(code, next)
      data.reload()
      toast(copy.plano.outdoorSaved)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.plano.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  if (data.loading && !data.data) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-14" />
      </div>
    )
  }
  if (data.error || !data.data) {
    return <ErrorState title={`${copy.error.load} (${data.error?.code ?? 'WC_ERROR'})`} detail={data.error?.message} onRetry={data.reload} />
  }

  return (
    <div className="grid gap-3" data-screen="bodega-damajuana">
      {outdoor ? (
        <div>
          <Badge tone="info">{copy.plano.outdoorAging}</Badge>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-subtle px-4 py-3">
        <span className="text-label text-ink-900">{copy.plano.outdoorAging}</span>
        <Switch
          id="damajuana-intemperie"
          checked={outdoor}
          disabled={!canOperate || busy}
          aria-label={copy.plano.outdoorAging}
          onChange={(checked) => void toggle(checked)}
        />
      </div>
    </div>
  )
}
