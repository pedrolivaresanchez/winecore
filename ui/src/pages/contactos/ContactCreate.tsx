import { useEffect, useRef, useState } from 'react'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { cleanInput, createContact, duplicateContact, emptyInput, type ContactInput } from '@/lib/contacts'
import { normalizeTaxId } from '@/lib/tax-id'
import { validateContact } from '@/lib/contact-validate'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, useToast } from '@/ui'
import { ContactForm } from '@/pages/contactos/ContactForm'

export function ContactCreate({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="nuevo-contacto" size="md">
      <CreateForm onClose={onClose} onCreated={onCreated} />
    </Dialog>
  )
}

function CreateForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast()
  const [value, setValue] = useState<ContactInput>(emptyInput)
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  /* The API replays a stored answer for a repeated key and refuses a different body under it,
     so a retry after fixing a field (a duplicate NIF, say) has to travel under a new key. */
  const attempt = useRef<{ key: string; body: string } | null>(null)
  /* Fields are disabled while saving and a disabled input cannot take focus. */
  const focusAfterSave = useRef<string | null>(null)

  useEffect(() => {
    if (saving || !focusAfterSave.current) return
    document.getElementById(focusAfterSave.current)?.focus()
    focusAfterSave.current = null
  }, [saving])

  useEffect(() => {
    let second = 0
    /* The dialog moves focus to its panel on the next frame; the name field takes it after. */
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => document.getElementById('legal_name')?.focus())
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])

  const live = validateContact(value)
  const errors: Record<string, string> = { ...serverErrors }
  for (const [field, message] of Object.entries(live)) {
    if (submitted || touched.has(field)) errors[field] = message
  }

  function change(next: ContactInput) {
    setServerErrors((current) => {
      const kept = Object.entries(current).filter(([field]) => next[field as keyof ContactInput] === value[field as keyof ContactInput])
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept)
    })
    if (next.tax_id !== value.tax_id || next.country_code !== value.country_code) setDuplicate(null)
    setValue(next)
  }

  function blur(field: keyof ContactInput) {
    if (field === 'tax_id' && value.tax_id) setValue((current) => ({ ...current, tax_id: normalizeTaxId(current.tax_id ?? '') }))
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)))
  }

  async function submit() {
    const next = { ...value, tax_id: value.tax_id ? normalizeTaxId(value.tax_id) : '' }
    setValue(next)
    setSubmitted(true)
    setDuplicate(null)
    const found = validateContact(next)
    const firstField = Object.keys(found)[0]
    if (firstField) {
      document.getElementById(firstField)?.focus()
      return
    }
    const input = cleanInput(next)
    const body = JSON.stringify(input)
    if (attempt.current?.body !== body) attempt.current = { key: crypto.randomUUID(), body }
    setSaving(true)
    try {
      const created = await createContact(input, attempt.current.key)
      toast(copy.contacts.created)
      onCreated(created.id)
    } catch (error: unknown) {
      const existing = duplicateContact(error)
      if (existing) {
        setDuplicate(existing)
        focusAfterSave.current = 'tax_id'
        return
      }
      if (error instanceof ApiError && error.fields) {
        setServerErrors(error.fields)
        focusAfterSave.current = Object.keys(error.fields)[0] ?? null
      } else {
        toast(error instanceof ApiError ? error.message : copy.contacts.createFailed)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      data-screen="contacto-nuevo"
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <DialogHeader titleId="nuevo-contacto" title={copy.contacts.new} description={copy.contacts.newHint} onClose={onClose} />
      <DialogBody className="pb-4">
        <ContactForm value={value} onChange={change} onBlurField={blur} errors={errors} duplicate={duplicate} disabled={saving} />
      </DialogBody>
      <DialogFooter className="border-t border-border-subtle">
        <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={onClose}>
          {copy.contacts.cancel}
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {saving ? copy.contacts.creating : copy.contacts.create}
        </Button>
      </DialogFooter>
    </form>
  )
}
