import { useCallback, useState } from 'react'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { useApi } from '@/hooks/use-api'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, MenuItem, MenuSeparator, useToast } from '@/ui'
import { DatePicker } from '@/ui'
import { patchBarrel } from '@/pages/bodega-plano/api'
import { notifyBarrel, requestRetire, useRetireRequest } from '@/pages/bodega-plano/refresh'
import { barrelStatusLabel, BARREL_STATUSES } from '@/pages/bodega-plano/text'
import type { BarrelStatus, BarrelView } from '@/pages/bodega-plano/types'

const DATE_LABELS = { clear: copy.stock.dateClear, today: copy.stock.dateToday }

export function BarrelMenu({ code, close }: { code: string; close: () => void }) {
  const data = useApi<BarrelView>(`/v1/vessels/${encodeURIComponent(code)}/barrel`)
  const toast = useToast()
  if (!data.data || data.data.vessel_code !== code) return null
  const barrel = data.data

  async function setStatus(status: BarrelStatus) {
    close()
    try {
      await patchBarrel(code, { status })
      notifyBarrel(code)
      toast(copy.plano.barrelSaved)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.plano.saveFailed)
    }
  }

  return (
    <>
      <MenuSeparator />
      {BARREL_STATUSES.filter((status) => status !== 'retired').map((status) => (
        <MenuItem key={status} radio checked={barrel.status === status} onClick={() => void setStatus(status)}>
          {barrelStatusLabel(status)}
        </MenuItem>
      ))}
      {barrel.status === 'retired' ? (
        <MenuItem onClick={() => void setStatus('in_use')}>{copy.plano.reactivate}</MenuItem>
      ) : (
        <MenuItem
          tone="danger"
          onClick={() => {
            close()
            requestRetire(code)
          }}
        >
          {copy.plano.retire}
        </MenuItem>
      )}
    </>
  )
}

export function BarrelRetireHost() {
  const [code, setCode] = useState<string | null>(null)
  const onCode = useCallback((next: string) => setCode(next), [])
  useRetireRequest(onCode)
  return <BarrelRetireDialog code={code} onClose={() => setCode(null)} />
}

function BarrelRetireDialog({ code, onClose }: { code: string | null; onClose: () => void }) {
  const toast = useToast()
  const [date, setDate] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function retire() {
    if (!code || !date) return
    setBusy(true)
    setError(null)
    try {
      await patchBarrel(code, { status: 'retired', retired_on: date })
      notifyBarrel(code)
      toast(copy.plano.barrelSaved)
      setDate(null)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.plano.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={code !== null} onClose={onClose} labelledBy="retirar-barrica" size="sm">
      <DialogHeader titleId="retirar-barrica" title={copy.plano.retireTitle} description={copy.plano.retireHint} onClose={onClose} />
      <DialogBody>
        <DatePicker
          value={date}
          onChange={setDate}
          labels={DATE_LABELS}
          locale="es"
          placeholder={copy.plano.retiredOn}
          className="w-full"
        />
        {error ? (
          <p role="alert" className="mt-2 text-label text-danger-600">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {copy.plano.cancel}
        </Button>
        <Button type="button" variant="danger" size="sm" loading={busy} disabled={!date} onClick={() => void retire()}>
          {copy.plano.retire}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
