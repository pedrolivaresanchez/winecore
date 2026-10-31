import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { fieldAria } from '@/lib/field'
import { iconStroke } from '@/lib/motion'
import type { LotListItem } from '@/lib/cellar'
import { Alert, Button, Drawer, DrawerBody, DrawerHeader, GlassMenu, Input, MenuItem, Select, useMenuOpen } from '@/ui'
import { MoreVertical } from '@/ui/icons'
import {
  DOSE_UNITS,
  OP_ORDER,
  doseUnitLabel,
  emptyAddition,
  emptyBlend,
  emptyStep,
  opName,
  type StepDraft,
} from '@/pages/lote-diseno/model'

export function PasoEditor({
  open,
  name,
  notes,
  steps,
  lots,
  error,
  saving,
  onClose,
  onName,
  onNotes,
  onSteps,
  onSave,
}: {
  open: boolean
  name: string
  notes: string
  steps: StepDraft[]
  lots: LotListItem[]
  error: string | null
  saving: boolean
  onClose: () => void
  onName: (value: string) => void
  onNotes: (value: string) => void
  onSteps: (next: StepDraft[]) => void
  onSave: () => void
}) {
  function patch(key: string, next: Partial<StepDraft>) {
    onSteps(steps.map((step) => (step.key === key ? { ...step, ...next } : step)))
  }

  return (
    <Drawer open={open} onClose={onClose} labelledBy="editar-pasos" size="xl">
      <DrawerHeader titleId="editar-pasos" title={copy.lote.editSteps} onClose={onClose} />
      <DrawerBody>
        <div className="grid gap-4" data-screen="lote-pasos">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field id="paso-nombre" label={copy.lote.recipeName} error={undefined}>
            <Input id="paso-nombre" value={name} disabled={saving} onChange={(event) => onName(event.target.value)} />
          </Field>
          <Field id="paso-notas" label={copy.lote.notes}>
            <Input id="paso-notas" value={notes} disabled={saving} onChange={(event) => onNotes(event.target.value)} />
          </Field>
          {steps.map((step, index) => (
            <StepCard
              key={step.key}
              index={index}
              step={step}
              lots={lots}
              disabled={saving}
              onChange={(next) => patch(step.key, next)}
              onRemove={() => onSteps(steps.filter((item) => item.key !== step.key))}
            />
          ))}
          <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => onSteps([...steps, emptyStep()])}>
            {copy.lote.addStep}
          </Button>
        </div>
      </DrawerBody>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-4 py-3 sm:px-6">
        <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={onClose}>
          {copy.lote.cancel}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={saving} onClick={onSave}>
          {copy.lote.save}
        </Button>
      </div>
    </Drawer>
  )
}

function StepCard({
  index,
  step,
  lots,
  disabled,
  onChange,
  onRemove,
}: {
  index: number
  step: StepDraft
  lots: LotListItem[]
  disabled: boolean
  onChange: (next: Partial<StepDraft>) => void
  onRemove: () => void
}) {
  const more = useMenuOpen()
  const known = new Set(lots.map((lot) => lot.id))
  const blends = step.blends.filter((item) => item.lot_id && !known.has(item.lot_id))

  return (
    <section className="grid gap-3 rounded-2xl border border-border-subtle p-3">
      <div className="flex items-center gap-2">
        <span className="text-caption text-text-tertiary">{index + 1}</span>
        <Select
          className="min-w-0 flex-1"
          aria-label={copy.lote.kind}
          value={step.op_type}
          disabled={disabled}
          onChange={(event) => onChange({ op_type: event.target.value })}
        >
          {OP_ORDER.map((op) => (
            <option key={op} value={op}>
              {opName(op)}
            </option>
          ))}
        </Select>
        <GlassMenu
          open={more.open}
          onOpenChange={more.setOpen}
          placement="bottom-end"
          trigger={
            <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.lote.more} onClick={more.toggle}>
              <MoreVertical strokeWidth={iconStroke} />
            </Button>
          }
        >
          <MenuItem
            tone="danger"
            onClick={() => {
              more.close()
              onRemove()
            }}
          >
            {copy.lote.removeStep}
          </MenuItem>
        </GlassMenu>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`${step.key}-day`} label={copy.lote.offset}>
          <Input
            {...fieldAria(`${step.key}-day`)}
            inputMode="numeric"
            value={step.offset_days}
            disabled={disabled}
            onChange={(event) => onChange({ offset_days: event.target.value })}
          />
        </Field>
        <Field id={`${step.key}-hours`} label={copy.lote.duration}>
          <Input
            {...fieldAria(`${step.key}-hours`)}
            inputMode="decimal"
            value={step.duration_hours}
            disabled={disabled}
            onChange={(event) => onChange({ duration_hours: event.target.value })}
          />
        </Field>
        <Field id={`${step.key}-temp`} label={copy.lote.temperature}>
          <Input
            {...fieldAria(`${step.key}-temp`)}
            inputMode="decimal"
            value={step.temperature_c}
            disabled={disabled}
            onChange={(event) => onChange({ temperature_c: event.target.value })}
          />
        </Field>
      </div>
      <div className="grid gap-2">
        <p className="text-caption text-text-tertiary">{copy.lote.additions}</p>
        {step.additions.map((item) => (
          <div key={item.key} className="grid gap-2 sm:grid-cols-[1fr_5rem_6rem]">
            <Input
              aria-label={copy.lote.product}
              value={item.product_name}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  additions: step.additions.map((row) =>
                    row.key === item.key ? { ...row, product_name: event.target.value, product_id: row.product_name === event.target.value ? row.product_id : null } : row,
                  ),
                })
              }
            />
            <Input
              aria-label={copy.lote.dose}
              inputMode="decimal"
              value={item.dose}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  additions: step.additions.map((row) => (row.key === item.key ? { ...row, dose: event.target.value } : row)),
                })
              }
            />
            <Select
              aria-label={copy.lote.dose}
              value={item.dose_unit}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  additions: step.additions.map((row) => (row.key === item.key ? { ...row, dose_unit: event.target.value } : row)),
                })
              }
            >
              {DOSE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {doseUnitLabel(unit)}
                </option>
              ))}
            </Select>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange({ additions: [...step.additions, emptyAddition()] })}>
          {copy.lote.addAddition}
        </Button>
      </div>
      {step.op_type === 'blend' ? (
        <div className="grid gap-2">
          <p className="text-caption text-text-tertiary">{copy.lote.blend}</p>
          {step.blends.map((item) => (
            <div key={item.key} className="grid gap-2 sm:grid-cols-[1fr_6rem]">
              <Select
                aria-label={copy.lote.lot}
                value={item.lot_id}
                disabled={disabled}
                onChange={(event) => {
                  const lot = lots.find((row) => row.id === event.target.value)
                  onChange({
                    blends: step.blends.map((row) =>
                      row.key === item.key ? { ...row, lot_id: event.target.value, lot_code: lot?.code ?? row.lot_code } : row,
                    ),
                  })
                }}
              >
                <option value="">{copy.lote.chooseLot}</option>
                {blends
                  .filter((row) => row.key === item.key)
                  .map((row) => (
                    <option key={row.lot_id} value={row.lot_id}>
                      {row.lot_code}
                    </option>
                  ))}
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.code}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={copy.lote.percent}
                inputMode="decimal"
                value={item.percent}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    blends: step.blends.map((row) => (row.key === item.key ? { ...row, percent: event.target.value } : row)),
                  })
                }
              />
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange({ blends: [...step.blends, emptyBlend()] })}>
            {copy.lote.addBlend}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
