import {
  Archive,
  Box,
  Briefcase,
  Calendar,
  ChartBar,
  Check,
  CreditCard,
  FileText,
  FlaskConical,
  Home,
  Layers,
  List,
  MapPin,
  Plus,
  Receipt,
  ShareNetwork,
  Tag,
  Users,
  type IconComponent,
} from '@/ui/icons'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import type { TagTone } from '@/ui/tag-palette'

export type RailGroupId = 'inicio' | 'comercial' | 'bodega' | 'gestion'
export type RailTier = 'primary' | 'more'

export type RailItem = {
  id: string
  label: string
  icon: IconComponent
  path: string
  /** Extra paths that light the row without being the click target. */
  exact?: string[]
  permission?: string
  tier: RailTier
}

export type RailGroup = {
  id: RailGroupId
  label: string
  /** The section's hue: its dot, its icons and its lit row. Charts reuse it for the same subject. */
  tone: TagTone
  items: RailItem[]
}

/**
 * Short rail. Secondary pages stay on `tier: 'more'` and open from the section,
 * not as another row beside Panel.
 */
export const railGroups: RailGroup[] = [
  {
    id: 'inicio',
    label: copy.nav.groups.inicio,
    tone: 'blue',
    items: [
      { id: 'panel', label: copy.nav.panel, icon: Home, path: '/', exact: ['/'], tier: 'primary' },
      { id: 'approvals', label: copy.nav.approvals, icon: Check, path: '/aprobaciones', tier: 'more' },
    ],
  },
  {
    id: 'comercial',
    label: copy.nav.groups.comercial,
    tone: 'emerald',
    items: [
      { id: 'contacts', label: copy.nav.contacts, icon: Users, path: '/contactos', permission: 'contacts.read', tier: 'primary' },
      { id: 'sales', label: copy.nav.sales, icon: Receipt, path: '/ventas', permission: 'sales.read', tier: 'primary' },
      { id: 'invoices', label: copy.nav.invoices, icon: FileText, path: '/facturas', permission: 'billing.read', tier: 'primary' },
      { id: 'collections', label: copy.nav.collections, icon: CreditCard, path: '/cobros', permission: 'finance.read', tier: 'primary' },
      { id: 'intercompany', label: copy.nav.intercompany, icon: ShareNetwork, path: '/intercompania', permission: 'billing.read', tier: 'more' },
    ],
  },
  {
    id: 'bodega',
    label: copy.nav.groups.bodega,
    tone: 'rose',
    items: [
      { id: 'deposits', label: copy.nav.vessels, icon: Layers, path: '/bodega/plano', permission: 'cellar.read', tier: 'primary' },
      { id: 'vineyard', label: copy.nav.vineyard, icon: MapPin, path: '/vinedo', permission: 'vineyard.read', tier: 'primary' },
      { id: 'map', label: copy.nav.map, icon: List, path: '/bodega/depositos', exact: ['/bodega'], permission: 'cellar.read', tier: 'more' },
      { id: 'lots', label: copy.nav.lots, icon: Archive, path: '/bodega/lotes', permission: 'cellar.read', tier: 'more' },
      { id: 'operation', label: copy.nav.newOperation, icon: Plus, path: '/bodega/operaciones/nueva', permission: 'cellar.operate', tier: 'more' },
      { id: 'readings', label: copy.nav.readings, icon: ChartBar, path: '/bodega/lecturas', permission: 'cellar.read', tier: 'more' },
      { id: 'phases', label: copy.nav.phases, icon: Calendar, path: '/bodega/fases', permission: 'cellar.read', tier: 'more' },
      { id: 'analyses', label: copy.nav.analyses, icon: FlaskConical, path: '/bodega/analiticas', permission: 'cellar.read', tier: 'more' },
      { id: 'tastings', label: copy.nav.tastings, icon: Tag, path: '/bodega/catas', permission: 'cellar.read', tier: 'more' },
      { id: 'recipes', label: copy.nav.recipes, icon: FileText, path: '/bodega/recetas', permission: 'cellar.read', tier: 'more' },
      { id: 'vintages', label: copy.nav.vintages, icon: Calendar, path: '/bodega/anadas', permission: 'cellar.read', tier: 'more' },
      { id: 'calculators', label: copy.nav.calculators, icon: ChartBar, path: '/bodega/calculadoras', permission: 'cellar.read', tier: 'more' },
      { id: 'hygiene', label: copy.nav.hygiene, icon: List, path: '/bodega/higiene', permission: 'cellar.read', tier: 'more' },
      { id: 'holders', label: copy.nav.holders, icon: Box, path: '/bodega/contenedores', permission: 'cellar.read', tier: 'more' },
    ],
  },
  {
    id: 'gestion',
    label: copy.nav.groups.gestion,
    tone: 'amber',
    items: [
      { id: 'catalog', label: copy.nav.catalog, icon: Box, path: '/catalogo', permission: 'catalog.read', tier: 'primary' },
      { id: 'expenses', label: copy.gastos.title, icon: Briefcase, path: '/gastos', permission: 'purchasing.read', tier: 'primary' },
      { id: 'stock', label: copy.nav.stock, icon: Archive, path: '/stock', permission: 'inventory.read', tier: 'primary' },
      { id: 'reports', label: copy.nav.reports, icon: ChartBar, path: '/informes', permission: 'reports.read', tier: 'primary' },
      { id: 'wines', label: copy.catalog.wines, icon: Tag, path: '/catalogo/vinos', permission: 'catalog.read', tier: 'more' },
      { id: 'formats', label: copy.catalog.formats, icon: Box, path: '/catalogo/formatos', permission: 'catalog.read', tier: 'more' },
      { id: 'tariffs', label: copy.catalog.tariffs, icon: Receipt, path: '/catalogo/tarifas', permission: 'catalog.read', tier: 'more' },
      { id: 'regulatory', label: copy.nav.regulatory, icon: Calendar, path: '/regulatorio', permission: 'regulatory.read', tier: 'more' },
    ],
  },
]

export function canSeeItem(me: Me, item: RailItem): boolean {
  return allows(me, item.permission)
}

export function visibleGroups(me: Me): RailGroup[] {
  return railGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canSeeItem(me, item)) }))
    .filter((group) => group.items.some((item) => item.tier === 'primary') || group.items.length > 0)
}

export function itemMatches(pathname: string, item: RailItem): boolean {
  if (item.exact?.includes(pathname)) return true
  if (item.exact?.includes(item.path) && item.exact.length === 1 && item.path === '/') return pathname === '/'
  if (item.path === '/') return pathname === '/'
  return pathname === item.path || pathname.startsWith(`${item.path}/`)
}

/** The longest matching path wins, so Catálogo does not stay lit on Vinos. */
export function activeRailId(pathname: string, groups: RailGroup[]): string | null {
  const hits = groups.flatMap((group) => group.items).filter((item) => itemMatches(pathname, item))
  hits.sort((left, right) => right.path.length - left.path.length)
  return hits[0]?.id ?? null
}
