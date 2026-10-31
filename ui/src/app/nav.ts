import { LayoutDashboard, Settings, Users, Warehouse, Wine, type LucideIcon } from "lucide-react";
import { copy } from "@/i18n";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";

export type NavChild = {
  id: string;
  label: string;
  path: string;
  permission?: string;
  mobile?: "tab";
  /** Evita que `/stock` quede activo dentro de `/stock/movimientos`. */
  end?: boolean;
};

export type NavEntry = {
  id: string;
  module: string;
  label: string;
  icon: LucideIcon;
  path?: string;
  end?: boolean;
  children?: NavChild[];
  permission?: string;
  /** tab = barra inferior; more = hoja Más; none = solo escritorio. */
  mobile: "tab" | "more" | "none";
  action?: "settings";
  placement: "main" | "footer";
};

export const navigation: NavEntry[] = [
  {
    id: "panel",
    module: "core",
    label: copy.nav.panel,
    icon: LayoutDashboard,
    path: "/",
    end: true,
    mobile: "tab",
    placement: "main",
  },
  {
    id: "cellar",
    module: "cellar",
    label: "Bodega",
    icon: Warehouse,
    path: "/bodega",
    permission: "cellar.read",
    mobile: "tab",
    placement: "main",
    children: [
      { id: "vessels", label: "Depósitos", path: "/bodega", permission: "cellar.read", end: true },
      { id: "new-operation", label: "Nueva operación", path: "/bodega/operacion/nueva", permission: "cellar.operate" },
    ],
  },
  {
    id: "stock",
    module: "inventory",
    label: copy.nav.stock,
    icon: Warehouse,
    path: "/stock",
    permission: "inventory.read",
    mobile: "more",
    placement: "main",
    children: [
      { id: "stock-at", label: "Existencias a fecha", path: "/stock", end: true, permission: "inventory.read" },
      { id: "stock-moves", label: "Movimientos", path: "/stock/movimientos", permission: "inventory.read" },
      { id: "stock-counts", label: "Aforos", path: "/stock/aforos", permission: "inventory.read" },
    ],
  },
  {
    id: "contacts",
    module: "contacts",
    label: copy.nav.contacts,
    icon: Users,
    path: "/contactos",
    permission: "contacts.read",
    mobile: "tab",
    placement: "main",
  },
  {
    id: "catalog",
    module: "catalog",
    label: "Catálogo",
    icon: Wine,
    mobile: "more",
    placement: "main",
    children: [
      {
        id: "products",
        label: "Productos",
        path: "/catalogo",
        permission: "catalog.read",
      },
      {
        id: "wines",
        label: "Vinos y formatos",
        path: "/catalogo/vinos",
        permission: "catalog.read",
      },
      {
        id: "tariffs",
        label: "Tarifas",
        path: "/catalogo/tarifas",
        permission: "catalog.read",
      },
    ],
  },
  {
    id: "settings",
    module: "core",
    label: "Ajustes",
    icon: Settings,
    action: "settings",
    mobile: "more",
    placement: "footer",
  },
];

export function canSeeChild(me: Me, child: NavChild): boolean {
  return allows(me, child.permission);
}

export function visibleChildren(me: Me, entry: NavEntry): NavChild[] {
  return (entry.children ?? []).filter((child) => canSeeChild(me, child));
}

export function canSeeEntry(me: Me, entry: NavEntry): boolean {
  if (entry.permission && !allows(me, entry.permission)) return false;
  if (entry.children && visibleChildren(me, entry).length === 0 && !entry.path && !entry.action) return false;
  return true;
}

export function mainNav(me: Me): NavEntry[] {
  return navigation.filter((entry) => entry.placement === "main" && canSeeEntry(me, entry));
}

export function footerNav(me: Me): NavEntry[] {
  return navigation.filter((entry) => entry.placement === "footer" && canSeeEntry(me, entry));
}

export type MobileTab = { id: string; label: string; path: string; end?: boolean; icon: LucideIcon };

export function mobileTabs(me: Me): MobileTab[] {
  const tabs: MobileTab[] = [];
  for (const entry of navigation) {
    if (!canSeeEntry(me, entry)) continue;
    if (entry.mobile === "tab" && entry.path) {
      tabs.push({ id: entry.id, label: entry.label, path: entry.path, end: entry.end, icon: entry.icon });
    }
    for (const child of visibleChildren(me, entry)) {
      if (child.mobile === "tab") {
        tabs.push({ id: child.id, label: child.label, path: child.path, icon: Users });
      }
    }
  }
  return tabs;
}

export function moreEntries(me: Me): NavEntry[] {
  return navigation.filter((entry) => entry.mobile === "more" && canSeeEntry(me, entry));
}
