import { cn } from '@/lib/cn'
import type { IconComponent } from '@/ui/icons'

export type GlyphTint = 'info' | 'cyan' | 'pink' | 'success' | 'flame' | 'warning' | 'purple' | 'sky' | 'mint' | 'red' | 'violet' | 'slate'

const TINT: Record<GlyphTint, string> = {
  info: 'bg-glyph-azure text-glyph-azure-fg',
  cyan: 'bg-glyph-cyan text-glyph-cyan-fg',
  pink: 'bg-glyph-pink text-glyph-pink-fg',
  success: 'bg-glyph-lime text-glyph-lime-fg',
  flame: 'bg-glyph-flame text-glyph-flame-fg',
  warning: 'bg-glyph-gold text-glyph-gold-fg',
  purple: 'bg-glyph-purple text-glyph-purple-fg',
  sky: 'bg-glyph-sky text-glyph-sky-fg',
  mint: 'bg-glyph-mint text-glyph-mint-fg',
  red: 'bg-glyph-red text-glyph-red-fg',
  violet: 'bg-glyph-violet text-glyph-violet-fg',
  slate: 'bg-glyph-slate text-glyph-slate-fg',
}

/** SDR's object glyph: a solid tinted square (16 or 20px) holding the object's icon at stroke 2. */
export function ObjectGlyph({ icon: Icon, tint = 'info', size = 'sm', className }: { icon: IconComponent; tint?: GlyphTint; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-xs', size === 'md' ? 'size-5' : 'size-4', TINT[tint], className)}>
      <Icon className={size === 'md' ? 'size-2.5' : 'size-2'} strokeWidth={2} />
    </span>
  )
}
