import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'

export type AvatarSize = '2xs' | 'xs' | 'sm' | 'md' | 'lg'

const BOX: Record<AvatarSize, string> = {
  '2xs': 'size-4 text-[9px]',
  xs: 'size-5 text-[10px]',
  sm: 'size-7 text-caption',
  md: 'size-8 text-label',
  lg: 'size-11 text-body',
}

/**
 * Tints for initials, keyed off the name so one person is one colour everywhere.
 *
 * Drawn from the status tokens rather than a fresh palette: they already flip correctly in
 * dark mode and they are already the app's colours, so an avatar column reads as tinted
 * rather than as a second design system that arrived with the CRM.
 */
const TINTS = [
  'bg-info-50 text-info-700',
  'bg-success-50 text-success-700',
  'bg-flame-50 text-flame-700',
  'bg-warning-50 text-warning-700',
  'bg-ink-100 text-ink-700',
] as const

function tintFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return TINTS[Math.abs(hash) % TINTS.length]
}

export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase()
}

/**
 * A person, at any size.
 *
 * Initials rather than a generic silhouette when there is no photo: a column of identical
 * grey heads is a column that costs space and says nothing, whereas two letters in a
 * consistent colour is something you learn to recognise inside a day.
 */
export function Avatar({
  name,
  src,
  size = 'sm',
  className,
}: {
  name: string
  src?: string | null
  size?: AvatarSize
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-full object-cover', BOX[size], className)}
      />
    )
  }

  return (
    <span
      aria-hidden
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium leading-none',
        BOX[size],
        tintFor(name),
        className,
      )}
    >
      {initialsFrom(name)}
    </span>
  )
}
