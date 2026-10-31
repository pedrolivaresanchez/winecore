import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/i18n";
import { ApiError, isAbortError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { browserSupportsWebAuthn, WebAuthnAbortService } from "@simplewebauthn/browser";
import {
  confirmTotp,
  enrollTotp,
  listCredentials,
  passkeyFailure,
  registerPasskey,
  renameCredential,
  revokeCredential,
} from "@/pages/aprobaciones/api";
import { OverlayDialog } from "@/pages/aprobaciones/OverlayDialog";
import { totpSecret, type UserCredential } from "@/pages/aprobaciones/model";

export function SecurityPanel() {
  const [items, setItems] = useState<UserCredential[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [label, setLabel] = useState("");
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [totpError, setTotpError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    listCredentials(controller.signal)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return;
        setError(err instanceof ApiError ? err : new ApiError(0, "WC_ERROR", copy.error.load));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  useEffect(() => {
    if (!otpauth) return;
    document.querySelector("[data-screen='seguridad-totp']")?.scrollIntoView({ block: "start" });
  }, [otpauth]);

  useEffect(() => {
    if (!otpauth) return;
    let active = true;
    toDataURL(otpauth, { margin: 1, width: 192, errorCorrectionLevel: "M" })
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        if (active) setQr(null);
      });
    return () => {
      active = false;
    };
  }, [otpauth]);

  const passkeys = (items ?? []).filter((item) => item.kind === "passkey");
  const totp = (items ?? []).filter((item) => item.kind === "totp");
  const revoking = items?.find((item) => item.id === revokeId) ?? null;
  const secret = otpauth ? totpSecret(otpauth) : "";

  async function addPasskey() {
    const name = label.trim();
    if (name.length < 1 || name.length > 40) {
      setPasskeyError("Pon un nombre de hasta 40 caracteres.");
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setPasskeyError("Este navegador no puede crear passkeys. Usa el código de la app.");
      return;
    }
    setBusy(true);
    setPasskeyError(null);
    try {
      const created = await registerPasskey(name);
      setItems((current) => [...(current ?? []), created]);
      setLabel("");
      setAddingPasskey(false);
      toast("Passkey registrada");
    } catch (err: unknown) {
      setPasskeyError(passkeyFailure(err));
    } finally {
      setBusy(false);
      WebAuthnAbortService.cancelCeremony();
    }
  }

  async function saveRename(id: string) {
    const name = renameValue.trim();
    if (name.length < 1 || name.length > 40) {
      toast("Pon un nombre de hasta 40 caracteres.");
      return;
    }
    setBusy(true);
    try {
      const updated = await renameCredential(id, name);
      setItems((current) => (current ?? []).map((item) => (item.id === id ? { ...item, ...updated, label: name } : item)));
      setRenameId(null);
      toast("Nombre cambiado");
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : "No se ha podido cambiar el nombre.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeId) return;
    setBusy(true);
    try {
      await revokeCredential(revokeId);
      setItems((current) => (current ?? []).filter((item) => item.id !== revokeId));
      setRevokeId(null);
      toast("Credencial revocada");
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : "No se ha podido revocar.");
    } finally {
      setBusy(false);
    }
  }

  async function startTotp() {
    setBusy(true);
    setTotpError(null);
    setCode("");
    try {
      const result = await enrollTotp();
      setOtpauth(result.otpauth_url);
    } catch (err: unknown) {
      setTotpError(err instanceof ApiError ? err.message : "No se ha podido preparar el código.");
    } finally {
      setBusy(false);
    }
  }

  async function finishTotp() {
    const digits = code.replace(/\D/g, "");
    if (!/^\d{6}$/.test(digits)) {
      setTotpError("El código tiene 6 cifras.");
      return;
    }
    setBusy(true);
    setTotpError(null);
    try {
      const created = await confirmTotp(digits);
      setItems((current) => [...(current ?? []).filter((item) => item.kind !== "totp"), created]);
      setOtpauth(null);
      setQr(null);
      setCode("");
      toast("Código activado");
    } catch (err: unknown) {
      setTotpError(err instanceof ApiError ? err.message : "El código no es válido.");
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.replace(/\s/g, ""));
      toast("Clave copiada");
    } catch {
      toast("No se ha podido copiar. Selecciónala a mano.");
    }
  }

  return (
    <div data-screen="seguridad" className="grid gap-5">
      <p className="text-compact text-muted-foreground">
        Sirven para aprobar. Entrar en WineCore sigue siendo tu cuenta de Microsoft.
      </p>
      {error ? (
        <div role="alert" className="grid gap-2">
          <p className="text-compact text-destructive">
            {copy.error.load} ({error.code}). {error.message}
          </p>
          <Button type="button" variant="secondary" className="w-fit" onClick={() => setAttempt((value) => value + 1)}>
            {copy.error.retry}
          </Button>
        </div>
      ) : null}
      {items === null && !error ? (
        <div aria-busy="true" className="grid gap-2">
          <p className="sr-only">{copy.loading}</p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}
      {items ? (
        <>
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-body font-semibold">Passkeys</h2>
              {addingPasskey ? null : (
                <Button type="button" onClick={() => setAddingPasskey(true)}>
                  Añadir passkey
                </Button>
              )}
            </div>
            {addingPasskey ? (
              <form
                data-screen="seguridad-passkey"
                className="grid gap-3 rounded-xl border p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addPasskey();
                }}
              >
                <label className="grid gap-1.5 text-compact font-medium" htmlFor="passkey-label">
                  Nombre
                  <Input
                    id="passkey-label"
                    value={label}
                    maxLength={40}
                    placeholder="iPhone de Pedro"
                    data-autofocus
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </label>
                <p className="text-meta text-muted-foreground">Por ejemplo, el teléfono o el portátil.</p>
                {passkeyError ? (
                  <p role="alert" className="text-compact text-destructive">
                    {passkeyError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy}>
                    {busy ? "Esperando al dispositivo…" : "Registrar passkey"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      WebAuthnAbortService.cancelCeremony();
                      setAddingPasskey(false);
                      setPasskeyError(null);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : null}
            {passkeys.length === 0 ? (
              <p className="text-compact text-muted-foreground">Aún no hay passkeys. Añade la del teléfono para aprobar en un toque.</p>
            ) : (
              <ul className="grid gap-2">
                {passkeys.map((item) => (
                  <CredentialRow
                    key={item.id}
                    item={item}
                    editing={renameId === item.id}
                    renameValue={renameValue}
                    busy={busy}
                    onRenameValue={setRenameValue}
                    onStartRename={() => {
                      setRenameId(item.id);
                      setRenameValue(item.label);
                    }}
                    onCancelRename={() => setRenameId(null)}
                    onSaveRename={() => void saveRename(item.id)}
                    onRevoke={() => setRevokeId(item.id)}
                  />
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-body font-semibold">Código de la app</h2>
              {totp.length === 0 && !otpauth ? (
                <Button type="button" variant="secondary" size="md" className="min-h-11 md:min-h-8" disabled={busy} onClick={() => void startTotp()}>
                  Añadir código
                </Button>
              ) : null}
            </div>
            {totp.length > 0 ? (
              <ul className="grid gap-2">
                {totp.map((item) => (
                  <CredentialRow
                    key={item.id}
                    item={item}
                    editing={renameId === item.id}
                    renameValue={renameValue}
                    busy={busy}
                    onRenameValue={setRenameValue}
                    onStartRename={() => {
                      setRenameId(item.id);
                      setRenameValue(item.label);
                    }}
                    onCancelRename={() => setRenameId(null)}
                    onSaveRename={() => void saveRename(item.id)}
                    onRevoke={() => setRevokeId(item.id)}
                  />
                ))}
              </ul>
            ) : null}
            {otpauth ? (
              <div data-screen="seguridad-totp" className="grid gap-3 rounded-xl border p-3">
                <p className="text-compact">Escanea el código o copia la clave en tu app de autenticación. Si cierras ahora, no quedará activo.</p>
                {qr ? (
                  <img src={qr} alt="Código QR del autenticador" width={192} height={192} className="mx-auto rounded-md bg-white p-2" />
                ) : (
                  <p className="text-compact text-muted-foreground">No se ha podido dibujar el QR. Usa la clave.</p>
                )}
                {secret ? (
                  <div>
                    <p className="text-meta text-muted-foreground">Clave manual</p>
                    <p className="mt-1 font-mono text-body break-all tracking-wide">{secret}</p>
                    <Button type="button" variant="secondary" size="md" className="mt-2 min-h-11 md:min-h-8" onClick={() => void copySecret()}>
                      Copiar clave
                    </Button>
                  </div>
                ) : null}
                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void finishTotp();
                  }}
                >
                  <label className="grid gap-1.5 text-compact font-medium" htmlFor="totp-confirm">
                    Código de 6 cifras
                    <Input
                      id="totp-confirm"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      spellCheck={false}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    />
                  </label>
                  {totpError ? (
                    <p role="alert" className="text-compact text-destructive">
                      {totpError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy || code.length !== 6}>
                      {busy ? "Comprobando…" : "Activar código"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setOtpauth(null);
                        setQr(null);
                        setTotpError(null);
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              </div>
            ) : null}
            {totp.length === 0 && !otpauth ? (
              <p className="text-compact text-muted-foreground">Respaldo si la passkey no está a mano.</p>
            ) : null}
            {totpError && !otpauth ? (
              <p role="alert" className="text-compact text-destructive">
                {totpError}
              </p>
            ) : null}
          </section>
        </>
      ) : null}
      <OverlayDialog
        open={Boolean(revoking)}
        title="Revocar"
        titleId="revocar-title"
        screen="revocar"
        onClose={() => {
          if (!busy) setRevokeId(null);
        }}
      >
        <p className="text-compact text-muted-foreground">
          Se dejará de poder usar «{revoking?.label}» para aprobar. Esta acción no se puede deshacer.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setRevokeId(null)}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" data-autofocus disabled={busy} onClick={() => void confirmRevoke()}>
            {busy ? "Revocando…" : "Revocar"}
          </Button>
        </div>
      </OverlayDialog>
    </div>
  );
}

function CredentialRow({
  item,
  editing,
  renameValue,
  busy,
  onRenameValue,
  onStartRename,
  onCancelRename,
  onSaveRename,
  onRevoke,
}: {
  item: UserCredential;
  editing: boolean;
  renameValue: string;
  busy: boolean;
  onRenameValue: (value: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSaveRename: () => void;
  onRevoke: () => void;
}) {
  const used = item.last_used_at ? `último uso ${formatDate(item.last_used_at)}` : "sin usar";
  return (
    <li className="rounded-xl border p-3" data-screen={editing ? "seguridad-renombrar" : undefined}>
      {editing ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveRename();
          }}
        >
          <label className="sr-only" htmlFor={`rename-${item.id}`}>
            Nombre
          </label>
          <Input id={`rename-${item.id}`} value={renameValue} maxLength={40} data-autofocus onChange={(event) => onRenameValue(event.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Guardar
            </Button>
            <Button type="button" variant="secondary" size="md" className="min-h-11 md:min-h-8" disabled={busy} onClick={onCancelRename}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-body font-medium break-words">{item.label}</p>
          <p className="text-meta text-muted-foreground">
            Alta {formatDate(item.created_at)} · {used}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="md" className="min-h-11 md:min-h-8" onClick={onStartRename}>
              Cambiar nombre
            </Button>
            <Button type="button" variant="secondary" size="md" className="min-h-11 md:min-h-8" onClick={onRevoke}>
              Revocar
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
