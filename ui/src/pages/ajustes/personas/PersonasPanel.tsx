import { useEffect, useState } from 'react'
import { MoreVertical, X } from '@/ui/icons'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import { entityName, roleLabel } from '@/lib/labels'
import { iconStroke } from '@/lib/motion'
import type { EntityCode, Me } from '@/lib/types'
import { isOwner } from '@/pages/aprobaciones/model'
import { StepUpDialog } from '@/pages/aprobaciones/StepUpDialog'
import { inviteUser, patchUser } from '@/pages/ajustes/personas/api'
import {
  ROLE_CODES,
  bodiesOf,
  draftsOf,
  passkeyRegistrationMessage,
  roleChip,
  rolesChanged,
  statusMeta,
  validateInvite,
  validateRoles,
  type DirectoryUser,
  type RoleBody,
  type RoleDraft,
} from '@/pages/ajustes/personas/model'
import { openSettings } from '@/pages/ajustes/seguridad/open-settings'
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  GlassMenu,
  Input,
  MenuItem,
  Select,
  Skeleton,
  useMenuOpen,
  useToast,
} from '@/ui'

type Job =
  | { kind: 'invite'; email: string; name: string; roles: RoleBody[] }
  | { kind: 'roles'; id: string; roles: RoleBody[] }
  | { kind: 'status'; id: string; status: 'active' | 'suspended'; name: string }

type Mode =
  | { kind: 'closed' }
  | { kind: 'invite' }
  | { kind: 'roles'; person: DirectoryUser }
  | { kind: 'status'; person: DirectoryUser; next: 'active' | 'suspended' }

function canSeeDirectory(me: Me): boolean {
  return me.roles.some((role) => role.role === 'owner' || role.role === 'admin')
}

