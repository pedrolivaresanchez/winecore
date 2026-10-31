import { useId } from 'react'
import { copy } from '@/i18n'
import type { CheckFinding } from '@/pages/enologia/types'
import { Alert, Textarea } from '@/ui'

/**
 * Hallazgos de POST /v1/enology/checks.
 * El aviso que pide motivo muestra el campo; el error que bloquea no admite motivo.
 * La bodega reenvía la operación con el texto cuando onReason cambia.
 */
export function EnologyChecks({
  findings,
  reason = '',
  onReason,
  disabled = false,
}: {
  findings: readonly CheckFinding[]
  reason?: string
  onReason?: (reason: string) => void
  disabled?: boolean
}) {
  const reasonId = useId()
  if (findings.length === 0) return null
  const ask = findings.some((row) => row.requires_reason)
  const blocking = findings.some((row) => row.blocks)

  return (
    <div data-screen="enologia-comprobaciones" data-blocking={blocking ? 'si' : 'no'} className="grid gap-3">
      {findings.map((row, index) => (
        <Alert
          key={`${row.code}-${index}`}
          tone={row.blocks || row.severity === 'error' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'}
        >
          {row.message}
        </Alert>
      ))}
      {ask && onReason ? (
        <label htmlFor={reasonId} className="grid gap-1.5 text-label font-medium text-ink-900">
          {copy.enology.fields.reason}
          <Textarea
            id={reasonId}
            value={reason}
            rows={3}
            disabled={disabled}
            onChange={(event) => onReason(event.target.value)}
          />
        </label>
      ) : null}
    </div>
  )
}
