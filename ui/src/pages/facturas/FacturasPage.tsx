import { useNavigate, useSearchParams } from 'react-router-dom'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { CreateInvoice } from '@/pages/facturas/CreateInvoice'
import { HoldedList } from '@/pages/facturas/HoldedList'
import { InvoiceList } from '@/pages/facturas/InvoiceList'

/** Histórico Holded por defecto. El libro Verifactu sigue en `?libro=emitidas`. `/facturas/nueva` abre el alta encima del libro que toque. */
export function FacturasPage({ me, creating = false }: { me: Me; creating?: boolean }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const verifactu = params.get('libro') === 'emitidas' || Boolean(params.get('verifactu'))
  const back = new URLSearchParams(params)
  back.delete('cliente')
  const search = back.toString()
  return (
    <>
      {verifactu ? <InvoiceList me={me} /> : <HoldedList me={me} />}
      {creating && allows(me, 'billing.write') ? (
        <CreateInvoice
          onClose={() => navigate({ pathname: '/facturas', search: search ? `?${search}` : '' })}
          onCreated={(id) => navigate(`/facturas/${id}`)}
        />
      ) : null}
    </>
  )
}
