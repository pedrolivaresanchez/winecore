import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/native-field";
import { Field } from "@/components/Field";
import { noteProblem } from "@/pages/aprobaciones/model";
import { OverlayDialog } from "@/pages/aprobaciones/OverlayDialog";

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
  return (
    <OverlayDialog open={open} title="Rechazar" titleId="rechazo-title" screen="rechazo" onClose={onClose}>
      <p className="text-compact text-muted-foreground">El motivo se envía a quien lo pidió. Entre 10 y 500 caracteres.</p>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <Field id="motivo" label="Motivo" error={error ?? undefined}>
          <TextArea
            id="motivo"
            data-autofocus
            value={note}
            maxLength={500}
            aria-invalid={Boolean(error)}
            aria-describedby="motivo-cuenta"
            onChange={(event) => onNote(event.target.value)}
          />
        </Field>
        <p id="motivo-cuenta" className={length > 0 && noteProblem(note) ? "text-meta text-destructive" : "text-meta text-muted-foreground"}>
          {length}/500
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy ? "Enviando…" : "Rechazar"}
          </Button>
        </div>
      </form>
    </OverlayDialog>
  );
}
