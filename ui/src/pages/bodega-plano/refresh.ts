import { useEffect } from 'react'

const BARREL = 'winecore-barrel'
const RETIRE = 'winecore-barrel-retire'

export function notifyBarrel(code: string) {
  window.dispatchEvent(new CustomEvent(BARREL, { detail: code }))
}

export function requestRetire(code: string) {
  window.dispatchEvent(new CustomEvent(RETIRE, { detail: code }))
}

export function useBarrelTick(code: string, reload: () => void) {
  useEffect(() => {
    function onEvent(event: Event) {
      if ((event as CustomEvent<string>).detail === code) reload()
    }
    window.addEventListener(BARREL, onEvent)
    return () => window.removeEventListener(BARREL, onEvent)
  }, [code, reload])
}

export function useRetireRequest(onCode: (code: string) => void) {
  useEffect(() => {
    function onEvent(event: Event) {
      const detail = (event as CustomEvent<string>).detail
      if (typeof detail === 'string' && detail) onCode(detail)
    }
    window.addEventListener(RETIRE, onEvent)
    return () => window.removeEventListener(RETIRE, onEvent)
  }, [onCode])
}
