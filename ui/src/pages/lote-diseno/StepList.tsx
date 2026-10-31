import { Badge } from '@/ui'
import { copy } from '@/i18n'
import { blendLabel, doseLabel, opName, stepMeta, type BlendShare, type RecipeAddition } from '@/pages/lote-diseno/model'

export function StepList({
  steps,
}: {
  steps: Array<{
    position: number
    op_type: string
    offset_days: number
    duration_hours: number | null
    temperature_c: number | null
    additions: RecipeAddition[]
    blend_proportions: BlendShare[]
    target_date?: string
    status?: string
  }>
}) {
  return (
    <ol className="overflow-hidden rounded-2xl border border-border-subtle">
      {steps.map((step) => (
        <li key={step.position} className="grid gap-1 border-b border-border-subtle px-4 py-3 last:border-b-0">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-label font-medium text-ink-900">
              {step.position}. {opName(step.op_type)}
            </p>
            {step.status === 'suggested' ? (
              <Badge tone="info" size="sm">
                {copy.lote.suggested}
              </Badge>
            ) : null}
          </div>
          <p className="text-caption text-text-secondary">{stepMeta(step)}</p>
          {step.additions.length > 0 ? (
            <p className="text-caption text-text-tertiary">{step.additions.map(doseLabel).join(' · ')}</p>
          ) : null}
          {step.blend_proportions.length > 0 ? (
            <p className="text-caption text-text-tertiary">{step.blend_proportions.map(blendLabel).join(' · ')}</p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
