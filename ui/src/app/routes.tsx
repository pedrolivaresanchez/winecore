import { Route, Routes } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { Panel } from '@/pages/Panel'
import { ContactCreate } from '@/pages/contactos/ContactCreate'
import { ContactList } from '@/pages/contactos/ContactList'
import { ContactPage } from '@/pages/contactos/ContactPage'
import { SettlementList } from '@/pages/intercompania/SettlementList'
import { SettlementPage } from '@/pages/intercompania/SettlementPage'
import { TariffList } from '@/pages/intercompania/TariffList'
import { TariffPage } from '@/pages/intercompania/TariffPage'

/** Authenticated routes. The shell, auth and the entity switcher stay outside. */
export function AppRoutes({ me }: { me: Me }) {
  return (
    <Routes>
      <Route index element={<Panel me={me} />} />
      <Route path="contactos" element={<ContactList me={me} />} />
      <Route path="contactos/nuevo" element={<ContactCreate me={me} />} />
      <Route path="contactos/:id" element={<ContactPage me={me} />} />
      <Route path="intercompania" element={<SettlementList me={me} />} />
      <Route path="intercompania/tarifas" element={<TariffList me={me} />} />
      <Route path="intercompania/tarifas/:id" element={<TariffPage me={me} />} />
      <Route path="intercompania/:period" element={<SettlementPage me={me} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
