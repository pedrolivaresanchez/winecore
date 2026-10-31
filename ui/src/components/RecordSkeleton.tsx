import { Skeleton } from '@/ui'
import { copy } from '@/i18n'

/** The 44px record bar, then the name and two cards — where the ficha will land. */
export function RecordSkeleton({ screen, step }: { screen?: string; step?: string }) {
  return (
    <div data-screen={screen} data-step={step} aria-busy="true" className="flex min-h-0 flex-1 flex-col">
      <p className="sr-only">{copy.loading}</p>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="h-3.5 w-24" />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-5 sm:px-8">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    </div>
  )
}