export function PersonasPanel({ me }: { me: Me }) {
  const toast = useToast()
  const owner = isOwner(me)
  const people = useApi<{ items: DirectoryUser[] }>(canSeeDirectory(me) ? '/v1/users' : null)
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [step, setStep] = useState<Job | null>(null)
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!canSeeDirectory(me)) return <NoPermission />

  const items = people.data?.items ?? []

  async function run(job: Job): Promise<'ok' | 'step'> {
    setBusy(true)
    setPasskeyMessage(null)
    try {
      if (job.kind === 'invite') {
        await inviteUser({ email: job.email, display_name: job.name, roles: job.roles })
        toast(copy.people.invited, { tone: 'success' })
      } else if (job.kind === 'roles') {
        await patchUser(job.id, { roles: job.roles })
        toast(copy.people.saved, { tone: 'success' })
      } else {
        await patchUser(job.id, { status: job.status })
        toast(job.status === 'suspended' ? copy.people.deactivated : copy.people.reactivated, { tone: 'success' })
      }
      setMode({ kind: 'closed' })
      setStep(null)
      people.reload()
      return 'ok'
    } catch (error: unknown) {
      const note = error instanceof ApiError ? passkeyRegistrationMessage(error) : null
      if (note) {
        setPasskeyMessage(note)
        setStep(null)
        return 'ok'
      }
      if (error instanceof ApiError && error.code === 'WC_STEP_UP_REQUIRED') return 'step'
      throw error
    } finally {
      setBusy(false)
    }
  }

  async function commit(job: Job): Promise<string | null> {
    try {
      const outcome = await run(job)
      if (outcome === 'step') setStep(job)
      else setNotice(null)
      return null
    } catch (error: unknown) {
      setStep(null)
      const message = failureText(error).banner
      setNotice(message)
      return message
    }
  }

  const stepPhrase =
    step?.kind === 'status' ? copy.people.stepOff : step?.kind === 'invite' ? copy.people.stepGrant : copy.people.stepRoles

  return (
    <div data-screen="personas" className="flex flex-col gap-4">
      {owner ? (
        <div className="flex justify-end">
          <Button type="button" variant="primary" size="sm" onClick={() => { setPasskeyMessage(null); setNotice(null); setMode({ kind: 'invite' }) }}>
            {copy.people.invite}
          </Button>
        </div>
      ) : null}
      {people.loading && !people.data ? (
        <div aria-busy="true" className="grid gap-2">
          <p className="sr-only">{copy.loading}</p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {people.error ? (
        <div className="grid gap-3">
          <Alert tone="danger">{`${copy.error.load} (${people.error.code})`}</Alert>
          <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={people.reload}>
            {copy.error.retry}
          </Button>
        </div>
      ) : null}
      {people.data && items.length === 0 ? (
        <EmptyState size="sm" title={copy.people.empty} description={copy.people.emptyHint} />
      ) : null}
      {items.length > 0 ? (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
          {items.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              owner={owner}
              onRoles={() => { setPasskeyMessage(null); setNotice(null); setMode({ kind: 'roles', person }) }}
              onStatus={(next) => { setPasskeyMessage(null); setNotice(null); setMode({ kind: 'status', person, next }) }}
            />
          ))}
        </ul>
      ) : null}

      <InviteDialog
        open={mode.kind === 'invite'}
        me={me}
        busy={busy}
        passkeyMessage={mode.kind === 'invite' ? passkeyMessage : null}
        notice={mode.kind === 'invite' ? notice : null}
        onClose={() => { if (!busy) { setMode({ kind: 'closed' }); setPasskeyMessage(null); setNotice(null) } }}
        onSubmit={(email, name, roles) => commit({ kind: 'invite', email, name, roles })}
      />
      <RolesDialog
        person={mode.kind === 'roles' ? mode.person : null}
        me={me}
        busy={busy}
        passkeyMessage={mode.kind === 'roles' ? passkeyMessage : null}
        notice={mode.kind === 'roles' ? notice : null}
        onClose={() => { if (!busy) { setMode({ kind: 'closed' }); setPasskeyMessage(null); setNotice(null) } }}
        onSubmit={(id, roles) => commit({ kind: 'roles', id, roles })}
      />
      <StatusDialog
        person={mode.kind === 'status' ? mode.person : null}
        next={mode.kind === 'status' ? mode.next : 'suspended'}
        busy={busy}
        passkeyMessage={mode.kind === 'status' ? passkeyMessage : null}
        notice={mode.kind === 'status' ? notice : null}
        onClose={() => { if (!busy) { setMode({ kind: 'closed' }); setPasskeyMessage(null); setNotice(null) } }}
        onSubmit={(person, next) => commit({ kind: 'status', id: person.id, status: next, name: person.display_name })}
      />
      <StepUpDialog
        open={step !== null}
        description={stepPhrase}
        passkeyOnly
        screen="personas-verificacion"
        onClose={() => { if (!busy) setStep(null) }}
        onVerified={() => {
          if (step) void commit(step)
        }}
      />
    </div>
  )
}

function PersonRow({
  person,
  owner,
  onRoles,
  onStatus,
}: {
  person: DirectoryUser
  owner: boolean
  onRoles: () => void
  onStatus: (next: 'active' | 'suspended') => void
}) {
  const menu = useMenuOpen()
  const meta = statusMeta(person.status)
  const off = person.status === 'suspended' || person.status === 'revoked'
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-label font-medium break-words text-ink-900">{person.display_name}</p>
            <Badge size="sm" tone={meta.tone} dot>
              {meta.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-caption break-all text-text-tertiary">{person.email}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {person.roles.map((role) => (
              <Badge key={`${role.role}-${role.legal_entity_id ?? 'all'}`} size="sm" tone="neutral">
                {roleChip(role)}
              </Badge>
            ))}
          </div>
        </div>
        {owner ? (
          <GlassMenu
            open={menu.open}
            onOpenChange={menu.setOpen}
            placement="bottom-end"
            trigger={
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.people.more} onClick={menu.toggle}>
                <MoreVertical strokeWidth={iconStroke} />
              </Button>
            }
          >
            <MenuItem onClick={() => { menu.close(); onRoles() }}>{copy.people.editRoles}</MenuItem>
            <MenuItem
              tone={off ? 'default' : 'danger'}
              onClick={() => { menu.close(); onStatus(off ? 'active' : 'suspended') }}
            >
              {off ? copy.people.reactivate : copy.people.deactivate}
            </MenuItem>
          </GlassMenu>
        ) : null}
      </div>
    </li>
  )
}

