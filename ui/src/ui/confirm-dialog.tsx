import type { ReactNode } from 'react'
import { Button } from './button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './dialog'
import { useUiLabels } from './ui-labels'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const labels = useUiLabels()
  return (
    <Dialog open={open} onClose={onClose} labelledBy="confirm-title" size="sm">
      <DialogHeader titleId="confirm-title" title={title} onClose={onClose} />
      <DialogBody>
        <div className="text-label text-text-secondary">{body}</div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {labels.cancel}
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
