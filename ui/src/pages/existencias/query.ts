export function assignParams(current: URLSearchParams, next: Record<string, string | null>): URLSearchParams {
  const updated = new URLSearchParams(current)
  for (const [key, value] of Object.entries(next)) {
    if (value) updated.set(key, value)
    else updated.delete(key)
  }
  return updated
}
