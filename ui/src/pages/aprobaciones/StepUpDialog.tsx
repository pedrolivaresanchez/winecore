import { useEffect, useState } from "react";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { Key } from "@/ui/icons";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import { iconStroke } from "@/lib/motion";
import { loadStepUpOptions, passkeyFailure, verifyPasskey, verifyTotp, type StepUpOptions } from "@/pages/aprobaciones/api";
import { openSettings } from "@/pages/ajustes/seguridad/open-settings";
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input } from "@/ui";

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
        setError(err instanceof ApiError ? err.message : copy.approvals.methodsFail);
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
      setError(copy.approvals.codeShort);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(digits);
      setPhase("loading");
      onVerified();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? passkeyFailure(err) : copy.approvals.codeInvalid);
    } finally {
      setBusy(false);
    }
  }

  const phrase = decision === "approve" ? copy.approvals.stepApprove : copy.approvals.stepReject;

  return (
    <Dialog open={open} onClose={onClose} size="sm" labelledBy="step-up-title">
      <div data-screen="verificacion">
        <DialogHeader title={copy.approvals.stepTitle} titleId="step-up-title" description={phrase} onClose={onClose} />
        <DialogBody>
          {phase === "loading" ? <p className="text-label text-text-secondary">{copy.approvals.checking}</p> : null}
          {error ? (
            <p role="alert" className="rounded-2xl bg-danger-50 px-3 py-2 text-label text-danger-700">
              {error}
            </p>
          ) : null}
          {phase === "passkey" ? (
            <div className="grid gap-2">
              <Button type="button" onClick={() => void confirmPasskey()} loading={busy}>
                <Key aria-hidden strokeWidth={iconStroke} />
                {busy ? copy.approvals.checkingPasskey : copy.approvals.usePasskey}
              </Button>
              {options?.totp ? (
                <Button type="button" variant="secondary" onClick={() => setPhase("totp")} disabled={busy}>
                  {copy.approvals.useCode}
                </Button>
              ) : null}
            </div>
          ) : null}
          {phase === "totp" ? (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmCode();
              }}
            >
              <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="totp-code">
                {copy.approvals.codeLabel}
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  spellCheck={false}
                  invalid={Boolean(error)}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </label>
              <Button type="submit" loading={busy} disabled={code.length !== 6 && !busy}>
                {busy ? copy.approvals.checkingPasskey : copy.approvals.confirmCode}
              </Button>
              {options?.passkey ? (
                <Button type="button" variant="secondary" onClick={() => setPhase("passkey")} disabled={busy}>
                  {copy.approvals.usePasskeyAlt}
                </Button>
              ) : null}
            </form>
          ) : null}
          {phase === "none" ? (
            <div className="grid gap-3">
              <p className="text-label text-text-secondary">{copy.approvals.noneMethods}</p>
              <p className="text-caption text-text-tertiary">{copy.approvals.noneHint}</p>
              <Button
                type="button"
                onClick={() => {
                  onClose();
                  openSettings("security");
                }}
              >
                {copy.approvals.goSecurity}
              </Button>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {copy.approvals.cancel}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
