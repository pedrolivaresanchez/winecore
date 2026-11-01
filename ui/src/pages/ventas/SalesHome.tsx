import type { Me } from '@/lib/types'
import { SalesDocumentList } from '@/pages/documents/SalesDocumentList'
import { VentasList } from '@/pages/ventas/VentasList'
import type { DocKind } from '@/lib/sales'

export function SalesHome({ me, doc, creating = false }: { me: Me; doc: DocKind; creating?: boolean }) {
  if (creating || doc === 'order') return <VentasList me={me} doc={doc} creating={creating} />
  return <SalesDocumentList me={me} kind={doc === 'quote' ? 'quote' : 'delivery_note'} />
}
