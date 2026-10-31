import { NavLink } from "react-router-dom";
import { copy } from "@/i18n";
import { cn } from "@/lib/utils";
import { navItems } from "@/app/nav";

export function BottomNav() {
  return (
    <nav
      aria-label={copy.nav.primary}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background md:hidden"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <div className="grid h-14 grid-cols-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-meta",
                  isActive
                    ? "font-medium text-foreground shadow-[inset_0_2px_0_var(--ink-900)]"
                    : "text-muted-foreground",
                )
              }
            >
              <Icon aria-hidden className="size-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
