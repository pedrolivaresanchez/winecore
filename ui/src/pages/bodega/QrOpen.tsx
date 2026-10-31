import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Skeleton } from '@/ui'

type Resolved = { code: string }

export function QrOpen({ me }: { me: Me }) {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const path = allows(me, 'cellar.read') && token ? `/v1/vessels/qr/${encodeURIComponent(token)}` : null
  const data = useApi<Resolved>(path)

  useEffect(() => {
    if (data.data?.code) navigate(`/bodega/depositos/${encodeURIComponent(data.data.code)}`, { replace: true })
  }, [data.data?.code, navigate])

  if (!allows(me, 'cellar.read')) return <NoPermission />
  if (data.error) {
    return (
      <div className="p-6" data-screen="bodega-qr-abierto">
        <ErrorState title={`${copy.error.load} (${data.error.code})`} detail={data.error.message} onRetry={data.reload} />
      </div>
    )
  }
  return (
    <div aria-busy="true" className="grid gap-3 p-6" data-screen="bodega-qr-abierto">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-36" />
    </div>
  )
}