function RoleFields({
  me,
  rows,
  error,
  onChange,
}: {
  me: Me
  rows: RoleDraft[]
  error?: string
  onChange: (rows: RoleDraft[]) => void
}) {
  function update(index: number, patch: Partial<RoleDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  return (
    <fieldset className="grid gap-2">
      <legend className="text-label font-medium text-ink-900">{copy.people.roles}</legend>
      <ul className="grid gap-2">
        {rows.map((row, index) => (
          <li key={`${index}-${row.role}`} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Select className="w-full min-w-0" aria-label={copy.people.role} value={row.role} onChange={(event) => update(index, { role: event.target.value as RoleDraft['role'] })}>
              {ROLE_CODES.map((code) => (
                <option key={code} value={code}>{roleLabel(code)}</option>
              ))}
            </Select>
            <Select className="w-full min-w-0" aria-label={copy.people.entity} value={row.legalEntityId} onChange={(event) => update(index, { legalEntityId: event.target.value })}>
              <option value="">{copy.entity.all}</option>
              {me.entities.map((entity) => (
                <option key={entity.id} value={entity.id}>{entityName(entity.code as EntityCode)}</option>
              ))}
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={copy.people.removeRole}
              disabled={rows.length === 1}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <X strokeWidth={iconStroke} />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...rows, { role: 'cellar', legalEntityId: me.entities[0]?.id ?? '' }])}
      >
        {copy.people.addRole}
      </Button>
      {error ? <p role="alert" className="text-caption text-danger-600">{error}</p> : null}
    </fieldset>
  )
}

function PasskeyNote({ message }: { message: string }) {
  const marker = 'Ajustes > Seguridad'
  const index = message.indexOf(marker)
  return (
    <div role="alert" className="rounded-2xl bg-danger-50 px-3 py-2 text-label text-danger-700">
      {index < 0 ? message : message.slice(0, index)}
      <button type="button" className="underline" onClick={() => openSettings('security')}>
        {index < 0 ? copy.settings.security : marker}
      </button>
      {index < 0 ? null : message.slice(index + marker.length)}
    </div>
  )
}

function failureText(error: unknown): { banner: string; fields: Record<string, string> } {
  if (!(error instanceof ApiError)) return { banner: copy.people.saveFail, fields: {} }
  return { banner: error.message, fields: error.fields ?? {} }
}

function InviteDialog({
  open,
  me,
  busy,
  passkeyMessage,
  notice,
  onClose,
  onSubmit,
}: {
  open: boolean
  me: Me
  busy: boolean
  passkeyMessage: string | null
  notice: string | null
  onClose: () => void
  onSubmit: (email: string, name: string, roles: RoleBody[]) => Promise<string | null>
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [rows, setRows] = useState<RoleDraft[]>([{ role: 'cellar', legalEntityId: '' }])
  const [fields, setFields] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setEmail('')
    setName('')
    setRows([{ role: 'cellar', legalEntityId: '' }])
    setFields({})
    setBanner(null)
  }, [open])

  function close() {
    if (busy) return
    setEmail('')
    setName('')
    setRows([{ role: 'cellar', legalEntityId: '' }])
    setFields({})
    setBanner(null)
    onClose()
  }

  async function submit() {
    const problems = validateInvite({ email, name, roles: rows })
    setFields(problems)
    setBanner(null)
    if (Object.keys(problems).length > 0) return
    const message = await onSubmit(email, name, bodiesOf(rows))
    if (message) setBanner(message)
  }

  return (
    <Dialog open={open} onClose={close} size="lg" labelledBy="invitar-persona">
      <DialogHeader title={copy.people.invite} titleId="invitar-persona" onClose={close} />
      <DialogBody>
        <form
          id="invitar-persona-form"
          data-screen="personas-invitar"
          className="grid gap-4"
          onSubmit={(event) => { event.preventDefault(); void submit() }}
        >
          {passkeyMessage ? <PasskeyNote message={passkeyMessage} /> : null}
          {banner || notice ? <Alert tone="danger">{banner ?? notice}</Alert> : null}
          <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="persona-correo">
            {copy.people.email}
            <Input id="persona-correo" type="email" autoComplete="off" value={email} invalid={Boolean(fields.email)} onChange={(event) => setEmail(event.target.value)} />
            {fields.email ? <span role="alert" className="text-caption font-normal text-danger-600">{fields.email}</span> : null}
          </label>
          <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="persona-nombre">
            {copy.people.name}
            <Input id="persona-nombre" value={name} maxLength={80} invalid={Boolean(fields.display_name)} onChange={(event) => setName(event.target.value)} />
            {fields.display_name ? <span role="alert" className="text-caption font-normal text-danger-600">{fields.display_name}</span> : null}
          </label>
          <RoleFields me={me} rows={rows} error={fields.roles} onChange={setRows} />
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={close}>{copy.people.cancel}</Button>
        <Button type="submit" form="invitar-persona-form" size="sm" loading={busy}>{busy ? copy.people.inviting : copy.people.invite}</Button>
      </DialogFooter>
    </Dialog>
  )
}

