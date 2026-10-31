import { Route, Routes } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { InformesPage } from '@/pages/informes/InformesPage'
import { Panel } from '@/pages/Panel'
import { ApprovalPage } from '@/pages/aprobaciones/Detail'
import { ApprovalInbox } from '@/pages/aprobaciones/Inbox'
import { ContactCreate } from '@/pages/contactos/ContactCreate'
import { ContactList } from '@/pages/contactos/ContactList'
import { ContactPage } from '@/pages/contactos/ContactPage'

/** Authenticated routes. The shell, auth and the entity switcher stay outside. */
export function AppRoutes({ me }: { me: Me }) {
  return (
    <Routes>
      <Route index element={<Panel me={me} />} />
      <Route path="aprobaciones" element={<ApprovalInbox me={me} />} />
      <Route path="aprobaciones/:id" element={<ApprovalPage />} />
      <Route path="contactos" element={<ContactList me={me} />} />
      <Route path="contactos/nuevo" element={<ContactCreate me={me} />} />
      <Route path="contactos/:id" element={<ContactPage me={me} />} />
      <Route path="informes" element={<InformesPage me={me} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
