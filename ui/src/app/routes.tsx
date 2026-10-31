import { Route, Routes } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { Panel } from '@/pages/Panel'
import { ContactCreate } from '@/pages/contactos/ContactCreate'
import { ContactList } from '@/pages/contactos/ContactList'
import { ContactPage } from '@/pages/contactos/ContactPage'
import { CreateInvoice } from '@/pages/facturas/CreateInvoice'
import { InvoiceList } from '@/pages/facturas/InvoiceList'
import { InvoicePage } from '@/pages/facturas/InvoicePage'
import { RectifyPage } from '@/pages/facturas/RectifyPage'

/** Authenticated routes. The shell, auth and the entity switcher stay outside. */
export function AppRoutes({ me }: { me: Me }) {
  return (
    <Routes>
      <Route index element={<Panel me={me} />} />
      <Route path="contactos" element={<ContactList me={me} />} />
      <Route path="contactos/nuevo" element={<ContactCreate me={me} />} />
      <Route path="contactos/:id" element={<ContactPage me={me} />} />
      <Route path="facturas" element={<InvoiceList me={me} />} />
      <Route path="facturas/nueva" element={<CreateInvoice me={me} />} />
      <Route path="facturas/:id/rectificar" element={<RectifyPage me={me} />} />
      <Route path="facturas/:id" element={<InvoicePage me={me} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
