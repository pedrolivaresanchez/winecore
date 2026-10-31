import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Detector = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

function detectorCtor(): (new (options: { formats: string[] }) => Detector) | null {
  const candidate = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => Detector }).BarcodeDetector;
  return candidate ?? null;
}

export function QrScanField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [busy, setBusy] = useState(false);

  async function scan() {
    const Ctor = detectorCtor();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      toast("No se puede abrir la cámara. Escribe el código del recipiente.");
      return;
    }
    setBusy(true);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.playsInline = true;
      await video.play();
      const codes = await new Ctor({ formats: ["qr_code"] }).detect(video);
      const raw = codes[0]?.rawValue?.trim();
      if (raw) onChange(raw);
      else toast("No se ha leído ningún código. Acerca el QR del recipiente.");
    } catch {
      toast("No se ha podido usar la cámara. Escribe el código del recipiente.");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 gap-2">
      <label className="grid min-w-0 flex-1 gap-1">
        <span className="text-compact font-medium">Recipiente</span>
        <Input
          type="search"
          value={value}
          placeholder="Código o QR"
          aria-label="Código del recipiente"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <Button type="button" variant="secondary" className="mt-6 shrink-0" disabled={busy} onClick={() => void scan()}>
        {busy ? "Leyendo…" : "Escanear"}
      </Button>
    </div>
  );
}
