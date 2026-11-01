import { useNavigate, useSearchParams } from 'react-router-dom'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { SalesDocumentList } from '@/pages/documents/SalesDocumentList'
import { CreateInvoice } from '@/pages/facturas/CreateInvoice'

/** Holded y WineCore en una sola lista; Verifactu y envío son filtros de la misma. `/facturas/nueva` abre el alta encima. */
export function FacturasPage({ me, creating = false }: { me: Me; creating?: boolean }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const back = new URLSearchParams(params)
  back.delete('cliente')
  const search = back.toString()
  return (
    <>
      <SalesDocumentList me={me} kind="invoice" />
      {creating && allows(me, 'billing.write') ? (
        <CreateInvoice
          onClose={() => navigate({ pathname: '/facturas', search: search ? `?${search}` : '' })}
          onCreated={(id) => navigate(`/facturas/${id}`)}
        />
      ) : null}
    </>
  )
}
