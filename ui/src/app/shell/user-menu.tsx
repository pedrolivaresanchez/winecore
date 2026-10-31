import { ChevronDown, Computer, LogOut, Moon, Sun } from '@/ui/icons'
import { GlassMenu, SegmentedControl, useMenuOpen } from '@/ui'
import { isAuthEnabled, useSession } from '@/auth/provider'
import { useTheme } from '@/theme/theme-provider'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { entityName, initials, roleLabel } from '@/lib/labels'
import { useToast } from '@/ui'
import { useShell } from '@/app/shell/shell-context'
import type { Me } from '@/lib/types'

export function UserMenu({ me, collapsed }: { me: Me; collapsed: boolean }) {
  const { logout } = useSession()
  const { theme, setTheme } = useTheme()
  const menu = useMenuOpen()
  const toast = useToast()
  const { mobile } = useShell()
  const name = me.display_name.trim() || me.email
  const mark = initials(name, me.email)

  function onLogout() {
    menu.close()
    if (!isAuthEnabled) {
      toast(copy.user.authOff)
      return
    }
    logout()
    window.location.assign('/login')
  }

  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement={collapsed && !mobile ? 'right-end' : 'top-start'}
      className={collapsed && !mobile ? 'w-7' : 'w-full'}
      panelClassName="min-w-[240px]"
      trigger={
        <button
          type="button"
          onClick={menu.toggle}
          aria-expanded={menu.open}
          aria-label={fill(copy.user.account, { email: me.email })}
          className={cn(
            'flex items-center rounded-md text-left outline-none',
            'transition-[color,background-color] duration-(--duration-quick) ease-(--ease-smooth-out) hover:bg-sidebar-hover',
            'focus-visible:shadow-(--shadow-focus)',
            menu.open && 'bg-sidebar-hover',
            collapsed && !mobile ? 'size-7 justify-center' : 'h-7 w-full gap-2 px-2',
          )}
        >
          <span
            aria-hidden
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-medium leading-none text-ink-0"
            style={{ backgroundImage: 'var(--btn-primary-face)' }}
          >
            {mark}
          </span>
          {collapsed && !mobile ? null : (
            <>
              <span className="min-w-0 flex-1 truncate text-label font-medium text-ink-900">{name}</span>
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 text-control transition-transform duration-(--duration-fast) ease-(--ease-smooth-out)',
                  menu.open && 'rotate-180',
                )}
                strokeWidth={iconStroke}
              />
            </>
          )}
        </button>
      }
    >
      <div className="px-2.5 py-2">
        <p className="truncate text-body font-medium text-ink-900">{name}</p>
        <p className="mt-0.5 truncate text-caption text-text-tertiary">{me.email}</p>
        {me.roles.length > 0 ? (
          <ul className="mt-2 grid gap-0.5">
            {me.roles.map((role) => (
              <li key={`${role.role}-${role.legal_entity_code ?? 'all'}`} className="truncate text-caption text-text-tertiary">
                {roleLabel(role.role)} · {entityName(role.legal_entity_code)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="px-2.5 pb-2">
        <SegmentedControl
          size="sm"
          fill
          aria-label={copy.user.theme}
          value={theme}
          onChange={(next) => setTheme(next)}
          options={(
            [
              ['light', Sun, copy.user.themeLight],
              ['dark', Moon, copy.user.themeDark],
              ['system', Computer, 'Sistema'],
            ] as const
          ).map(([value, Icon, label]) => ({
            value,
            'aria-label': label,
            content: <Icon className="size-3.5" strokeWidth={iconStroke} />,
          }))}
        />
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={onLogout}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-body text-control outline-none hover:bg-fill-hover"
      >
        <LogOut className="size-3.5 shrink-0" strokeWidth={iconStroke} />
        {copy.user.logout}
      </button>
    </GlassMenu>
  )
}
