import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { Input, type InputSize } from '@/ui'

export type ComboOption = { value: string; label: string; hint?: string }

const LIMIT = 50

function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function filterOptions(options: ComboOption[], query: string): ComboOption[] {
  const tokens = plain(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return options
  return options.filter((option) => {
    const haystack = plain(`${option.label} ${option.hint ?? ''}`)
    return tokens.every((token) => haystack.includes(token))
  })
}

/**
 * Buscador con lista: se escribe para acotar y se elige con el ratón o con Enter.
 * Sustituye al desplegable largo cuando hay decenas o cientos de opciones.
 */
export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder,
  emptyText,
  label,
  invalid,
  size = 'md',
  disabled,
}: {
  id?: string
  options: ComboOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  emptyText: string
  /** Nombre accesible cuando no hay una etiqueta enlazada con `id`. */
  label?: string
  invalid?: boolean
  size?: InputSize
  disabled?: boolean
}) {
  const auto = useId()
  const listId = `${id ?? auto}-lista`
  const [typed, setTyped] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const selected = options.find((option) => option.value === value)
  const query = typed ?? ''
  const matches = useMemo(() => filterOptions(options, query), [options, query])
  const shown = matches.slice(0, LIMIT)

  useEffect(() => {
    setActive(0)
  }, [query, open])

  useEffect(() => {
    if (!open) return
    const row = listRef.current?.children[active] as HTMLElement | undefined
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open])

  function pick(option: ComboOption) {
    onChange(option.value)
    setTyped(null)
    setOpen(false)
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((current) => Math.min(current + 1, Math.max(shown.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      const option = shown[active]
      if (option) pick(option)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setTyped(null)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        size={size}
        value={typed ?? selected?.label ?? ''}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        invalid={invalid}
        disabled={disabled}
        onFocus={(event) => {
          setOpen(true)
          event.currentTarget.select()
        }}
        onBlur={() => {
          setOpen(false)
          setTyped(null)
        }}
        onChange={(event) => {
          if (value) onChange('')
          setTyped(event.target.value)
          setOpen(true)
        }}
        onKeyDown={onKey}
      />
      {open ? (
        <div className="absolute inset-x-0 z-30 mt-1 overflow-hidden rounded-md border border-border-subtle bg-surface shadow-(--shadow-float)">
          {shown.length === 0 ? (
            <p className="px-2.5 py-2 text-label text-text-tertiary">{emptyText}</p>
          ) : (
            <ul id={listId} ref={listRef} role="listbox" className="max-h-56 overflow-auto py-1">
              {shown.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  className={cn(
                    'flex cursor-pointer items-baseline justify-between gap-3 px-2.5 py-1.5 text-label text-ink-900',
                    index === active && 'bg-fill-hover',
                    option.value === value && 'font-medium',
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    pick(option)
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.hint ? <span className="shrink-0 text-caption text-text-tertiary">{option.hint}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {matches.length > LIMIT ? (
            <p className="border-t border-border-subtle px-2.5 py-1.5 text-caption text-text-tertiary">
              {fill(copy.combobox.more, { count: String(matches.length - LIMIT) })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
