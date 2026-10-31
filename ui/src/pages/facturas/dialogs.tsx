import { useState } from 'react'
import { Field } from '@/components/Field'
import { copy, fill } from '@/i18n'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Select, Textarea } from '@/ui'
import { reasonLabel } from '@/pages/facturas/format'
import { VOID_REASONS, type VoidReason } from '@/pages/facturas/types'

export function IssueDialog({
  open,
  entity,
  total,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  entity: string
  total: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="emitir-factura" size="sm">
      <div data-screen="facturas-dialogo">
        <DialogHeader titleId="emitir-factura" title={copy.facturas.issueTitle} onClose={onClose} />
        <DialogBody>
          <p className="text-label text-text-secondary">{fill(copy.facturas.issueBody, { entity, total })}</p>
          <p className="mt-2 text-label text-text-tertiary">{copy.facturas.stockTip}</p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {copy.facturas.cancel}
          </Button>
          <Button type="button" variant="primary" size="sm" loading={busy} onClick={onConfirm}>
            {copy.facturas.issue}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}

export function VoidDialog({
  open,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  busy: boolean
  onClose: () => void
  onConfirm: (reason: VoidReason, detail: string) => void
}) {
  const [reason, setReason] = useState<VoidReason>('duplicate')
  const [detail, setDetail] = useState('')

  return (
    <Dialog open={open} onClose={onClose} labelledBy="anular-factura" size="sm">
      <DialogHeader titleId="anular-factura" title={copy.facturas.voidTitle} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3">
          <Field id="motivo-anulacion" label={copy.facturas.voidReason}>
            <Select
              id="motivo-anulacion"
              size="sm"
              value={reason}
              onChange={(event) => setReason(event.target.value as VoidReason)}
            >
              {VOID_REASONS.map((item) => (
                <option key={item} value={item}>
                  {reasonLabel(item)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="detalle-anulacion" label={copy.facturas.detail}>
            <Textarea id="detalle-anulacion" value={detail} rows={3} onChange={(event) => setDetail(event.target.value)} />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {copy.facturas.cancel}
        </Button>
        <Button type="button" variant="danger" size="sm" loading={busy} onClick={() => onConfirm(reason, detail.trim())}>
          {copy.facturas.void}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
