import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { NoPermission } from '@/components/NoPermission'
import { useMinWidth } from '@/hooks/use-media'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { cleanInput, createContact, duplicateContact, emptyInput, type ContactInput } from '@/lib/contacts'
import { allows } from '@/lib/permissions'
import { normalizeTaxId } from '@/lib/tax-id'
import type { Me } from '@/lib/types'
import { validateContact } from '@/lib/contact-validate'
import { Button, Drawer, DrawerBody, DrawerHeader, useToast } from '@/ui'
import { ContactForm } from '@/pages/contactos/ContactForm'

export function ContactCreate({ me }: { me: Me }) {
  const navigate = useNavigate()
  const desktop = useMinWidth(768)
  const toast = useToast()
  useChromeTitle(copy.contacts.new)
  const [value, setValue] = useState<ContactInput>(emptyInput)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const idempotency = useRef(crypto.randomUUID())

  useEffect(() => {
    const field = Object.keys(errors)[0]
    if (field) document.getElementById(field)?.scrollIntoView({ block: 'center' })
  }, [errors])

  useEffect(() => {
    if (duplicate) document.getElementById('duplicate-tax')?.scrollIntoView({ block: 'center' })
  }, [duplicate])

  if (!allows(me, 'contacts.read')) return <NoPermission />

  async function onSubmit() {
    const next = { ...value, tax_id: value.tax_id ? normalizeTaxId(value.tax_id) : '' }
    setValue(next)
    const found = validateContact(next)
    setErrors(found)
    setDuplicate(null)
    if (Object.keys(found).length > 0 || !allows(me, 'contacts.write')) return
    setSaving(true)
    try {
      const created = await createContact(cleanInput(next), idempotency.current)
      toast('Contacto creado')
      navigate(`/contactos/${created.id}`)
    } catch (error: unknown) {
      const existing = duplicateContact(error)
      if (existing) {
        setDuplicate(existing)
        return
      }
      if (error instanceof ApiError && error.fields) setErrors(error.fields)
      else toast(error instanceof ApiError ? error.message : 'No se ha podido crear el contacto.')
    } finally {
      setSaving(false)
    }
  }

  const form = (
    <form
      className="grid gap-4"
      data-screen="contacto-nuevo"
      onSubmit={(event) => {
        event.preventDefault()
        void onSubmit()
      }}
    >
      <ContactForm
        value={value}
        onChange={setValue}
        errors={errors}
        duplicate={duplicate}
        disabled={saving || !allows(me, 'contacts.write')}
      />
      {allows(me, 'contacts.write') ? (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            {saving ? 'Creando…' : copy.contacts.create}
          </Button>
        </div>
      ) : null}
    </form>
  )

  if (!desktop) {
    return (
      <Drawer open onClose={() => navigate('/contactos')} labelledBy="nuevo-contacto" size="lg">
        <DrawerHeader titleId="nuevo-contacto" title={copy.contacts.new} onClose={() => navigate('/contactos')} />
        <DrawerBody>{form}</DrawerBody>
      </Drawer>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 py-6 md:px-8">
        <header>
          <h1 className="text-heading font-medium tracking-tight text-ink-900">{copy.contacts.new}</h1>
          <p className="mt-1 text-label text-text-secondary">Alta rápida. El correo crea la primera persona.</p>
        </header>
        {form}
      </div>
    </div>
  )
}
