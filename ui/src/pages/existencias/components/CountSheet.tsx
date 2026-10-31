import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import type { CountLine, CountMethod } from '@/pages/existencias/api'
import { lineGap } from '@/pages/existencias/filters'
import { COUNT_METHODS, isPackaged, methodLabel, ownerLabel, productLabel, stateLabel } from '@/pages/existencias/labels'
import { UnitsInput, VolumeInput } from '@/pages/existencias/components/VolumeInput'
import { formatMl, formatSignedMl, formatSignedUnits, formatUnits } from '@/pages/existencias/volume'
import { Select, Textarea } from '@/ui'

export type LineDraft = {
  counted_volume_ml: number | null
  counted_qty_units: number | null
  method: CountMethod | null
  difference_reason: string
  photoName: string | null
}

function bookText(line: CountLine): string {
  if (isPackaged(line.product_state)) return `${formatUnits(line.expected_qty_units)} ud`
  return formatMl(line.expected_volume_ml)
}

function diffText(line: CountLine, draft: LineDraft): string {
  const gap = lineGap({ ...line, counted_volume_ml: draft.counted_volume_ml, counted_qty_units: draft.counted_qty_units })
  if (gap == null) return '—'
  return isPackaged(line.product_state) ? formatSignedUnits(gap) : formatSignedMl(gap)
}

function diffValue(line: CountLine, draft: LineDraft): number | null {
  return lineGap({ ...line, counted_volume_ml: draft.counted_volume_ml, counted_qty_units: draft.counted_qty_units })
}

