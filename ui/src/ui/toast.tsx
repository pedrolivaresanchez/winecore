import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Toaster, toast as sonnerToast } from 'sonner'
import {
  AlertCircle,
  Check,
  MessageSquare,
  RefreshCw,
  TriangleAlert,
  X,
} from './icons'
import { cn } from '../lib/cn'
import { isModifiedClick } from '../lib/click'
import { usePortalDocument } from './portal-document'

export const TOAST_DURATION_MS = 5500

const TOAST_WIDTH = '404px'

/** `pending` is a request still on the wire; it is meant to be replaced (see `id`). */
export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'pending'

export interface ToastOptions {
  tone?: ToastTone
  description?: string
  /** ms before auto-dismiss. `Infinity` leaves the toast up until it is dismissed or replaced. */
  duration?: number
  /**
   * A stable id makes a later call with the same id *update* the toast in place instead of
   * stacking a second one — how "Sending…" becomes "Sent" without two toasts on screen.
   */
  id?: string | number
  /**
   * Where this toast leads. The whole copy block becomes the control.
   *
   * A real URL rather than a handler alone, so the row behaves like every other name in
   * the product: Cmd/Ctrl-click and middle-click open a tab, and the status bar says
   * where the click goes before it is made. `onNavigate` is how the app keeps a plain
   * click inside the SPA — this file cannot know about a router.
   */
  href?: string
  onNavigate?: () => void
  /**
   * One verb, for a toast that reports something the reader can still do about it.
   *
   * The surface has always drawn this slot; only the public function was dropping it. Kept
   * to one action and no confirmation, because a toast is not a Dialog — "your call is
   * held, retry now" is the shape that earns it, and anything needing a decision belongs
   * in a Dialog instead.
   */
  action?: { label: string; onClick: () => void }
}

type ToastType = 'default' | 'success' | 'error' | 'warning' | 'info' | 'loading'

type ToastAction = {
  label: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}

type ToastShowOptions = {
  description?: ReactNode
  duration?: number
  icon?: ReactNode
  action?: ToastAction
  cancel?: ToastAction
  href?: string
  onNavigate?: () => void
  className?: string
  style?: CSSProperties
  id?: string | number
  /** The stack it lands on, when there is more than one. */
  toasterId?: string
}

type ToastFn = (title: string, options?: ToastOptions) => string | number

type ToastLabels = {
  dismiss: string
  region: string
  /** The verb read out before the title on a toast that leads somewhere. */
  open: string
  /** What the icon says for each kind of toast — read before the title. */
  kind: Record<ToastType, string>
}

const DEFAULT_LABELS: ToastLabels = {
  dismiss: 'Dismiss notification',
  region: 'Notifications',
  open: 'Open',
  kind: {
    default: 'Notification',
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Information',
    loading: 'Loading',
  },
}

export type ToastLabelOverrides = Partial<Omit<ToastLabels, 'kind'>> & {
  kind?: Partial<ToastLabels['kind']>
}

const ToastContext = createContext<ToastFn | null>(null)
const ToastLabelsContext = createContext<ToastLabels>(DEFAULT_LABELS)

const TONE_TO_TYPE: Record<ToastTone, ToastType> = {
  neutral: 'default',
  success: 'success',
  warning: 'warning',
  danger: 'error',
  pending: 'loading',
}

const TOAST_ICON: Record<ToastType, { Icon: typeof AlertCircle; size: number }> = {
  default: { Icon: MessageSquare, size: 10 },
  success: { Icon: Check, size: 10 },
  error: { Icon: X, size: 10 },
  warning: { Icon: TriangleAlert, size: 10 },
  info: { Icon: AlertCircle, size: 10 },
  loading: { Icon: RefreshCw, size: 13 },
}

/** Transient confirmation for a completed action. */
export function useToast(): ToastFn {
  const toast = useContext(ToastContext)
  if (!toast) throw new Error('useToast must be used inside <ToastProvider>')
  return toast
}

function resolveContent(content: ReactNode | (() => ReactNode)) {
  return typeof content === 'function' ? content() : content
}

function ToastIcon({ type, icon }: { type: ToastType; icon?: ReactNode }) {
  const labels = useContext(ToastLabelsContext)
  const iconConfig = TOAST_ICON[type] ?? TOAST_ICON.default
  const Icon = iconConfig.Icon

  return (
    <span
      className="toast-icon"
      data-toast-icon-type={type}
      role="img"
      aria-label={labels.kind[type] ?? labels.kind.default}
    >
      {icon ?? (
        <Icon
          className="block"
          style={{ width: iconConfig.size, height: iconConfig.size }}
          strokeWidth={type === 'loading' ? 1.5 : 2.25}
          aria-hidden
        />
      )}
    </span>
  )
}

function ToastActionButton({
  action,
  toastId,
  kind = 'action',
}: {
  action?: ToastAction
  toastId: string | number
  kind?: 'action' | 'cancel'
}) {
  if (!action) return null

  return (
    <button
      type="button"
      className="toast-action"
      data-toast-action-kind={kind}
      onClick={(event) => {
        action.onClick(event)
        if (!event.defaultPrevented) sonnerToast.dismiss(toastId)
      }}
    >
      {action.label}
    </button>
  )
}

