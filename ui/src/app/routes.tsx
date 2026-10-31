import { Route, Routes } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { Panel } from '@/pages/Panel'
import { ContactCreate } from '@/pages/contactos/ContactCreate'
import { ContactList } from '@/pages/contactos/ContactList'
import { ContactPage } from '@/pages/contactos/ContactPage'
import { CobrosPage } from '@/pages/cobros/CobrosPage'
import { RemesaPage } from '@/pages/cobros/RemesaPage'

/** Authenticated routes. The shell, auth and the entity switcher stay outside. */
export function AppRoutes({ me }: { me: Me }) {
  return (
    <Routes>
      <Route index element={<Panel me={me} />} />
      <Route path="contactos" element={<ContactList me={me} />} />
      <Route path="contactos/nuevo" element={<ContactCreate me={me} />} />
      <Route path="contactos/:id" element={<ContactPage me={me} />} />
      <Route path="cobros" element={<CobrosPage me={me} />} />
      <Route path="cobros/remesas/:id" element={<RemesaPage me={me} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
