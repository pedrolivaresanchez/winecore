import { useNavigate, useSearchParams } from 'react-router-dom'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { CreateDocument } from '@/pages/ventas/dialogs'
import { HistoricalDocs } from '@/pages/ventas/HistoricalDocs'
import { VentasList } from '@/pages/ventas/VentasList'
import { docPath, type DocKind } from '@/lib/sales'

export function SalesHome({ me, doc, creating = false }: { me: Me; doc: DocKind; creating?: boolean }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const historical = doc !== 'order' && params.get('libro') !== 'winecore' && !(creating && doc === 'delivery')
  if (!historical) return <VentasList me={me} doc={doc} creating={creating} />
  return (
    <>
      <HistoricalDocs me={me} kind={doc === 'quote' ? 'quote' : 'delivery'} />
      {creating && doc === 'quote' && allows(me, 'sales.write') ? (
        <CreateDocument
          doc="quote"
          onClose={() => navigate(docPath('quote'))}
          onCreated={(id) => navigate(`${docPath('quote')}/${id}`)}
        />
      ) : null}
    </>
  )
}
