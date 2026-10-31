import { Home, Receipt, Settings2, Users, type IconComponent } from '@/ui/icons'
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
  {
    id: 'panel',
    module: 'core',
    label: copy.nav.panel,
    icon: Home,
    path: '/',
    end: true,
    mobile: 'tab',
    placement: 'main',
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
  },
  {
    id: 'collections',
    module: 'finance',
    label: copy.nav.collections,
    icon: Receipt,
    path: '/cobros',
    permission: 'finance.read',
    mobile: 'tab',
    placement: 'main',
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
