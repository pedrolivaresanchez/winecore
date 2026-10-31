import { copy } from '@/i18n'
import { GlassMenu, MenuChip, MenuItem, useMenuOpen } from '@/ui'

export function ColumnMenu({
  ids,
  labels,
  hidden,
  locked,
  onToggle,
}: {
  ids: readonly string[]
  labels: Record<string, string>
  hidden: Set<string>
  locked?: string
  onToggle: (id: string) => void
}) {
  const menu = useMenuOpen()
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-start"
      panelClassName="min-w-[200px]"
      trigger={
        <MenuChip active={menu.open} onClick={menu.toggle} title={copy.stock.columns}>
          {copy.stock.columns}
        </MenuChip>
      }
    >
      {ids.map((id) => (
        <MenuItem key={id} checked={!hidden.has(id)} disabled={id === locked} onClick={() => onToggle(id)}>
          {labels[id]}
        </MenuItem>
      ))}
    </GlassMenu>
  )
}
