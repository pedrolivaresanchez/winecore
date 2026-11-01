import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const PARAM = 'doc'

type DocState = { docModal?: boolean } | null

/**
 * The open document lives in `?doc=<id>` so the link can be shared. Opening pushes an entry,
 * so Back closes the modal; stepping to the next document replaces it, so Back still does.
 */
export function useDocParam() {
  const location = useLocation()
  const navigate = useNavigate()
  const id = new URLSearchParams(location.search).get(PARAM)
  const pushed = Boolean((location.state as DocState)?.docModal)

  const target = useCallback(
    (next: string | null) => {
      const query = new URLSearchParams(location.search)
      if (next) query.set(PARAM, next)
      else query.delete(PARAM)
      const search = query.toString()
      return { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }
    },
    [location.hash, location.pathname, location.search],
  )

  const open = useCallback(
    (next: string) => {
      if (next === id) return
      navigate(target(next), id ? { replace: true, state: location.state } : { state: { docModal: true } })
    },
    [id, location.state, navigate, target],
  )

  const move = useCallback(
    (next: string) => navigate(target(next), { replace: true, state: location.state }),
    [location.state, navigate, target],
  )

  const close = useCallback(() => {
    if (pushed) navigate(-1)
    else navigate(target(null), { replace: true })
  }, [navigate, pushed, target])

  /** For a row's Cmd-click: the same list with the document already open. */
  const hrefFor = useCallback(
    (next: string) => {
      const to = target(next)
      return `${to.pathname}${to.search}${to.hash}`
    },
    [target],
  )

  return { id, open, move, close, hrefFor }
}
