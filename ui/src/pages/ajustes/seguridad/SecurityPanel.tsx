import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, WebAuthnAbortService } from "@simplewebauthn/browser";
import { toDataURL } from "qrcode";
import { MoreVertical } from "@/ui/icons";
import { copy, fill } from "@/i18n";
import { ApiError, isAbortError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { iconStroke } from "@/lib/motion";
import {
  confirmTotp,
  enrollTotp,
  listCredentials,
  passkeyFailure,
  registerPasskey,
  renameCredential,
  revokeCredential,
} from "@/pages/aprobaciones/api";
import { totpSecret, type UserCredential } from "@/pages/aprobaciones/model";
import { ApprovalStepUpSetting } from "./ApprovalStepUpSetting";
import {
  Alert,
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  EmptyState,
  GlassMenu,
  Input,
  MenuItem,
  Skeleton,
  useMenuOpen,
  useToast,
} from "@/ui";

export function SecurityPanel() {
  const toast = useToast();
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
      setPasskeyError(copy.security.nameError);
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setPasskeyError(copy.security.unsupported);
      return;
    }
    setBusy(true);
    setPasskeyError(null);
    try {
      const created = await registerPasskey(name);
      setItems((current) => [...(current ?? []), created]);
      setLabel("");
      setAddingPasskey(false);
      toast(copy.security.registered, { tone: "success" });
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
      toast(copy.security.nameError, { tone: "warning" });
      return;
    }
    setBusy(true);
    try {
      const updated = await renameCredential(id, name);
      setItems((current) => (current ?? []).map((item) => (item.id === id ? { ...item, ...updated, label: name } : item)));
      setRenameId(null);
      toast(copy.security.renamed, { tone: "success" });
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : copy.security.renameFail, { tone: "danger" });
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
      toast(copy.security.revoked, { tone: "success" });
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : copy.security.revokeFail, { tone: "danger" });
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
      setTotpError(err instanceof ApiError ? err.message : copy.security.prepareFail);
    } finally {
      setBusy(false);
    }
  }

  async function finishTotp() {
    const digits = code.replace(/\D/g, "");
    if (!/^\d{6}$/.test(digits)) {
      setTotpError(copy.approvals.codeShort);
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
      toast(copy.security.activated, { tone: "success" });
    } catch (err: unknown) {
      setTotpError(err instanceof ApiError ? err.message : copy.approvals.codeInvalid);
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.replace(/\s/g, ""));
      toast(copy.security.copied, { tone: "success" });
    } catch {
      toast(copy.security.copyFail, { tone: "warning" });
    }
  }

  return (
    <div data-screen="seguridad" className="flex flex-col gap-10">
      <ApprovalStepUpSetting />
      {error ? (
        <div className="grid gap-3">
          <Alert tone="danger">{`${copy.error.load} (${error.code}). ${error.message}`}</Alert>
          <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => setAttempt((value) => value + 1)}>
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
          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-label font-medium text-ink-900">{copy.security.passkeys}</h2>
              {addingPasskey ? null : (
                <Button type="button" size="sm" onClick={() => setAddingPasskey(true)}>
                  {copy.security.addPasskey}
                </Button>
              )}
            </div>
            {addingPasskey ? (
              <form
                data-screen="seguridad-passkey"
                className="mt-3 grid gap-3 rounded-2xl border border-border-subtle px-4 py-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addPasskey();
                }}
              >
                <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="passkey-label">
                  {copy.security.name}
                  <Input
                    id="passkey-label"
                    value={label}
                    maxLength={40}
                    placeholder={copy.security.placeholder}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </label>
                <p className="text-caption text-text-tertiary">{copy.security.nameHint}</p>
                {passkeyError ? (
                  <p role="alert" className="text-caption text-danger-600">
                    {passkeyError}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" loading={busy}>
                    {busy ? copy.security.waiting : copy.security.register}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      WebAuthnAbortService.cancelCeremony();
                      setAddingPasskey(false);
                      setPasskeyError(null);
                    }}
                  >
                    {copy.approvals.cancel}
                  </Button>
                </div>
              </form>
            ) : null}
            {passkeys.length === 0 && !addingPasskey ? (
              <div className="mt-3">
                <EmptyState size="sm" title={copy.security.emptyPasskeys} description={copy.security.emptyPasskeysHint} />
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
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
          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-label font-medium text-ink-900">{copy.security.codeTitle}</h2>
              {totp.length === 0 && !otpauth ? (
                <Button type="button" variant="secondary" size="sm" loading={busy} onClick={() => void startTotp()}>
                  {copy.security.addCode}
                </Button>
              ) : null}
            </div>
            {totp.length > 0 ? (
              <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
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
              <div data-screen="seguridad-totp" className="mt-3 grid gap-3 rounded-2xl border border-border-subtle px-4 py-3">
                <p className="text-label text-text-secondary">{copy.security.scan}</p>
                {qr ? (
                  <img src={qr} alt={copy.security.qrAlt} width={192} height={192} className="rounded-md bg-white p-2" />
                ) : (
                  <p className="text-label text-text-secondary">{copy.security.qrFail}</p>
                )}
                {secret ? (
                  <div>
                    <p className="text-caption text-text-tertiary">{copy.security.manual}</p>
                    <p className="mt-1 font-mono text-body break-all tracking-wide text-ink-900">{secret}</p>
                    <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void copySecret()}>
                      {copy.security.copy}
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
                  <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="totp-confirm">
                    {copy.approvals.codeLabel}
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
                    <p role="alert" className="text-caption text-danger-600">
                      {totpError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" loading={busy} disabled={code.length !== 6 && !busy}>
                      {busy ? copy.approvals.checkingPasskey : copy.security.activate}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setOtpauth(null);
                        setQr(null);
                        setTotpError(null);
                      }}
                    >
                      {copy.approvals.cancel}
                    </Button>
                  </div>
                </form>
              </div>
            ) : null}
            {totp.length === 0 && !otpauth ? <p className="mt-3 text-caption text-text-tertiary">{copy.security.codeHint}</p> : null}
            {totpError && !otpauth ? (
              <p role="alert" className="mt-3 text-caption text-danger-600">
                {totpError}
              </p>
            ) : null}
          </section>
        </>
      ) : null}
      <Dialog
        open={Boolean(revoking)}
        onClose={() => {
          if (!busy) setRevokeId(null);
        }}
        size="sm"
        labelledBy="revocar-title"
      >
        <div data-screen="revocar">
          <DialogHeader
            title={copy.security.revokeTitle}
            titleId="revocar-title"
            description={fill(copy.security.revokeBody, { name: revoking?.label ?? "" })}
            onClose={() => {
              if (!busy) setRevokeId(null);
            }}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setRevokeId(null)}>
              {copy.approvals.cancel}
            </Button>
            <Button type="button" variant="danger" size="sm" loading={busy} onClick={() => void confirmRevoke()}>
              {busy ? copy.security.revoking : copy.security.revoke}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
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
  const menu = useMenuOpen();
  const used = item.last_used_at ? fill(copy.security.used, { date: formatDate(item.last_used_at) }) : copy.security.unused;
  return (
    <li className="px-4 py-3" data-screen={editing ? "seguridad-renombrar" : undefined}>
      {editing ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveRename();
          }}
        >
          <label className="sr-only" htmlFor={`rename-${item.id}`}>
            {copy.security.name}
          </label>
          <Input id={`rename-${item.id}`} value={renameValue} maxLength={40} onChange={(event) => onRenameValue(event.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={busy}>
              {copy.approvals.save}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancelRename}>
              {copy.approvals.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-label font-medium break-words text-ink-900">{item.label}</p>
            <p className="text-caption text-text-tertiary">
              {fill(copy.security.created, { date: formatDate(item.created_at) })} · {used}
            </p>
          </div>
          <GlassMenu
            open={menu.open}
            onOpenChange={menu.setOpen}
            placement="bottom-end"
            trigger={
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.approvals.more} onClick={menu.toggle}>
                <MoreVertical strokeWidth={iconStroke} />
              </Button>
            }
          >
            <MenuItem
              onClick={() => {
                menu.close();
                onStartRename();
              }}
            >
              {copy.security.rename}
            </MenuItem>
            <MenuItem
              tone="danger"
              onClick={() => {
                menu.close();
                onRevoke();
              }}
            >
              {copy.security.revoke}
            </MenuItem>
          </GlassMenu>
        </div>
      )}
    </li>
  );
}
