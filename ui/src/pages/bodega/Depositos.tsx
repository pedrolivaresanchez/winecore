import { useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { copy } from '@/i18n'
import { readStorage, writeStorage } from '@/lib/storage'
import type { Me } from '@/lib/types'
import { SegmentedControl } from '@/ui'
import { PlanoPage } from '@/pages/bodega-plano/Plano'
import { MapaPage } from '@/pages/bodega/Mapa'

type VesselView = 'plano' | 'lista'

const VIEW_KEY = 'winecore.bodega.vista'

function isView(value: string | null): value is VesselView {
  return value === 'plano' || value === 'lista'
}

function viewHref(view: VesselView, params: URLSearchParams): string {
  const next = new URLSearchParams(params)
  next.set('vista', view)
  return `/bodega/depositos?${next.toString()}`
}

/** One place, two views. `?vista=` names the view; without it you get the last one you used. */
export function DepositosPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams()
  const asked = params.get('vista')
  const view = isView(asked) ? asked : null

  useEffect(() => {
    if (view) writeStorage(VIEW_KEY, view)
  }, [view])

  if (!view) {
    const stored = readStorage(VIEW_KEY)
    return <Navigate to={viewHref(isView(stored) ? stored : 'plano', params)} replace />
  }

  const views = (
    <SegmentedControl<VesselView>
      size="sm"
      aria-label={copy.cellar.view}
      value={view}
      onChange={(next) => setParams({ vista: next }, { replace: true })}
      options={[
        { value: 'plano', content: copy.cellar.viewPlan },
        { value: 'lista', content: copy.cellar.viewList },
      ]}
    />
  )
  return view === 'plano' ? <PlanoPage me={me} views={views} /> : <MapaPage me={me} views={views} />
}

/** `/bodega/plano` links keep what they pointed at (`recipiente`, `zona`). */
export function PlanoRedirect() {
  const [params] = useSearchParams()
  return <Navigate to={viewHref('plano', params)} replace />
}
