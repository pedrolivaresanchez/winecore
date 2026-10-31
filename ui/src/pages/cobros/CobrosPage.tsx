import { useSearchParams } from 'react-router-dom'
import { NoPermission } from '@/components/NoPermission'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { vistaOf } from '@/pages/cobros/vista'
import { Conciliacion } from '@/pages/cobros/Conciliacion'
import { Pagos } from '@/pages/cobros/Pagos'
import { Pendiente } from '@/pages/cobros/Pendiente'
import { Remesas } from '@/pages/cobros/Remesas'

export function CobrosPage({ me }: { me: Me }) {
  const [params] = useSearchParams()
  if (!allows(me, 'finance.read')) return <NoPermission />
  const vista = vistaOf(params.get('vista'))
  if (vista === 'pagos') return <Pagos me={me} />
  if (vista === 'conciliacion') return <Conciliacion me={me} />
  if (vista === 'remesas') return <Remesas me={me} />
  return <Pendiente me={me} />
}
