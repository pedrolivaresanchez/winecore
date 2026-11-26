import { copy } from '@/i18n'
import { GlassMenu, MenuChip, MenuItem, useMenuOpen } from '@/ui'

/** Excel y PDF del listado que está en pantalla, con los filtros activos. */
export function ExportMenu({ busy, onExport }: { busy: boolean; onExport: (format: 'xlsx' | 'pdf') => void }) {
  const menu = useMenuOpen()
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-end"
      panelClassName="min-w-[180px]"
      trigger={
        <MenuChip active={menu.open} onClick={menu.toggle} title={copy.salesDocs.exportMenu}>
          {copy.salesDocs.exportMenu}
        </MenuChip>
      }
    >
      <MenuItem disabled={busy} onClick={() => onExport('xlsx')}>
        {copy.salesDocs.exportExcel}
      </MenuItem>
      <MenuItem disabled={busy} onClick={() => onExport('pdf')}>
        {copy.salesDocs.exportPdf}
      </MenuItem>
    </GlassMenu>
  )
}
