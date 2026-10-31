import { Route, Routes } from 'react-router-dom'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { Panel } from '@/pages/Panel'
import { ContactCreate } from '@/pages/contactos/ContactCreate'
import { ContactList } from '@/pages/contactos/ContactList'
import { ContactPage } from '@/pages/contactos/ContactPage'
import { FormatPage } from '@/pages/catalogo/FormatPage'
import { FormatsPage } from '@/pages/catalogo/FormatsPage'
import { PriceListPage } from '@/pages/catalogo/PriceListPage'
import { PriceListsPage } from '@/pages/catalogo/PriceListsPage'
import { ProductCreate } from '@/pages/catalogo/ProductCreate'
import { ProductList } from '@/pages/catalogo/ProductList'
import { ProductPage } from '@/pages/catalogo/ProductPage'
import { WinesPage } from '@/pages/catalogo/WinesPage'

/** Authenticated routes. The shell, auth and the entity switcher stay outside. */
export function AppRoutes({ me }: { me: Me }) {
  return (
    <Routes>
      <Route index element={<Panel me={me} />} />
      <Route path="contactos" element={<ContactList me={me} />} />
      <Route path="contactos/nuevo" element={<ContactCreate me={me} />} />
      <Route path="contactos/:id" element={<ContactPage me={me} />} />
      <Route path="catalogo" element={<ProductList me={me} />} />
      <Route path="catalogo/nuevo" element={<ProductCreate me={me} />} />
      <Route path="catalogo/vinos" element={<WinesPage me={me} />} />
      <Route path="catalogo/formatos" element={<FormatsPage me={me} />} />
      <Route path="catalogo/formatos/:id" element={<FormatPage me={me} />} />
      <Route path="catalogo/tarifas" element={<PriceListsPage me={me} />} />
      <Route path="catalogo/tarifas/:id" element={<PriceListPage me={me} />} />
      <Route path="catalogo/:id" element={<ProductPage me={me} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
