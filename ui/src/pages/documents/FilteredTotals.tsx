import { copy } from '@/i18n'

/** Pie del listado en el teléfono. En escritorio lo pinta el pie de la tabla. */
export function FilteredTotals({ base, total, pending }: { base: string; total: string; pending?: string | null }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-border-subtle bg-surface-subtle px-3 py-2 text-label md:hidden">
      <Figure label={copy.salesDocs.base} value={base} />
      <Figure label={copy.salesDocs.total} value={total} />
      {pending != null ? <Figure label={copy.salesDocs.pending} value={pending} /> : null}
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-text-tertiary">{label}</span>
      <span className="tabular-nums font-medium text-ink-900">{value}</span>
    </span>
  )
}
