import type { ReactNode } from 'react'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@/ui'

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="confirm-title" size="sm">
      <DialogHeader titleId="confirm-title" title={title} onClose={onClose} />
      <DialogBody>
        <div className="text-label text-text-secondary">{body}</div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant={danger ? 'danger' : 'primary'}
          size="sm"
          onClick={onConfirm}
          loading={busy}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
