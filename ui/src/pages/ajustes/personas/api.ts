import { api } from '@/lib/api'
import type { DirectoryUser, RoleBody } from '@/pages/ajustes/personas/model'

export function listUsers(signal?: AbortSignal) {
  return api<{ items: DirectoryUser[] }>('/v1/users', { signal })
}

export function inviteUser(input: { email: string; display_name: string; roles: RoleBody[] }) {
  return api<DirectoryUser>('/v1/users', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      display_name: input.display_name.trim(),
      roles: input.roles,
    }),
  })
}

export function patchUser(id: string, body: { roles?: RoleBody[]; status?: 'active' | 'suspended' }) {
  return api<DirectoryUser>(`/v1/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
