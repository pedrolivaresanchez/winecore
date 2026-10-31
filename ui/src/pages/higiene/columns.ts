import { useState } from 'react'
import { readStorage, writeStorage } from '@/lib/storage'

export function useColumns(key: string, ids: readonly string[], fallback: readonly string[]) {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    const raw = readStorage(key)
    if (!raw) return new Set(fallback)
    try {
      const parsed = JSON.parse(raw) as string[]
      return new Set(parsed.filter((id) => ids.includes(id)))
    } catch {
      return new Set(fallback)
    }
  })

  function toggle(id: string) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStorage(key, JSON.stringify([...next]))
      return next
    })
  }

  return { hidden, toggle }
}
