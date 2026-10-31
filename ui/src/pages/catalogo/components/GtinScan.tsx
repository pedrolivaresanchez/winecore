import { useEffect, useRef, useState } from 'react'
import { Button, Drawer, DrawerBody, DrawerHeader } from '@/ui'
import { ScanSearch } from '@/ui/icons'
import { iconStroke } from '@/lib/motion'
import { copy } from '@/i18n'

type Detector = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>
}

type DetectorCtor = new (options?: { formats?: string[] }) => Detector

function detectorCtor(): DetectorCtor | null {
  const host = window as Window & { BarcodeDetector?: DetectorCtor }
  return host.BarcodeDetector ?? null
}

export function GtinScanButton({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    if (!open) return
    const video = videoRef.current
    let stopped = false
    let stream: MediaStream | null = null
    let timer = 0
    const Ctor = detectorCtor()

    async function run() {
      if (!Ctor || !navigator.mediaDevices?.getUserMedia || !video) {
        setMessage('Escribe el GTIN. Este navegador no puede usar la cámara.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        video.srcObject = stream
        await video.play()
        const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })
        const tick = async () => {
          if (stopped) return
          try {
            const codes = await detector.detect(video)
            const value = codes[0]?.rawValue?.replace(/\D/g, '')
            if (value) {
              onCodeRef.current(value)
              setOpen(false)
              return
            }
          } catch {
            /* El fotograma todavía no está listo. */
          }
          timer = window.setTimeout(() => void tick(), 400)
        }
        void tick()
      } catch {
        setMessage('No se ha podido abrir la cámara.')
      }
    }

    void run()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
      if (video) video.srcObject = null
    }
  }, [open])

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        iconOnly
        className="shrink-0 md:hidden"
        aria-label={copy.catalog.scan}
        onClick={() => {
          setMessage(null)
          setOpen(true)
        }}
      >
        <ScanSearch strokeWidth={iconStroke} />
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} labelledBy="escanear-gtin" size="md">
        <DrawerHeader titleId="escanear-gtin" title={copy.catalog.scan} onClose={() => setOpen(false)} />
        <DrawerBody>
          <div data-screen="catalogo-escaner" className="grid gap-3">
            <video ref={videoRef} muted playsInline className="max-h-64 w-full rounded-2xl bg-surface-subtle" />
            <p className="text-label text-text-tertiary">{message ?? 'Apunta al código de la botella o de la caja.'}</p>
          </div>
        </DrawerBody>
      </Drawer>
    </>
  )
}
