import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, Delete, Droplets, Filter, Merge, Plus, Sparkles, Tag, Trash2, Wine, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useEntity } from "@/app/entity-context";
import { ErrorState } from "@/components/ErrorState";
import { Field } from "@/components/Field";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, TextArea } from "@/components/ui/native-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { ApiError } from "@/lib/api";
import {
  confirmOperation,
  contentLabel,
  createOperation,
  describeCellarError,
  mlToEdit,
  OP_TYPES,
  previewOperation,
  updateOperation,
  type CellarOperation,
  type OperationPreview,
  type OpType,
  type Vessel,
} from "@/lib/cellar";
import { formatLitres } from "@/lib/format";
import { allows } from "@/lib/permissions";
import {
  applyKey,
  balanceFor,
  blocksStep,
  buildPayload,
  destApplies,
  effectsFor,
  emptyDraft,
  emptyLine,
  lossApplies,
  mlOf,
  needsApproval,
  nextStep,
  parseQty,
  prefillLosses,
  prevStep,
  problems,
  readTipo,
  withVessel,
  WIZARD_STEPS,
  type ActiveField,
  type Balance,
  type Draft,
  type DraftLine,
  type Issue,
  type LineRole,
  type WizardStep,
} from "@/lib/operation-draft";
import type { Me } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<OpType, LucideIcon> = {
  racking: ArrowLeftRight,
  blend: Merge,
  filtration: Filter,
  bottling: Wine,
  labeling: Tag,
  addition: Plus,
  loss: Droplets,
  destruction: Trash2,
  cleaning: Sparkles,
};

type List = { items: Vessel[]; next_cursor: string | null; total: number };

function opLabel(op: OpType | ""): string {
  return OP_TYPES.find((item) => item.id === op)?.label ?? "";
}

function stepHint(op: OpType | "", step: WizardStep): string {
  if (step === "tipo") return "Elige qué vas a registrar.";
  if (step === "origenes") {
    if (op === "cleaning") return "Qué depósito se limpia y con qué.";
    if (op === "addition") return "Dónde y qué producto echas.";
    if (op === "labeling") return "Botellas que vas a etiquetar.";
    if (op === "loss" || op === "destruction") return "De dónde sale el vino que se pierde.";
    return "De dónde sale el vino.";
  }
  if (step === "destinos") {
    if (!destApplies(op)) return "Este tipo no tiene destino.";
    if (op === "blend") return "Depósito vacío y código del lote nuevo.";
    if (op === "bottling") return "Botellas y lote envasado.";
    return "A qué depósito va el vino.";
  }
  if (step === "mermas") {
    if (!lossApplies(op)) return "Este tipo no tiene merma.";
    if (op === "destruction") return "La destrucción exige un motivo.";
    if (op === "labeling") return "Roturas, si las hay.";
    return "Lías u otras pérdidas. Tiene que cuadrar.";
  }
  return "Revisa el cuadre antes de confirmar.";
}

function lineMessages(issues: Issue[], key: string, view: WizardStep): string[] {
  return issues.filter((issue) => issue.key === key && (view === "revision" || issue.step === view)).map((issue) => issue.message);
}

function describeLine(op: OpType, role: LineRole, line: DraftLine, vessels: Vessel[], lotCode: string): string {
  const vessel = vessels.find((item) => item.code === line.vessel_code);
  const place = vessel ? `${vessel.code} · ${vessel.name}` : "Sin depósito";
  if (op === "bottling" && role === "output") {
    const lot = lotCode ? ` · ${lotCode}` : "";
    return `${parseQty(line.qty_text)} botellas × ${line.nominal_text || "0"} L = ${formatLitres(mlOf(op, role, line) / 1000)}${lot}`;
  }
  if (op === "labeling") {
    const kind = role === "loss" ? (line.loss_kind === "incident" ? " · incidencia" : " · rotura") : "";
    return `${place} · ${parseQty(line.qty_text)} botellas${kind}`;
  }
  const wine = role === "input" ? vessel?.content?.wine_name : null;
  const lot = role === "output" && op === "blend" ? lotCode : line.lot_code;
  const extra = [lot, wine].filter(Boolean).join(" · ");
  const kind = role === "loss" ? (line.loss_kind === "incident" ? " · incidencia" : " · autorizada") : "";
  return `${place}${extra ? ` · ${extra}` : ""} · ${formatLitres(mlOf(op, role, line) / 1000)}${kind}`;
}

function matchKey(draft: Draft, vessel?: string, role?: string): string {
  const pools: [string, DraftLine[]][] = [
    ["input", draft.inputs],
    ["output", draft.outputs],
    ["loss", draft.losses],
  ];
  for (const [name, lines] of pools) {
    if (role && role !== name) continue;
    const hit = lines.find((line) => vessel && line.vessel_code === vessel);
    if (hit) return hit.key;
  }
  return "banner";
}