export function CountSheet({
  lines,
  drafts,
  errors,
  scan,
  volumesEditable,
  reasonsEditable,
  onDraft,
}: {
  lines: CountLine[]
  drafts: Record<string, LineDraft>
  errors: Record<string, string>
  scan: string
  volumesEditable: boolean
  reasonsEditable: boolean
  onDraft: (id: string, patch: Partial<LineDraft>) => void
}) {
  const groups = new Map<string, { name: string; code: string; lines: CountLine[] }>()
  for (const line of lines) {
    const group = groups.get(line.location_id) ?? { name: line.location_name, code: line.location_code, lines: [] }
    group.lines.push(line)
    groups.set(line.location_id, group)
  }
  const needle = scan.trim().toLocaleLowerCase('es')

  return (
    <div className="grid min-w-0">
      {[...groups.entries()].map(([id, group]) => (
        <section key={id} className="min-w-0">
          <h2 className="border-b border-border-subtle px-3 py-2 text-caption text-text-tertiary sm:px-4">
            {group.name} · {group.code}
          </h2>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-label">
              <caption className="sr-only">Recuento en {group.name}</caption>
              <thead>
                <tr className="border-b border-border-subtle text-caption text-text-tertiary">
                  {['Recipiente', 'Lote', 'Libro', 'Contado', 'Diferencia', 'Motivo', 'Método'].map((header) => (
                    <th key={header} className={cn('h-9 px-3 text-left font-medium', (header === 'Libro' || header === 'Diferencia') && 'text-right')}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.lines.map((line) => {
                  const draft = drafts[line.id]
                  if (!draft) return null
                  const gap = diffValue(line, draft)
                  const active = needle.length > 0 && `${line.vessel_code ?? ''} ${line.lot_code ?? ''} ${line.qr_token ?? ''}`.toLocaleLowerCase('es').includes(needle)
                  return (
                    <tr key={line.id} data-line={line.id} className={cn('border-b border-border-subtle', active && 'bg-fill-selected')}>
                      <td className="px-3 py-2 align-top">
                        <p className="font-medium text-ink-900">{line.vessel_code ?? productLabel(line)}</p>
                        <p className="text-caption text-text-tertiary">
                          {stateLabel(line.product_state)} · {ownerLabel(line.owner_code)}
                        </p>
                      </td>
                      <td className="px-3 py-2 align-top">{line.lot_code ?? '—'}</td>
                      <td className="px-3 py-2 text-right align-top tabular-nums">{bookText(line)}</td>
                      <td className="w-36 px-3 py-2 align-top">
                        <CountControl line={line} draft={draft} editable={volumesEditable} onDraft={onDraft} suffix="d" />
                        {errors[line.id] ? <p className="mt-1 text-caption text-danger-700">{errors[line.id]}</p> : null}
                      </td>
                      <td className={cn('px-3 py-2 text-right align-top tabular-nums', gap != null && gap < 0 && 'text-danger-700')}>{diffText(line, draft)}</td>
                      <td className="w-48 px-3 py-2 align-top">
                        <ReasonField line={line} draft={draft} gap={gap} editable={reasonsEditable} onDraft={onDraft} />
                      </td>
                      <td className="w-44 px-3 py-2 align-top">
                        <MethodField line={line} draft={draft} editable={volumesEditable} onDraft={onDraft} />
                        <PhotoField lineId={line.id} draft={draft} editable={volumesEditable || reasonsEditable} onDraft={onDraft} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <ul className="md:hidden">
            {group.lines.map((line) => {
              const draft = drafts[line.id]
              if (!draft) return null
              const gap = diffValue(line, draft)
              const active = needle.length > 0 && `${line.vessel_code ?? ''} ${line.lot_code ?? ''} ${line.qr_token ?? ''}`.toLocaleLowerCase('es').includes(needle)
              return (
                <li key={line.id} data-line={line.id} className={cn('grid gap-2 border-b border-border-subtle px-3 py-3', active && 'bg-fill-selected')}>
                  <div>
                    <p className="text-label font-medium text-ink-900">{line.vessel_code ?? productLabel(line)}</p>
                    <p className="text-caption text-text-tertiary">
                      {line.lot_code ?? 'Sin lote'} · {stateLabel(line.product_state)} · {ownerLabel(line.owner_code)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-label">
                    <span className="text-text-tertiary">{copy.stock.bookCol}</span>
                    <span className="tabular-nums">{bookText(line)}</span>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-caption text-text-tertiary">{copy.stock.counted}</span>
                    <CountControl line={line} draft={draft} editable={volumesEditable} onDraft={onDraft} suffix="m" />
                    {errors[line.id] ? <p className="text-caption text-danger-700">{errors[line.id]}</p> : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 text-label">
                    <span className="text-text-tertiary">{copy.stock.diff}</span>
                    <span className={cn('tabular-nums', gap != null && gap < 0 && 'text-danger-700')}>{diffText(line, draft)}</span>
                  </div>
                  <ReasonField line={line} draft={draft} gap={gap} editable={reasonsEditable} onDraft={onDraft} />
                  <MethodField line={line} draft={draft} editable={volumesEditable} onDraft={onDraft} />
                  <PhotoField lineId={line.id} draft={draft} editable={volumesEditable || reasonsEditable} onDraft={onDraft} />
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function CountControl({
  line,
  draft,
  editable,
  onDraft,
  suffix,
}: {
  line: CountLine
  draft: LineDraft
  editable: boolean
  onDraft: (id: string, patch: Partial<LineDraft>) => void
  suffix: string
}) {
  if (!editable) {
    if (isPackaged(line.product_state)) return <p className="text-right tabular-nums">{draft.counted_qty_units == null ? '—' : `${formatUnits(draft.counted_qty_units)} ud`}</p>
    return <p className="text-right tabular-nums">{draft.counted_volume_ml == null ? '—' : formatMl(draft.counted_volume_ml)}</p>
  }
  if (isPackaged(line.product_state)) {
    return <UnitsInput id={`ud-${line.id}-${suffix}`} units={draft.counted_qty_units} onCommit={(units) => onDraft(line.id, { counted_qty_units: units })} />
  }
  return <VolumeInput id={`l-${line.id}-${suffix}`} ml={draft.counted_volume_ml} onCommit={(ml) => onDraft(line.id, { counted_volume_ml: ml })} />
}

function ReasonField({
  line,
  draft,
  gap,
  editable,
  onDraft,
}: {
  line: CountLine
  draft: LineDraft
  gap: number | null
  editable: boolean
  onDraft: (id: string, patch: Partial<LineDraft>) => void
}) {
  if (gap === 0 || gap == null) return <p className="text-caption text-text-tertiary">{draft.difference_reason || '—'}</p>
  if (!editable) return <p className="text-label">{draft.difference_reason || 'Falta el motivo'}</p>
  return (
    <Textarea
      aria-label={`${copy.stock.reason} ${line.vessel_code ?? line.lot_code ?? ''}`}
      value={draft.difference_reason}
      placeholder={copy.stock.reason}
      rows={2}
      onChange={(event) => onDraft(line.id, { difference_reason: event.target.value })}
    />
  )
}

function MethodField({
  line,
  draft,
  editable,
  onDraft,
}: {
  line: CountLine
  draft: LineDraft
  editable: boolean
  onDraft: (id: string, patch: Partial<LineDraft>) => void
}) {
  if (!editable) return <p className="text-label">{methodLabel(draft.method)}</p>
  return (
    <Select
      size="sm"
      aria-label={`${copy.stock.method} ${line.vessel_code ?? line.lot_code ?? ''}`}
      value={draft.method ?? ''}
      onChange={(event) => onDraft(line.id, { method: (event.target.value || null) as CountMethod | null })}
    >
      <option value="">{copy.stock.method}</option>
      {COUNT_METHODS.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </Select>
  )
}

function PhotoField({
  lineId,
  draft,
  editable,
  onDraft,
}: {
  lineId: string
  draft: LineDraft
  editable: boolean
  onDraft: (id: string, patch: Partial<LineDraft>) => void
}) {
  if (!editable) return draft.photoName ? <p className="text-caption text-text-tertiary">{draft.photoName}</p> : null
  return (
    <label className="mt-1 flex cursor-pointer items-center text-caption text-text-tertiary">
      <span className="truncate">{draft.photoName ?? copy.stock.photo}</span>
      <input type="file" accept="image/*" className="sr-only" onChange={(event) => onDraft(lineId, { photoName: event.target.files?.[0]?.name ?? null })} />
    </label>
  )
}
