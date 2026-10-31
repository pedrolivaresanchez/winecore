import { useSearchParams } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { HistoricalDocs } from '@/pages/ventas/HistoricalDocs'
import { VentasList } from '@/pages/ventas/VentasList'
import type { DocKind } from '@/lib/sales'

export function SalesHome({ me, doc, creating = false }: { me: Me; doc: DocKind; creating?: boolean }) {
  const [params] = useSearchParams()
  if (!creating && doc !== 'order' && params.get('libro') !== 'winecore') {
    return <HistoricalDocs me={me} kind={doc === 'quote' ? 'quote' : 'delivery'} />
  }
  return <VentasList me={me} doc={doc} creating={creating} />
}
