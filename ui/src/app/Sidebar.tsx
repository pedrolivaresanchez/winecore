import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copy } from "@/i18n";
import { cn } from "@/lib/utils";
import { navItems } from "@/app/nav";

export function Sidebar({
  collapsed,
  showToggle,
  onToggle,
}: {
  collapsed: boolean;
  showToggle: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-card md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className={cn("flex h-14 items-center border-b", collapsed ? "justify-center px-2" : "px-3")}>
        <BrandMark word={collapsed ? "never" : "always"} />
      </div>
      <nav aria-label={copy.nav.primary} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex min-h-11 items-center rounded-md text-body",
                  collapsed ? "justify-center" : "gap-3 px-3",
                  isActive ? "bg-ink font-medium text-ink-foreground" : "text-foreground hover:bg-accent",
                )
              }
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
            </NavLink>
          );
          if (!collapsed) return link;
          return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
      {showToggle ? (
        <div className="border-t p-2">
          <button
            type="button"
            className={cn(
              "flex h-11 w-full items-center rounded-md text-compact hover:bg-accent",
              collapsed ? "justify-center" : "gap-3 px-3",
            )}
            aria-expanded={!collapsed}
            aria-label={collapsed ? copy.nav.expand : copy.nav.collapse}
            onClick={onToggle}
          >
            {collapsed ? <PanelLeftOpen aria-hidden className="size-5" /> : <PanelLeftClose aria-hidden className="size-5" />}
            <span className={cn(collapsed && "sr-only")}>{collapsed ? copy.nav.expand : copy.nav.collapse}</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}
