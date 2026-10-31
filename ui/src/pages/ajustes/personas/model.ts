import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { entityName, roleLabel } from '@/lib/labels'
import type { EntityCode } from '@/lib/types'
import type { BadgeTone } from '@/ui'

export const ROLE_CODES = ['owner', 'approver', 'admin', 'cellar', 'field', 'advisor'] as const

export type RoleCode = (typeof ROLE_CODES)[number]

export type UserRole = {
  role: string
  legal_entity_id: string | null
  legal_entity_code: string | null
}

export type DirectoryUser = {
  id: string
  display_name: string
  email: string
  roles: UserRole[]
  status: string
}

export type RoleDraft = {
  role: RoleCode
  legalEntityId: string
}

export type RoleBody = {
  role: RoleCode
  legal_entity_id: string | null
}

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/
const GENERIC_STEP_UP = 'Falta una verificación reforzada reciente'

export function statusMeta(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'active':
      return { label: copy.people.statuses.active, tone: 'success' }
    case 'invited':
      return { label: copy.people.statuses.invited, tone: 'info' }
    case 'suspended':
      return { label: copy.people.statuses.suspended, tone: 'warning' }
    case 'revoked':
      return { label: copy.people.statuses.revoked, tone: 'neutral' }
    default:
      return { label: status, tone: 'neutral' }
  }
}

export function roleChip(role: UserRole): string {
  const name = roleLabel(role.role)
  const entity = role.legal_entity_code ? entityName(role.legal_entity_code as EntityCode) : copy.entity.all
  return `${name} · ${entity}`
}

export function draftsOf(person: DirectoryUser): RoleDraft[] {
  const rows = person.roles.flatMap((role) => {
    if (!isRoleCode(role.role)) return []
    return [{ role: role.role, legalEntityId: role.legal_entity_id ?? '' }]
  })
  return rows.length > 0 ? rows : [{ role: 'cellar', legalEntityId: '' }]
}

export function bodiesOf(rows: readonly RoleDraft[]): RoleBody[] {
  return rows.map((row) => ({
    role: row.role,
    legal_entity_id: row.legalEntityId === '' ? null : row.legalEntityId,
  }))
}

export function rolesChanged(current: readonly UserRole[], next: readonly RoleBody[]): boolean {
  const have = new Set(current.map((role) => roleKey(role.role, role.legal_entity_id)))
  const wanted = new Set(next.map((role) => roleKey(role.role, role.legal_entity_id)))
  if (have.size !== wanted.size) return true
  for (const key of have) if (!wanted.has(key)) return true
  return false
}

export function grantsPrivileged(roles: readonly { role: string }[]): boolean {
  return roles.some((role) => role.role === 'owner' || role.role === 'admin')
}

export function validateInvite(input: { email: string; name: string; roles: readonly RoleDraft[] }): Record<string, string> {
  const fields: Record<string, string> = {}
  const email = input.email.trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 160) fields.email = copy.people.emailError
  const name = input.name.trim()
  if (name.length < 2 || name.length > 80) fields.display_name = copy.people.nameError
  const roles = roleProblem(input.roles)
  if (roles) fields.roles = roles
  return fields
}

export function validateRoles(rows: readonly RoleDraft[]): string | null {
  return roleProblem(rows)
}

export function passkeyRegistrationMessage(error: ApiError): string | null {
  if (error.code !== 'WC_STEP_UP_REQUIRED') return null
  if (error.fields?.passkey) return error.fields.passkey
  if (error.message && error.message !== GENERIC_STEP_UP) return error.message
  return null
}

export function isRoleCode(value: string): value is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(value)
}

function roleProblem(rows: readonly RoleDraft[]): string | null {
  if (rows.length < 1 || rows.length > 24) return copy.people.rolesError
  const seen = new Set<string>()
  for (const row of rows) {
    if (!isRoleCode(row.role)) return copy.people.rolesError
    const key = roleKey(row.role, row.legalEntityId === '' ? null : row.legalEntityId)
    if (seen.has(key)) return copy.people.duplicateRole
    seen.add(key)
  }
  return null
}

function roleKey(role: string, entityId: string | null): string {
  return `${role}|${entityId ?? ''}`
}