function ToastCountdown({
  duration,
  toastId,
}: {
  duration: number
  toastId: string | number
}) {
  const labels = useContext(ToastLabelsContext)
  const isTimed = Number.isFinite(duration) && duration > 0

  return (
    <button
      type="button"
      className="toast-dismiss"
      onClick={() => sonnerToast.dismiss(toastId)}
      aria-label={labels.dismiss}
      title={labels.dismiss}
    >
      {isTimed ? (
        <svg
          key={duration}
          className="toast-countdown"
          viewBox="0 0 20 20"
          aria-hidden
          style={{ ['--toast-countdown-dur' as string]: `${duration}ms` }}
        >
          <circle className="toast-countdown-track" cx="10" cy="10" r="7.5" />
          <circle className="toast-countdown-value" cx="10" cy="10" r="7.5" />
        </svg>
      ) : (
        <X className="block size-3.5" strokeWidth={2} aria-hidden />
      )}
    </button>
  )
}

function ToastSurface({
  id,
  type = 'default',
  title,
  description,
  duration = TOAST_DURATION_MS,
  icon,
  action,
  cancel,
  href,
  onNavigate,
  className = '',
  style,
}: {
  id: string | number
  type?: ToastType
  title: ReactNode
  description?: ReactNode
  duration?: number
  icon?: ReactNode
  action?: ToastAction
  cancel?: ToastAction
  href?: string
  onNavigate?: () => void
  className?: string
  style?: CSSProperties
}) {
  const labels = useContext(ToastLabelsContext)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsOpen(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const copy = (
    <>
      <div className="toast-title">{resolveContent(title)}</div>
      {description ? <div className="toast-description">{resolveContent(description)}</div> : null}
    </>
  )

  return (
    <div
      className={cn('t-toast toast-surface', isOpen && 'is-open', className)}
      data-toast-type={type}
      style={style}
    >
      <ToastIcon type={type} icon={icon} />
      {href ? (
        <a
          href={href}
          className="toast-copy toast-link"
          onClick={(event) => {
            /* A modifier is a request for a tab; let the browser answer it and leave the
               toast up, because the reader is still on the page it was raised over. */
            if (isModifiedClick(event)) return
            event.preventDefault()
            onNavigate?.()
            sonnerToast.dismiss(id)
          }}
        >
          {/* Read before the title, so the link announces itself as one rather than as a
              sentence that happens to be focusable. */}
          <span className="sr-only">{labels.open}</span>
          {copy}
        </a>
      ) : (
        <div className="toast-copy">{copy}</div>
      )}
      {action || cancel ? (
        <div className="toast-actions">
          <ToastActionButton action={cancel} toastId={id} kind="cancel" />
          <ToastActionButton action={action} toastId={id} />
        </div>
      ) : null}
      <ToastCountdown duration={duration} toastId={id} />
    </div>
  )
}

function showToast(type: ToastType, title: ReactNode, options: ToastShowOptions = {}) {
  const {
    description,
    duration = TOAST_DURATION_MS,
    icon,
    action,
    cancel,
    href,
    onNavigate,
    className,
    style,
    ...sonnerOptions
  } = options

  return sonnerToast.custom(
    (id) => (
      <ToastSurface
        id={id}
        type={type}
        title={title}
        description={description}
        duration={duration}
        icon={icon}
        action={action}
        cancel={cancel}
        href={href}
        onNavigate={onNavigate}
        className={className}
        style={style}
      />
    ),
    {
      ...sonnerOptions,
      duration,
    },
  )
}

/**
 * Toast queue — bottom-center Sonner stack on `z-toast`, ported from
 * timbal-platform's inverted pill. Toasts confirm outcomes ("Saved");
 * anything needing a decision belongs in a Dialog.
 */
export function ToastProvider({
  children,
  theme = 'system',
  labels,
  toasterId,
}: {
  children: ReactNode
  theme?: 'light' | 'dark' | 'system'
  labels?: ToastLabelOverrides
  /**
   * A stack of its own. Sonner keeps one queue for the page, so a second provider — the
   * popped-out chat's, in its own window — names its stack and only its toasts land there.
   */
  toasterId?: string
}) {
  const doc = usePortalDocument()
  const resolvedLabels = useMemo<ToastLabels>(
    () => ({ ...DEFAULT_LABELS, ...labels, kind: { ...DEFAULT_LABELS.kind, ...labels?.kind } }),
    [labels],
  )

  const toast = useCallback<ToastFn>(
    (title, options = {}) => {
      const { tone = 'neutral', description, duration, href, onNavigate, action, id } = options
      return showToast(TONE_TO_TYPE[tone], title, {
        id,
        description,
        duration,
        href,
        onNavigate,
        action: action ? { label: action.label, onClick: () => action.onClick() } : undefined,
        toasterId,
      })
    },
    [toasterId],
  )

  return (
    <ToastLabelsContext.Provider value={resolvedLabels}>
      <ToastContext.Provider value={toast}>
        {children}
        {typeof document !== 'undefined'
          ? createPortal(
              <Toaster
                id={toasterId}
                className="toast-toaster"
                theme={theme === 'light' || theme === 'dark' ? theme : 'system'}
                position="bottom-center"
                offset="24px"
                mobileOffset="16px"
                duration={TOAST_DURATION_MS}
                style={
                  {
                    '--width': TOAST_WIDTH,
                    zIndex: 'var(--z-toast)',
                  } as CSSProperties
                }
                gap={10}
                visibleToasts={4}
                expand={false}
                closeButton={false}
                swipeDirections={['left', 'right', 'bottom']}
                toastOptions={{ unstyled: true }}
                containerAriaLabel={resolvedLabels.region}
              />,
              doc.body,
            )
          : null}
      </ToastContext.Provider>
    </ToastLabelsContext.Provider>
  )
}
