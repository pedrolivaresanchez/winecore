import { useState } from 'react'
import { copy } from '@/i18n'
import { ApiError, api } from '@/lib/api'
import type { Me } from '@/lib/types'
import { canOpenExercise, warehouseOptionLabel } from '@/pages/regulatorio/model'
import { useWarehouses } from '@/pages/regulatorio/warehouses'
import { Alert, Button, Select, useToast } from '@/ui'

export function ExerciseAction({
  me,
  entityId,
  year,
}: {
  me: Me
  entityId: string
  year: number
}) {
  const toast = useToast()
  const places = useWarehouses()
  const options = places.warehouses.filter((item) => item.entityId === entityId)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const warehouseId = options.length === 1 ? (options[0]?.id ?? '') : picked

  if (!canOpenExercise(me, entityId)) return null

  async function open() {
    if (!warehouseId || !Number.isInteger(year)) return
    setBusy(true)
    setError(null)
    try {
      await api('/v1/silicie-exercises', {
        method: 'POST',
        body: JSON.stringify({ tax_warehouse_id: warehouseId, year }),
      })
      toast(copy.regulatorio.exerciseOpened, { tone: 'success' })
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.regulatorio.saveFail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-screen="regulatorio-ejercicio" className="grid gap-2">
      {options.length > 1 ? (
        <Select
          aria-label={copy.regulatorio.warehouse}
          value={picked}
          className="w-full"
          onChange={(event) => setPicked(event.target.value)}
        >
          <option value="">{copy.regulatorio.warehouse}</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {warehouseOptionLabel(item)}
            </option>
          ))}
        </Select>
      ) : null}
      <Button type="button" size="sm" className="w-fit" loading={busy} disabled={!warehouseId && !busy} onClick={() => void open()}>
        {copy.regulatorio.openExercise}
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  )
}
