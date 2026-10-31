import { useParams } from 'react-router-dom'
import { NoPermission } from '@/components/NoPermission'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { CalendarioPage } from '@/pages/regulatorio/Calendario'
import { EnvioPage } from '@/pages/regulatorio/Envio'
import { MayoresPage } from '@/pages/regulatorio/Mayores'
import { ModelosPage } from '@/pages/regulatorio/Modelos'
import { PresentacionesPage } from '@/pages/regulatorio/Presentaciones'

export function Regulatorio({ me }: { me: Me }) {
  const params = useParams()
  const rest = params['*'] ?? ''
  if (!allows(me, 'regulatory.read')) return <NoPermission />
  const filing = /^envios\/([^/]+)$/.exec(rest)
  if (filing?.[1]) return <EnvioPage me={me} id={decodeURIComponent(filing[1])} />
  if (rest === 'calendario') return <CalendarioPage me={me} />
  if (rest === 'mayores') return <MayoresPage me={me} />
  if (rest === 'modelos') return <ModelosPage me={me} />
  if (rest === '') return <PresentacionesPage me={me} />
  return <NotFound />
}
