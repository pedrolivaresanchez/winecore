import { useParams } from 'react-router-dom'
import { NoPermission } from '@/components/NoPermission'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { EvolutionPage } from '@/pages/catas/EvolutionPage'
import { NoteForm } from '@/pages/catas/NoteForm'
import { NotePage } from '@/pages/catas/NotePage'
import { NotesPage } from '@/pages/catas/NotesPage'
import { SessionPage } from '@/pages/catas/SessionPage'
import { SessionsPage } from '@/pages/catas/SessionsPage'
import { NotFound } from '@/pages/NotFound'

export function CatasPage({ me }: { me: Me }) {
  const params = useParams()
  const rest = params['*'] ?? ''
  if (!allows(me, 'cellar.read')) return <NoPermission />
  if (rest === '' || rest === '/') return <NotesPage me={me} />
  if (rest === 'nueva') return <NoteForm me={me} />
  if (rest.startsWith('notas/')) {
    const id = decodeURIComponent(rest.slice('notas/'.length))
    if (id.endsWith('/editar')) return <NoteForm me={me} noteId={id.slice(0, -'/editar'.length)} />
    return <NotePage me={me} noteId={id} />
  }
  if (rest === 'ciegas') return <SessionsPage me={me} />
  if (rest.startsWith('ciegas/')) return <SessionPage me={me} sessionId={decodeURIComponent(rest.slice('ciegas/'.length))} />
  if (rest === 'evolucion') return <EvolutionPage me={me} />
  return <NotFound />
}
