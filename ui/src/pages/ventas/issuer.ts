import { useEffect, useState } from 'react'
import { useEntity } from '@/app/entity-context'
import { copy, fill } from '@/i18n'
import { resolveIssuing, type IssuingPreview } from '@/lib/sales'
import { entityLabel } from '@/pages/facturas/format'

/** Rule preview wins until the user picks; then the switcher, then the first entity. */
export function useIssuer(customerId: string, channel: string) {
  const { filter, entities } = useEntity()
  const [preview, setPreview] = useState<IssuingPreview | null>(null)
  const [resolved, setResolved] = useState(false)
  const [chosen, setChosen] = useState('')

  useEffect(() => {
    setResolved(false)
    if (!customerId) {
      setPreview(null)
      return
    }
    const controller = new AbortController()
    resolveIssuing(customerId, channel, controller.signal)
      .then((hit) => {
        setPreview(hit)
        setResolved(true)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setPreview(null)
        setResolved(true)
      })
    return () => controller.abort()
  }, [channel, customerId])

  const fallback = entities.find((item) => item.code === filter)?.id ?? entities[0]?.id ?? ''
  const ruled = preview && entities.some((item) => item.id === preview.entity_id) ? preview.entity_id : ''
  const entityId = chosen || ruled || fallback
  const labelOf = (id: string | null | undefined) => entityLabel(entities.find((item) => item.id === id)?.code)
  const current = preview && customerId && resolved ? preview : null

  let note = ''
  if (customerId && resolved) {
    if (!preview) note = fill(copy.sales.entityFirst, { entity: labelOf(entityId) })
    else if (preview.entity_id !== entityId) note = fill(copy.sales.entityException, { entity: entityLabel(preview.entity_code) })
    else note = preview.label
  }

  return {
    entityId,
    label: labelOf(entityId),
    labelOf,
    preview: current,
    note,
    choose: setChosen,
    options: [...entities]
      .sort((a, b) => Number(b.code === 'PO') - Number(a.code === 'PO'))
      .map((item) => ({ value: item.id, content: entityLabel(item.code) })),
  }
}
