import { useNavigate } from 'react-router-dom'
import { allows } from '@/lib/permissions'
import { useSalesCatalog } from '@/lib/sales-catalog'
import { docPath, type DocKind } from '@/lib/sales'
import type { Me } from '@/lib/types'
import { SalesDocumentList } from '@/pages/documents/SalesDocumentList'
import { CreateDelivery, CreateDocument } from '@/pages/ventas/dialogs'
import { VentasList } from '@/pages/ventas/VentasList'

export function SalesHome({ me, doc, creating = false }: { me: Me; doc: DocKind; creating?: boolean }) {
  if (doc === 'order') return <VentasList me={me} creating={creating} />
  return (
    <>
      <SalesDocumentList me={me} kind={doc === 'quote' ? 'quote' : 'delivery_note'} />
      {creating && allows(me, 'sales.write') ? <CreateOver doc={doc} /> : null}
    </>
  )
}

/** `/nuevo` opens the dialog over the same list; closing it goes back to that list. */
function CreateOver({ doc }: { doc: 'quote' | 'delivery' }) {
  const navigate = useNavigate()
  const { customers } = useSalesCatalog()
  const close = () => navigate(docPath(doc))
  const created = (id: string) => navigate(`${docPath(doc)}/${id}`)
  if (doc === 'quote') return <CreateDocument doc="quote" customers={customers} onClose={close} onCreated={created} />
  return <CreateDelivery customers={customers} onClose={close} onCreated={created} />
}
