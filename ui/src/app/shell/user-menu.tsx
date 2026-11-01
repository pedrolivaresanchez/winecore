import { ChevronDown, Computer, LogOut, Moon, Settings2, Sun } from '@/ui/icons'
import { GlassMenu, SegmentedControl, useMenuOpen } from '@/ui'
import { EntitySwitcher } from '@/app/EntitySwitcher'
import { useEntity } from '@/app/entity-context'
import { useShell } from '@/app/shell/shell-context'
import { railMetrics } from '@/app/shell/rail-metrics'
import { isAuthEnabled, useSession } from '@/auth/provider'
import { useTheme } from '@/theme/theme-provider'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { entityName, initials, roleLabel } from '@/lib/labels'
import { useToast } from '@/ui'
import type { Me } from '@/lib/types'

export function UserMenu({ me, collapsed }: { me: Me; collapsed: boolean }) {
  const { logout } = useSession()
  const { theme, setTheme } = useTheme()
  const menu = useMenuOpen()
  const toast = useToast()
  const { mobile, openSettings } = useShell()
  const { filter } = useEntity()
  const name = me.display_name.trim() || me.email
  const mark = initials(name, me.email)
  const company = filter === 'all' ? copy.entity.both : entityName(filter)
  const compact = collapsed && !mobile

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
      placement={compact ? 'right-end' : 'top-start'}
      className={compact ? 'w-7' : 'w-full'}
      panelClassName="min-w-[280px]"
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
            compact ? 'size-7 justify-center' : cn('w-full gap-2 px-2 py-1', railMetrics.account),
          )}
        >
          <span
            aria-hidden
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-medium leading-none text-ink-0"
            style={{ backgroundImage: 'var(--btn-primary-face)' }}
          >
            {mark}
          </span>
          {compact ? null : (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-label font-medium text-ink-900">{name}</span>
                <span className="block truncate text-caption text-text-tertiary">{company}</span>
              </span>
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
      <div className="flex items-center gap-2.5 px-2.5 py-1.5">
        <span
          aria-hidden
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-label font-medium leading-none text-ink-0"
          style={{ backgroundImage: 'var(--btn-primary-face)' }}
        >
          {mark}
        </span>
        <div className="min-w-0 flex-1 leading-snug">
          <p className="truncate text-label font-medium text-ink-900">{name}</p>
          <p className="mt-0.5 truncate text-caption text-text-tertiary">{company}</p>
          <p className="mt-0.5 truncate text-caption text-text-tertiary">{me.email}</p>
        </div>
      </div>

      {me.roles.length > 0 ? (
        <ul className="px-2.5 pb-1">
          {me.roles.map((role) => (
            <li key={`${role.role}-${role.legal_entity_code ?? 'all'}`} className="truncate text-caption text-text-tertiary">
              {roleLabel(role.role)} · {role.legal_entity_code ? entityName(role.legal_entity_code) : copy.entity.both}
            </li>
          ))}
        </ul>
      ) : null}

      <div role="separator" className="my-1.5 h-px bg-border" />

      <div
        className="px-2.5 py-1.5"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <p className="mb-1.5 text-caption text-text-tertiary">{copy.user.company}</p>
        <EntitySwitcher />
      </div>

      <div
        className="flex items-center justify-between gap-3 px-2.5 py-1.5"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <span className="shrink-0 text-body text-control">{copy.user.theme}</span>
        <SegmentedControl
          size="sm"
          aria-label={copy.user.theme}
          value={theme}
          onChange={(next) => setTheme(next)}
          options={(
            [
              ['light', Sun, copy.user.themeLight],
              ['dark', Moon, copy.user.themeDark],
              ['system', Computer, copy.user.themeSystem],
            ] as const
          ).map(([value, Icon, label]) => ({
            value,
            'aria-label': label,
            content: <Icon className="size-3.5" strokeWidth={iconStroke} />,
          }))}
        />
      </div>

      <div role="separator" className="my-1.5 h-px bg-border" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          menu.close()
          openSettings()
        }}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-body text-control outline-none hover:bg-fill-hover max-sm:min-h-11"
      >
        <Settings2 className="size-3.5 shrink-0" strokeWidth={iconStroke} />
        {copy.user.settings}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onLogout}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-body text-danger-600 outline-none hover:bg-danger-50 max-sm:min-h-11"
      >
        <LogOut className="size-3.5 shrink-0" strokeWidth={iconStroke} />
        {copy.user.logout}
      </button>
    </GlassMenu>
  )
}
