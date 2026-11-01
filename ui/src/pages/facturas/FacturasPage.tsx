import type { Me } from '@/lib/types'
import { SalesDocumentList } from '@/pages/documents/SalesDocumentList'

/** Holded y WineCore en una sola lista; Verifactu y envío son filtros de la misma. */
export function FacturasPage({ me }: { me: Me }) {
  return <SalesDocumentList me={me} kind="invoice" />
}
