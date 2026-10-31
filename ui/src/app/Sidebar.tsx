import { useState } from "react";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copy } from "@/i18n";
import { readStorage, writeStorage } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { footerNav, mainNav, visibleChildren, type NavChild, type NavEntry } from "@/app/nav";
import { PendingBadge } from "@/pages/aprobaciones/PendingBadge";
import type { Me } from "@/lib/types";

const GROUPS_KEY = "winecore.nav.groups";

function childIsCurrent(pathname: string, child: NavChild, siblings: NavChild[]): boolean {
  const matches = pathname === child.path || pathname.startsWith(`${child.path}/`);
  if (!matches) return false;
  return !siblings.some(
    (other) =>
      other.path !== child.path &&
      other.path.length > child.path.length &&
      (pathname === other.path || pathname.startsWith(`${other.path}/`)),
  );
}

function readGroups(): Record<string, boolean> {
  try {
    const raw = readStorage(GROUPS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    return { cellar: true, stock: true, ...parsed };
  } catch {
    return { cellar: true };
  }
}

export function Sidebar({
  me,
  collapsed,
  showToggle,
  onToggle,
  onOpenSettings,
}: {
  me: Me;
  collapsed: boolean;
  showToggle: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}) {
  const location = useLocation();
  const [groups, setGroups] = useState(readGroups);
  const items = mainNav(me);
  const footer = footerNav(me);

  function toggleGroup(id: string) {
    setGroups((current) => {
      const next = { ...current, [id]: !current[id] };
      writeStorage(GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function renderEntry(entry: NavEntry) {
    const Icon = entry.icon;
    const children = visibleChildren(me, entry);
    const childActive = children.some(
      (child) => location.pathname === child.path || (!child.end && location.pathname.startsWith(`${child.path}/`)),
    );
    const open = groups[entry.id] ?? childActive;

    if (entry.action === "settings") {
      const button = (
        <button
          type="button"
          className={cn(
            "flex min-h-11 w-full items-center rounded-md text-body hover:bg-accent",
            collapsed ? "justify-center" : "gap-3 px-3",
          )}
          onClick={onOpenSettings}
        >
          <Icon aria-hidden className="size-5 shrink-0" />
          <span className={cn("truncate", collapsed && "sr-only")}>{entry.label}</span>
        </button>
      );
      if (!collapsed) return <div key={entry.id}>{button}</div>;
      return (
        <Tooltip key={entry.id}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">{entry.label}</TooltipContent>
        </Tooltip>
      );
    }

    if (children.length > 0) {
      const target = children[0]?.path ?? entry.path ?? "/";
      if (collapsed) {
        return (
          <Tooltip key={entry.id}>
            <TooltipTrigger asChild>
              <NavLink
                to={target}
                className={cn(
                  "flex min-h-11 items-center justify-center rounded-md",
                  childActive ? "bg-ink text-ink-foreground" : "hover:bg-accent",
                )}
              >
                <Icon aria-hidden className="size-5" />
                <span className="sr-only">{entry.label}</span>
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">{entry.label}</TooltipContent>
          </Tooltip>
        );
      }
      return (
        <div key={entry.id} className="grid gap-1">
          <button
            type="button"
            className="flex min-h-11 items-center gap-3 rounded-md px-3 text-body hover:bg-accent"
            aria-expanded={open}
            onClick={() => toggleGroup(entry.id)}
          >
            <Icon aria-hidden className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
            <ChevronDown aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
          {open ? (
            <div className="grid gap-1 pl-4">
              {children.map((child) => (
                <NavLink
                  key={child.id}
                  to={child.path}
                  end={child.end}
                  className={() =>
                    cn(
                      "flex min-h-11 items-center rounded-md px-3 text-compact",
                      childIsCurrent(location.pathname, child, children)
                        ? "bg-ink font-medium text-ink-foreground"
                        : "hover:bg-accent",
                    )
                  }
                >
                  {child.label}
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    if (!entry.path) return null;
    const link = (
      <NavLink
        to={entry.path}
        end={entry.end}
        className={({ isActive }) =>
          cn(
            "relative flex min-h-11 items-center rounded-md text-body",
            collapsed ? "justify-center" : "gap-3 px-3",
            isActive ? "bg-ink font-medium text-ink-foreground" : "hover:bg-accent",
          )
        }
      >
        <Icon aria-hidden className="size-5 shrink-0" />
        <span className={cn("truncate", collapsed ? "sr-only" : "min-w-0 flex-1")}>{entry.label}</span>
        {entry.id === "approvals" ? <PendingBadge variant={collapsed ? "corner" : "inline"} /> : null}
      </NavLink>
    );
    if (!collapsed) return <div key={entry.id}>{link}</div>;
    return (
      <Tooltip key={entry.id}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{entry.label}</TooltipContent>
      </Tooltip>
    );
  }

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
        {items.map(renderEntry)}
      </nav>
      <div className="shrink-0 border-t p-2">
        <div className="grid gap-1">{footer.map(renderEntry)}</div>
        {showToggle ? (
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
        ) : null}
      </div>
    </aside>
  );
}
