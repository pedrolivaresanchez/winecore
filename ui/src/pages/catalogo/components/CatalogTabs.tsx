import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/catalogo", label: "Productos", end: true },
  { to: "/catalogo/vinos", label: "Vinos y formatos", end: true },
  { to: "/catalogo/tarifas", label: "Tarifas", end: false },
];

export function CatalogTabs() {
  return (
    <nav aria-label="Catálogo" className="flex max-w-full flex-wrap gap-2">
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) =>
            cn(
              "inline-flex h-11 items-center rounded-full px-3 text-compact md:h-8",
              isActive ? "bg-ink font-medium text-ink-foreground" : "bg-muted text-foreground",
            )
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