function serverIssues(error: unknown, draft: Draft): Issue[] {
  if (!(error instanceof ApiError)) {
    return [{ step: "revision", key: "banner", code: "WC_ERROR", message: "No se ha podido guardar la operación" }];
  }
  const described = describeCellarError(error);
  const issues: Issue[] = [
    {
      step: "revision",
      key: matchKey(draft, described.vessel, described.role),
      code: described.code,
      message: described.message,
    },
  ];
  if (error.fields?.reason) {
    issues.push({ step: "mermas", key: "reason", code: described.code, message: error.fields.reason });
  }
  return issues;
}

function Alerts({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="grid gap-1">
      {messages.map((message) => (
        <p key={message} role="alert" data-code={message.includes("(WC") ? message.match(/WC[0-9A-Z_]+/)?.[0] : undefined} className="text-meta text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}

function BalanceBanner({ balance }: { balance: Balance }) {
  return (
    <p
      id="conservacion"
      role={balance.ok ? "status" : "alert"}
      data-code={balance.ok ? "ok" : "WC020"}
      className={cn(
        "rounded-xl px-3 py-3 text-compact",
        balance.ok ? "bg-status-success text-status-success-fg" : "bg-status-danger text-status-danger-fg",
      )}
    >
      {balance.text}
    </p>
  );
}

const MOVE_LABEL: Record<string, string> = {
  cellar_out: "Sale",
  cellar_in: "Entra",
  loss: "Merma",
};

const FISCAL_LABEL: Record<string, string> = {
  ledger_change_out: "Sale del mayor",
  ledger_change_in: "Entra en el mayor",
  loss: "Merma fiscal",
  destruction: "Destrucción fiscal",
};

const CLASS_LABEL: Record<string, string> = {
  bulk: "granel",
  bulk_wood: "madera",
  packaged: "envasado",
};

function EffectsPanel({
  preview,
  fallback,
  vessels,
  draft,
}: {
  preview: OperationPreview | null;
  fallback: { fisico: string; sisv: string; silicie: string } | null;
  vessels: Vessel[];
  draft: Draft;
}) {
  if (preview) {
    const lines = [...draft.inputs, ...draft.outputs, ...draft.losses];
    return (
      <section data-effects="server" className="grid gap-1 rounded-xl border bg-card p-3 text-compact">
        <h2 className="text-body font-semibold">Efectos</h2>
        {preview.moves.length === 0 ? <p className="text-muted-foreground">Sin movimiento físico</p> : null}
        {preview.moves.map((move, index) => {
          const vessel = vessels.find((item) => item.id === move.vessel_id)?.code;
          const lot = lines.find((item) => item.lot_id && item.lot_id === move.lot_id)?.lot_code;
          const amount = move.qty_units !== 0 ? `${Math.abs(move.qty_units)} botellas` : formatLitres(Math.abs(move.volume_ml) / 1000);
          return (
            <p key={`${move.move_type}-${move.vessel_id ?? ""}-${index}`}>
              {MOVE_LABEL[move.move_type] ?? move.move_type}
              {vessel ? ` · ${vessel}` : ""}
              {lot ? ` · ${lot}` : ""}
              {` · ${amount}`}
            </p>
          );
        })}
        {preview.fiscal_moves.length === 0 ? <p className="text-muted-foreground">Sin asiento fiscal</p> : null}
        {preview.fiscal_moves.map((move, index) => (
          <p key={`${move.move_type}-${index}`}>
            {FISCAL_LABEL[move.move_type] ?? move.move_type}
            {` · ${CLASS_LABEL[move.product_class] ?? move.product_class} · ${formatLitres(Math.abs(move.volume_ml) / 1000)}`}
          </p>
        ))}
        {preview.new_lots.map((lot) => (
          <p key={lot.code}>
            Lote nuevo · {lot.code} · {formatLitres(lot.volume_ml / 1000)}
          </p>
        ))}
      </section>
    );
  }
  if (!fallback) return null;
  return (
    <section data-effects="local" className="grid gap-2 rounded-xl border bg-card p-3 text-compact">
      <h2 className="text-body font-semibold">Efectos</h2>
      <p>
        <span className="text-muted-foreground">Físico · </span>
        {fallback.fisico}
      </p>
      <p>
        <span className="text-muted-foreground">SISV · </span>
        {fallback.sisv}
      </p>
      <p>
        <span className="text-muted-foreground">SILICIE · </span>
        {fallback.silicie}
      </p>
    </section>
  );
}

function Keypad({ onPress }: { onPress: (key: string) => void }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"];
  return (
    <div className="grid grid-cols-3 gap-2 md:hidden" role="group" aria-label="Teclado numérico">
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={key === "⌫" ? "Borrar" : key === "," ? "Coma" : key}
          className="h-12 rounded-lg bg-muted text-body font-medium"
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPress(key)}
        >
          {key === "⌫" ? <Delete aria-hidden className="size-5" /> : key}
        </button>
      ))}
    </div>
  );
}

function VesselChips({
  vessels,
  selected,
  onSelect,
}: {
  vessels: Vessel[];
  selected: string;
  onSelect: (vessel: Vessel) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap">
        {vessels.map((vessel) => {
          const on = vessel.code === selected;
          const disabled = vessel.status !== "in_service";
          return (
            <button
              key={vessel.id}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onSelect(vessel)}
              className={cn(
                "h-16 min-w-24 shrink-0 rounded-xl border px-3 text-left",
                on ? "border-ink bg-ink text-ink-foreground" : "bg-card",
                disabled && "opacity-50",
              )}
            >
              <span className="block text-compact font-semibold">{vessel.code}</span>
              <span className={cn("block text-meta tabular-nums", on ? "text-ink-foreground/80" : "text-muted-foreground")}>
                {vessel.status !== "in_service" ? "Fuera de servicio" : vessel.content ? formatLitres(vessel.content.volume_ml / 1000) : "Vacío"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function caption(vessel: Vessel | undefined): string {
  if (!vessel) return "Elige un depósito.";
  if (!vessel.content) return `${vessel.name} · ${contentLabel(vessel)}`;
  return `${vessel.name} · ${vessel.content.lot_code} · ${vessel.content.wine_name}`;
}

export function OperacionPage({ me }: { me: Me }) {
  const allowed = allows(me, "cellar.operate");
  const data = useApi<List>(allowed ? "/v1/vessels?limit=200" : null);
  if (!allowed) return <NoPermission />;
  if (data.loading && !data.data) {
    return (
      <div aria-busy="true" className="grid gap-3" data-screen="bodega-operacion" data-step="cargando">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (data.error || !data.data) {
    return <ErrorState title={`No se ha podido cargar (${data.error?.code ?? "WC_ERROR"})`} detail={data.error?.message} onRetry={data.reload} />;
  }
  return <Wizard me={me} vessels={data.data.items} />;
}

function Wizard({ me, vessels }: { me: Me; vessels: Vessel[] }) {
  const [params] = useSearchParams();
  const { entities } = useEntity();
  const legalEntityId = entities.find((item) => item.code === "PO")?.id ?? entities[0]?.id ?? "";
  const [draft, setDraft] = useState(() => emptyDraft(readTipo(params.get("tipo")), me.display_name));
  const [step, setStep] = useState<WizardStep>("tipo");
  const [tried, setTried] = useState(false);
  const [active, setActive] = useState<ActiveField | null>(null);
  const [server, setServer] = useState<Issue[]>([]);
  const [saving, setSaving] = useState(false);
  const [serverPreview, setServerPreview] = useState<OperationPreview | null>(null);
  const [result, setResult] = useState<CellarOperation | null>(null);
  const draftRef = useRef(draft);
  const vesselsRef = useRef(vessels);
  const draftIdRef = useRef<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  draftRef.current = draft;
  vesselsRef.current = vessels;
  const vesselQuery = params.get("vessel") ?? "";

  const ensureDraft = useCallback(async (): Promise<string | null> => {
    const run = queueRef.current.then(async () => {
      const current = draftRef.current;
      if (!current.op_type) return null;
      const body = buildPayload(current, vesselsRef.current, legalEntityId);
      const id = draftIdRef.current;
      const saved = id ? await updateOperation(id, body) : await createOperation(body);
      draftIdRef.current = saved.id;
      return saved.id;
    });
    queueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, [legalEntityId]);

  useEffect(() => {
    if (!vesselQuery) return;
    const vessel = vessels.find((item) => item.code === vesselQuery);
    if (!vessel || vessel.status !== "in_service") return;
    setDraft((current) => {
      if (current.inputs.some((line) => line.vessel_code === vessel.code)) return current;
      const base = current.inputs[0] ?? emptyLine();
      if (base.vessel_code) return current;
      const next = withVessel(base, vessel);
      if (vessel.content && current.op_type !== "cleaning" && current.op_type !== "addition" && current.op_type !== "labeling") {
        next.volume_text = mlToEdit(vessel.content.volume_ml);
      }
      return { ...current, inputs: [next, ...current.inputs.slice(1)] };
    });
  }, [vesselQuery, vessels]);

  const balance = useMemo(() => balanceFor(draft), [draft]);
  const issues = useMemo(() => {
    const local = problems(draft, vessels, tried || step === "revision");
    return [...local, ...server];
  }, [draft, vessels, tried, step, server]);
  const ready = useMemo(() => problems(draft, vessels, true).length === 0, [draft, vessels]);
  const effects = effectsFor(draft, vessels);
  const op = draft.op_type;

  useEffect(() => {
    if (step !== "revision" || !op) return;
    let cancel = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const id = await ensureDraft();
          if (!id || cancel) return;
          const next = await previewOperation(id);
          if (!cancel) setServerPreview(next);
        } catch {
          if (!cancel) setServerPreview(null);
        }
      })();
    }, 150);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [step, draft, op, ensureDraft]);

  function change(recipe: (current: Draft) => Draft) {
    setServer([]);
    setDraft(recipe);
  }

  function jump(target: WizardStep) {
    setActive(null);
    setStep(target);
    window.scrollTo({ top: 0 });
  }

  function forward() {
    if (blocksStep(problems(draft, vessels, true), step)) {
      setTried(true);
      return;
    }
    setTried(false);
    setActive(null);
    const following = nextStep(step);
    if (following === "mermas") setDraft((current) => prefillLosses(current));
    setStep(following);
    window.scrollTo({ top: 0 });
  }

  function back() {
    setTried(false);
    setActive(null);
    setStep((current) => prevStep(current));
    window.scrollTo({ top: 0 });
  }

  async function persist(confirm: boolean) {
    if (!op) return;
    if (confirm && problems(draft, vessels, true).length > 0) {
      setTried(true);
      return;
    }
    setSaving(true);
    try {
      const id = await ensureDraft();
      if (!id) return;
      if (!confirm) {
        toast("Borrador guardado");
        return;
      }
      setResult(await confirmOperation(id));
    } catch (error: unknown) {
      setServer(serverIssues(error, draft));
      setStep("revision");
    } finally {
      setSaving(false);
    }
  }

  if (result?.approval_request_id && result.status !== "confirmed") {
    return (
      <div data-screen="bodega-operacion-pendiente" className="mx-auto grid w-full max-w-lg gap-4">
        <Link to="/bodega" className="text-compact text-muted-foreground">
          ← Depósitos
        </Link>
        <PageHeader title={`${opLabel(result.op_type as OpType)} registrada`} description="El vino no se mueve hasta que alguien la apruebe." />
        {result.reason ? <p className="rounded-xl border bg-card p-4 text-body">{result.reason}</p> : null}
        <Link to={`/aprobaciones/${result.approval_request_id}`} className="inline-flex min-h-11 items-center text-body font-medium underline">
          Pendiente de aprobación
        </Link>
      </div>
    );
  }

  if (result?.status === "confirmed") {
    const backCode = draft.inputs[0]?.vessel_code;
    return (
      <div data-screen="bodega-operacion-ok" className="mx-auto grid w-full max-w-lg gap-4">
        <PageHeader title="Operación confirmada" description={result.number ?? "Ya está en el libro de bodega."} />
        {backCode ? (
          <Link to={`/bodega/${backCode}`} className="inline-flex min-h-11 items-center text-body font-medium underline">
            Volver a {backCode}
          </Link>
        ) : (
          <Link to="/bodega" className="text-compact text-muted-foreground">
            ← Depósitos
          </Link>
        )}
      </div>
    );
  }

  const currentIndex = WIZARD_STEPS.findIndex((item) => item.id === step);
  const balanceAttr = !balance ? "na" : balance.ok ? "ok" : balance.text ? "wc020" : "vacio";
  const showKeys = active !== null && step !== "tipo" && step !== "revision";

  return (
    <div
      data-screen="bodega-operacion"
      data-step={step}
      data-op={op || "ninguno"}
      data-balance={balanceAttr}
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4"
    >
      <Link to="/bodega" className="text-compact text-muted-foreground">
        ← Depósitos
      </Link>
      <PageHeader title={op ? `Nueva operación · ${opLabel(op)}` : "Nueva operación"} description={stepHint(op, step)} />
      <div className="grid grid-cols-5 gap-1">
        {WIZARD_STEPS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            disabled={index > currentIndex}
            aria-current={item.id === step ? "step" : undefined}
            className={cn(
              "h-11 truncate rounded-full px-1 text-meta",
              item.id === step ? "bg-ink font-medium text-ink-foreground" : "bg-muted",
              index > currentIndex && "opacity-50",
            )}
            onClick={() => {
              if (index < currentIndex) jump(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {step === "tipo" ? (
        <div className="grid gap-2">
        <div className="grid gap-2 sm:grid-cols-2">
          {OP_TYPES.map((item) => {
            const Icon = ICONS[item.id];
            const on = op === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  change((current) => ({
                    ...current,
                    op_type: item.id,
                    losses: current.losses.map((line) => ({
                      ...line,
                      loss_kind: item.id === "destruction" ? "incident" : line.loss_kind,
                    })),
                  }))
                }
                className={cn("flex min-h-20 items-center gap-3 rounded-xl border-2 bg-card p-3 text-left", on ? "border-ink" : "border-border")}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-body font-semibold">{item.label}</span>
                  <span className="block text-meta text-muted-foreground">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
          <Alerts messages={lineMessages(issues, "tipo", step)} />
        </div>
      ) : null}

      {step === "origenes" && op ? (
        <div className="grid gap-3">
          {draft.inputs.map((line, index) => (
            <LineCard
              key={line.key}
              title={draft.inputs.length > 1 ? `Origen ${index + 1}` : "Origen"}
              line={line}
              index={index}
              list="inputs"
              idPrefix="origen"
              op={op}
              role="input"
              vessels={vessels}
              messages={lineMessages(issues, line.key, step)}
              hideAmount={op === "cleaning" || op === "addition"}
              onVessel={(vessel) =>
                change((current) => ({
                  ...current,
                  inputs: current.inputs.map((item, itemIndex) => {
                    if (itemIndex !== index) return item;
                    const next = withVessel(item, vessel);
                    if (vessel.content && op !== "cleaning" && op !== "addition" && op !== "labeling") {
                      next.volume_text = mlToEdit(vessel.content.volume_ml);
                    }
                    return next;
                  }),
                }))
              }
              onChange={(field, value) =>
                change((current) => ({
                  ...current,
                  inputs: current.inputs.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
                }))
              }
              onFocus={(field) => setActive({ list: "inputs", index, field })}
              onBlur={() => setActive(null)}
              onRemove={draft.inputs.length > 1 ? () => change((current) => ({ ...current, inputs: current.inputs.filter((_, itemIndex) => itemIndex !== index) })) : undefined}
            />
          ))}
          {op !== "cleaning" && op !== "addition" ? (
            <Button type="button" variant="secondary" onClick={() => change((current) => ({ ...current, inputs: [...current.inputs, emptyLine()] }))}>
              Añadir otro origen
            </Button>
          ) : null}
          {op === "addition" ? (
            <div className="grid gap-3 rounded-xl border bg-card p-3">
              <Field id="additive_name" label="Producto" error={lineMessages(issues, "additive_name", step)[0]}>
                <Input id="additive_name" value={draft.additive_name} onChange={(event) => change((current) => ({ ...current, additive_name: event.target.value }))} />
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <Field id="quantity_text" label="Cantidad" error={lineMessages(issues, "quantity_text", step)[0]}>
                  <Input id="quantity_text" inputMode="decimal" value={draft.quantity_text} onChange={(event) => change((current) => ({ ...current, quantity_text: event.target.value }))} />
                </Field>
                <Field id="quantity_unit" label="Unidad">
                  <NativeSelect id="quantity_unit" value={draft.quantity_unit} onChange={(event) => change((current) => ({ ...current, quantity_unit: event.target.value as Draft["quantity_unit"] }))}>
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="l">l</option>
                  </NativeSelect>
                </Field>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <Field id="dose_text" label="Dosis" error={lineMessages(issues, "dose_text", step)[0]}>
                  <Input id="dose_text" inputMode="decimal" value={draft.dose_text} onChange={(event) => change((current) => ({ ...current, dose_text: event.target.value }))} />
                </Field>
                <Field id="dose_unit" label="Unidad">
                  <NativeSelect id="dose_unit" value={draft.dose_unit} onChange={(event) => change((current) => ({ ...current, dose_unit: event.target.value as Draft["dose_unit"] }))}>
                    <option value="g/hl">g/hL</option>
                    <option value="mg/l">mg/L</option>
                    <option value="g/l">g/L</option>
                  </NativeSelect>
                </Field>
              </div>
              <Field id="purpose" label="Para qué">
                <NativeSelect id="purpose" value={draft.purpose} onChange={(event) => change((current) => ({ ...current, purpose: event.target.value as Draft["purpose"] }))}>
                  <option value="sulphiting">Sulfitado</option>
                  <option value="acidification">Acidificación</option>
                  <option value="cleaning">Limpieza</option>
                  <option value="other">Otro</option>
                </NativeSelect>
              </Field>
            </div>
          ) : null}
          {op === "cleaning" ? (
            <div className="grid gap-3 rounded-xl border bg-card p-3">
              <Field id="cleaning_product" label="Producto">
                <Input id="cleaning_product" value={draft.cleaning_product} onChange={(event) => change((current) => ({ ...current, cleaning_product: event.target.value }))} />
              </Field>
              <Field id="active_substance" label="Sustancia activa" error={lineMessages(issues, "active_substance", step)[0]}>
                <Input id="active_substance" value={draft.active_substance} placeholder="Ácido peracético" onChange={(event) => change((current) => ({ ...current, active_substance: event.target.value }))} />
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                <Field id="cleaning_qty" label="Cantidad" error={lineMessages(issues, "cleaning_qty", step)[0]}>
                  <Input id="cleaning_qty" inputMode="decimal" value={draft.cleaning_qty} onChange={(event) => change((current) => ({ ...current, cleaning_qty: event.target.value }))} />
                </Field>
                <Field id="cleaning_unit" label="Unidad">
                  <NativeSelect id="cleaning_unit" value={draft.cleaning_unit} onChange={(event) => change((current) => ({ ...current, cleaning_unit: event.target.value as Draft["cleaning_unit"] }))}>
                    <option value="ml">ml</option>
                    <option value="l">l</option>
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                  </NativeSelect>
                </Field>
              </div>
              <Field id="efficacy_check" label="Comprobación" error={lineMessages(issues, "efficacy_check", step)[0]}>
                <TextArea id="efficacy_check" value={draft.efficacy_check} placeholder="Aclarado y tira de pH" onChange={(event) => change((current) => ({ ...current, efficacy_check: event.target.value }))} />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === "destinos" && op ? (
        <div className="grid gap-3">
          {!destApplies(op) ? (
            <p className="rounded-xl border bg-card p-4 text-body">Esta operación no tiene destino.</p>
          ) : (
            <>
              {op === "blend" || op === "bottling" ? (
                <Field id="new_lot_code" label="Lote nuevo" error={lineMessages(issues, "new_lot_code", step)[0]} hint="Mayúsculas, sin espacios.">
                  <Input
                    id="new_lot_code"
                    value={draft.new_lot_code}
                    autoCapitalize="characters"
                    onChange={(event) => change((current) => ({ ...current, new_lot_code: event.target.value.toUpperCase() }))}
                  />
                </Field>
              ) : null}
              {draft.outputs.map((line, index) => (
                <LineCard
                  key={line.key}
                  title={draft.outputs.length > 1 ? `Destino ${index + 1}` : "Destino"}
                  line={line}
                  index={index}
                  list="outputs"
                  idPrefix="destino"
                  op={op}
                  role="output"
                  vessels={vessels}
                  messages={lineMessages(issues, line.key, step)}
                  onVessel={(vessel) =>
                    change((current) => ({
                      ...current,
                      outputs: current.outputs.map((item, itemIndex) => (itemIndex === index ? withVessel(item, vessel) : item)),
                    }))
                  }
                  onChange={(field, value) =>
                    change((current) => ({
                      ...current,
                      outputs: current.outputs.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
                    }))
                  }
                  onFocus={(field) => setActive({ list: "outputs", index, field })}
                  onBlur={() => setActive(null)}
                  onRemove={
                    draft.outputs.length > 1
                      ? () => change((current) => ({ ...current, outputs: current.outputs.filter((_, itemIndex) => itemIndex !== index) }))
                      : undefined
                  }
                />
              ))}
              <Button type="button" variant="secondary" onClick={() => change((current) => ({ ...current, outputs: [...current.outputs, emptyLine()] }))}>
                Añadir otro destino
              </Button>
            </>
          )}
        </div>
      ) : null}

      {step === "mermas" && op ? (
        <div className="grid gap-3">
          {!lossApplies(op) ? <p className="rounded-xl border bg-card p-4 text-body">Esta operación no tiene merma.</p> : null}
          {lossApplies(op) && op === "destruction" ? (
            <p className="rounded-xl bg-status-warning px-3 py-3 text-compact text-status-warning-fg">Esta destrucción exige aprobación. El vino no se mueve hasta entonces.</p>
          ) : null}
          {lossApplies(op)
            ? draft.losses.map((line, index) => (
                <div key={line.key} className="grid gap-3 rounded-xl border bg-card p-3">
                  <p className="text-compact font-medium">{draft.losses.length > 1 ? `Merma ${index + 1}` : "Merma"}</p>
                  {op === "destruction" ? null : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        aria-pressed={line.loss_kind === "authorized"}
                        className={cn("h-12 rounded-xl border px-2 text-compact", line.loss_kind === "authorized" ? "border-ink bg-ink text-ink-foreground" : "bg-card")}
                        onClick={() =>
                          change((current) => ({
                            ...current,
                            losses: current.losses.map((item, itemIndex) => (itemIndex === index ? { ...item, loss_kind: "authorized" } : item)),
                          }))
                        }
                      >
                        {op === "labeling" ? "Rotura" : "Lías / autorizada"}
                      </button>
                      <button
                        type="button"
                        aria-pressed={line.loss_kind === "incident"}
                        className={cn("h-12 rounded-xl border px-2 text-compact", line.loss_kind === "incident" ? "border-ink bg-ink text-ink-foreground" : "bg-card")}
                        onClick={() =>
                          change((current) => ({
                            ...current,
                            losses: current.losses.map((item, itemIndex) => (itemIndex === index ? { ...item, loss_kind: "incident" } : item)),
                          }))
                        }
                      >
                        Incidencia
                      </button>
                    </div>
                  )}
                  <LineFields
                    line={line}
                    index={index}
                    idPrefix="merma"
                    op={op}
                    role="loss"
                    messages={lineMessages(issues, line.key, step)}
                    onChange={(field, value) =>
                      change((current) => ({
                        ...current,
                        losses: current.losses.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
                      }))
                    }
                    onFocus={(field) => setActive({ list: "losses", index, field })}
                    onBlur={() => setActive(null)}
                  />
                  {op === "loss" || op === "destruction" ? (
                    <>
                      <p className="text-compact text-muted-foreground">{caption(vessels.find((item) => item.code === line.vessel_code))}</p>
                      <VesselChips
                        vessels={vessels}
                        selected={line.vessel_code}
                        onSelect={(vessel) =>
                          change((current) => ({
                            ...current,
                            losses: current.losses.map((item, itemIndex) => (itemIndex === index ? withVessel(item, vessel) : item)),
                          }))
                        }
                      />
                    </>
                  ) : (
                    <p className="text-meta text-muted-foreground">Se descuenta de {draft.inputs[0]?.vessel_code || "el origen"}.</p>
                  )}
                </div>
              ))
            : null}
          {lossApplies(op) && (op === "destruction" || draft.losses.some((line) => line.loss_kind === "incident")) ? (
            <Field id="motivo" label="Motivo" error={lineMessages(issues, "reason", step)[0]}>
              <TextArea id="motivo" value={draft.reason} onChange={(event) => change((current) => ({ ...current, reason: event.target.value }))} />
            </Field>
          ) : null}
          {balance?.text ? <BalanceBanner balance={balance} /> : null}
        </div>
      ) : null}

      {step === "revision" && op ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
          <div className="grid gap-3">
            {balance?.text ? <BalanceBanner balance={balance} /> : null}
            <EffectsPanel preview={serverPreview} fallback={effects} vessels={vessels} draft={draft} />
            {lineMessages(issues, "banner", step).map((message) => (
              <p key={message} role="alert" data-server-error className="rounded-xl bg-status-danger px-3 py-3 text-compact text-status-danger-fg">
                {message}
              </p>
            ))}
            <Summary title="Orígenes" lines={draft.inputs} op={op} role="input" vessels={vessels} lotCode={draft.new_lot_code} issues={issues} onFix={() => jump("origenes")} />
            <Summary title="Destinos" lines={destApplies(op) ? draft.outputs : []} op={op} role="output" vessels={vessels} lotCode={draft.new_lot_code} issues={issues} empty="Sin destino" onFix={() => jump("destinos")} />
            <Summary
              title="Merma"
              lines={lossApplies(op) ? draft.losses.filter((line) => mlOf(op, "loss", line) > 0 || (op === "labeling" && parseQty(line.qty_text) > 0) || lineMessages(issues, line.key, "revision").length > 0) : []}
              op={op}
              role="loss"
              vessels={vessels}
              lotCode={draft.new_lot_code}
              issues={issues}
              empty="Sin merma"
              onFix={() => jump("mermas")}
            />
            {needsApproval(draft) ? (
              <p className="rounded-xl bg-status-warning px-3 py-3 text-compact text-status-warning-fg">Al confirmar quedará pendiente de aprobación y el vino no se mueve hasta entonces.</p>
            ) : null}
          </div>
          <div className="grid gap-3">
            <Field id="occurred_at" label="Fecha" error={lineMessages(issues, "occurred_at", step)[0]}>
              <Input id="occurred_at" type="datetime-local" value={draft.occurred_at} onChange={(event) => change((current) => ({ ...current, occurred_at: event.target.value }))} />
            </Field>
            <Field id="performed_by" label="Quién" error={lineMessages(issues, "performed_by", step)[0]}>
              <Input id="performed_by" value={draft.performed_by} onChange={(event) => change((current) => ({ ...current, performed_by: event.target.value }))} />
            </Field>
          </div>
        </div>
      ) : null}

      <div className={cn("md:hidden", showKeys ? "h-80" : "h-40")} />
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 grid gap-2 border-t bg-background p-3 md:static md:z-auto md:mt-2 md:border-0 md:bg-transparent md:p-0">
        {showKeys && active ? <Keypad onPress={(key) => setDraft((current) => applyKey(current, active, key))} /> : null}
        {step === "revision" ? (
          <div className="grid gap-2">
            <Button type="button" disabled={!ready || saving} aria-describedby={balance && !balance.ok ? "conservacion" : undefined} onClick={() => void persist(true)}>
              {saving ? "Guardando…" : "Confirmar"}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" disabled={saving} onClick={back}>
                Atrás
              </Button>
              <Button type="button" variant="secondary" disabled={!op || saving} onClick={() => void persist(false)}>
                Guardar borrador
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={step === "tipo"} onClick={back}>
              Atrás
            </Button>
            <Button type="button" onClick={forward}>
              Siguiente
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function LineCard({
  title,
  line,
  index,
  list,
  idPrefix,
  op,
  role,
  vessels,
  messages,
  hideAmount,
  onVessel,
  onChange,
  onFocus,
  onBlur,
  onRemove,
}: {
  title: string;
  line: DraftLine;
  index: number;
  list: ActiveField["list"];
  idPrefix: string;
  op: OpType;
  role: LineRole;
  vessels: Vessel[];
  messages: string[];
  hideAmount?: boolean;
  onVessel: (vessel: Vessel) => void;
  onChange: (field: "volume_text" | "qty_text" | "nominal_text", value: string) => void;
  onFocus: (field: ActiveField["field"]) => void;
  onBlur?: () => void;
  onRemove?: () => void;
}) {
  const vessel = vessels.find((item) => item.code === line.vessel_code);
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-3" data-list={list}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-compact font-medium">{title}</h2>
        {onRemove ? (
          <button type="button" className="min-h-11 px-2 text-compact text-muted-foreground" onClick={onRemove}>
            Quitar
          </button>
        ) : null}
      </div>
      <VesselChips vessels={vessels} selected={line.vessel_code} onSelect={onVessel} />
      <p className="text-compact text-muted-foreground">{caption(vessel)}</p>
      {hideAmount ? null : (
        <LineFields line={line} index={index} idPrefix={idPrefix} op={op} role={role} messages={messages} onChange={onChange} onFocus={onFocus} onBlur={onBlur} />
      )}
      {hideAmount ? <Alerts messages={messages} /> : null}
    </section>
  );
}

function LineFields({
  line,
  index,
  idPrefix,
  op,
  role,
  messages,
  onChange,
  onFocus,
  onBlur,
}: {
  line: DraftLine;
  index: number;
  idPrefix: string;
  op: OpType;
  role: LineRole;
  messages: string[];
  onChange: (field: "volume_text" | "qty_text" | "nominal_text", value: string) => void;
  onFocus: (field: ActiveField["field"]) => void;
  onBlur?: () => void;
}) {
  const units = op === "labeling" || (op === "bottling" && role === "output");
  if (units) {
    const qtyId = `${idPrefix}-${index}-unidades`;
    return (
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor={qtyId}>Botellas</Label>
            <span className="text-meta text-muted-foreground tabular-nums">{parseQty(line.qty_text)}</span>
          </div>
          <Input
            id={qtyId}
            inputMode="numeric"
            autoComplete="off"
            value={line.qty_text}
            aria-invalid={messages.length > 0 || undefined}
            className="h-14 text-title tabular-nums md:h-12"
            onFocus={() => onFocus("qty_text")}
            onBlur={onBlur}
            onChange={(event) => onChange("qty_text", event.target.value)}
          />
          <Alerts messages={messages} />
        </div>
        {op === "bottling" && role === "output" ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-${index}-nominal`}>Litros por botella</Label>
            <Input
              id={`${idPrefix}-${index}-nominal`}
              inputMode="decimal"
              autoComplete="off"
              value={line.nominal_text}
              className="h-14 text-title tabular-nums md:h-12"
              onFocus={() => onFocus("nominal_text")}
              onBlur={onBlur}
              onChange={(event) => onChange("nominal_text", event.target.value)}
            />
            <p className="text-meta text-muted-foreground tabular-nums">{formatLitres(mlOf(op, role, line) / 1000)} en total</p>
          </div>
        ) : null}
      </div>
    );
  }
  const id = `${idPrefix}-${index}-volumen`;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>Litros</Label>
        <span className="text-meta text-muted-foreground tabular-nums">{formatLitres(mlOf(op, role, line) / 1000)}</span>
      </div>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={line.volume_text}
        aria-invalid={messages.length > 0 || undefined}
        className="h-14 text-title tabular-nums md:h-12"
        onFocus={() => onFocus("volume_text")}
        onBlur={onBlur}
        onChange={(event) => onChange("volume_text", event.target.value)}
      />
      <Alerts messages={messages} />
    </div>
  );
}

function Summary({
  title,
  lines,
  op,
  role,
  vessels,
  lotCode,
  issues,
  empty,
  onFix,
}: {
  title: string;
  lines: DraftLine[];
  op: OpType;
  role: LineRole;
  vessels: Vessel[];
  lotCode: string;
  issues: Issue[];
  empty?: string;
  onFix: () => void;
}) {
  return (
    <section className="rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-meta font-medium text-muted-foreground">{title}</h2>
        <button type="button" className="min-h-11 px-2 text-compact underline" onClick={onFix}>
          Corregir
        </button>
      </div>
      {lines.length === 0 ? <p className="mt-2 text-compact">{empty}</p> : null}
      <ul className="mt-2 grid gap-2">
        {lines.map((line) => {
          const messages = lineMessages(issues, line.key, "revision");
          return (
            <li key={line.key}>
              <p className="text-body">{describeLine(op, role, line, vessels, lotCode)}</p>
              <Alerts messages={messages} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
