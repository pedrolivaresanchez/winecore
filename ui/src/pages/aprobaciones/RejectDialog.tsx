import { copy } from "@/i18n";
import { noteProblem } from "@/pages/aprobaciones/model";
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Textarea } from "@/ui";

export function RejectDialog({
  open,
  note,
  error,
  busy,
  onNote,
  onClose,
  onConfirm,
}: {
  open: boolean;
  note: string;
  error: string | null;
  busy: boolean;
  onNote: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const length = note.trim().length;
  const over = length > 0 && noteProblem(note);
  return (
    <Dialog open={open} onClose={onClose} size="sm" labelledBy="rechazo-title">
      <form
        data-screen="rechazo"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <DialogHeader title={copy.approvals.rejectTitle} titleId="rechazo-title" description={copy.approvals.rejectHint} onClose={onClose} />
        <DialogBody>
          <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="motivo">
            {copy.approvals.reason}
            <Textarea
              id="motivo"
              value={note}
              maxLength={500}
              invalid={Boolean(error)}
              aria-describedby="motivo-cuenta"
              onChange={(event) => onNote(event.target.value)}
            />
          </label>
          <p id="motivo-cuenta" className={over || error ? "mt-2 text-caption text-danger-600" : "mt-2 text-caption text-text-tertiary"}>
            {length}/500
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-caption text-danger-600">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {copy.approvals.cancel}
          </Button>
          <Button type="submit" variant="danger" size="sm" loading={busy}>
            {busy ? copy.approvals.sending : copy.approvals.reject}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
