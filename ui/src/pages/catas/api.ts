import { isAuthEnabled } from '@/auth/config'
import { getAccessToken } from '@/auth/tokens'
import { ApiError, api } from '@/lib/api'
import { copy } from '@/i18n'
import type { Wine } from '@/pages/catalogo/model'
import type { LotListItem, Page } from '@/lib/cellar'
import type {
  Descriptor,
  EvolutionView,
  Note,
  NoteDraft,
  NotePatch,
  Selection,
  Session,
  Template,
} from '@/pages/catas/types'

export function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : copy.error.load
}

function root(): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  return (configured && configured.length > 0 ? configured : '/api').replace(/\/$/, '')
}

export function listTemplates(signal?: AbortSignal) {
  return api<{ items: Template[] }>('/v1/tasting-templates', { signal })
}

export function listDescriptors(signal?: AbortSignal) {
  return api<{ items: Descriptor[] }>('/v1/tasting-descriptors', { signal })
}

export function listWines(signal?: AbortSignal) {
  return api<{ items: Wine[] }>('/v1/wines?limit=100', { signal })
}

export function listLotPage(signal?: AbortSignal) {
  return api<Page<LotListItem>>('/v1/lots?limit=100', { signal })
}

export type NoteQuery = {
  template_code?: string
  lot_id?: string
  wine_id?: string
  from?: string
  to?: string
}

export function listNotes(query: NoteQuery, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (query.template_code) params.set('template_code', query.template_code)
  if (query.lot_id) params.set('lot_id', query.lot_id)
  if (query.wine_id) params.set('wine_id', query.wine_id)
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  params.set('limit', '200')
  return api<{ items: Note[] }>(`/v1/tasting-notes?${params}`, { signal })
}

export function getNote(id: string, signal?: AbortSignal) {
  return api<Note>(`/v1/tasting-notes/${encodeURIComponent(id)}`, { signal })
}

export function createNote(draft: NoteDraft) {
  return api<Note>('/v1/tasting-notes', { method: 'POST', body: JSON.stringify(draft) })
}

export function patchNote(id: string, patch: NotePatch) {
  return api<Note>(`/v1/tasting-notes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function uploadNoteFile(noteId: string, file: File, role: 'photo' | 'other') {
  const body = new FormData()
  body.set('file', file)
  body.set('table', 'tasting.note')
  body.set('row_id', noteId)
  body.set('role', role)
  return api<{ id: string }>('/v1/attachments', { method: 'POST', body })
}

export async function attachmentObjectUrl(id: string): Promise<{ url: string; mime: string } | null> {
  const headers = new Headers({ Accept: '*/*' })
  if (isAuthEnabled) {
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(`${root()}/v1/attachments/${encodeURIComponent(id)}`, { headers, cache: 'no-store' })
  if (!response.ok) return null
  const blob = await response.blob()
  return { url: URL.createObjectURL(blob), mime: response.headers.get('content-type') ?? blob.type }
}

export function listSessions(signal?: AbortSignal) {
  return api<{ items: Session[] }>('/v1/tasting-sessions', { signal })
}

export function createSession(body: { title: string; target: string; started_on: string; days: number; notes?: string }) {
  return api<Session>('/v1/tasting-sessions', { method: 'POST', body: JSON.stringify(body) })
}

export function getSession(id: string, signal?: AbortSignal) {
  return api<Session>(`/v1/tasting-sessions/${encodeURIComponent(id)}`, { signal })
}

export function addSample(id: string, lotId: string) {
  return api<{ sample_no: number }>(`/v1/tasting-sessions/${encodeURIComponent(id)}/samples`, {
    method: 'POST',
    body: JSON.stringify({ lot_id: lotId }),
  })
}

export function castVote(
  id: string,
  body: { sample_no: number; day_no: number; vote: 'yes' | 'no'; taster_name: string; score?: number | null; comment?: string },
) {
  return api<{ vote_id: string; updated: boolean }>(`/v1/tasting-sessions/${encodeURIComponent(id)}/votes`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function revealSession(id: string) {
  return api<Session>(`/v1/tasting-sessions/${encodeURIComponent(id)}/reveal`, { method: 'POST' })
}

export function setSelection(id: string, lotIds: string[]) {
  return api<Selection>(`/v1/tasting-sessions/${encodeURIComponent(id)}/selection`, {
    method: 'PATCH',
    body: JSON.stringify({ lot_ids: lotIds }),
  })
}

export function getEvolution(query: { lot_id?: string; wine_id?: string }, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (query.lot_id) params.set('lot_id', query.lot_id)
  if (query.wine_id) params.set('wine_id', query.wine_id)
  return api<EvolutionView>(`/v1/tasting-evolution?${params}`, { signal })
}
