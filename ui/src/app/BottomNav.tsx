import { Ellipsis } from "lucide-react";
import { NavLink } from "react-router-dom";
import { copy } from "@/i18n";
import { cn } from "@/lib/utils";
import { mobileTabs } from "@/app/nav";
import type { Me } from "@/lib/types";

export function BottomNav({ me, onOpenMore }: { me: Me; onOpenMore: () => void }) {
  const tabs = mobileTabs(me);
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
      <div className="grid h-14" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-meta",
                  isActive ? "font-medium text-foreground shadow-[inset_0_2px_0_var(--ink-900)]" : "text-muted-foreground",
                )
              }
            >
              <Icon aria-hidden className="size-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          className="flex h-14 flex-col items-center justify-center gap-0.5 text-meta text-muted-foreground"
          onClick={onOpenMore}
        >
          <Ellipsis aria-hidden className="size-5" />
          <span>{copy.nav.more}</span>
        </button>
      </div>
    </nav>
  );
}
