import { Route, Routes } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { Panel } from '@/pages/Panel'
import { ContactCreate } from '@/pages/contactos/ContactCreate'
import { ContactList } from '@/pages/contactos/ContactList'
import { ContactPage } from '@/pages/contactos/ContactPage'
import { DepositoPage } from '@/pages/bodega/Deposito'
import { LotePage } from '@/pages/bodega/Lote'
import { LotesPage } from '@/pages/bodega/Lotes'
import { MapaPage } from '@/pages/bodega/Mapa'
import { OperacionPage } from '@/pages/bodega/Operacion'
import { QrOpen } from '@/pages/bodega/QrOpen'

/** Authenticated routes. The shell, auth and the entity switcher stay outside. */
export function AppRoutes({ me }: { me: Me }) {
  return (
    <Routes>
      <Route index element={<Panel me={me} />} />
      <Route path="contactos" element={<ContactList me={me} />} />
      <Route path="contactos/nuevo" element={<ContactCreate me={me} />} />
      <Route path="contactos/:id" element={<ContactPage me={me} />} />
      <Route path="bodega" element={<MapaPage me={me} />} />
      <Route path="bodega/depositos" element={<MapaPage me={me} />} />
      <Route path="bodega/depositos/:vesselId" element={<DepositoPage me={me} />} />
      <Route path="bodega/lotes" element={<LotesPage me={me} />} />
      <Route path="bodega/lotes/:lotId" element={<LotePage me={me} />} />
      <Route path="lotes/:lotId" element={<LotePage me={me} />} />
      <Route path="bodega/operaciones/nueva" element={<OperacionPage me={me} />} />
      <Route path="bodega/operacion/nueva" element={<OperacionPage me={me} />} />
      <Route path="bodega/operaciones/:id" element={<OperacionPage me={me} />} />
      <Route path="bodega/:vesselId" element={<DepositoPage me={me} />} />
      <Route path="q/:token" element={<QrOpen me={me} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
