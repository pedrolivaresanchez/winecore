import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { copy, fill } from '@/i18n'
import { isAbortError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { listContacts } from '@/lib/contacts'
import { iconStroke } from '@/lib/motion'
import { Search } from '@/ui/icons'
import { Input, useDismissOnEscape } from '@/ui'

export type CustomerOption = { id: string; name: string; taxId: string | null; city: string | null }

const MIN_CHARS = 2

export function CustomerPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string
  value: CustomerOption | null
  onChange: (next: CustomerOption | null) => void
  invalid?: boolean
}) {
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<CustomerOption[]>([])
  const [searched, setSearched] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const term = query.trim()
  const searching = term.length >= MIN_CHARS && searched !== term
  const showList = open && !value && term.length >= MIN_CHARS
  const current = Math.min(active, Math.max(hits.length - 1, 0))

  useDismissOnEscape(showList, () => setOpen(false))

  useEffect(() => {
    if (value || term.length < MIN_CHARS) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      listContacts({ role: 'customer', q: term, limit: 20 }, controller.signal)
        .then((page) => {
          setHits(
            page.items
              .filter((item) => item.is_customer && !item.archived_at)
              .map((item) => ({ id: item.id, name: item.legal_name, taxId: item.tax_id, city: item.city })),
          )
          setActive(0)
          setSearched(term)
        })
        .catch((err: unknown) => {
          if (isAbortError(err)) return
          setHits([])
          setSearched(term)
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [term, value])

  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [current, showList])

  function pick(option: CustomerOption | undefined) {
    if (!option) return
    onChange(option)
    setQuery(option.name)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showList || searching || hits.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current + 1) % hits.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current - 1 + hits.length) % hits.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(hits[current])
    }
  }

  const optionId = (index: number) => `${listId}-${index}`

  return (
    <div className="relative grid gap-1.5">
      <Input
        id={id}
        value={value ? value.name : query}
        placeholder={copy.sales.findCustomer}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && !searching && hits[current] ? optionId(current) : undefined}
        aria-describedby={`${id}-ayuda`}
        invalid={invalid}
        prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
        onChange={(event) => {
          if (value) onChange(null)
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <p id={`${id}-ayuda`} className="text-caption text-text-tertiary">
        {value?.taxId ? [value.taxId, value.city].filter(Boolean).join(' · ') : copy.sales.customerHint}
      </p>
      {showList ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={copy.sales.customer}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-lg border border-border-subtle bg-surface p-1 shadow-(--shadow-float)"
        >
          {searching ? (
            <li className="px-2.5 py-2 text-label text-text-tertiary">{copy.sales.searchingCustomers}</li>
          ) : hits.length === 0 ? (
            <li className="px-2.5 py-2 text-label text-text-tertiary">{fill(copy.sales.noCustomers, { q: term })}</li>
          ) : (
            hits.map((option, index) => {
              const selected = index === current
              return (
                <li
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  data-active={selected ? '' : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => {
                    if (!selected) setActive(index)
                  }}
                  onClick={() => pick(option)}
                  className={cn(
                    'flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-label',
                    selected ? 'bg-fill-hover text-ink-900' : 'text-control',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {option.taxId ? <span className="shrink-0 text-caption text-text-tertiary tabular-nums">{option.taxId}</span> : null}
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}
