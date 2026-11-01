import { useEffect, useState } from "react";
import { copy } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { Skeleton, Switch, useToast } from "@/ui";

type Settings = { require_step_up: boolean };

/** Solo la ve el propietario: el resto recibe 403 y el bloque no aparece. */
export function ApprovalStepUpSetting() {
  const toast = useToast();
  const [required, setRequired] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<Settings>("/v1/approval-settings", { signal: controller.signal })
      .then((settings) => setRequired(Boolean(settings.require_step_up)))
      .catch(() => {
        if (!controller.signal.aborted) setHidden(true);
      });
    return () => controller.abort();
  }, []);

  async function change(next: boolean) {
    setSaving(true);
    try {
      const saved = await api<Settings>("/v1/approval-settings", {
        method: "PUT",
        body: JSON.stringify({ require_step_up: next }),
      });
      setRequired(Boolean(saved.require_step_up));
      toast(copy.security.approveSaved, { tone: "success" });
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.security.approveSaveFail, { tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  if (hidden) return null;
  if (required === null) return <Skeleton className="h-16 w-full" />;

  return (
    <section data-screen="seguridad-aprobar">
      <h2 className="text-label font-medium text-ink-900">{copy.security.approveTitle}</h2>
      <div className="mt-3 flex items-start justify-between gap-4 rounded-2xl border border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <label htmlFor="approve-strict" className="text-label font-medium text-ink-900">
            {copy.security.approveStrict}
          </label>
          <p className="mt-1 text-caption text-text-tertiary">{copy.security.approveStrictHint}</p>
        </div>
        <Switch id="approve-strict" checked={required} disabled={saving} onChange={(next) => void change(next)} />
      </div>
    </section>
  );
}
