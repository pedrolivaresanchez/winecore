import { useState } from 'react'
import { copy } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import { Button, Input, useToast } from '@/ui'
import { Search } from '@/ui/icons'

type Detector = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>
}

function detectorCtor(): (new (options: { formats: string[] }) => Detector) | null {
  const candidate = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => Detector }).BarcodeDetector
  return candidate ?? null
}

export function QrScanField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function scan() {
    const Ctor = detectorCtor()
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      toast(copy.stock.scanUnsupported)
      return
    }
    setBusy(true)
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      const video = document.createElement('video')
      video.srcObject = stream
      video.playsInline = true
      await video.play()
      const codes = await new Ctor({ formats: ['qr_code'] }).detect(video)
      const raw = codes[0]?.rawValue?.trim()
      if (raw) onChange(raw)
      else toast(copy.stock.scanEmpty)
    } catch {
      toast(copy.stock.scanFail)
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input
        size="sm"
        type="search"
        value={value}
        placeholder={copy.stock.searchVessel}
        aria-label={copy.stock.vessel}
        className="max-w-xs"
        prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => void scan()}>
        {busy ? copy.stock.scanning : copy.stock.scan}
      </Button>
    </div>
  )
}
