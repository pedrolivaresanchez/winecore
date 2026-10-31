import { Building } from '@/ui/icons'
import { GlassMenu, MenuItem, SegmentedControl, useMenuOpen } from '@/ui'
import { iconStroke } from '@/lib/motion'
import { copy } from '@/i18n'
import { entityName } from '@/lib/labels'
import { useEntity } from '@/app/entity-context'
import type { EntityChoice } from '@/lib/types'

export function EntitySwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { filter, setFilter, entities } = useEntity()
  const menu = useMenuOpen()
  const options: { value: EntityChoice; label: string }[] = [
    { value: 'all', label: copy.entity.all },
    ...entities.map((entity) => ({ value: entity.code, label: entityName(entity.code) })),
  ]
  if (collapsed) {
    return (
      <GlassMenu
        open={menu.open}
        onOpenChange={menu.setOpen}
        placement="right-start"
        panelClassName="min-w-[160px]"
        trigger={
          <button
            type="button"
            onClick={menu.toggle}
            aria-label={copy.entity.label}
            className="flex size-7 items-center justify-center rounded-md text-control hover:bg-sidebar-hover"
          >
            <Building className="size-3.5" strokeWidth={iconStroke} />
          </button>
        }
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            radio
            checked={option.value === filter}
            onClick={() => {
              setFilter(option.value)
              menu.close()
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </GlassMenu>
    )
  }

  return (
    <div
      onKeyDown={(event) => {
        const index = options.findIndex((option) => option.value === filter)
        const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
        if (!direction) return
        event.preventDefault()
        const next = (index + direction + options.length) % options.length
        const option = options[next]
        if (!option) return
        setFilter(option.value)
        const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')
        radios[next]?.focus()
      }}
    >
      <SegmentedControl
        size="sm"
        fill
        aria-label={copy.entity.label}
        value={filter}
        onChange={setFilter}
        options={options.map((option) => ({ value: option.value, content: option.label }))}
      />
    </div>
  )
}
