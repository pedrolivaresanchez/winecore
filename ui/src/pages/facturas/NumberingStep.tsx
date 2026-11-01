import { useState } from 'react'
import { copy, fill } from '@/i18n'
import type { Me } from '@/lib/types'
import type { NumberingNeed } from '@/pages/ajustes/numeracion/api'
import { canManageNumbering, firstTitle } from '@/pages/ajustes/numeracion/model'
import { NumberingChoice } from '@/pages/ajustes/numeracion/NumberingChoice'
import { openSettings } from '@/pages/ajustes/seguridad/open-settings'
import { entityLabel } from '@/pages/facturas/format'
import { Alert, Button, Surface, useToast } from '@/ui'

/** Shown instead of the issue dialog when the entity has no series for the invoice's year. */
export function NumberingStep({ me, need, onOpened }: { me: Me; need: NumberingNeed; onOpened: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!canManageNumbering(me)) {
    return <Alert tone="warning">{fill(copy.numbering.askStaff, { entity: entityLabel(need.entity_code), year: String(need.year) })}</Alert>
  }
  return (
    <div data-screen="numeracion-primera">
      <Surface className="grid gap-3 p-4">
        <p className="text-label font-medium text-ink-900">{firstTitle(need)}</p>
        <NumberingChoice
          need={need}
          formId="numeracion-primera"
          onBusy={setBusy}
          onOpened={(series) => {
            if (series) toast(fill(copy.numbering.opened, { prefix: series.prefix }), { tone: 'success' })
            onOpened()
          }}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => openSettings('numbering')}>
            {copy.numbering.manage}
          </Button>
          <Button type="submit" form="numeracion-primera" variant="primary" size="sm" loading={busy}>
            {copy.numbering.use}
          </Button>
        </div>
      </Surface>
    </div>
  )
}
