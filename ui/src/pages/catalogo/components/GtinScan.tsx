import { useEffect, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Detector = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
};

type DetectorCtor = new (options?: { formats?: string[] }) => Detector;

function detectorCtor(): DetectorCtor | null {
  const host = window as Window & { BarcodeDetector?: DetectorCtor };
  return host.BarcodeDetector ?? null;
}

export function GtinScanButton({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!open) return;
    const video = videoRef.current;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    const Ctor = detectorCtor();

    async function run() {
      if (!Ctor || !navigator.mediaDevices?.getUserMedia || !video) {
        setMessage("Escribe el GTIN. Este navegador no puede usar la cámara.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const detector = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue?.replace(/\D/g, "");
            if (value) {
              onCodeRef.current(value);
              setOpen(false);
              return;
            }
          } catch {
            /* El fotograma todavía no está listo. */
          }
          timer = window.setTimeout(() => void tick(), 400);
        };
        void tick();
      } catch {
        setMessage("No se ha podido abrir la cámara.");
      }
    }

    void run();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="shrink-0 px-3 md:hidden"
        aria-label="Escanear código de barras"
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        <ScanBarcode aria-hidden className="size-4" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Escanear GTIN</SheetTitle>
          </SheetHeader>
          <div className="grid gap-3 px-4 pb-6">
            <video ref={videoRef} muted playsInline className="max-h-64 w-full rounded-md bg-muted" />
            {message ? <p className="text-compact text-muted-foreground">{message}</p> : (
              <p className="text-compact text-muted-foreground">Apunta al código de la botella o de la caja.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
