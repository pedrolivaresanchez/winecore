import { useState } from 'react'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { Field } from '@/components/Field'
import { Button, Input, Select, useToast } from '@/ui'
import { createZone } from '@/pages/bodega-plano/api'
import type { ZoneKind } from '@/pages/bodega-plano/types'
import { zoneLabel } from '@/pages/bodega-plano/text'

const KINDS: ZoneKind[] = ['elaboration', 'barrel_room', 'outdoor', 'bottle_store', 'other']

const SUGGESTED: Record<ZoneKind, { code: string; name: string }> = {
  elaboration: { code: 'ELAB', name: 'Nave de elaboración' },
  barrel_room: { code: 'SALA', name: 'Sala de barricas' },
  outdoor: { code: 'EXT', name: 'Exterior' },
  bottle_store: { code: 'BOT', name: 'Almacén de botellas' },
  other: { code: 'ZONA', name: 'Zona' },
}

export function ZoneForm({
  locationId,
  preset,
  onCreated,
}: {
  locationId: string
  preset: ZoneKind | null
  onCreated: (kind: ZoneKind) => void
}) {
  const toast = useToast()
  const initial = preset ?? 'elaboration'
  const [kind, setKind] = useState<ZoneKind>(initial)
  const [code, setCode] = useState(SUGGESTED[initial].code)
  const [name, setName] = useState(SUGGESTED[initial].name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  function applyKind(next: ZoneKind) {
    const previous = SUGGESTED[kind]
    setKind(next)
    if (code === '' || code === previous.code) setCode(SUGGESTED[next].code)
    if (name === '' || name === previous.name) setName(SUGGESTED[next].name)
  }

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await createZone({ location_id: locationId, code: code.trim().toUpperCase(), name: name.trim(), kind })
      toast(copy.plano.zoneCreated)
      onCreated(kind)
    } catch (caught: unknown) {
      if (caught instanceof ApiError) setError(caught)
      else toast(copy.plano.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="grid w-full max-w-sm gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Field id="plano-zona-codigo" label={copy.plano.code} error={error?.fields?.code}>
        <Input
          id="plano-zona-codigo"
          value={code}
          maxLength={20}
          autoCapitalize="characters"
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          aria-invalid={error?.fields?.code ? true : undefined}
        />
      </Field>
      <Field id="plano-zona-nombre" label={copy.plano.name} error={error?.fields?.name}>
        <Input
          id="plano-zona-nombre"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error?.fields?.name ? true : undefined}
        />
      </Field>
      <Field id="plano-zona-tipo" label={copy.plano.kind} error={error?.fields?.kind}>
        <Select
          id="plano-zona-tipo"
          aria-label={copy.plano.kind}
          value={kind}
          onChange={(event) => applyKind(event.target.value as ZoneKind)}
        >
          {KINDS.map((item) => (
            <option key={item} value={item}>
              {zoneLabel(item)}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="primary" size="sm" loading={saving} disabled={code.trim().length < 2 || name.trim().length === 0}>
        {copy.plano.createZone}
      </Button>
    </form>
  )
}
