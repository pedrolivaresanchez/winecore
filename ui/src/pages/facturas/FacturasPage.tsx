import { useSearchParams } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { HoldedList } from '@/pages/facturas/HoldedList'
import { InvoiceList } from '@/pages/facturas/InvoiceList'

/** Histórico Holded por defecto. El libro Verifactu sigue en `?libro=emitidas`. */
export function FacturasPage({ me }: { me: Me }) {
  const [params] = useSearchParams()
  if (params.get('libro') === 'emitidas' || params.get('verifactu')) return <InvoiceList me={me} />
  return <HoldedList me={me} />
}
