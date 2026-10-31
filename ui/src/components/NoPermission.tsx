import { EmptyState } from '@/ui'

export function NoPermission() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState title="Sin permiso" description="No puedes ver esta pantalla." />
    </div>
  )
}
