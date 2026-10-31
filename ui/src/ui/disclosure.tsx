import {
  cloneElement,
  useId,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { cn } from '../lib/cn'
import { iconStroke } from '../lib/motion'
import { Badge, type BadgeTone } from './badge'
import { GlassMenu, type MenuPlacement } from './glass-menu'
import { ChevronRight, Info } from './icons'
import { Tooltip } from './tooltip'
import { useUiLabels } from './ui-labels'

/**
 * How a surface says less on its face and keeps the rest one gesture away.
 *
 * A screen that explains itself in sentences is read once and skimmed past forever after,
 * and the sentence is still there taking the room of the thing the rep came to change. These
 * four put the explanation behind a hover, a click or a fold instead, and every one of them
 * is reachable without a mouse: what a pointer gets on hover, a keyboard gets on focus and a
 * finger gets on tap. Nothing a person needs to decide is hidden by them — it is moved.
 *
 * - `InfoTip`: an «i» beside a title. Hover or focus shows the help; a click or a tap pins it.
 * - `WhyPopover`: a quiet «¿Por qué?» that opens the rationale for a state or a proposal.
 * - `Reveal`: one line of summary that unfolds into the detail (the accordion recipe).
 * - `StatusChip`: state as a chip, with the reasons on hover instead of in a sentence.
 */

const HINT_PANEL = 'w-max max-w-80 p-3 text-label text-text-secondary'
const HINT_CARD = 'max-w-80 p-2.5 text-text-secondary'

/** A control the hint can toggle, and that the tooltip can listen to. */
type HintTrigger = ReactElement<{
  onClick?: (event: MouseEvent<HTMLElement>) => void
  onMouseEnter?: (event: never) => void
}>

/**
 * A trigger that peeks on hover and pins on click.
 *
 * The peek is the tooltip recipe — it cannot be clicked into, which is what a peek is for.
 * The pin is the same content in a popover, which can hold a link or be selected, and is how
 * touch reaches it at all. The peek steps aside while the pin is open so the two never stack.
 */
function PinnedHint({
  content,
  label,
  placement,
  className,
  children,
}: {
  content: ReactNode
  /** Accessible name of the trigger; shown as the peek when the content is not plain text. */
  label: string
  placement: MenuPlacement
  className?: string
  children: HintTrigger
}) {
  const [open, setOpen] = useState(false)
  const plain = typeof content === 'string'
  const trigger = cloneElement(children, {
    'aria-haspopup': 'dialog',
    onClick: (event: MouseEvent<HTMLElement>) => {
      children.props.onClick?.(event)
      setOpen((current) => !current)
    },
  } as Partial<typeof children.props>)

  return (
    <GlassMenu
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      fitTrigger={false}
      role="dialog"
      className={cn('inline-flex align-middle', className)}
      panelClassName={HINT_PANEL}
      trigger={
        <Tooltip
          label={plain ? content : label}
          content={plain ? undefined : content}
          placement={placement.startsWith('top') ? 'top' : 'bottom'}
          disabled={open}
          className={plain ? 'max-w-72' : HINT_CARD}
        >
          {trigger}
        </Tooltip>
      }
    >
      <div className="text-pretty">{content}</div>
    </GlassMenu>
  )
}

/**
 * The «i» beside a title that holds what the title means, why, and what happens next.
 *
 * Plain text peeks as the ink tooltip; anything richer as the small card. Either way a click
 * or a tap pins it in a popover, so a link inside it can be followed.
 */
export function InfoTip({
  children,
  label,
  placement = 'bottom-start',
  className,
}: {
  /** The help itself. Plain text when it can be; a short list or a link when it must. */
  children: ReactNode
  /** What the «i» is about, for a screen reader. Defaults to «Más información». */
  label?: string
  placement?: MenuPlacement
  className?: string
}) {
  const labels = useUiLabels()
  const name = label ?? labels.moreInfo
  return (
    <PinnedHint content={children} label={name} placement={placement} className={className}>
      <button
        type="button"
        aria-label={name}
        className={cn(
          'relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-icon-muted outline-none',
          /* 16px drawn, 24px reachable. */
          'before:absolute before:-inset-1 before:content-[""]',
          'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
          'hover:text-ink-900 focus-visible:text-ink-900 focus-visible:shadow-(--shadow-focus) aria-expanded:text-ink-900',
        )}
      >
        <Info className="size-3.5" strokeWidth={iconStroke} aria-hidden />
      </button>
    </PinnedHint>
  )
}

/**
 * The rationale behind a state or a proposal, one click away.
 *
 * Quiet by default — caption weight, tertiary ink — because it is the answer to a question
 * only some people ask. Bring a `trigger` (a chip, a status) when the thing being explained
 * is itself the natural place to click.
 */
export function WhyPopover({
  children,
  title,
  actions,
  trigger,
  label,
  placement = 'bottom-start',
  className,
}: {
  /** The reasoning. A sentence or two, or a short list. */
  children: ReactNode
  /** One line naming what is being explained, set above the reasoning. */
  title?: ReactNode
  /** The one thing to do about it, under the reasoning — «Reprocesar», «Abrir el deal». */
  actions?: ReactNode
  /** Replaces the «¿Por qué?» text button. Must be a single focusable element. */
  trigger?: HintTrigger
  /** Overrides the words on the default trigger. */
  label?: string
  placement?: MenuPlacement
  className?: string
}) {
  const labels = useUiLabels()
  const [open, setOpen] = useState(false)
  const own = trigger ?? (
    <button
      type="button"
      className={cn(
        'inline-flex h-6 items-center rounded-md px-1.5 text-caption text-text-tertiary outline-none',
        'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
        'hover:bg-fill-hover hover:text-ink-900 focus-visible:shadow-(--shadow-focus) aria-expanded:bg-fill-hover aria-expanded:text-ink-900',
      )}
    >
      {label ?? labels.why}
    </button>
  )
  const control = cloneElement(own, {
    'aria-haspopup': 'dialog',
    onClick: (event: MouseEvent<HTMLElement>) => {
      own.props.onClick?.(event)
      setOpen((current) => !current)
    },
  } as Partial<typeof own.props>)

  return (
    <GlassMenu
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      fitTrigger={false}
      role="dialog"
      className={cn('inline-flex align-middle', className)}
      panelClassName={HINT_PANEL}
      trigger={control}
    >
      <div className="flex flex-col gap-2 text-pretty">
        {title ? <p className="font-medium text-ink-900">{title}</p> : null}
        <div>{children}</div>
        {actions ? <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div> : null}
      </div>
    </GlassMenu>
  )
}

/**
 * One line of summary that unfolds into the detail.
 *
 * For reasoning, history and fine print that matter to somebody checking but not to somebody
 * acting: the summary says enough to decide whether to open it. Height is the accordion recipe
 * (`.t-acc-panel`, 250ms symmetric); the body stays mounted so the close can play, and inert
 * while shut so a keyboard does not tab into text nobody can see.
 */
export function Reveal({
  summary,
  children,
  defaultOpen = false,
  className,
  bodyClassName,
}: {
  /** One line. Truncates rather than wrapping — a second line is what the fold is for. */
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  bodyClassName?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'group -mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-label text-text-secondary outline-none',
          'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
          'hover:text-ink-900 focus-visible:shadow-(--shadow-focus)',
        )}
      >
        <ChevronRight
          strokeWidth={iconStroke}
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-icon-muted group-hover:text-ink-900',
            'transition-transform duration-(--acc-chevron) ease-(--acc-ease) motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </button>
      <div id={bodyId} className="t-acc-panel" data-open={open ? 'true' : 'false'} inert={!open}>
        <div className="t-acc-panel-inner">
          <div className={cn('pt-1.5 pl-5 text-label text-text-secondary', bodyClassName)}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * State as a chip, not a sentence — «Sin cambios», «Ya agendada · 30 oct», «2 deals».
 *
 * With a `detail`, the chip is a control: hover or focus lists the reasons, a click or a tap
 * pins them, and a small «i» inside the chip says there is something to read. Without one it
 * is the plain `Badge`.
 */
export function StatusChip({
  tone = 'neutral',
  dot = false,
  detail,
  placement = 'bottom-start',
  className,
  children,
}: {
  tone?: BadgeTone
  dot?: boolean
  /** The reasons behind the state. Plain text or a short list. */
  detail?: ReactNode
  placement?: MenuPlacement
  className?: string
  children: ReactNode
}) {
  const labels = useUiLabels()
  if (detail == null || detail === false) {
    return (
      <Badge tone={tone} dot={dot} className={className}>
        {children}
      </Badge>
    )
  }
  return (
    <PinnedHint
      content={detail}
      label={typeof children === 'string' ? children : labels.moreInfo}
      placement={placement}
      className={className}
    >
      <button
        type="button"
        className="inline-flex rounded-full outline-none focus-visible:shadow-(--shadow-focus)"
      >
        <Badge tone={tone} dot={dot} className="cursor-default">
          {children}
          <Info className="-mr-0.5 size-3 shrink-0 opacity-70" strokeWidth={iconStroke} aria-hidden />
        </Badge>
      </button>
    </PinnedHint>
  )
}
