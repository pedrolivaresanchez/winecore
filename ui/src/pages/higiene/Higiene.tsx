import { useLocation } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { Consumibles } from '@/pages/higiene/Consumibles'
import { Envasado } from '@/pages/higiene/Envasado'
import { EnvasadoForm } from '@/pages/higiene/EnvasadoForm'
import { EquipoPage } from '@/pages/higiene/EquipoPage'
import { Equipos } from '@/pages/higiene/Equipos'
import { Filtraciones } from '@/pages/higiene/Filtraciones'
import { LimpiezaForm } from '@/pages/higiene/LimpiezaForm'
import { Limpiezas } from '@/pages/higiene/Limpiezas'
import { ProcedimientoForm } from '@/pages/higiene/ProcedimientoForm'
import { Procedimientos } from '@/pages/higiene/Procedimientos'

export function Higiene({ me }: { me: Me }) {
  const { pathname } = useLocation()
  const rest = pathname.replace(/^\/bodega\/higiene\/?/, '')
  const [head, id] = rest.split('/').filter(Boolean)

  if (!head) return <Limpiezas me={me} />
  if (head === 'limpiezas' && id === 'nueva') return <LimpiezaForm me={me} />
  if (head === 'limpiezas') return <Limpiezas me={me} />
  if (head === 'filtraciones') return <Filtraciones me={me} />
  if (head === 'envasado' && id) return <EnvasadoForm me={me} operationId={id} />
  if (head === 'envasado') return <Envasado me={me} />
  if (head === 'equipos' && id) return <EquipoPage me={me} equipmentId={id} />
  if (head === 'equipos') return <Equipos me={me} />
  if (head === 'consumibles') return <Consumibles me={me} />
  if (head === 'procedimientos' && !id) return <Procedimientos me={me} />
  if (head === 'procedimientos') return <ProcedimientoForm me={me} procedureId={id === 'nuevo' ? null : (id ?? null)} />
  return <NotFound />
}
