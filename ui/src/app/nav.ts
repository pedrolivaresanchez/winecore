import { Archive, Box, Calendar, ChartBar, Check, CreditCard, FileText, Home, Layers, MapPin, Receipt, Settings2, ShareNetwork, Users, type IconComponent } from '@/ui/icons'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'

export type NavChild = {
  id: string
  label: string
  path: string
  permission?: string
  mobile?: 'tab'
}

/** Menu groups from docs/08-ui/01-navegacion.md, in that order. */
export type NavGroup = 'inicio' | 'ventas' | 'facturacion' | 'catalogo' | 'compras' | 'stock' | 'bodega' | 'vinedo' | 'regulatorio' | 'informes'

export type NavEntry = {
  id: string
  module: string
  label: string
  icon: IconComponent
  path?: string
  end?: boolean
  children?: NavChild[]
  permission?: string
  /** tab = barra inferior; more = hoja Más; none = solo escritorio. */
  mobile: 'tab' | 'more' | 'none'
  action?: 'settings'
  placement: 'main' | 'footer'
  /** One rail entry per area. Sub-routes stay on `children`. */
  group?: NavGroup
}

export const navigation: NavEntry[] = [
  {
    id: 'panel',
    module: 'core',
    label: copy.nav.panel,
    icon: Home,
    path: '/',
    end: true,
    mobile: 'tab',
    placement: 'main',
    group: 'inicio',
  },
  {
    id: 'approvals',
    module: 'core',
    label: copy.nav.approvals,
    icon: Check,
    path: '/aprobaciones',
    mobile: 'more',
    placement: 'main',
    group: 'inicio',
  },
  {
    id: 'contacts',
    module: 'contacts',
    label: copy.nav.contacts,
    icon: Users,
    path: '/contactos',
    permission: 'contacts.read',
    mobile: 'tab',
    placement: 'main',
    group: 'ventas',
  },
  {
    id: 'sales',
    module: 'sales',
    label: copy.nav.sales,
    icon: Receipt,
    path: '/ventas',
    permission: 'sales.read',
    mobile: 'more',
    placement: 'main',
    group: 'ventas',
  },
  {
    id: 'invoices',
    module: 'billing',
    label: copy.nav.invoices,
    icon: FileText,
    path: '/facturas',
    permission: 'billing.read',
    mobile: 'tab',
    placement: 'main',
    group: 'facturacion',
  },
  {
    id: 'collections',
    module: 'finance',
    label: copy.nav.collections,
    icon: CreditCard,
    path: '/cobros',
    permission: 'finance.read',
    mobile: 'tab',
    placement: 'main',
    group: 'facturacion',
  },
  {
    id: 'intercompany',
    module: 'billing',
    label: copy.nav.intercompany,
    icon: ShareNetwork,
    path: '/intercompania',
    permission: 'billing.read',
    mobile: 'tab',
    placement: 'main',
    group: 'facturacion',
  },
  {
    id: 'catalog',
    module: 'catalog',
    label: copy.nav.catalog,
    icon: Box,
    path: '/catalogo',
    end: true,
    permission: 'catalog.read',
    mobile: 'more',
    placement: 'main',
    group: 'catalogo',
    children: [
      { id: 'wines', label: copy.catalog.wines, path: '/catalogo/vinos', permission: 'catalog.read' },
      { id: 'formats', label: copy.catalog.formats, path: '/catalogo/formatos', permission: 'catalog.read' },
      { id: 'tariffs', label: copy.catalog.tariffs, path: '/catalogo/tarifas', permission: 'catalog.read' },
    ],
  },
  {
    id: 'expenses',
    module: 'purchasing',
    label: copy.gastos.title,
    icon: FileText,
    path: '/gastos',
    permission: 'purchasing.read',
    mobile: 'tab',
    placement: 'main',
    group: 'compras',
  },
  {
    id: 'stock',
    module: 'inventory',
    label: copy.nav.stock,
    icon: Archive,
    path: '/stock',
    permission: 'inventory.read',
    mobile: 'more',
    placement: 'main',
    group: 'stock',
  },
  {
    id: 'cellar',
    module: 'cellar',
    label: copy.nav.cellar,
    icon: Layers,
    permission: 'cellar.read',
    mobile: 'tab',
    placement: 'main',
    group: 'bodega',
    children: [
      { id: 'vessels', label: copy.nav.vessels, path: '/bodega/depositos', permission: 'cellar.read' },
      { id: 'plan', label: copy.nav.plan, path: '/bodega/plano', permission: 'cellar.read' },
      { id: 'lots', label: copy.nav.lots, path: '/bodega/lotes', permission: 'cellar.read' },
      { id: 'new-operation', label: copy.nav.newOperation, path: '/bodega/operaciones/nueva', permission: 'cellar.operate' },
      { id: 'tastings', label: copy.nav.tastings, path: '/bodega/catas', permission: 'cellar.read' },
      { id: 'recipes', label: copy.nav.recipes, path: '/bodega/recetas', permission: 'cellar.read' },
      { id: 'vintages', label: copy.nav.vintages, path: '/bodega/anadas', permission: 'cellar.read' },
      { id: 'calculators', label: copy.nav.calculators, path: '/bodega/calculadoras', permission: 'cellar.read' },
      { id: 'hygiene', label: copy.nav.hygiene, path: '/bodega/higiene', permission: 'cellar.read' },
      { id: 'holders', label: copy.nav.holders, path: '/bodega/contenedores', permission: 'cellar.read' },
    ],
  },
  {
    id: 'vineyard',
    module: 'vineyard',
    label: copy.nav.vineyard,
    icon: MapPin,
    path: '/vinedo',
    permission: 'vineyard.read',
    mobile: 'tab',
    placement: 'main',
    group: 'vinedo',
  },
  {
    id: 'regulatory',
    module: 'regulatory',
    label: copy.nav.regulatory,
    icon: Calendar,
    path: '/regulatorio',
    permission: 'regulatory.read',
    mobile: 'more',
    placement: 'main',
    group: 'regulatorio',
  },
  {
    id: 'reports',
    module: 'core',
    label: copy.nav.reports,
    icon: ChartBar,
    path: '/informes',
    permission: 'reports.read',
    mobile: 'more',
    placement: 'main',
    group: 'informes',
  },
  {
    id: 'settings',
    module: 'core',
    label: 'Ajustes',
    icon: Settings2,
    action: 'settings',
    mobile: 'more',
    placement: 'footer',
  },
]

export function canSeeChild(me: Me, child: NavChild): boolean {
  return allows(me, child.permission)
}

export function visibleChildren(me: Me, entry: NavEntry): NavChild[] {
  return (entry.children ?? []).filter((child) => canSeeChild(me, child))
}

export function canSeeEntry(me: Me, entry: NavEntry): boolean {
  if (entry.permission && !allows(me, entry.permission)) return false
  if (entry.children && visibleChildren(me, entry).length === 0 && !entry.path && !entry.action) return false
  return true
}

export function mainNav(me: Me): NavEntry[] {
  return navigation.filter((entry) => entry.placement === 'main' && canSeeEntry(me, entry))
}

export function footerNav(me: Me): NavEntry[] {
  return navigation.filter((entry) => entry.placement === 'footer' && canSeeEntry(me, entry))
}
