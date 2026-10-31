import { Navigate, Route, Routes } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { Panel } from '@/pages/Panel'
import { ContactCreate } from '@/pages/contactos/ContactCreate'
import { ContactList } from '@/pages/contactos/ContactList'
import { ContactPage } from '@/pages/contactos/ContactPage'
import { DeliveryPage } from '@/pages/ventas/DeliveryPage'
import { OrderPage } from '@/pages/ventas/OrderPage'
import { QuotePage } from '@/pages/ventas/QuotePage'
import { VentasList } from '@/pages/ventas/VentasList'

/** Authenticated routes. The shell, auth and the entity switcher stay outside. */
export function AppRoutes({ me }: { me: Me }) {
  return (
    <Routes>
      <Route index element={<Panel me={me} />} />
      <Route path="contactos" element={<ContactList me={me} />} />
      <Route path="contactos/nuevo" element={<ContactCreate me={me} />} />
      <Route path="contactos/:id" element={<ContactPage me={me} />} />
      <Route path="ventas" element={<Navigate to="/ventas/presupuestos" replace />} />
      <Route path="ventas/presupuestos" element={<VentasList me={me} doc="quote" />} />
      <Route path="ventas/presupuestos/nuevo" element={<VentasList me={me} doc="quote" creating />} />
      <Route path="ventas/presupuestos/:id" element={<QuotePage me={me} />} />
      <Route path="ventas/pedidos" element={<VentasList me={me} doc="order" />} />
      <Route path="ventas/pedidos/nuevo" element={<VentasList me={me} doc="order" creating />} />
      <Route path="ventas/pedidos/:id" element={<OrderPage me={me} />} />
      <Route path="ventas/albaranes" element={<VentasList me={me} doc="delivery" />} />
      <Route path="ventas/albaranes/nuevo" element={<VentasList me={me} doc="delivery" creating />} />
      <Route path="ventas/albaranes/:id" element={<DeliveryPage me={me} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
