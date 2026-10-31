import { EntityProvider } from '@/app/entity-context'
import { AppRoutes } from '@/app/routes'
import { Shell } from '@/app/shell/app-layout'
import { BrandMark } from '@/components/BrandMark'
import { ErrorState } from '@/components/ErrorState'
import { useApi } from '@/hooks/use-api'
import { useNoAccess } from '@/hooks/use-no-access'
import { copy } from '@/i18n'
import { Skeleton } from '@/ui'
import type { Me } from '@/lib/types'
import { NoAccess } from '@/pages/NoAccess'

function LoadingScreen() {
  return (
    <div className="min-h-dvh bg-canvas px-4 py-5" data-screen="cargando" aria-busy="true">
      <p className="sr-only">{copy.loading}</p>
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-6 h-40 w-full max-w-3xl" />
    </div>
  )
}

export function Workspace() {
  const denied = useNoAccess()
  const me = useApi<Me>('/v1/me')

  if (denied) return <NoAccess />

  if (me.loading && !me.data) return <LoadingScreen />

  if (me.error || !me.data) {
    const error = me.error
    return (
      <main data-screen="error" className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-4">
        <BrandMark word="always" />
        <ErrorState
          title={`${copy.error.load} (${error?.code ?? 'WC_ERROR'})`}
          detail={error?.message}
          onRetry={me.reload}
        />
      </main>
    )
  }

  return (
    <EntityProvider me={me.data}>
      <Shell me={me.data}>
        <AppRoutes me={me.data} />
      </Shell>
    </EntityProvider>
  )
}
