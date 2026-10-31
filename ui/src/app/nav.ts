import { Ellipsis, LayoutDashboard, Users, type LucideIcon } from "lucide-react";
import { copy } from "@/i18n";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

export const navItems: NavItem[] = [
  { to: "/", label: copy.nav.panel, icon: LayoutDashboard, end: true },
  { to: "/contactos", label: copy.nav.contacts, icon: Users },
  { to: "/mas", label: copy.nav.more, icon: Ellipsis },
];
