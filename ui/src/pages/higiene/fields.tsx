import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { Input } from '@/ui'

export function EffluentField({ id = 'efluente' }: { id?: string }) {
  return (
    <Field id={id} label={copy.higiene.effluent}>
      <Input id={id} readOnly value={copy.higiene.effluentPending} />
    </Field>
  )
}

export function FactList({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="overflow-hidden rounded-2xl border border-border-subtle">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
          <dt className="text-caption text-text-tertiary">{row.label}</dt>
          <dd className="text-label break-words text-ink-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
