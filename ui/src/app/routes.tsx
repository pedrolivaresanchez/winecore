import { Navigate, Route, Routes } from 'react-router-dom'
import { copy } from '@/i18n'
import type { Me } from '@/lib/types'
import { NotFound } from '@/pages/NotFound'
import { AsistentePage } from '@/pages/asistente/AsistentePage'
import { InformesPage } from '@/pages/informes/InformesPage'
import { Panel } from '@/pages/Panel'
import { ApprovalPage } from '@/pages/aprobaciones/Detail'
import { ApprovalInbox } from '@/pages/aprobaciones/Inbox'
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
import { DepositoPage } from '@/pages/bodega/Deposito'
import { HolderPage } from '@/pages/bodega-plano/HolderPage'
import { HoldersPage } from '@/pages/bodega-plano/Holders'
import { PlanoPage } from '@/pages/bodega-plano/Plano'
import { CalculadorasPage } from '@/pages/enologia/Calculadoras'
import { AnadasPage } from '@/pages/lote-diseno/AnadasPage'
import { RecetaPage } from '@/pages/lote-diseno/RecetaPage'
import { RecetasPage } from '@/pages/lote-diseno/RecetasPage'
import { LotePage } from '@/pages/bodega/Lote'
import { LotesPage } from '@/pages/bodega/Lotes'
import { MapaPage } from '@/pages/bodega/Mapa'
import { OperacionPage } from '@/pages/bodega/Operacion'
import { QrOpen } from '@/pages/bodega/QrOpen'
import { CatasPage } from '@/pages/catas/CatasPage'
import { AnaliticasPage } from '@/pages/elaboracion/Analiticas'
import { FasesPage } from '@/pages/elaboracion/Fases'
import { LecturasPage } from '@/pages/elaboracion/Lecturas'
import { CountCreate } from '@/pages/existencias/CountCreate'
import { CountPage } from '@/pages/existencias/CountPage'
import { CountsPage } from '@/pages/existencias/CountsPage'
import { InspectionPage } from '@/pages/existencias/InspectionPage'
import { MovesPage } from '@/pages/existencias/MovesPage'
import { StockPage } from '@/pages/existencias/StockPage'
import { DeliveryPage } from '@/pages/ventas/DeliveryPage'
import { OrderPage } from '@/pages/ventas/OrderPage'
import { QuotePage } from '@/pages/ventas/QuotePage'
import { SalesHome } from '@/pages/ventas/SalesHome'
import { VentasList } from '@/pages/ventas/VentasList'
import { Gastos } from '@/pages/gastos/Gastos'
import { CreateInvoice } from '@/pages/facturas/CreateInvoice'
import { FacturasPage } from '@/pages/facturas/FacturasPage'
import { InvoicePage } from '@/pages/facturas/InvoicePage'
import { RectifyPage } from '@/pages/facturas/RectifyPage'
import { CobrosPage } from '@/pages/cobros/CobrosPage'
import { RemesaPage } from '@/pages/cobros/RemesaPage'
import { SettlementList } from '@/pages/intercompania/SettlementList'
import { SettlementPage } from '@/pages/intercompania/SettlementPage'
import { TariffList } from '@/pages/intercompania/TariffList'
import { TariffPage } from '@/pages/intercompania/TariffPage'
import { Higiene } from '@/pages/higiene/Higiene'
import { ParcelaPage } from '@/pages/vinedo/Parcela'
import { Vinedo } from '@/pages/vinedo/Vinedo'
import { Regulatorio } from '@/pages/regulatorio/Regulatorio'

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
      <Route path="asistente" element={<AsistentePage me={me} />} />
      <Route path="catalogo" element={<ProductList me={me} />} />
      <Route path="catalogo/nuevo" element={<ProductCreate me={me} />} />
      <Route path="catalogo/vinos" element={<WinesPage me={me} />} />
      <Route path="catalogo/formatos" element={<FormatsPage me={me} />} />
      <Route path="catalogo/formatos/:id" element={<FormatPage me={me} />} />
      <Route path="catalogo/tarifas" element={<PriceListsPage me={me} />} />
      <Route path="catalogo/tarifas/:id" element={<PriceListPage me={me} />} />
      <Route path="catalogo/:id" element={<ProductPage me={me} />} />
      <Route path="bodega" element={<MapaPage me={me} />} />
      <Route path="bodega/calculadoras" element={<CalculadorasPage me={me} />} />
      <Route path="bodega/depositos" element={<MapaPage me={me} />} />
      <Route path="bodega/depositos/:vesselId" element={<DepositoPage me={me} />} />
      <Route path="bodega/plano" element={<PlanoPage me={me} />} />
      <Route path="bodega/contenedores" element={<HoldersPage me={me} />} />
      <Route path="bodega/contenedores/:code" element={<HolderPage me={me} />} />
      <Route path="bodega/lotes" element={<LotesPage me={me} />} />
      <Route path="bodega/lotes/:lotId" element={<LotePage me={me} />} />
      <Route path="bodega/recetas" element={<RecetasPage me={me} />} />
      <Route path="bodega/recetas/:id" element={<RecetaPage me={me} />} />
      <Route path="bodega/anadas" element={<AnadasPage me={me} />} />
      <Route path="lotes/:lotId" element={<LotePage me={me} />} />
      <Route path="bodega/lecturas" element={<LecturasPage me={me} />} />
      <Route path="bodega/fases" element={<FasesPage me={me} />} />
      <Route path="bodega/analiticas" element={<AnaliticasPage me={me} />} />
      <Route path="bodega/operaciones/nueva" element={<OperacionPage me={me} />} />
      <Route path="bodega/operacion/nueva" element={<OperacionPage me={me} />} />
      <Route path="bodega/operaciones/:id" element={<OperacionPage me={me} />} />
      <Route path="bodega/catas/*" element={<CatasPage me={me} />} />
      <Route path="bodega/higiene/*" element={<Higiene me={me} />} />
      <Route path="bodega/:vesselId" element={<DepositoPage me={me} />} />
      <Route path="q/:token" element={<QrOpen me={me} />} />
      <Route path="stock" element={<StockPage me={me} />} />
      <Route path="stock/movimientos" element={<MovesPage me={me} />} />
      <Route path="stock/informe" element={<InspectionPage me={me} />} />
      <Route path="stock/aforos" element={<CountsPage me={me} />} />
      <Route path="stock/aforos/nuevo" element={<CountCreate me={me} />} />
      <Route path="stock/aforos/:id" element={<CountPage me={me} />} />
      <Route path="ventas" element={<Navigate to="/ventas/presupuestos" replace />} />
      <Route path="ventas/presupuestos" element={<SalesHome me={me} doc="quote" />} />
      <Route path="ventas/presupuestos/nuevo" element={<VentasList me={me} doc="quote" creating />} />
      <Route path="ventas/presupuestos/:id" element={<QuotePage me={me} />} />
      <Route path="ventas/pedidos" element={<VentasList me={me} doc="order" />} />
      <Route path="ventas/pedidos/nuevo" element={<VentasList me={me} doc="order" creating />} />
      <Route path="ventas/pedidos/:id" element={<OrderPage me={me} />} />
      <Route path="ventas/albaranes" element={<SalesHome me={me} doc="delivery" />} />
      <Route path="ventas/albaranes/nuevo" element={<VentasList me={me} doc="delivery" creating />} />
      <Route path="ventas/albaranes/:id" element={<DeliveryPage me={me} />} />
      <Route path="gastos/*" element={<Gastos me={me} />} />
      <Route path="facturas" element={<FacturasPage me={me} />} />
      <Route path="facturas/nueva" element={<CreateInvoice me={me} />} />
      <Route path="facturas/:id/rectificar" element={<RectifyPage me={me} />} />
      <Route path="facturas/:id" element={<InvoicePage me={me} />} />
      <Route path="cobros" element={<CobrosPage me={me} />} />
      <Route path="cobros/remesas/:id" element={<RemesaPage me={me} />} />
      <Route path="intercompania" element={<SettlementList me={me} />} />
      <Route path="intercompania/tarifas" element={<TariffList me={me} />} />
      <Route path="intercompania/tarifas/:id" element={<TariffPage me={me} />} />
      <Route path="intercompania/:period" element={<SettlementPage me={me} />} />
      <Route path="vinedo" element={<Vinedo me={me} />} />
      <Route path="vinedo/:code" element={<ParcelaPage me={me} />} />
      <Route path="regulatorio/*" element={<Regulatorio me={me} />} />
      <Route path="ajustes/puesta-en-marcha" element={<div className="sr-only">{copy.settings.setup}</div>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
