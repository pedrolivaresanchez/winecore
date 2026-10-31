import { useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { NoPermission } from '@/components/NoPermission'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Cuaderno } from '@/pages/vinedo/Cuaderno'
import { Maduracion } from '@/pages/vinedo/Maduracion'
import { Parcelas } from '@/pages/vinedo/Parcelas'
import { Planificador } from '@/pages/vinedo/Planificador'
import { Recepcion } from '@/pages/vinedo/Recepcion'
import { Vendimias } from '@/pages/vinedo/Vendimias'
import { sectionOf } from '@/pages/vinedo/labels'

export function Vinedo({ me }: { me: Me }) {
  const [params] = useSearchParams()
  const section = sectionOf(params.get('seccion'))
  useChromeTitle(copy.nav.vineyard)
  if (!allows(me, 'vineyard.read')) return <NoPermission />
  if (section === 'maduracion') return <Maduracion me={me} />
  if (section === 'planificador') return <Planificador me={me} />
  if (section === 'vendimias') return <Vendimias me={me} />
  if (section === 'recepcion') return <Recepcion me={me} />
  if (section === 'cuaderno') return <Cuaderno me={me} />
  return <Parcelas me={me} />
}
