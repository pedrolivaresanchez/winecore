import { Route, Routes } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { Panel } from '@/pages/Panel'
import { ContactCreate } from '@/pages/contactos/ContactCreate'
import { ContactList } from '@/pages/contactos/ContactList'
import { ContactPage } from '@/pages/contactos/ContactPage'
import { CountCreate } from '@/pages/existencias/CountCreate'
import { CountPage } from '@/pages/existencias/CountPage'
import { CountsPage } from '@/pages/existencias/CountsPage'
import { InspectionPage } from '@/pages/existencias/InspectionPage'
import { MovesPage } from '@/pages/existencias/MovesPage'
import { StockPage } from '@/pages/existencias/StockPage'

/** Authenticated routes. The shell, auth and the entity switcher stay outside. */
export function AppRoutes({ me }: { me: Me }) {
  return (
    <Routes>
      <Route index element={<Panel me={me} />} />
      <Route path="contactos" element={<ContactList me={me} />} />
      <Route path="contactos/nuevo" element={<ContactCreate me={me} />} />
      <Route path="contactos/:id" element={<ContactPage me={me} />} />
      <Route path="stock" element={<StockPage me={me} />} />
      <Route path="stock/movimientos" element={<MovesPage me={me} />} />
      <Route path="stock/informe" element={<InspectionPage me={me} />} />
      <Route path="stock/aforos" element={<CountsPage me={me} />} />
      <Route path="stock/aforos/nuevo" element={<CountCreate me={me} />} />
      <Route path="stock/aforos/:id" element={<CountPage me={me} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
