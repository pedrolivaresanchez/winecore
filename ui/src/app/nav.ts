import { Box, ChartBar, Check, Home, Layers, Receipt, Settings2, Users, type IconComponent } from '@/ui/icons'
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
}

export const navigation: NavEntry[] = [
  { id: 'panel', module: 'core', label: copy.nav.panel, icon: Home, path: '/', end: true, mobile: 'tab', placement: 'main' },
  { id: 'approvals', module: 'core', label: copy.nav.approvals, icon: Check, path: '/aprobaciones', mobile: 'more', placement: 'main' },
  { id: 'sales', module: 'sales', label: copy.nav.sales, icon: Receipt, path: '/ventas', permission: 'sales.read', mobile: 'more', placement: 'main' },
  { id: 'expenses', module: 'purchasing', label: copy.gastos.title, icon: Receipt, path: '/gastos', permission: 'purchasing.read', mobile: 'tab', placement: 'main' },
  {
    id: 'cellar',
    module: 'cellar',
    label: copy.nav.cellar,
    icon: Layers,
    permission: 'cellar.read',
    mobile: 'tab',
    placement: 'main',
    children: [
      { id: 'vessels', label: copy.nav.vessels, path: '/bodega/depositos', permission: 'cellar.read' },
      { id: 'lots', label: copy.nav.lots, path: '/bodega/lotes', permission: 'cellar.read' },
      { id: 'calculators', label: copy.nav.calculators, path: '/bodega/calculadoras', permission: 'cellar.read' },
      { id: 'new-operation', label: copy.nav.newOperation, path: '/bodega/operaciones/nueva', permission: 'cellar.operate' },
    ],
  },
  { id: 'stock', module: 'inventory', label: copy.nav.stock, icon: Box, path: '/stock', permission: 'inventory.read', mobile: 'more', placement: 'main' },
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
    children: [
      { id: 'wines', label: copy.catalog.wines, path: '/catalogo/vinos', permission: 'catalog.read' },
      { id: 'formats', label: copy.catalog.formats, path: '/catalogo/formatos', permission: 'catalog.read' },
      { id: 'tariffs', label: copy.catalog.tariffs, path: '/catalogo/tarifas', permission: 'catalog.read' },
    ],
  },
  { id: 'contacts', module: 'contacts', label: copy.nav.contacts, icon: Users, path: '/contactos', permission: 'contacts.read', mobile: 'tab', placement: 'main' },
  { id: 'reports', module: 'core', label: copy.nav.reports, icon: ChartBar, path: '/informes', permission: 'reports.read', mobile: 'more', placement: 'main' },
  { id: 'settings', module: 'core', label: 'Ajustes', icon: Settings2, action: 'settings', mobile: 'more', placement: 'footer' },
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
