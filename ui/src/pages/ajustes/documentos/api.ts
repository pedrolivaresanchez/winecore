import { api, apiBlob } from '@/lib/api'

export type DocumentVariant = 'po' | 'cvpo'

export const VARIANTS: DocumentVariant[] = ['po', 'cvpo']

export type SampleKind = 'invoice' | 'discount' | 'corrective' | 'withholding' | 'multipage' | 'quote' | 'order' | 'delivery_note'

export const SAMPLE_KINDS: SampleKind[] = ['invoice', 'discount', 'corrective', 'withholding', 'multipage', 'quote', 'order', 'delivery_note']

export type SampleLang = 'es' | 'en'

export type DocumentLogo = {
  attachment_id: string
  filename: string
  mime_type: string
  size_bytes: number
}

export type DocumentProfile = {
  legal_entity_code: string
  variants: DocumentVariant[]
  variant: DocumentVariant
  email: string | null
  phone: string | null
  website: string | null
  footer_lines: string[]
  logo: DocumentLogo | null
  configured: boolean
  updated_at: string | null
}

/** What the form edits. The logo is not part of it: it is stored the moment it is chosen. */
export type ProfileDraft = {
  variant: DocumentVariant
  email: string
  phone: string
  website: string
  footer: string
}

export const MAX_LOGO_BYTES = 2 * 1024 * 1024
export const LOGO_TYPES = ['image/png', 'image/jpeg']
export const MAX_FOOTER_LINES = 12
export const MAX_FOOTER_LINE = 200

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export function draftOf(profile: DocumentProfile): ProfileDraft {
  return {
    variant: profile.variant,
    email: profile.email ?? '',
    phone: profile.phone ?? '',
    website: profile.website ?? '',
    footer: profile.footer_lines.join('\n'),
  }
}

export function footerLinesOf(footer: string): string[] {
  return footer.split(/\r?\n/u).map((line) => line.trim())
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function profileBody(draft: ProfileDraft) {
  return {
    variant: draft.variant,
    email: textOrNull(draft.email),
    phone: textOrNull(draft.phone),
    website: textOrNull(draft.website),
    footer_lines: footerLinesOf(draft.footer),
  }
}

export function sameDraft(a: ProfileDraft, b: ProfileDraft): boolean {
  return JSON.stringify(profileBody(a)) === JSON.stringify(profileBody(b))
}

export type DraftProblems = Partial<Record<'email' | 'footer', string>>

/** The same limits as the API, so the sample is not asked for with data it will refuse. */
export function draftProblems(draft: ProfileDraft, messages: { email: string; lines: string; line: string }): DraftProblems {
  const problems: DraftProblems = {}
  const email = draft.email.trim()
  if (email !== '' && !EMAIL.test(email)) problems.email = messages.email
  const lines = footerLinesOf(draft.footer)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  while (lines.length > 0 && lines[0] === '') lines.shift()
  if (lines.length > MAX_FOOTER_LINES) problems.footer = messages.lines
  else if (lines.some((line) => line.length > MAX_FOOTER_LINE)) problems.footer = messages.line
  return problems
}

const path = (code: string) => `/v1/legal-entities/${encodeURIComponent(code)}/document-profile`

export function getProfile(code: string, signal?: AbortSignal): Promise<DocumentProfile> {
  return api<DocumentProfile>(path(code), { signal })
}

export function saveProfile(code: string, draft: ProfileDraft): Promise<DocumentProfile> {
  return api<DocumentProfile>(path(code), { method: 'PUT', body: JSON.stringify(profileBody(draft)) })
}

export function uploadLogo(code: string, file: File): Promise<DocumentProfile> {
  const form = new FormData()
  form.set('file', file)
  return api<DocumentProfile>(`${path(code)}/logo`, { method: 'PUT', body: form })
}

export function removeLogo(code: string): Promise<DocumentProfile> {
  return api<DocumentProfile>(`${path(code)}/logo`, { method: 'DELETE' })
}

export async function logoBlob(code: string, signal?: AbortSignal): Promise<Blob> {
  const { blob } = await apiBlob(`${path(code)}/logo`, { headers: { Accept: '*/*' }, signal })
  return blob
}

export async function sampleBlob(
  code: string,
  options: { kind: SampleKind; lang: SampleLang; profile: Record<string, unknown> },
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string | null }> {
  return apiBlob(`${path(code)}/sample`, {
    method: 'POST',
    headers: { Accept: 'application/pdf' },
    body: JSON.stringify({ kind: options.kind, lang: options.lang, ...options.profile }),
    signal,
  })
}
