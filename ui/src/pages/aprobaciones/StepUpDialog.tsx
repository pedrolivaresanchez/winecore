import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { loadStepUpOptions, passkeyFailure, verifyPasskey, verifyTotp, type StepUpOptions } from "@/pages/aprobaciones/api";
import { OverlayDialog } from "@/pages/aprobaciones/OverlayDialog";
import { openSettings } from "@/pages/ajustes/seguridad/open-settings";

type Phase = "loading" | "passkey" | "totp" | "none";

export function StepUpDialog({
  open,
  decision,
  onClose,
  onVerified,
}: {
  open: boolean;
  decision: "approve" | "reject";
  onClose: () => void;
  onVerified: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [options, setOptions] = useState<StepUpOptions | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPhase("loading");
    setOptions(null);
    setCode("");
    setError(null);
    setBusy(false);
    loadStepUpOptions()
      .then((next) => {
        if (!active) return;
        setOptions(next);
        if (next.passkey) setPhase("passkey");
        else if (next.totp) setPhase("totp");
        else setPhase("none");
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : "No se han podido comprobar tus métodos.");
        setPhase("none");
      });
    return () => {
      active = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [open]);

  async function confirmPasskey() {
    if (!options?.passkey) return;
    setBusy(true);
    setError(null);
    try {
      await verifyPasskey(options.passkey);
      setPhase("loading");
      onVerified();
    } catch (err: unknown) {
      setError(passkeyFailure(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    const digits = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(digits)) {
      setError("El código tiene 6 cifras.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(digits);
      setPhase("loading");
      onVerified();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? passkeyFailure(err) : "El código no es válido.");
    } finally {
      setBusy(false);
    }
  }

  const verb = decision === "approve" ? "aprobar" : "rechazar";

  return (
    <OverlayDialog open={open} title="Confirma que eres tú" titleId="step-up-title" screen="verificacion" onClose={onClose}>
      <p className="text-body font-medium">Vas a {verb} exactamente lo que ves.</p>
      {phase === "loading" ? <p className="mt-3 text-compact text-muted-foreground">Comprobando tus métodos…</p> : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-status-danger px-3 py-2 text-compact text-status-danger-fg">
          {error}
        </p>
      ) : null}
      {phase === "passkey" ? (
        <div className="mt-4 grid gap-2">
          <Button type="button" data-autofocus onClick={() => void confirmPasskey()} disabled={busy} className="h-12">
            <KeyRound aria-hidden />
            {busy ? "Comprobando…" : "Comprobar passkey"}
          </Button>
          {options?.totp ? (
            <Button type="button" variant="secondary" onClick={() => setPhase("totp")} disabled={busy}>
              Usar código de la app
            </Button>
          ) : null}
        </div>
      ) : null}
      {phase === "totp" ? (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmCode();
          }}
        >
          <label className="grid gap-1.5 text-compact font-medium" htmlFor="totp-code">
            Código de 6 cifras
            <Input
              id="totp-code"
              data-autofocus
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              spellCheck={false}
              aria-invalid={Boolean(error)}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </label>
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Comprobando…" : "Confirmar código"}
          </Button>
          {options?.passkey ? (
            <Button type="button" variant="secondary" onClick={() => setPhase("passkey")} disabled={busy}>
              Usar passkey
            </Button>
          ) : null}
        </form>
      ) : null}
      {phase === "none" ? (
        <div className="mt-4 grid gap-3">
          <p className="text-compact text-muted-foreground">
            Aún no tienes passkey ni código de una app. Regístralos para poder decidir.
          </p>
          <Button
            type="button"
            data-autofocus
            onClick={() => {
              onClose();
              openSettings("security");
            }}
          >
            Ir a Seguridad
          </Button>
        </div>
      ) : null}
      <Button type="button" variant="ghost" className="mt-2 w-full" onClick={onClose} disabled={busy}>
        Cancelar
      </Button>
    </OverlayDialog>
  );
}
