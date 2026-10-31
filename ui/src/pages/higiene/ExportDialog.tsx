import { useState } from 'react'
import { copy } from '@/i18n'
import { downloadAppcc, errorText, todayMadrid, yearStart } from '@/pages/higiene/api'
import { dateLabels } from '@/pages/higiene/labels'
import { EffluentField } from '@/pages/higiene/fields'
import { Field } from '@/components/Field'
import { Button, DatePicker, Dialog, DialogBody, DialogFooter, DialogHeader, useToast } from '@/ui'

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [from, setFrom] = useState<string | null>(yearStart())
  const [to, setTo] = useState<string | null>(todayMadrid())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!from || !to) return
    if (from > to) {
      setError(copy.higiene.period)
      return
    }
    setSaving(true)
    setError('')
    try {
      await downloadAppcc(from, to)
      toast(copy.higiene.exported)
      onClose()
    } catch (err: unknown) {
      setError(errorText(err, copy.higiene.exportFailed))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="exportar-appcc" size="md">
      <DialogHeader titleId="exportar-appcc" title={copy.higiene.export} onClose={onClose} />
      <DialogBody>
        <form
          id="exportar-appcc-form"
          data-screen="higiene-dialogo-appcc"
          className="grid gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="appcc-desde" label={copy.higiene.from}>
              <DatePicker value={from} onChange={setFrom} locale="es" labels={dateLabels()} className="w-full" />
            </Field>
            <Field id="appcc-hasta" label={copy.higiene.to}>
              <DatePicker value={to} onChange={setTo} locale="es" labels={dateLabels()} className="w-full" />
            </Field>
          </div>
          <EffluentField />
          {error ? (
            <p role="alert" className="text-label text-danger-700">
              {error}
            </p>
          ) : null}
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.higiene.cancel}
        </Button>
        <Button type="submit" form="exportar-appcc-form" variant="primary" size="sm" loading={saving}>
          {copy.higiene.download}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
