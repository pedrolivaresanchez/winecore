import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { isAuthEnabled, useSession } from "@/auth/provider";
import { GlassMenuContent } from "@/components/GlassMenu";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copy, fill } from "@/i18n";
import { entityName, initials, roleLabel } from "@/lib/labels";
import type { Me } from "@/lib/types";

export function UserMenu({ me }: { me: Me }) {
  const { logout } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const themeLabel =
    resolvedTheme === "dark" ? copy.user.themeLight : resolvedTheme === "light" ? copy.user.themeDark : copy.user.theme;
  const name = me.display_name.trim() || me.email;

  function onLogout() {
    if (!isAuthEnabled) {
      toast(copy.user.authOff);
      return;
    }
    logout();
    window.location.assign("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-compact font-medium text-ink-foreground"
          aria-label={fill(copy.user.account, { email: me.email })}
        >
          {initials(name, me.email)}
        </button>
      </DropdownMenuTrigger>
      <GlassMenuContent align="end" collisionPadding={8}>
        <div className="px-2.5 py-2">
          <p className="text-body font-medium break-words">{name}</p>
          <p className="mt-0.5 text-meta break-all text-muted-foreground">{me.email}</p>
          {me.roles.length > 0 ? (
            <ul className="mt-2 grid gap-1">
              {me.roles.map((role) => (
                <li key={`${role.role}-${role.legal_entity_code ?? "all"}`} className="text-meta text-muted-foreground">
                  {roleLabel(role.role)} · {entityName(role.legal_entity_code)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-11 text-compact"
          onSelect={(event) => {
            event.preventDefault();
            setTheme(dark ? "light" : "dark");
          }}
        >
          {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          {themeLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 text-compact" onSelect={onLogout}>
          <LogOut aria-hidden />
          {copy.user.logout}
        </DropdownMenuItem>
      </GlassMenuContent>
    </DropdownMenu>
  );
}