function RolesDialog({
  person,
  me,
  busy,
  passkeyMessage,
  notice,
  onClose,
  onSubmit,
}: {
  person: DirectoryUser | null
  me: Me
  busy: boolean
  passkeyMessage: string | null
  notice: string | null
  onClose: () => void
  onSubmit: (id: string, roles: RoleBody[]) => Promise<string | null>
}) {
  const [rows, setRows] = useState<RoleDraft[]>([{ role: 'cellar', legalEntityId: '' }])
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    if (!person) return
    setRows(draftsOf(person))
    setError(null)
    setBanner(null)
  }, [person])

  async function submit() {
    if (!person) return
    const problem = validateRoles(rows)
    setError(problem)
    setBanner(null)
    if (problem) return
    const roles = bodiesOf(rows)
    if (!rolesChanged(person.roles, roles)) {
      onClose()
      return
    }
    const message = await onSubmit(person.id, roles)
    if (message) setBanner(message)
  }

  return (
    <Dialog open={person !== null} onClose={onClose} size="lg" labelledBy="roles-persona">
      <DialogHeader title={copy.people.editRoles} titleId="roles-persona" description={person?.display_name} onClose={onClose} />
      <DialogBody>
        <form
          id="roles-persona-form"
          data-screen="personas-roles"
          className="grid gap-4"
          onSubmit={(event) => { event.preventDefault(); void submit() }}
        >
          {passkeyMessage ? <PasskeyNote message={passkeyMessage} /> : null}
          {banner || notice ? <Alert tone="danger">{banner ?? notice}</Alert> : null}
          <RoleFields me={me} rows={rows} error={error ?? undefined} onChange={setRows} />
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onClose}>{copy.people.cancel}</Button>
        <Button type="submit" form="roles-persona-form" size="sm" loading={busy}>{busy ? copy.people.saving : copy.people.save}</Button>
      </DialogFooter>
    </Dialog>
  )
}

function StatusDialog({
  person,
  next,
  busy,
  passkeyMessage,
  notice,
  onClose,
  onSubmit,
}: {
  person: DirectoryUser | null
  next: 'active' | 'suspended'
  busy: boolean
  passkeyMessage: string | null
  notice: string | null
  onClose: () => void
  onSubmit: (person: DirectoryUser, next: 'active' | 'suspended') => Promise<string | null>
}) {
  const [banner, setBanner] = useState<string | null>(null)
  const off = next === 'suspended'
  return (
    <Dialog open={person !== null} onClose={onClose} size="sm" labelledBy="estado-persona">
      <DialogHeader
        title={off ? copy.people.deactivateTitle : copy.people.reactivateTitle}
        titleId="estado-persona"
        description={person ? fill(off ? copy.people.deactivateBody : copy.people.reactivateBody, { name: person.display_name }) : undefined}
        onClose={onClose}
      />
      <DialogBody>
        {passkeyMessage ? <PasskeyNote message={passkeyMessage} /> : null}
        {banner || notice ? <Alert tone="danger">{banner ?? notice}</Alert> : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onClose}>{copy.people.cancel}</Button>
        <Button
          type="button"
          variant={off ? 'danger' : 'primary'}
          size="sm"
          loading={busy}
          onClick={() => {
            if (!person) return
            setBanner(null)
            void onSubmit(person, next).then((message) => { if (message) setBanner(message) })
          }}
        >
          {off ? copy.people.deactivate : copy.people.reactivate}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
