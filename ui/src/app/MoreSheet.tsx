import { NavLink } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { copy } from "@/i18n";
import { footerNav, moreEntries, visibleChildren } from "@/app/nav";
import type { Me } from "@/lib/types";

export function MoreSheet({
  me,
  open,
  onOpenChange,
  onOpenSettings,
}: {
  me: Me;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
}) {
  const entries = [...moreEntries(me), ...footerNav(me).filter((entry) => !moreEntries(me).some((item) => item.id === entry.id))];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" data-screen="mas">
        <SheetHeader>
          <SheetTitle>{copy.more.title}</SheetTitle>
          <SheetDescription>{copy.more.description}</SheetDescription>
        </SheetHeader>
        <ul className="grid gap-1 px-2 pb-4">
          {entries.length === 0 ? <li className="px-2 py-3 text-compact text-muted-foreground">{copy.more.empty}</li> : null}
          {entries.map((entry) => {
            const Icon = entry.icon;
            const children = visibleChildren(me, entry);
            if (children.length > 0) {
              return (
                <li key={entry.id}>
                  <p className="flex items-center gap-3 px-3 pt-2 text-meta text-muted-foreground">
                    <Icon aria-hidden className="size-4" />
                    {entry.label}
                  </p>
                  <ul>
                    {children.map((child) => (
                      <li key={child.id}>
                        <NavLink
                          to={child.path}
                          end={child.end}
                          className="flex min-h-11 items-center rounded-md px-3 text-body hover:bg-accent"
                          onClick={() => onOpenChange(false)}
                        >
                          {child.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            }
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-body hover:bg-accent"
                  onClick={() => {
                    onOpenChange(false);
                    if (entry.action === "settings") onOpenSettings();
                  }}
                >
                  <Icon aria-hidden className="size-5" />
                  {entry.label}
                </button>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
